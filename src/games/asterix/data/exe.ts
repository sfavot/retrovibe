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
}

/** Lit les tables du jeu dans l'exécutable (format MZ : l'image suit l'en-tête de `u16[8] × 16` octets). */
export function parseExeTables(bytes: Uint8Array): ExeTables {
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error("ASTERIX.EXE : signature MZ absente");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = view.getUint16(8, true) * 16;
  const at = (segment: number, offset: number): number => header + (segment - LOAD_SEGMENT) * 16 + offset;
  const word = (offset: number): number => view.getInt16(at(DGROUP, offset), true);
  const words = (offset: number, count: number): number[] => Array.from({ length: count }, (_, i) => word(offset + 2 * i));
  const points = (offset: number, count: number, stride = 4): Point[] =>
    Array.from({ length: count }, (_, i) => ({ x: word(offset + stride * i), y: word(offset + stride * i + 2) }));
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
  };
}
