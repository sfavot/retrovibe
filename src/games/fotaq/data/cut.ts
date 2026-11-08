/**
 * Cinématiques scriptées, « cutaways » (`*.CUT`).
 *
 * Sources (engines/queen/cutaway.cpp et cutaway.h, ScummVM) : `Cutaway::load` (en-tête), `loadStrings` (noms de
 * banques, dialogue de fin), `getCutawayObject`, `turnOnPeople`, `getObjectType`, `handleAnimation` /
 * `getCutawayAnim`, `Cutaway::run` (ordre de lecture), `stop` et `updateGameState` (section d'états),
 * `Talk::getString` (chaînes). Un en-tête de 20 octets de banque AMOS est sauté ; tout est **grand-boutiste** ;
 * les décalages comptent depuis ce point.
 *
 * Disposition : en-tête de 12 octets (panneau `u16`, nombre d'objets `i16` négatif si non sautable, drapeaux
 * `i16` négatif si pièce finale, trois décalages : états du jeu, phrases, noms de banques) ; les objets à partir
 * de 12 ; quelques mots de fin (`recordsTrailer`, que ScummVM ne lit pas) jusqu'à la section d'états ; états
 * (nombre, 6 mots chacun, puis pièce / x / y finals de Joe) ; section des états finaux, que `Cutaway::stop` ne lit que si la cinématique est sautée
 * (`extra` : nombre, 7 mots chacun, 2 mots) ; phrases (une chaîne d'entrée, puis une par objet) ; noms de
 * banques (nombre, chaînes), nom du fichier de dialogue de fin et personne à qui Joe parle.
 *
 * Un objet : 17 mots, le nombre de personnes à allumer et leurs numéros ; si l'objet est une animation exécutée,
 * une chaîne d'animations (en-tête = objet, puis 9 mots, jusqu'à `-2`). La **nature** de l'objet (`kind`) vient de
 * `getObjectType` ; elle dépend d'un fait des données logiques (un objet est-il une personne : image -3 ou -4 ?),
 * donc `parseCutaway` prend `isPerson`. La structure, elle, ne dépend pas de cette réponse sur les 302 fichiers
 * du jeu (vérifié par test), contrairement à ce que la lecture du code laissait craindre.
 * Écarts volontaires : les champs sont rendus tels que dans le fichier sauf `song` (déduit de `limitBobX1` négatif,
 * comme ScummVM) et le sens de `flip` (déduit d'une image négative) ; `-1` (fondu de pièce) est rendu par
 * `roomFade` avec l'objet 0 ; les noms de banques vides sont retirés comme dans ScummVM (les numéros de banque
 * des animations comptent à partir de 1 dans cette liste). Toutes les sections sont lues et leurs bornes
 * vérifiées (l'enchaînement tombe exactement sur la section suivante, aux zéros de remplissage près).
 */

import { BinaryReader } from "../../../data/reader";
import { decodeGameText, gameTextEncoding, type TextEncoding } from "./text";

export const CUT_HEADER_SIZE = 20;
const OBJECTS_OFFSET = 12;
const MAX_PEOPLE = 6;
const MAX_ANIMATION_HEADER = 1000;
const ANIMATION_END = -2;
const EXTRA_ENTRY_WORDS = 7;

/** `ObjectType` de ScummVM. */
export type CutObjectKind = "animation" | "person" | "noAnimation" | "textSpeak" | "textDisplayAndSpeak" | "textDisplay";

export interface CutAnimation {
  /** Objet dont l'animation est décrite (0 : Joe ; `-1` du fichier est rendu 0, comme ScummVM). */
  object: number;
  /** Numéro d'image de la banque (positif ; voir `flip`). */
  unpackFrame: number;
  flip: boolean;
  /** Vitesse du fichier ; ScummVM utilise `speed / 3 + 1`. */
  speed: number;
  /** Banque : 0 objets de la pièce (15), 13 Joe (7), sinon rang + 1 dans `bankNames`. */
  bank: number;
  mx: number;
  my: number;
  cx: number;
  cy: number;
  scale: number;
  song: number;
}

export interface CutObject {
  /** 0 Joe, -1 fondu de pièce (voir `roomFade`), -2 à -4 texte, > 0 objet du jeu. */
  objectNumber: number;
  roomFade: boolean;
  moveToX: number;
  moveToY: number;
  bank: number;
  animList: number;
  execute: number;
  /** Bornes du bob (`limitBobX1` à `Y2`) ; `x1` vaut 0 si le fichier y mettait un morceau. */
  limit: { x1: number; y1: number; x2: number; y2: number };
  /** Morceau à jouer (> 0), codé par un `limitBobX1` négatif. */
  song: number;
  specialMove: number;
  animType: number;
  fromObject: number;
  bobStartX: number;
  bobStartY: number;
  room: number;
  scale: number;
  /** Personnes à allumer (numéros d'objets). */
  people: number[];
  kind: CutObjectKind;
  /** Chaîne d'animations (vide sauf pour `kind === "animation"`). */
  animations: CutAnimation[];
  /** Phrase de l'objet (`*` : rien à dire ; `#NOM` : générique ; commandes `*` des répliques). */
  sentence: string;
  /** Encodage des octets de la phrase (`gameTextEncoding`). */
  sentenceEncoding: TextEncoding;
}

