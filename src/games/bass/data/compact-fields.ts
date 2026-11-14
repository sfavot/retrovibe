/**
 * Champs d'un compact : positions des mots, structure `MegaSet`, adressage des scripts (`getCompactElem`).
 *
 * Référence : ScummVM engines/sky/struc.h (`Compact`, `MegaSet`, `TurnTable`), compact.cpp (`compactOffsets[]`, `megaSetOffsets[]`,
 * `turnTableOffsets[]`, `SkyCompact::getCompactElem`, `getMegaSet`, `getTurnTable`) et skydefs.h (`C_*`, `NEXT_MEGA_SET`)
 * (GPL v3 ou ultérieure).
 *
 * Un compact de type `CptType.compact` est un tableau de mots `u16` : 55 champs (indices ci-dessous) puis quatre `MegaSet` de 14 mots, soit
 * 111 mots. Les positions sont des **indices de mot** (la structure de ScummVM est « packée » en `u16` : décalage en octets / 2).
 *
 * Les scripts ne désignent pas un champ par son indice mais par un « décalage DOS » (`C_*`), compté en octets de la structure d'origine où
 * `getToTableId`, `grafixProgId`, `turnProgId`, `animScratchId` et les identifiants de `MegaSet` occupaient 4 octets. `COMPACT_ELEM_WORDS`
 * traduit ce décalage en indice de mot, dans l'ordre de `getCompactElem` : compact (114 décalages), puis pour chaque `MegaSet` ses 44 décalages
 * et les 100 de sa table de rotation (`TurnTable`, 25 mots, lue dans le compact désigné par `turnTableId`). Comme dans ScummVM, un décalage
 * qui tombe au milieu d'un champ de 4 octets vaut 0 (premier mot).
 */

/** Indices de mot dans un compact (`struct Compact`). */
export const CompactField = {
  logic: 0,
  status: 1,
  sync: 2,
  screen: 3,
  place: 4,
  getToTableId: 5,
  xcood: 6,
  ycood: 7,
  frame: 8,
  cursorText: 9,
  mouseOn: 10,
  mouseOff: 11,
  mouseClick: 12,
  /** Signé. */
  mouseRelX: 13,
  /** Signé. */
  mouseRelY: 14,
  mouseSizeX: 15,
  mouseSizeY: 16,
  actionScript: 17,
  upFlag: 18,
  downFlag: 19,
  getToFlag: 20,
  flag: 21,
  mood: 22,
  grafixProgId: 23,
  grafixProgPos: 24,
  offset: 25,
  mode: 26,
  baseSub: 27,
  baseSub_off: 28,
  actionSub: 29,
  actionSub_off: 30,
  getToSub: 31,
  getToSub_off: 32,
  extraSub: 33,
  extraSub_off: 34,
  dir: 35,
  stopScript: 36,
  miniBump: 37,
  leaving: 38,
  atWatch: 39,
  atWas: 40,
  alt: 41,
  request: 42,
  spWidth_xx: 43,
  spColor: 44,
  spTextId: 45,
  spTime: 46,
  arAnimIndex: 47,
  turnProgId: 48,
  turnProgPos: 49,
  waitingFor: 50,
  arTargetX: 51,
  arTargetY: 52,
  animScratchId: 53,
  megaSet: 54,
} as const;

/** Nombre de champs avant les `MegaSet` ; `megaSet0` commence à ce mot. */
export const COMPACT_FIELD_COUNT = 55;
export const MEGASET_COUNT = 4;
/** Mots d'un `MegaSet`. */
export const MEGASET_WORDS = 14;
/** Mots d'un compact complet (55 champs + 4 `MegaSet`). */
export const COMPACT_WORDS = COMPACT_FIELD_COUNT + MEGASET_COUNT * MEGASET_WORDS;

/** Indices de mot dans un `MegaSet` (`struct MegaSet`). */
export const MegaSetField = {
  gridWidth: 0,
  colOffset: 1,
  colWidth: 2,
  lastChr: 3,
  animUpId: 4,
  animDownId: 5,
  animLeftId: 6,
  animRightId: 7,
  standUpId: 8,
  standDownId: 9,
  standLeftId: 10,
  standRightId: 11,
  standTalkId: 12,
  turnTableId: 13,
} as const;

