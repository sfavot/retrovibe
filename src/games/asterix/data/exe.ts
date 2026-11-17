import { decodeCp850 } from "../../../data/cp850";

/**
 * Tables de `ASTERIX.EXE` lues à l'exécution (décision D4 : l'exécutable est versionné pour ses tables, jamais exécuté).
 * Les adresses sont celles de `docs/asterix/engine.md` : `DS:xxxx` dans DGROUP (segment `2de2`), `seg:off` dans le code.
 */

/** Segment de base du chargement dans la décompilation (Ghidra) : les segments du document y sont relatifs. */
const LOAD_SEGMENT = 0x1000;
const DGROUP = 0x2de2;

export const SQUARE_COUNT = 54;
export const CHARACTER_COUNT = 6;
export const OBJECT_COUNT = 9;

export interface Point {
  x: number;
  y: number;
}

/** Une image des Anachronismes (M25) et la zone de son objet (`DS:22a2`, 10 octets), coordonnées décalées de (32, 40). */
export interface Anachronism {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Niveau Réflexion auquel l'image est proposée. */
  level: number;
}

/** Une zone du Brouillard (M26, `DS:2524`, 10 octets) : rectangle en pixels d'écran et rang du cri dans `DS:2498`. */
export interface FogZone {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sound: number;
}

export interface FogTables {
  /** `DS:2498` : noms des 35 sons (pointeurs lointains) ; le premier est le son de l'erreur. */
  sounds: string[];
  /** `DS:2524 + 100 × scène + 10 × zone` : cinq scènes de dix zones. */
  zones: FogZone[][];
}

export interface IdefixTables {
  /** `DS:2ec4` : par parcours (0 hors partie, 1 à 6 en partie), type de l'obstacle par moment (`DS:6f3a >> 1`). */
  courses: Map<number, number>[];
  /** `DS:306a`, `DS:306f` : pour chacun des cinq décors, l'étendue de son ordonnée et l'attente avant le suivant. */
  decorSpans: number[];
  decorDelays: number[];
}

/** Un pixel opaque d'une forme de curseur. */
export interface CursorPixel {
  x: number;
  y: number;
  color: number;
}

/** Flèche du curseur logiciel `153c:05b4` (`DS:114c`) : 9 × 15 octets, 0 transparent. */
export const ARROW_WIDTH = 9;
export const ARROW_HEIGHT = 15;
/** Curseur de la bibliothèque `18a1` (`DS:11d4`) : 16 × 16. */
export const LIBRARY_CURSOR_SIZE = 16;

export interface ExeTables {
  /** `DS:1d81` : type de chaque case, par position 0..53 (engine.md §9.2). */
  board: number[];
  /** `DS:1ded` : centre du pion dans sa bande de l'écran de jeu, par position. */
  pawnCenters: Point[];
  /** `DS:1ec5` : (colonne, ligne) de chaque position sur la carte générale. */
  mapCells: Point[];
  /** `DS:1d4b` : couleurs 123, 124 et 125 du pion (9 octets RVB) par personnage. */
  pawnColors: Uint8Array[];
  /** `DS:2144 + 12 × nb + 2j` : ordonnée de la ligne du joueur `j` sur l'écran de score, pour `nb` joueurs. */
  scoreRows: number[][];
  /** `DS:219c` : position de la croix de chaque objet sur le marbre de route. */
  marbleObjects: Point[];
  /** `DS:2a3a` : directions de l'espion par position (quartet bas : avancer, quartet haut : reculer). */
  spyDirections: number[];
  /** `DS:2ac5` : étal d'Epidemaïs, dans l'ordre du curseur (x, y, objet). */
  stall: (Point & { object: number })[];
  /** `DS:2afb` : les six groupes de gourdes du devin (pari 0 à 5). */
  soothsayer: Point[];
  /** `DS:201a` : indice du nombre d'objets proposé, par `[joueurs − 1][indice de durée]`. */
  objectsByDuration: number[][];
  /** `DS:1ff6` : emplacements de l'écran des joueurs M08 (x, y, personnage), de gauche à droite. */
  characterSlots: (Point & { character: number })[];
  /** `DS:33e4` : fichier de quiz de chaque pays. */
  quizFiles: string[];
  /** `DS:1a03` : noms des personnages en français (minuscules sans accent). */
  characterNames: string[];
  /** `DS:2c1d` : les quatre textes français du devin (octets CP850, gabarits `%d` et `%s`). */
  soothsayerTexts: string[];
  /** `20fa:146d` : positions des quinze cases de jeu, dans l'ordre de la table d'aiguillage. */
  minigamePositions: number[];
  /** `20fa:1198` : positions des six pièges, dans l'ordre de la table d'aiguillage. */
  trapPositions: number[];
  /** `DS:1f9d`, `DS:1f9f` : durée (secondes) et nombre d'objets de l'image, repris par REJOUER sans partie préalable. */
  defaultDuration: number;
  defaultObjects: number;
  /** `DS:114c` : flèche 9 × 15 du curseur logiciel `153c:05b4`, un octet par pixel (dessiné avec la valeur + 1). */
  arrow: Uint8Array;
  /** `DS:11d4` : curseur 16 × 16 de la bibliothèque `18a1`, ses pixels opaques (couleurs 0 et 255). */
  libraryCursor: CursorPixel[];
  /** `DS:22a2` : les 44 images des Anachronismes (M25). */
  anachronisms: Anachronism[];
  /** `DS:2498`, `DS:2524` : sons et zones du Brouillard (M26). */
  fog: FogTables;
  /** `DS:3182 + 0x3c × jeu + 4 × emplacement` : les quinze emplacements des Sangliers (0) et des Pirates (1), M28 et M29. */
  targetSpots: Point[][];
  /** `DS:310e` : valeur de chaque case de la jauge des Jeux olympiques (M30), 20 mots. */
  gauge: number[];
  /** `DS:2ec4`, `DS:306a`, `DS:306f` : parcours et décors d'Idéfix (M34). */
  idefix: IdefixTables;
}

