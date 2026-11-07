import { decodeCp850 } from "../../../data/cp850";
import { BinaryReader } from "../../../data/reader";

/**
 * `drascula.dat` : données du moteur ScummVM (version 7) — tables du jeu et textes en six langues.
 *
 * Format tiré de `loadDrasculaDat` et `loadTexts` (engines/drascula/drascula.cpp) et de
 * `devtools/create_drascula` (ScummVM, GPL v3 ou ultérieure, comme le fichier). Tous les entiers sont
 * big-endian. Écarts : les quatre tables de caractères sont gardées séparées (ScummVM n'en fusionne que deux
 * selon la langue) ; seules les langues demandées sont décodées, les autres sont parcourues pour vérifier
 * leur structure ; la fin du fichier doit tomber exactement sur la dernière ligne de texte.
 */

export const DAT_VERSION = 7;

/** Langues du fichier, dans l'ordre : l'index est celui des blocs de texte. */
export const DAT_LANGUAGES = ["en", "es", "de", "fr", "it", "ru"] as const;
export type DatLanguage = (typeof DAT_LANGUAGES)[number];

/** Sections de textes, dans l'ordre du fichier. */
export const DAT_TEXT_NAMES = [
  "text",
  "textd",
  "textb",
  "textbj",
  "texte",
  "texti",
  "textl",
  "textp",
  "textt",
  "textvb",
  "textsys",
  "texthis",
  "textverbs",
  "textmisc",
  "textd1",
] as const;
export type DatTextName = (typeof DAT_TEXT_NAMES)[number];

/** Une entrée de table de caractères : caractère lu, position du glyphe dans la police et type. */
export interface DatCharEntry {
  inChar: number;
  mappedChar: number;
  charType: number;
}

export interface DatPoint {
  x: number;
  y: number;
}

/** Rectangle recopié sur le décor selon un drapeau (`roomPreUpdates` avant l'affichage, `roomUpdates` après). */
export interface DatRoomUpdate {
  room: number;
  flag: number;
  flagValue: number;
  sourceX: number;
  sourceY: number;
  destX: number;
  destY: number;
  width: number;
  height: number;
  type: number;
}

/** Réponse par défaut à un verbe sur un objet (`chapter` -1 : tous les chapitres). */
export interface DatRoomAction {
  room: number;
  chapter: number;
  action: number;
  objectId: number;
  speechId: number;
}

/** Commande d'une séquence de dialogue. */
export interface DatTalkSequence {
  chapter: number;
  sequence: number;
  commandType: number;
  action: number;
}

export interface DrasculaDat {
  version: number;
  /** Tables de caractères de la police, telles que dans le fichier. */
  charMaps: { letters: DatCharEntry[]; signs: DatCharEntry[]; cyrillic: DatCharEntry[]; accented: DatCharEntry[] };
  itemLocations: DatPoint[];
  /** Cases de l'écran d'inventaire (`x_pol`, `y_pol`). */
  inventoryCells: DatPoint[];
  verbBarX: number[];
  menuPoints: DatPoint[];
  frameX: number[];
  candles: DatPoint[];
  pianistX: number[];
  drunkX: number[];
  roomPreUpdates: DatRoomUpdate[];
  roomUpdates: DatRoomUpdate[];
  roomActions: DatRoomAction[];
  talkSequences: DatTalkSequence[];
  languageCount: number;
  /** Nombre de lignes de chaque section (identique dans toutes les langues). */
  lineCounts: Record<DatTextName, number>;
  /** Lignes de chaque section dans les langues demandées, par index de langue. */
  texts: Record<DatTextName, Partial<Record<DatLanguage, string[]>>>;
  /** Octets lus ; égal à la taille du fichier quand il n'a pas de reste. */
  bytesRead: number;
}

export interface ParseDatOptions {
  /** Langues à décoder (français par défaut). Le russe n'est pas en CP850 et n'est pas pris en charge. */
  languages?: readonly DatLanguage[];
}

/** Alignement des lignes de texte : chaque ligne est complétée à un multiple de 4 octets (`DATAALIGNMENT`). */
const TEXT_ALIGNMENT = 4;

