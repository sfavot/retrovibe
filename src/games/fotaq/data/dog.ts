/**
 * Arbres de dialogue (`*.DOG`).
 *
 * Sources (engines/queen/talk.cpp, ScummVM) : `Talk::load` (en-tête et arbre), `Talk::initialTalk` (premières
 * phrases), `Talk::findDialogueString` (sections de phrases), `Talk::getString` (chaînes) et le début de
 * `Talk::talk` (cutscene finale, mise à jour de l'état). Un en-tête de 20 octets de banque AMOS est sauté ;
 * tout est **grand-boutiste**.
 *
 * Disposition (après les 20 octets), tous les décalages comptés depuis ce point :
 * - 0 : `levelMax` (i16, négatif : on ne peut pas quitter le dialogue), `uniqueKey`, `talkKey` (numéro des
 *   voix `TTHHHH…`), `jMax` (phrases de Joe), `pMax` (phrases du personnage), deux triplets de conditions
 *   (état, valeur, objet d'inventaire, `updateGame`), puis les décalages de la section du personnage 1, de la
 *   section de cutscene et de la section du personnage 2 ; deux octets à 28 sont inutilisés et le mot à 30
 *   répète `|levelMax|` (**vérifié** sur les 73 fichiers) ;
 * - 32 : l'arbre, `|levelMax|` niveaux de 6 options de 16 octets (`reserved` : quatre mots que ScummVM saute) ;
 * - `32 + |levelMax| * 96` : section de Joe, `jMax` phrases ; puis la section du personnage 1 (`pMax` phrases)
 *   et la section de cutscene (état, valeur, nom de fichier) ; puis la section du personnage 2 (deux chaînes :
 *   la phrase d'accueil quand Joe a déjà parlé au personnage, et la sienne) ; le reste du fichier est nul.
 * Une phrase de section : mot ignoré, numéro de tête (i16), chaîne alignée sur 4 octets. La première phrase de
 * chaque section a la tête 0 (premier échange, `initialTalk`). Une chaîne est « longueur sur 1 octet, octets,
 * alignement » (la chaîne vide ne consomme que l'octet de longueur) ; le texte est en CP850 ou en Latin-1
 * (`decodeGameText`).
 * Écarts volontaires : toutes les sections sont lues et rendues (ScummVM les cherche à la demande) ; les
 * enchaînements de sections sont **vérifiés** (chaque section finit exactement où la suivante commence, aux
 * zéros de remplissage près : `padding`) ; `CHIEF1.DOG` et `CHIEF2.DOG` sont lus depuis `queen.1c` comme les
 * autres (ScummVM préfère un fichier du dossier du jeu pour le français, qui n'existe pas ici).
 */

import { BinaryReader } from "../../../data/reader";
import { decodeGameText, gameTextEncoding, type TextEncoding } from "./text";

export const DOG_HEADER_SIZE = 20;
const TREE_OFFSET = 32;
const OPTIONS_PER_LEVEL = 6;
const OPTION_SIZE = 16;
const LEVEL_SIZE = OPTIONS_PER_LEVEL * OPTION_SIZE;

export interface DogOption {
  /** Numéro de tête de la phrase (-1 : option retirée). */
  head: number;
  /** « Valeur de nœud 1 » de ScummVM : suite de l'échange (-1 : option retirée). */
  node: number;
  /** Condition : si négatif, l'option n'est offerte que si l'état `|stateIndex|` vaut `stateValue`. */
  stateIndex: number;
  stateValue: number;
  /** Mots que ScummVM ne lit pas (positions 0, 2, 4 et 6). */
  reserved: [number, number, number, number];
}

export interface DogSentence {
  /** Numéro de tête (0 : premier échange). */
  head: number;
  text: string;
  /** Encodage des octets de la phrase (`gameTextEncoding`). */
  encoding: TextEncoding;
}

export interface DogCondition {
  /** État à tester (0 ou négatif : aucun). */
  state: number;
  value: number;
  /** Objet d'inventaire à ajouter (> 0) ou retirer (< 0) si la condition est vraie. */
  item: number;
}

export interface DogDialog {
  /** Nombre de niveaux (valeur absolue de `levelMax`). */
  levelCount: number;
  /** Vrai si le joueur ne peut pas quitter le dialogue (`levelMax` < 0). */
  cannotQuit: boolean;
  uniqueKey: number;
  talkKey: number;
  jMax: number;
  pMax: number;
  /** Les deux conditions de fin de dialogue. */
  conditions: [DogCondition, DogCondition];
  /** `tree[niveau - 1][option]` : niveaux numérotés à partir de 1 dans ScummVM, options de 0 à 5. */
  tree: DogOption[][];
  /** Phrases de Joe (options proposées). */
  joeSentences: DogSentence[];
  /** Phrases du personnage 1 (réponses). */
  personSentences: DogSentence[];
  /** Cutscene de fin : jouée si l'état `state` vaut `value`. */
  cutaway: { state: number; value: number; file: string };
  /** Phrase d'accueil quand Joe a déjà parlé au personnage (`'0'` : aucune) et la réplique de Joe. */
  person2: { greeting: string; joe: string };
  /** Mot à 30 (copie de `levelCount`) et mot à 28, tels que lus. */
  reservedHeader: [number, number];
  /** Octets nuls entre les sections et à la fin du fichier. */
  padding: number;
}