/** Position dans le fichier `ASTERIX.EXE` (format MZ : l'image suit l'en-tête de `u16[8] × 16` octets) de l'adresse `seg:off`. */
export function exeOffset(exe: Uint8Array, segment: number, offset: number): number {
  return (exe[8] | (exe[9] << 8)) * 16 + (segment - LOAD_SEGMENT) * 16 + offset;
}

/** Position dans le fichier de l'adresse `DS:offset` (DGROUP). */
export function dataOffset(exe: Uint8Array, offset: number): number {
  return exeOffset(exe, DGROUP, offset);
}

/**
 * Forme `DS:11d4`, au format que lit `18a1:0559` : par ligne, un nombre de segments ; par segment, des points
 * transparents à sauter, puis un mot (octet bas : quadruplets, octet haut : octets en plus) et autant de couleurs ; enfin
 * les points transparents de fin de ligne.
 */
function parseLibraryCursor(bytes: Uint8Array): CursorPixel[] {
  const pixels: CursorPixel[] = [];
  let at = dataOffset(bytes, 0x11d4);
  for (let y = 0; y < LIBRARY_CURSOR_SIZE; y++) {
    let x = 0;
    for (let segments = bytes[at++]; segments > 0; segments--) {
      x += bytes[at++];
      const length = bytes[at] * 4 + bytes[at + 1];
      at += 2;
      for (let i = 0; i < length; i++) pixels.push({ x: x++, y, color: bytes[at++] });
    }
    at++;
  }
  return pixels;
}

/** `DS:2ec4` : sept parcours de 15 couples (moment, type), le moment en doubles images, −1 pour finir. */
function parseIdefixCourses(word: (offset: number) => number): Map<number, number>[] {
  const courses: Map<number, number>[] = [];
  for (let course = 0; course < 7; course++) {
    const entries = new Map<number, number>();
    for (let i = 0; i < 15; i++) {
      const at = 0x2ec4 + (course * 15 + i) * 4;
      const moment = word(at);
      if (moment === -1) break;
      // `23d1:01a9` rend le type de la première entrée dont le moment correspond.
      if (!entries.has(moment)) entries.set(moment, word(at + 2));
    }
    courses.push(entries);
  }
  return courses;
}