/** `TurnTable` : cinq tables de 5 mots, dans l'ordre haut, bas, gauche, droite, parole. */
export const TurnTableField = { up: 0, down: 5, left: 10, right: 15, talk: 20 } as const;
export const TURN_TABLE_WORDS = 25;

/** Décalages DOS (skydefs.h). */
export const C_BASE_MODE = 0;
export const C_ACTION_MODE = 4;
export const C_SP_COLOR = 90;
export const C_MEGA_SET = 112;
export const C_GRID_WIDTH = 114;
export const C_ANIM_UP = 122;
export const C_STAND_UP = 138;
export const C_TURN_TABLE = 158;
/** Écart, en décalages DOS, entre deux `MegaSet` (`258 - C_GRID_WIDTH`) ; c'est aussi la valeur du champ `megaSet` du jeu de rang 1. */
export const NEXT_MEGA_SET = 258 - C_GRID_WIDTH;

/** Où se trouve un élément adressé par un décalage DOS. */
export interface CompactElemLocation {
  readonly source: "compact" | "megaSet" | "turnTable";
  /** Rang du `MegaSet` (0 à 3) pour `megaSet` et `turnTable`, 0 pour `compact`. */
  readonly megaSet: number;
  /** Indice de mot : dans le compact (`compact`), dans le `MegaSet` (`megaSet`) ou dans la `TurnTable` (`turnTable`). */
  readonly word: number;
}

/** `[mot, taille en octets DOS]` dans l'ordre de `compactOffsets[]` : une entrée par octet DOS, la première porte le mot, les autres valent 0. */
const COMPACT_LAYOUT: ReadonlyArray<readonly [number, 2 | 4]> = [
  [CompactField.logic, 2],
  [CompactField.status, 2],
  [CompactField.sync, 2],
  [CompactField.screen, 2],
  [CompactField.place, 2],
  [CompactField.getToTableId, 4],
  [CompactField.xcood, 2],
  [CompactField.ycood, 2],
  [CompactField.frame, 2],
  [CompactField.cursorText, 2],
  [CompactField.mouseOn, 2],
  [CompactField.mouseOff, 2],
  [CompactField.mouseClick, 2],
  [CompactField.mouseRelX, 2],
  [CompactField.mouseRelY, 2],
  [CompactField.mouseSizeX, 2],
  [CompactField.mouseSizeY, 2],
  [CompactField.actionScript, 2],
  [CompactField.upFlag, 2],
  [CompactField.downFlag, 2],
  [CompactField.getToFlag, 2],
  [CompactField.flag, 2],
  [CompactField.mood, 2],
  [CompactField.grafixProgId, 4],
  [CompactField.offset, 2],
  [CompactField.mode, 2],
  [CompactField.baseSub, 2],
  [CompactField.baseSub_off, 2],
  [CompactField.actionSub, 2],
  [CompactField.actionSub_off, 2],
  [CompactField.getToSub, 2],
  [CompactField.getToSub_off, 2],
  [CompactField.extraSub, 2],
  [CompactField.extraSub_off, 2],
  [CompactField.dir, 2],
  [CompactField.stopScript, 2],
  [CompactField.miniBump, 2],
  [CompactField.leaving, 2],
  [CompactField.atWatch, 2],
  [CompactField.atWas, 2],
  [CompactField.alt, 2],
  [CompactField.request, 2],
  [CompactField.spWidth_xx, 2],
  [CompactField.spColor, 2],
  [CompactField.spTextId, 2],
  [CompactField.spTime, 2],
  [CompactField.arAnimIndex, 2],
  [CompactField.turnProgId, 4],
  [CompactField.waitingFor, 2],
  [CompactField.arTargetX, 2],
  [CompactField.arTargetY, 2],
  [CompactField.animScratchId, 4],
  [CompactField.megaSet, 2],
];

