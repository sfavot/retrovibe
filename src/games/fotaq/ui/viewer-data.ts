/**
 * Logique pure de la visionneuse de ressources de Flight of the Amazon Queen (sans DOM, testée) : groupes de la
 * barre latérale, palette composée, pièces et objets de `QUEEN.JAS`, arbre d'un `.DOG`, champs d'une section
 * « supplémentaire » de `.CUT`, rattachement d'une voix à son texte, résumé d'une table de morceaux.
 */
import type { BankSong } from "../data/music";
import type { Cutaway, CutObject } from "../data/cut";
import type { DogDialog, DogOption, DogSentence } from "../data/dog";
import { baseName, cutawayVoicePrefix, extensionOf, parseVoiceName, stemOf, voiceFile, type GameFiles, type VoiceName } from "../data/files";
import type { Box, QueenJas } from "../data/jas";
import { LIGHT_TABLE_ROWS, MASK_COLUMNS, MASK_SIZE } from "../data/dynalum";
import { splitSpeech, voiceSuffix, type GameTexts } from "../data/text";

/** Nom d'un fichier sans dossier ni extension, en majuscules. */
export function stem(path: string): string {
  return stemOf(baseName(path)).toUpperCase();
}

/** Couleurs du décor gardées dans la palette d'une pièce (0 à 143) ; 144 à 255 viennent du panneau (`getNumColorsForRoom`, **lu**). */
export const ROOM_COLORS = 144;
/** Pièces dont le décor garde ses 256 couleurs (114 à 125, **lu**). */
export const FULL_PALETTE_ROOMS: readonly [number, number] = [114, 125];

/** Palette d'une pièce : couleurs 0 à `colors - 1` du décor, les autres du panneau. */
export function composePalette(decor: Uint8Array, panel: Uint8Array, colors = ROOM_COLORS): Uint8Array {
  const out = new Uint8Array(768);
  out.set(decor.subarray(0, colors * 3), 0);
  out.set(panel.subarray(colors * 3, 768), colors * 3);
  return out;
}

// --- Groupes de la barre latérale ----------------------------------------------------------------------------

/**
 * Groupe (dossier de la barre latérale) d'un fichier. Les voix sont classées par leur nom ; `cutaways` (noms des
 * `.CUT`) départage `MON_0001` (un effet) d'un nom de cinématique.
 */
export function familyOf(files: GameFiles): (entry: { path: string }) => string {
  const cutaways = new Set(files.cutaways());
  return ({ path }) => family(path, cutaways);
}

export function family(path: string, cutaways?: ReadonlySet<string>): string {
  const name = baseName(path).toUpperCase();
  switch (extensionOf(path)) {
    case "PCX":
      return "Images : décors et écrans (PCX)";
    case "BBK":
      return "Banques : objets et personnages (BBK)";
    case "ACT":
      return "Banques : acteurs (ACT)";
    case "SAM":
      return "Banques : sprites (SAM, pas des sons)";
    case "MSK":
    case "LUM":
      return "Pièces : masques et lumière (MSK, LUM)";
    case "JAS":
      return name === "QUEEN.JAS" ? "Données logiques" : "Textes";
    case "DOG":
      return "Dialogues (DOG)";
    case "CUT":
      return "Cinématiques (CUT)";
    case "CRD":
      return "Génériques";
    case "RL":
    case "MUS":
      return "Musique : tables de morceaux (MIDI)";
    case "TXT":
      return "Documentation";
    case "MP3": {
      const voice = parseVoiceName(path, cutaways);
      switch (voice.kind) {
        case "dialog":
        case "dialogOpening":
          return `Voix : dialogue ${String(voice.talkKey).padStart(2, "0")}`;
        case "cutaway":
          return `Voix : cinématique ${voice.cutaway}`;
        case "joe":
          return voice.number <= 40 ? "Voix : Joe, réponses" : "Voix : Joe, descriptions";
        default:
          return "Voix : effets";
      }
    }
    default:
      return name === "DATA" ? "Génériques" : "Autres";
  }
}

// --- Pièces et objets de QUEEN.JAS ---------------------------------------------------------------------------

/** Pièces (numéros) qui portent un nom d'image, en majuscules (`B1` -> [20]) : plusieurs pièces partagent un décor (`N8`, `N9`…). */
export function roomsByImage(texts: GameTexts): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let room = 1; room < texts.roomNames.length; room++) {
    const name = texts.roomNames[room].toUpperCase();
    if (!name) continue;
    const list = map.get(name);
    if (list) list.push(room);
    else map.set(name, [room]);
  }
  return map;
}

/** Numéros des objets de la pièce `room` (à partir de 1). */
export function roomObjectNumbers(jas: QueenJas, room: number): number[] {
  const first = jas.roomFirstObject[room];
  const last = jas.roomFirstObject[room + 1];
  if (first === undefined || last === undefined) return [];
  const numbers: number[] = [];
  for (let n = first + 1; n <= last; n++) numbers.push(n);
  return numbers;
}