/** Lit les tables du jeu dans l'exécutable (format MZ : l'image suit l'en-tête de `u16[8] × 16` octets). */
export function parseExeTables(bytes: Uint8Array): ExeTables {
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error("ASTERIX.EXE : signature MZ absente");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (segment: number, offset: number): number => exeOffset(bytes, segment, offset);
  const word = (offset: number): number => view.getInt16(at(DGROUP, offset), true);
  const words = (offset: number, count: number): number[] => Array.from({ length: count }, (_, i) => word(offset + 2 * i));
  const points = (offset: number, count: number, stride = 4): Point[] =>
    Array.from({ length: count }, (_, i) => ({ x: word(offset + stride * i), y: word(offset + stride * i + 2) }));
  const dataBytes = (offset: number, count: number): Uint8Array => bytes.slice(at(DGROUP, offset), at(DGROUP, offset) + count);
  const text = (offset: number): { value: string; next: number } => {
    const start = at(DGROUP, offset);
    let end = start;
    while (bytes[end] !== 0) end++;
    return { value: decodeCp850(bytes.subarray(start, end)), next: offset + (end - start) + 1 };
  };
  const codeWords = (segment: number, offset: number, count: number): number[] =>
    Array.from({ length: count }, (_, i) => view.getUint16(at(segment, offset) + 2 * i, true));

  const soothsayerTexts: string[] = [];
  let cursor = 0x2c1d;
  for (let i = 0; i < 4; i++) {
    const read = text(cursor);
    soothsayerTexts.push(read.value);
    cursor = read.next;
  }

  return {
    board: words(0x1d81, SQUARE_COUNT),
    pawnCenters: points(0x1ded, SQUARE_COUNT),
    mapCells: points(0x1ec5, SQUARE_COUNT),
    pawnColors: Array.from({ length: CHARACTER_COUNT }, (_, i) => bytes.slice(at(DGROUP, 0x1d4b + 9 * i), at(DGROUP, 0x1d4b + 9 * i) + 9)),
    scoreRows: [1, 2, 3, 4].map((players) => words(0x2144 + 12 * players, players)),
    marbleObjects: points(0x219c, OBJECT_COUNT),
    spyDirections: words(0x2a3a, SQUARE_COUNT),
    stall: points(0x2ac5, OBJECT_COUNT, 6).map((point, i) => ({ ...point, object: word(0x2ac5 + 6 * i + 4) })),
    soothsayer: points(0x2afb, 6),
    objectsByDuration: [0, 1, 2, 3].map((row) => words(0x201a + 8 * row, 4)),
    characterSlots: points(0x1ff6, CHARACTER_COUNT, 6).map((point, i) => ({ ...point, character: word(0x1ff6 + 6 * i + 4) })),
    quizFiles: Array.from({ length: OBJECT_COUNT }, (_, i) => text(0x33e4 + 13 * i).value),
    characterNames: Array.from({ length: CHARACTER_COUNT }, (_, i) => text(0x1a03 + 20 * i).value),
    soothsayerTexts,
    minigamePositions: codeWords(0x20fa, 0x146d, 15),
    trapPositions: codeWords(0x20fa, 0x1198, 6),
    defaultDuration: word(0x1f9d),
    defaultObjects: word(0x1f9f),
    arrow: dataBytes(0x114c, ARROW_WIDTH * ARROW_HEIGHT),
    libraryCursor: parseLibraryCursor(bytes),
    anachronisms: Array.from({ length: 44 }, (_, n) => {
      const [x1, y1, x2, y2, level] = words(0x22a2 + 10 * n, 5);
      return { x1, y1, x2, y2, level };
    }),
    fog: {
      // Pointeurs lointains : le mot bas est le déplacement du nom dans DGROUP.
      sounds: Array.from({ length: 35 }, (_, i) => text(view.getUint16(at(DGROUP, 0x2498 + 4 * i), true)).value),
      zones: Array.from({ length: 5 }, (_, scene) =>
        Array.from({ length: 10 }, (_zone, i): FogZone => {
          const offset = 0x2524 + 100 * scene + 10 * i;
          const [x1, y1, x2, y2] = words(offset, 4);
          return { x1, y1, x2, y2, sound: bytes[at(DGROUP, offset + 8)] };
        }),
      ),
    },
    targetSpots: [0, 1].map((game) => points(0x3182 + 0x3c * game, 15)),
    gauge: words(0x310e, 20),
    idefix: {
      courses: parseIdefixCourses(word),
      decorSpans: Array.from(dataBytes(0x306a, 5)),
      decorDelays: Array.from(dataBytes(0x306f, 5)),
    },
  };
}