export interface CutState {
  /** > 0 : tester ; <= 0 : positionner l'état `|stateIndex|`. */
  stateIndex: number;
  stateValue: number;
  /** > 0 : montrer l'objet, < 0 : le cacher. */
  object: number;
  area: number;
  areaSubIndex: number;
  fromObject: number;
}

export interface Cutaway {
  /** Mode d'écran : 0 et 2 lancent la scène (panneau), 1 plein écran… (`comPanel`). */
  panel: number;
  /** Faux si le compteur d'objets est négatif : la cinématique ne se saute pas. */
  skippable: boolean;
  /** Drapeaux (`flags1`) : < 0 pièce finale (`-flags`), 1 enchaîne une autre cinématique. */
  flags: number;
  finalRoom: number;
  anotherCutaway: boolean;
  objectCount: number;
  /** Phrase d'entrée : orientation de Joe (`*FL`, `*FR`, `*FF`, `*FB`) ou vide. */
  entrySentence: string;
  objects: CutObject[];
  /** Mots de fin de la section des objets que ScummVM ne lit pas. */
  recordsTrailer: number[];
  states: CutState[];
  /** Pièce et position finales de Joe (0 : inchangé). */
  joeFinal: { room: number; x: number; y: number };
  /** États finaux lus par `Cutaway::stop` quand la cinématique est sautée : `entries` de 7 mots, puis le mouvement spécial et le morceau de fin. */
  extra: { entries: number[][]; trailer: [number, number] };
  /** Nombre de noms de banques déclaré, vides compris. */
  bankNameCount: number;
  /** Noms de banques non vides (`CUTAWAY_BANK` : la première est chargée au début). */
  bankNames: string[];
  /** Fichier de dialogue de fin (`*.DOG`), vide ou `*` si aucun. */
  talkFile: string;
  /** Objet à qui Joe parle à la fin. */
  talkTo: number;
}

function readString(reader: BinaryReader): string {
  return readEncodedString(reader).text;
}

function readEncodedString(reader: BinaryReader): { text: string; encoding: TextEncoding } {
  const length = reader.u8();
  if (length === 0) return { text: "", encoding: "ascii" };
  const raw = reader.bytesView(length);
  reader.offset = (reader.offset + 1) & ~1;
  return { text: decodeGameText(raw), encoding: gameTextEncoding(raw) };
}

/** `getObjectType` de ScummVM (après remplacement de `-1` par l'objet 0). */
function objectKind(object: Omit<CutObject, "kind" | "animations" | "sentence" | "sentenceEncoding">, isPerson: (objectNumber: number) => boolean): CutObjectKind {
  let kind: CutObjectKind = "animation";
  if (object.objectNumber > 0) {
    if (!object.animList && isPerson(object.objectNumber)) kind = "person";
  } else if (object.objectNumber === 0 && !object.animList) {
    kind = "person";
  }
  if (object.fromObject > 0) kind = "noAnimation";
  if (object.objectNumber === -2) kind = "textSpeak";
  else if (object.objectNumber === -3) kind = "textDisplayAndSpeak";
  else if (object.objectNumber === -4) kind = "textDisplay";
  if (kind === "animation" && !object.execute) kind = "noAnimation";
  return kind;
}

/**
 * Lit une cinématique. `isPerson(n)` dit si l'objet `n` du jeu est une personne (image -3 ou -4 dans
 * `QUEEN.JAS`) : il décide `kind` des objets sans liste d'animations, pas la structure du fichier.
 */