/** Nom d'un objet (`name` négatif : caché, 0 : supprimé). */
export function objectName(jas: QueenJas, texts: GameTexts, object: number): string {
  const name = jas.objects[object]?.name ?? 0;
  if (name === 0) return "(supprimé)";
  const text = texts.objectNames[Math.abs(name)] ?? "";
  return name < 0 ? `${text} (caché)` : text;
}

export interface RoomObjectRow {
  number: number;
  name: string;
  box: Box;
  x: number;
  y: number;
  state: number;
  image: number;
  /** Pièce enregistrée dans l'objet (différente de la pièce qui le contient pour quelques-uns, ex. l'objet 260). */
  ownRoom: number;
  description: string;
}

export function roomObjects(jas: QueenJas, texts: GameTexts, room: number): RoomObjectRow[] {
  return roomObjectNumbers(jas, room).map((number) => {
    const object = jas.objects[number];
    return {
      number,
      name: objectName(jas, texts, number),
      box: jas.objectBoxes[number],
      x: object.x,
      y: object.y,
      state: object.state,
      image: object.image,
      ownRoom: object.room,
      description: texts.objectDescriptions[object.description] ?? "",
    };
  });
}

/** Zones voisines lues dans les bits de `mapNeighbors` (bit `n` : zone `n + 1`) : lecture **supposée**, la valeur brute est toujours affichée avec. */
export function neighborAreas(mask: number): number[] {
  const out: number[] = [];
  for (let bit = 0; bit < 16; bit++) if ((mask >> bit) & 1) out.push(bit + 1);
  return out;
}

export function boxText(box: Box): string {
  return `${box.x1},${box.y1} - ${box.x2},${box.y2}`;
}

export function boxContains(box: Box, x: number, y: number): boolean {
  return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2;
}

/** Classe de hauteur d'un décor (`formats.md`, § 11 : la hauteur ne dit pas à elle seule si le panneau s'affiche). */
export function decorHeightClass(height: number): "150" | "200" | "autre" {
  return height === 150 ? "150" : height === 200 ? "200" : "autre";
}

/** Pièces « d'écran » (cinématiques, écrans fixes, génériques) : 76 à 96 et 105 à 126 ; les autres sont des pièces de jeu. */
export function isGameRoom(room: number): boolean {
  return room <= 75 || (room >= 97 && room <= 104);
}

// --- Masque de lumière ----------------------------------------------------------------------------------------

export const MASK_ROWS = MASK_SIZE / MASK_COLUMNS;

/** Nombre de cellules par ligne de la table (0 à 7) et hors table (clé `other`, ex. 255). */
export function maskHistogram(mask: Uint8Array): { rows: number[]; other: number } {
  const rows = new Array<number>(LIGHT_TABLE_ROWS).fill(0);
  let other = 0;
  for (const value of mask) {
    if (value < LIGHT_TABLE_ROWS) rows[value]++;
    else other++;
  }
  return { rows, other };
}

/** Couleur CSS d'une ligne de la table dans la superposition du masque. */
export function maskRowColor(row: number, alpha = 0.45): string {
  if (row >= LIGHT_TABLE_ROWS) return `rgba(255,255,255,${alpha})`;
  return `hsla(${Math.round((row * 360) / LIGHT_TABLE_ROWS)},85%,55%,${alpha})`;
}

// --- Section « supplémentaire » d'un .CUT --------------------------------------------------------------------

/**
 * Champs d'une entrée de la section `extra` (**constaté**, vague V, sur les 333 entrées des 302 fichiers) : nouvelles
 * valeurs de l'objet à la fin de la cinématique, dans l'ordre de `ObjectData` : objet, objet associé, x, y, pièce
 * (identique à la pièce de l'objet dans 323 cas sur 333), image, état. Position : celle du départ ou de la marche du dernier
 * enregistrement de l'objet qui en a une (230 entrées sur 230 non nulles). Image : dernière image de
 * l'animation de l'objet, négative si elle est en miroir, 1000 si l'animation finit sur l'image 0 (231 sur 234 ayant
 * une animation propre). Seul l'état (0 à 5) reste **supposé**.
 */
export interface CutExtraEntry {
  object: number;
  entryObject: number;
  x: number;
  y: number;
  room: number;
  image: number;
  /** Supposé : `state` de l'objet (0 à 5). */
  state: number;
}

export function cutExtraEntry(words: readonly number[]): CutExtraEntry {
  return { object: words[0], entryObject: words[1], x: words[2], y: words[3], room: words[4], image: words[5], state: words[6] };
}