function readString(reader: BinaryReader, align: number): string {
  const length = reader.u8();
  if (length === 0) return "";
  const text = decodeGameText(reader.bytesView(length));
  reader.offset = (reader.offset + align - 1) & ~(align - 1);
  return text;
}

function readSentences(reader: BinaryReader, bytes: Uint8Array, start: number, count: number): DogSentence[] {
  reader.offset = start;
  const sentences: DogSentence[] = [];
  for (let i = 0; i < count; i++) {
    reader.u16be();
    const head = reader.i16be();
    const length = bytes[reader.offset];
    const encoding = gameTextEncoding(bytes.subarray(reader.offset + 1, reader.offset + 1 + length));
    sentences.push({ head, text: readString(reader, 4), encoding });
  }
  return sentences;
}

export function parseDog(file: Uint8Array): DogDialog {
  if (file.length < DOG_HEADER_SIZE + TREE_OFFSET) throw new Error("DOG invalide : fichier trop court");
  const bytes = file.subarray(DOG_HEADER_SIZE);
  const reader = new BinaryReader(bytes);
  const levelMax = reader.i16be();
  const levelCount = Math.abs(levelMax);
  const uniqueKey = reader.i16be();
  const talkKey = reader.i16be();
  const jMax = reader.i16be();
  const pMax = reader.i16be();
  const conditions: DogCondition[] = [];
  for (let i = 0; i < 2; i++) conditions.push({ state: reader.i16be(), value: reader.i16be(), item: reader.i16be() });
  const personOffset = reader.u16be();
  const cutawayOffset = reader.u16be();
  const person2Offset = reader.u16be();
  const reservedHeader: [number, number] = [reader.u16be(), reader.u16be()];

  const joeOffset = TREE_OFFSET + levelCount * LEVEL_SIZE;
  if (joeOffset > bytes.length) throw new Error("DOG invalide : arbre tronqué");

  reader.offset = TREE_OFFSET;
  const tree: DogOption[][] = [];
  for (let level = 0; level < levelCount; level++) {
    const options: DogOption[] = [];
    for (let j = 0; j < OPTIONS_PER_LEVEL; j++) {
      const w0 = reader.u16be();
      const head = reader.i16be();
      const w2 = reader.u16be();
      const node = reader.i16be();
      const w4 = reader.u16be();
      const stateIndex = reader.i16be();
      const w6 = reader.u16be();
      const stateValue = reader.i16be();
      options.push({ head, node, stateIndex, stateValue, reserved: [w0, w2, w4, w6] });
    }
    tree.push(options);
  }

  const expectEnd = (what: string, actual: number, wanted: number) => {
    if (actual !== wanted) throw new Error(`DOG invalide : ${what} finit en ${actual}, attendu ${wanted}`);
  };

  const joeSentences = readSentences(reader, bytes, joeOffset, jMax);
  expectEnd("la section de Joe", reader.offset, personOffset);
  const personSentences = readSentences(reader, bytes, personOffset, pMax);
  expectEnd("la section du personnage", reader.offset, cutawayOffset);

  reader.offset = cutawayOffset;
  const cutawayState = reader.i16be();
  const cutawayValue = reader.i16be();
  const cutawayFile = readString(reader, 2);
  // La section de cutscene est suivie d'un remplissage de 0 à 3 octets (alignement sur 4).
  if (reader.offset > person2Offset || person2Offset - reader.offset > 3) throw new Error("DOG invalide : cutscene et personnage 2 non contigus");
  let padding = person2Offset - reader.offset;
  for (let i = reader.offset; i < person2Offset; i++) if (bytes[i] !== 0) throw new Error("DOG invalide : octets de remplissage non nuls");

  reader.offset = person2Offset;
  const greeting = readString(reader, 2);
  const joe = readString(reader, 2);
  for (let i = reader.offset; i < bytes.length; i++) if (bytes[i] !== 0) throw new Error("DOG invalide : données après la dernière chaîne");
  padding += bytes.length - reader.offset;

  return {
    levelCount,
    cannotQuit: levelMax < 0,
    uniqueKey,
    talkKey,
    jMax,
    pMax,
    conditions: [conditions[0], conditions[1]],
    tree,
    joeSentences,
    personSentences,
    cutaway: { state: cutawayState, value: cutawayValue, file: cutawayFile },
    person2: { greeting, joe },
    reservedHeader,
    padding,
  };
}