/** `megaSetOffsets[]` (le dernier mot, `turnTableId`, n'est pas adressable par les scripts). */
const MEGASET_LAYOUT: ReadonlyArray<readonly [number, 2 | 4]> = [
  [MegaSetField.gridWidth, 2],
  [MegaSetField.colOffset, 2],
  [MegaSetField.colWidth, 2],
  [MegaSetField.lastChr, 2],
  [MegaSetField.animUpId, 4],
  [MegaSetField.animDownId, 4],
  [MegaSetField.animLeftId, 4],
  [MegaSetField.animRightId, 4],
  [MegaSetField.standUpId, 4],
  [MegaSetField.standDownId, 4],
  [MegaSetField.standLeftId, 4],
  [MegaSetField.standRightId, 4],
  [MegaSetField.standTalkId, 4],
];

function expand(layout: ReadonlyArray<readonly [number, 2 | 4]>): number[] {
  const out: number[] = [];
  for (const [word, size] of layout) {
    out.push(word);
    for (let i = 1; i < size; i++) out.push(0);
  }
  return out;
}

/** `turnTableOffsets[]` : 25 mots de 4 octets DOS chacun. */
function expandTurnTable(): number[] {
  const out: number[] = [];
  for (let word = 0; word < TURN_TABLE_WORDS; word++) out.push(word, 0, 0, 0);
  return out;
}

const COMPACT_OFFSETS = expand(COMPACT_LAYOUT);
const MEGASET_OFFSETS = expand(MEGASET_LAYOUT);
const TURN_TABLE_OFFSETS = expandTurnTable();

/** Nombre de décalages DOS adressables (`COMPACT_SIZE + 4 * (MEGASET_SIZE + TURNTABLE_SIZE)`). */
export const COMPACT_ELEM_COUNT = COMPACT_OFFSETS.length + MEGASET_COUNT * (MEGASET_OFFSETS.length + TURN_TABLE_OFFSETS.length);

const LOCATIONS: readonly CompactElemLocation[] = (() => {
  const out: CompactElemLocation[] = COMPACT_OFFSETS.map((word) => ({ source: "compact", megaSet: 0, word }));
  for (let m = 0; m < MEGASET_COUNT; m++) {
    for (const word of MEGASET_OFFSETS) out.push({ source: "megaSet", megaSet: m, word });
    for (const word of TURN_TABLE_OFFSETS) out.push({ source: "turnTable", megaSet: m, word });
  }
  return out;
})();

/** `getCompactElem` : emplacement de l'élément désigné par le décalage DOS `off` ; lève une erreur hors limites. */
export function compactElemLocation(off: number): CompactElemLocation {
  const location = LOCATIONS[off];
  if (!Number.isInteger(off) || !location) throw new RangeError(`décalage de compact ${off} hors limites`);
  return location;
}

/**
 * `getMegaSet` : rang (0 à 3) du `MegaSet` actif d'après la valeur du champ `megaSet` (0, 144, 288 ou 432) ; erreur sinon.
 */
export function megaSetIndex(megaSetValue: number): number {
  if (megaSetValue % NEXT_MEGA_SET !== 0 || megaSetValue < 0 || megaSetValue >= MEGASET_COUNT * NEXT_MEGA_SET) {
    throw new RangeError(`MegaSet ${megaSetValue} invalide`);
  }
  return megaSetValue / NEXT_MEGA_SET;
}

/** Indice de mot, dans un compact, du premier mot du `MegaSet` de rang `index`. */
export function megaSetBase(index: number): number {
  return COMPACT_FIELD_COUNT + index * MEGASET_WORDS;
}

/** Lit un mot signé (`mouseRelX`, `mouseRelY`, décalages de `DataFileHeader`…). */
export function toInt16(word: number): number {
  return (word << 16) >> 16;
}

/** Valeur d'un champ du `MegaSet` actif du compact `cpt`. */
export function megaSetWord(cpt: Uint16Array, field: number): number {
  return cpt[megaSetBase(megaSetIndex(cpt[CompactField.megaSet]!)) + field]!;
}