/**
 * Positions du dernier enregistrement de l'objet qui en a une : départ du bob, destination de marche (les deux si
 * le fichier les donne). Vide si l'objet n'a jamais de position non nulle.
 */
export function lastObjectPositions(cut: Cutaway, object: number): { x: number; y: number }[] {
  let found: { x: number; y: number }[] = [];
  for (const record of cut.objects) {
    if (record.objectNumber !== object) continue;
    const positions: { x: number; y: number }[] = [];
    if (record.bobStartX || record.bobStartY) positions.push({ x: record.bobStartX, y: record.bobStartY });
    if (record.moveToX || record.moveToY) positions.push({ x: record.moveToX, y: record.moveToY });
    if (positions.length > 0) found = positions;
  }
  return found;
}

/** Image attendue d'après la dernière animation de l'objet (voir `CutExtraEntry`) ; `null` si l'objet n'a pas d'animation propre. */
export function lastObjectImage(cut: Cutaway, object: number): number | null {
  let last: { unpackFrame: number; flip: boolean } | null = null;
  for (const record of cut.objects) {
    if (record.objectNumber !== object) continue;
    for (const animation of record.animations) if (animation.object === object) last = animation;
  }
  if (!last) return null;
  return last.unpackFrame === 0 ? 1000 : last.flip ? -last.unpackFrame : last.unpackFrame;
}

// --- Arbre d'un .DOG ------------------------------------------------------------------------------------------

export interface DogOptionView {
  /** Rang de l'option dans le niveau (1 à 5 : la 0 est l'en-tête du niveau). */
  index: number;
  option: DogOption;
  joe: DogSentence | undefined;
  person: DogSentence | undefined;
  /** Tête du niveau suivant ; `null` : fin du dialogue (-1) ; `undefined` : aucun niveau de cette tête. */
  next: number | null | undefined;
}

export interface DogLevelView {
  /** Tête du niveau (tête de son option 0) ; le niveau de départ est celui de tête 1. */
  head: number;
  options: DogOptionView[];
}

/**
 * Niveaux d'un arbre de dialogue (**constaté**, vague V) : l'option 0 d'un niveau porte la tête qui nomme le niveau
 * (valeur de nœud 0) ; les autres options sont des répliques de Joe de cette tête (puis la réponse du personnage de
 * même tête) et leur valeur de nœud est la tête du niveau suivant, -1 mettant fin au dialogue. Les options retirées
 * (tête -1) ne sont pas listées.
 */
export function dogLevels(dog: DogDialog): DogLevelView[] {
  const heads = new Set(dog.tree.map((level) => level[0].head));
  const joe = new Map(dog.joeSentences.map((sentence) => [sentence.head, sentence]));
  const person = new Map(dog.personSentences.map((sentence) => [sentence.head, sentence]));
  return dog.tree.map((level) => ({
    head: level[0].head,
    options: level
      .map((option, index) => ({ option, index }))
      .filter(({ option, index }) => index > 0 && option.head !== -1)
      .map(({ option, index }) => ({
        index,
        option,
        joe: joe.get(option.head),
        person: person.get(option.head),
        next: option.node === -1 ? null : heads.has(option.node) ? option.node : undefined,
      })),
  }));
}

// --- Voix ----------------------------------------------------------------------------------------------------

export interface SentenceVoice {
  /** Rang du segment (à partir de 1). */
  segment: number;
  text: string;
  /** Nom de la voix (sans extension), ou `null` pour un segment sans voix (`*GD`, `*GM`). */
  voice: string | null;
  exists: boolean;
}

/** Voix de chaque segment d'une réplique : `<préfixe><rang en hexadécimal>`, sauf les segments « saisir » (`splitSpeech`) et les segments vides sans fichier. */
export function sentenceVoices(prefix: string, sentence: string, has: (path: string) => boolean): SentenceVoice[] {
  return splitSpeech(sentence).map((segment) => {
    if (segment.command.kind === "grab") return { segment: segment.index + 1, text: segment.text, voice: null, exists: false };
    const voice = `${prefix}${voiceSuffix(segment.index)}`;
    const exists = has(voiceFile(voice));
    // Un segment vide (deux commandes qui se suivent, `*05*04`) n'est pas dit : pas de voix attendue.
    if (!exists && segment.text === "") return { segment: segment.index + 1, text: "", voice: null, exists: false };
    return { segment: segment.index + 1, text: segment.text, voice, exists };
  });
}

/** Un objet de cinématique qui peut parler : sa phrase et les voix de ses segments (un texte dit n'a que le segment 1). */
export function cutObjectVoices(cutName: string, rank: number, object: CutObject, has: (path: string) => boolean): SentenceVoice[] {
  if (object.sentence === "*" || object.sentence === "") return [];
  const prefix = cutawayVoicePrefix(cutName, rank);
  const spokenText = object.kind === "textSpeak" || object.kind === "textDisplayAndSpeak";
  if (spokenText) {
    const voice = `${prefix}${voiceSuffix(0)}`;
    return [{ segment: 1, text: object.sentence, voice, exists: has(voiceFile(voice)) }];
  }
  return sentenceVoices(prefix, object.sentence, has).filter((entry) => entry.voice !== null && entry.exists);
}