export function parseCutaway(file: Uint8Array, isPerson: (objectNumber: number) => boolean): Cutaway {
  if (file.length < CUT_HEADER_SIZE + OBJECTS_OFFSET) throw new Error("CUT invalide : fichier trop court");
  const bytes = file.subarray(CUT_HEADER_SIZE);
  const reader = new BinaryReader(bytes);
  const panel = reader.u16be();
  const countWord = reader.i16be();
  const flags = reader.i16be();
  const statesOffset = reader.u16be();
  const sentencesOffset = reader.u16be();
  const bankNamesOffset = reader.u16be();
  const objectCount = Math.abs(countWord);
  const fail = (message: string): never => {
    throw new Error(`CUT invalide : ${message}`);
  };
  if (statesOffset > sentencesOffset || sentencesOffset > bankNamesOffset || bankNamesOffset > bytes.length) fail("sections hors ordre");

  const objects: Omit<CutObject, "sentence" | "sentenceEncoding">[] = [];
  for (let i = 0; i < objectCount; i++) {
    const objectWord = reader.i16be();
    const base = {
      objectNumber: objectWord,
      roomFade: objectWord === -1,
      moveToX: reader.i16be(),
      moveToY: reader.i16be(),
      bank: reader.i16be(),
      animList: reader.i16be(),
      execute: reader.i16be(),
    };
    const limitX1 = reader.i16be();
    const limit = { x1: limitX1 < 0 ? 0 : limitX1, y1: reader.i16be(), x2: reader.i16be(), y2: reader.i16be() };
    const rest = {
      specialMove: reader.i16be(),
      animType: reader.i16be(),
      fromObject: reader.i16be(),
      bobStartX: reader.i16be(),
      bobStartY: reader.i16be(),
      room: reader.i16be(),
      scale: reader.i16be(),
    };
    const peopleCount = reader.i16be();
    if (peopleCount < 0 || peopleCount > MAX_PEOPLE) fail(`${peopleCount} personnes à allumer`);
    const people: number[] = [];
    for (let p = 0; p < peopleCount; p++) people.push(reader.i16be());

    const head = { ...base, objectNumber: base.roomFade ? 0 : objectWord, limit, song: limitX1 < 0 ? -limitX1 : 0, ...rest, people };
    const kind = objectKind(head, isPerson);
    const animations: CutAnimation[] = [];
    if (kind === "animation") {
      for (;;) {
        const header = reader.i16be();
        if (header === ANIMATION_END) break;
        if (header > MAX_ANIMATION_HEADER) fail("en-tête d'animation trop grand");
        const unpackFrame = reader.i16be();
        animations.push({
          object: header === -1 ? 0 : header,
          unpackFrame: Math.abs(unpackFrame),
          flip: unpackFrame < 0,
          speed: reader.i16be(),
          bank: reader.i16be(),
          mx: reader.i16be(),
          my: reader.i16be(),
          cx: reader.i16be(),
          cy: reader.i16be(),
          scale: reader.i16be(),
          song: reader.i16be(),
        });
      }
    }
    objects.push({ ...head, kind, animations });
  }
  if (reader.offset > statesOffset || (statesOffset - reader.offset) % 2 !== 0) fail("la section des objets déborde sur les états");
  const recordsTrailer: number[] = [];
  while (reader.offset < statesOffset) recordsTrailer.push(reader.i16be());

  const stateCount = reader.i16be();
  const states: CutState[] = [];
  for (let i = 0; i < stateCount; i++) {
    states.push({
      stateIndex: reader.i16be(),
      stateValue: reader.i16be(),
      object: reader.i16be(),
      area: reader.i16be(),
      areaSubIndex: reader.i16be(),
      fromObject: reader.i16be(),
    });
  }
  const joeFinal = { room: reader.u16be(), x: reader.u16be(), y: reader.u16be() };

  const extraCount = reader.i16be();
  const entries: number[][] = [];
  for (let i = 0; i < extraCount; i++) {
    const words: number[] = [];
    for (let w = 0; w < EXTRA_ENTRY_WORDS; w++) words.push(reader.i16be());
    entries.push(words);
  }
  const extra = { entries, trailer: [reader.i16be(), reader.i16be()] as [number, number] };
  if (reader.offset !== sentencesOffset) fail(`les états finissent en ${reader.offset}, attendu ${sentencesOffset}`);

  const entrySentence = readString(reader);
  const sentences: { text: string; encoding: TextEncoding }[] = [];
  for (let i = 0; i < objectCount; i++) sentences.push(readEncodedString(reader));
  for (let i = reader.offset; i < bankNamesOffset; i++) if (bytes[i] !== 0) fail("octets de remplissage non nuls avant les noms de banques");
  if (reader.offset > bankNamesOffset) fail("les phrases débordent sur les noms de banques");

  reader.offset = bankNamesOffset;
  const bankNameCount = reader.u16be();
  const bankNames: string[] = [];
  for (let i = 0; i < bankNameCount; i++) {
    const name = readString(reader);
    if (name) bankNames.push(name);
  }
  const talkFile = readString(reader);
  const talkTo = reader.i16be();
  for (let i = reader.offset; i < bytes.length; i++) if (bytes[i] !== 0) fail("données après le dernier champ");

  return {
    panel,
    skippable: countWord >= 0,
    flags,
    finalRoom: flags < 0 ? -flags : 0,
    anotherCutaway: flags === 1,
    objectCount,
    entrySentence,
    objects: objects.map((object, i) => ({ ...object, sentence: sentences[i].text, sentenceEncoding: sentences[i].encoding })),
    recordsTrailer,
    states,
    joeFinal,
    extra,
    bankNameCount,
    bankNames,
    talkFile,
    talkTo,
  };
}