export function parseDat(bytes: Uint8Array, options: ParseDatOptions = {}): DrasculaDat {
  const languages = options.languages ?? ["fr"];
  if (languages.includes("ru")) throw new Error("drascula.dat : le russe n'est pas en CP850");
  const reader = new BinaryReader(bytes);
  if (bytes.length < 9 || reader.string(8) !== "DRASCULA") throw new Error("drascula.dat invalide : signature absente");
  const version = reader.u8();
  if (version !== DAT_VERSION) throw new Error(`drascula.dat : version ${version} (attendue ${DAT_VERSION})`);

  const sizes = [reader.u16be(), reader.u16be(), reader.u16be(), reader.u16be()];
  const charMap = (count: number): DatCharEntry[] =>
    Array.from({ length: count }, () => ({ inChar: reader.u8(), mappedChar: reader.i16be(), charType: reader.u8() }));
  const charMaps = {
    letters: charMap(sizes[0]),
    signs: charMap(sizes[1]),
    cyrillic: charMap(sizes[2]),
    accented: charMap(sizes[3]),
  };

  const list = <T>(read: () => T): T[] => Array.from({ length: reader.u16be() }, read);
  const point = (): DatPoint => ({ x: reader.i16be(), y: reader.i16be() });
  const update = (): DatRoomUpdate => ({
    room: reader.i16be(),
    flag: reader.i16be(),
    flagValue: reader.i16be(),
    sourceX: reader.i16be(),
    sourceY: reader.i16be(),
    destX: reader.i16be(),
    destY: reader.i16be(),
    width: reader.i16be(),
    height: reader.i16be(),
    type: reader.i16be(),
  });

  const itemLocations = list(point);
  const inventoryCells = list(point);
  const verbBarX = list(() => reader.i16be());
  const menuPoints = list(point);
  const frameX = list(() => reader.i16be());
  const candles = list(point);
  const pianistX = list(() => reader.i16be());
  const drunkX = list(() => reader.i16be());
  const roomPreUpdates = list(update);
  const roomUpdates = list(update);
  const roomActions = list(
    (): DatRoomAction => ({
      room: reader.i16be(),
      chapter: reader.i16be(),
      action: reader.i16be(),
      objectId: reader.i16be(),
      speechId: reader.i16be(),
    }),
  );
  const talkSequences = list(
    (): DatTalkSequence => ({
      chapter: reader.i16be(),
      sequence: reader.i16be(),
      commandType: reader.i16be(),
      action: reader.i16be(),
    }),
  );

  const languageCount = reader.u16be();
  const wanted = new Set(languages.map((language) => DAT_LANGUAGES.indexOf(language)));
  const lineCounts = {} as Record<DatTextName, number>;
  const texts = {} as DrasculaDat["texts"];
  for (const name of DAT_TEXT_NAMES) {
    const count = reader.u16be();
    lineCounts[name] = count;
    texts[name] = {};
    for (let language = 0; language < languageCount; language++) {
      const length = reader.u16be();
      if (reader.offset + length > reader.length) throw new Error(`drascula.dat : section ${name} tronquée`);
      const block = reader.bytesView(length);
      if (wanted.has(language)) texts[name][DAT_LANGUAGES[language]] = readTextBlock(block, count, name);
      else checkTextBlock(block, count, name);
    }
  }

  return {
    version,
    charMaps,
    itemLocations,
    inventoryCells,
    verbBarX,
    menuPoints,
    frameX,
    candles,
    pianistX,
    drunkX,
    roomPreUpdates,
    roomUpdates,
    roomActions,
    talkSequences,
    languageCount,
    lineCounts,
    texts,
    bytesRead: reader.offset,
  };
}

/**
 * Bloc de textes d'une langue : remplissage de `TEXT_ALIGNMENT - 2` octets, puis par ligne `u16` longueur
 * totale (u16 compris), chaîne terminée par NUL et remplissage de zéros (1 à 4 octets : un multiple de 4 au total).
 * Rend les chaînes brutes (octets) de chaque ligne, sans NUL ni remplissage.
 */
function* textLines(block: Uint8Array, count: number, name: string): Generator<Uint8Array> {
  const reader = new BinaryReader(block);
  reader.offset = TEXT_ALIGNMENT - 2;
  for (let i = 0; i < count; i++) {
    const total = reader.u16be();
    const body = reader.bytesView(total - 2);
    const end = body.indexOf(0);
    if (total < 3 || body.length !== total - 2 || end === -1 || body.subarray(end).some((byte) => byte !== 0))
      throw new Error(`drascula.dat : ligne ${i} de ${name} mal formée`);
    if ((TEXT_ALIGNMENT - ((end + 1 + 2) % TEXT_ALIGNMENT)) + end + 1 + 2 !== total)
      throw new Error(`drascula.dat : remplissage de la ligne ${i} de ${name}`);
    yield body.subarray(0, end);
  }
  if (!reader.isAtEnd) throw new Error(`drascula.dat : reste après les lignes de ${name}`);
}

function readTextBlock(block: Uint8Array, count: number, name: string): string[] {
  return [...textLines(block, count, name)].map(decodeCp850);
}

function checkTextBlock(block: Uint8Array, count: number, name: string): void {
  for (const line of textLines(block, count, name)) void line;
}