export interface VoiceData {
  jas: QueenJas;
  texts: GameTexts;
  /** Dialogues par clé (`talkKey`). */
  dialogs: ReadonlyMap<number, { name: string; dog: DogDialog }>;
  /** Cinématique du nom de la voix, si elle est chargée. */
  cut?: Cutaway | null;
}

export interface VoiceSource {
  kind: VoiceName["kind"];
  /** D'où vient le texte, en une ligne. */
  origin: string;
  /** Texte du segment de la voix ; `null` si aucun texte n'y est rattaché. */
  text: string | null;
}

function segmentText(sentence: string | null | undefined, segment: number): string | null {
  if (sentence == null) return null;
  return splitSpeech(sentence)[segment - 1]?.text ?? null;
}

/** Texte et origine d'une voix (rattachement de `files.test.ts`). */
export function describeVoice(voice: VoiceName, data: VoiceData): VoiceSource {
  switch (voice.kind) {
    case "dialog": {
      const entry = data.dialogs.get(voice.talkKey);
      if (!entry) return { kind: voice.kind, origin: `aucun .DOG de clé ${voice.talkKey}`, text: null };
      const sentences = voice.who === "P" ? entry.dog.personSentences : entry.dog.joeSentences;
      const sentence = sentences.find((s) => s.head === voice.head);
      return {
        kind: voice.kind,
        origin: `${entry.name} : ${voice.who === "P" ? "personnage" : "Joe"}, tête ${voice.head}, segment ${voice.segment}`,
        text: segmentText(sentence?.text, voice.segment),
      };
    }
    case "dialogOpening": {
      const entry = data.dialogs.get(voice.talkKey);
      if (!entry) return { kind: voice.kind, origin: `aucun .DOG de clé ${voice.talkKey}`, text: null };
      const { dog } = entry;
      const first = voice.opening === "SSSS";
      const sentence = first ? (voice.who === "J" ? dog.joeSentences[0]?.text : dog.personSentences[0]?.text) : voice.who === "J" ? dog.person2.joe : dog.person2.greeting;
      return {
        kind: voice.kind,
        origin: `${entry.name} : ${first ? "premier échange" : "personnage déjà rencontré"}, ${voice.who === "J" ? "Joe" : "personnage"}, segment ${voice.segment}`,
        text: segmentText(sentence, voice.segment),
      };
    }
    case "joe": {
      const isResponse = voice.number <= 40;
      const sentence = isResponse ? data.texts.joeResponses[voice.number] : data.texts.objectDescriptions[voice.number - 40];
      return {
        kind: voice.kind,
        origin: isResponse ? `QUEEN2.JAS : réponse de Joe ${voice.number}, segment ${voice.segment}` : `QUEEN2.JAS : description ${voice.number - 40}, segment ${voice.segment}`,
        text: segmentText(sentence, voice.segment),
      };
    }
    case "cutaway": {
      const object = data.cut?.objects[voice.objectRank - 1];
      return {
        kind: voice.kind,
        origin: `${voice.cutaway}.CUT : objet ${voice.objectRank}, segment ${voice.segment}`,
        text: object ? (object.kind === "textSpeak" || object.kind === "textDisplayAndSpeak" ? object.sentence : segmentText(object.sentence, voice.segment)) : null,
      };
    }
    default:
      return { kind: "effect", origin: "effet sonore (nom de la table de ScummVM ou de la pièce, pas dans les données)", text: null };
  }
}

/** Index des dialogues par clé. */
export function dialogsByKey(dialogs: { name: string; dog: DogDialog }[]): Map<number, { name: string; dog: DogDialog }> {
  return new Map(dialogs.map((entry) => [entry.dog.talkKey, entry]));
}

// --- Musique --------------------------------------------------------------------------------------------------

export interface SongRow {
  index: number;
  offset: number;
  length: number;
  compression: string;
  format: number;
  tracks: number;
  division: number;
  smfBytes: number;
  defect: string;
}

export function songRow(song: BankSong): SongRow {
  return {
    index: song.index,
    offset: song.offset,
    length: song.length,
    compression: song.compression === "none" ? "direct" : song.compression === "dictionary" ? "dictionnaire (C)" : "dictionnaire (c)",
    format: song.layout.format,
    tracks: song.layout.trackCount,
    division: song.layout.division,
    smfBytes: song.smf.length,
    defect: song.defect === "stubPrefix" ? "souche de 22 octets" : song.defect === "truncated" ? "piste coupée" : "",
  };
}
