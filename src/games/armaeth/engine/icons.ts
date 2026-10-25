/**
 * Barre d'icônes d'*Armaeth* : table des outils `DGROUP:0bc2` (35 enregistrements de 16 octets), trois pages
 * d'icônes `DGROUP:0b86`, cases du cadre et disponibilité (`docs/armaeth/interface.md` § 1 et § 2,
 * `docs/armaeth/screens.md` E7). Pur : aucune lecture de fichier à l'exécution.
 *
 * Les constantes sont celles du document, recoupées avec les octets de `AM1.EXE` (l'image du segment de données
 * commence à l'octet `DGROUP_IMAGE_OFFSET`) par `decodeToolTable` / `decodeIconPages`, que les tests rejouent.
 */

/** Offset, dans `AM1.EXE`, du début de l'image du segment de données (interface.md, introduction). */
export const DGROUP_IMAGE_OFFSET = 224624;
/** `DGROUP:0bc2` : table des outils. */
export const TOOL_TABLE_OFFSET = 0x0bc2;
/** `DGROUP:0b86` : 3 pages de 10 numéros (mots). */
export const ICON_PAGES_OFFSET = 0x0b86;
export const TOOL_RECORD_BYTES = 16;
export const TOOL_RECORD_COUNT = 35;
export const ICON_PAGE_COUNT = 3;
export const ICONS_PER_PAGE = 10;

/** Numéros des objets `INT` spéciaux (interface.md § 3). */
export const INT_CURSOR = 1;
export const INT_ROOM_BUTTON = 2;
export const INT_PAGE_BUTTON = 3;
export const INT_TOOL_INDICATOR = 4;
export const INT_GEM = 5;

/** Outil par défaut : `Num` 1 (curseur). */
export const DEFAULT_TOOL = 1;
/** Outil « bottes » : marcher (interface.md § 5.6). */
export const TOOL_BOOTS = 198;
/** Icône « échelle » (action directe, équivalent des touches `-` et `+`). */
export const ICON_LADDER = 199;
/** Les verbes émis sont des mots de la classe 22 du dictionnaire : `VERB_CLASS_BASE + numéro`. */
export const VERB_CLASS_BASE = 22000;

/** Enregistrement de `DGROUP:0bc2` (interface.md § 1). Les drapeaux valent 0 ou 7 dans l'original, ici des booléens. */
export interface ToolRecord {
  /** `Num` de l'icône (ressource `INT`). */
  num: number;
  /** Variante : 0 = image 0 / bouton gauche, 1 = image 1 / bouton droit. */
  variant: 0 | 1;
  /** `invDroit` = 0 : un clic droit sans objet tenu inverse direct et indirect (§ 5.4). */
  rightInverts: boolean;
  /** Numéro du verbe (classe 22, 1 à 42) ; 0 = aucun. */
  verb: number;
  /** Préposition (1 dans, 3 sur, 7 avec, 8 à) ; transmise seulement s'il y a un complément indirect. */
  preposition: number;
  /** Ctrl + clic sur un objet de l'inventaire le prend au curseur (§ 5.5). */
  grab: boolean;
  /** Listes parcourues : L0 interface, L1 objets de la salle, L2 inventaire, L3 contenu de l'objet sélectionné, L4 décors. */
  lists: readonly [boolean, boolean, boolean, boolean, boolean];
  /** Un clic sur un point sensible de la scène empile son message (§ 5.7). */
  hotspots: boolean;
  /** Traitement d'un clic dans le vide (bottes : marcher ; mettre : poser). */
  empty: boolean;
  /** Direct = objet tenu ou sélectionné, indirect = objet cliqué (sinon l'inverse). */
  inverse: boolean;
}

/** Décode un enregistrement de 16 octets (`bytes` pointe sur le premier octet de la table). */
export function decodeToolRecord(bytes: Uint8Array, index: number): ToolRecord {
  const at = index * TOOL_RECORD_BYTES;
  const b = (i: number) => bytes[at + i];
  return {
    num: b(0) | (b(1) << 8),
    variant: b(2) === 0 ? 0 : 1,
    rightInverts: b(3) === 0,
    verb: b(4),
    preposition: b(5),
    grab: b(6) !== 0,
    lists: [b(7) !== 0, b(8) !== 0, b(9) !== 0, b(10) !== 0, b(11) !== 0],
    hotspots: b(12) !== 0,
    empty: b(13) !== 0,
    inverse: b(14) !== 0,
  };
}

/** Lit la table des outils dans les octets de `AM1.EXE` (les 35 enregistrements de `DGROUP:0bc2`). */
export function decodeToolTable(exe: Uint8Array): ToolRecord[] {
  const base = DGROUP_IMAGE_OFFSET + TOOL_TABLE_OFFSET;
  const bytes = exe.subarray(base, base + TOOL_RECORD_COUNT * TOOL_RECORD_BYTES);
  return Array.from({ length: TOOL_RECORD_COUNT }, (_, i) => decodeToolRecord(bytes, i));
}

/** Lit les 3 pages de 10 numéros de `DGROUP:0b86` dans les octets de `AM1.EXE`. */
export function decodeIconPages(exe: Uint8Array): number[][] {
  const base = DGROUP_IMAGE_OFFSET + ICON_PAGES_OFFSET;
  const view = new DataView(exe.buffer, exe.byteOffset + base, ICON_PAGE_COUNT * ICONS_PER_PAGE * 2);
  return Array.from({ length: ICON_PAGE_COUNT }, (_, p) =>
    Array.from({ length: ICONS_PER_PAGE }, (_, i) => view.getUint16((p * ICONS_PER_PAGE + i) * 2, true)),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Table décodée (interface.md § 1, « Contenu décodé »)

/** Compacte une ligne du tableau du document : `[num, variante, invDroit, verbe, prép, saisie, L0..L4, points, vide, inverse]`. */
type Row = [number, 0 | 1, 0 | 7, number, number, 0 | 7, ...number[]];

function record(row: Row): ToolRecord {
  const [num, variant, invDroit, verb, preposition, grab, l0, l1, l2, l3, l4, points, empty, inverse] = row;
  return {
    num,
    variant,
    rightInverts: invDroit === 0,
    verb,
    preposition,
    grab: grab !== 0,
    lists: [l0 !== 0, l1 !== 0, l2 !== 0, l3 !== 0, l4 !== 0],
    hotspots: points !== 0,
    empty: empty !== 0,
    inverse: inverse !== 0,
  };
}

const T = 7;
export const TOOL_TABLE: readonly ToolRecord[] = (
  [
    [1, 0, T, 0, 0, 0, T, 0, 0, 0, 0, 0, 0, 0],
    [2, 0, 0, 5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 0, T, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [5, 0, T, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [101, 0, 0, 5, 1, 0, T, T, T, T, T, T, 0, 0],
    [101, 1, 0, 20, 1, 0, T, T, T, 0, T, T, 0, 0],
    [102, 0, T, 6, 1, 0, T, T, 0, T, 0, 0, 0, 0],
    [102, 1, T, 15, 1, T, T, T, T, 0, 0, 0, T, T],
    [103, 0, T, 3, 7, T, T, T, T, 0, 0, 0, 0, 0],
    [103, 1, T, 4, 7, T, T, T, T, 0, 0, 0, 0, 0],
    [104, 0, T, 1, 7, T, T, T, T, 0, 0, 0, 0, T],
    [104, 1, T, 2, 0, 0, T, T, T, 0, 0, 0, 0, 0],
    [105, 0, T, 11, 0, 0, T, 0, T, 0, 0, 0, 0, 0],
    [105, 1, T, 34, 0, 0, T, 0, T, 0, 0, 0, 0, 0],
    [106, 0, T, 21, 0, 0, T, T, T, 0, 0, 0, 0, 0],
    [106, 1, T, 22, 0, 0, T, T, 0, 0, 0, 0, 0, 0],
    [107, 0, T, 37, 0, 0, T, T, 0, 0, 0, 0, 0, 0],
    [107, 1, T, 37, 0, 0, T, T, 0, 0, 0, 0, 0, 0],
    [108, 0, T, 32, 8, T, T, T, T, 0, 0, 0, 0, T],
    [108, 1, T, 32, 8, T, T, T, T, 0, 0, 0, 0, T],
    [109, 0, T, 24, 8, 0, T, T, T, 0, 0, 0, 0, T],
    [109, 1, T, 24, 8, 0, T, T, T, 0, 0, 0, 0, T],
    [110, 0, T, 26, 0, 0, T, T, T, 0, 0, 0, 0, 0],
    [110, 1, T, 26, 0, 0, T, T, T, 0, 0, 0, 0, 0],
    [198, 0, 0, 0, 0, 0, T, 0, 0, 0, 0, 0, T, 0],
    [198, 1, 0, 0, 0, 0, T, 0, 0, 0, 0, 0, T, 0],
    [199, 0, T, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [199, 1, T, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [111, 0, T, 19, 7, T, T, T, T, 0, 0, 0, 0, 0],
    [111, 1, T, 25, 0, 0, T, T, 0, 0, 0, 0, 0, 0],
    [112, 0, T, 10, 7, T, T, T, T, 0, 0, 0, 0, 0],
    [112, 1, T, 10, 7, T, T, T, T, 0, 0, 0, 0, 0],
    [113, 0, T, 39, 0, 0, T, 0, T, 0, 0, 0, 0, 0],
    [113, 1, T, 39, 0, 0, T, 0, T, 0, 0, 0, 0, 0],
  ] as Row[]
).map(record);

/** Retrouve l'enregistrement d'un couple (outil, variante) (`160c:000e`) ; `undefined` si absent (`gm_abort` dans l'original). */
export function findTool(num: number, variant: 0 | 1): ToolRecord | undefined {
  return TOOL_TABLE.find((r) => r.num === num && r.variant === variant);
}

// ---------------------------------------------------------------------------------------------------------------
// Pages et emplacements

/** Pages d'icônes dans l'ordre de `DGROUP:0b86` (interface.md § 2). */
export const ICON_PAGES: readonly (readonly number[])[] = [
  [101, 102, 103, 104, 111, 109, 106, 107, 198, 199],
  [101, 102, 103, 105, 108, 112, 113, 110, 198, 199],
  [201, 202, 203, 204, 205, 206, 207, 208, 209, 210],
];

/**
 * Icône placée à chaque emplacement (0 à 9, de gauche à droite) : positions de `A1FCFG.SYS` (interface.md § 2),
 * différentes de l'ordre de la table.
 */
export const ICON_SLOTS: readonly (readonly number[])[] = [
  [101, 102, 103, 104, 111, 109, 106, 107, 199, 198],
  [101, 102, 103, 105, 108, 112, 113, 110, 199, 198],
  [202, 204, 201, 205, 203, 207, 206, 208, 209, 210],
];

/** Abscisse du coin gauche des 10 cases du haut : `25 + 24k` (k 0 à 4) puis `178 + 24k` (screens.md E7). */
export function topCellX0(slot: number): number {
  return slot < 5 ? 25 + 24 * slot : 178 + 24 * (slot - 5);
}
export const TOP_CELL_WIDTH = 20;
export const TOP_CELL_HEIGHT = 16;
export const TOP_CELL_Y0 = 2;

export interface CellRect {
  x0: number;
  y0: number;
  /** Largeur et hauteur : 20 × 16. */
  width: number;
  height: number;
}

/** Case du haut (emplacement 0 à 9), x 25+24k / 178+24k, y 2..17. */
export function topCell(slot: number): CellRect {
  return { x0: topCellX0(slot), y0: TOP_CELL_Y0, width: TOP_CELL_WIDTH, height: TOP_CELL_HEIGHT };
}

/** Case d'inventaire (k 0 à 11), x0 = 18 + 24k, y 182..197. */
export function inventoryCell(k: number): CellRect {
  return { x0: 18 + 24 * k, y0: 182, width: TOP_CELL_WIDTH, height: TOP_CELL_HEIGHT };
}
export const INVENTORY_CELLS = 12;

/** Centre `x` de l'icône de l'emplacement (case + 10) et pied `y` (hypothèse, interface.md § 2 : « pied y = 15 »). */
export function slotCenterX(slot: number): number {
  return topCellX0(slot) + 10;
}
export const ICON_FOOT_Y = 15;

/** Emplacement d'une icône sur une page, ou -1 si elle n'y est pas. */
export function slotOf(page: number, num: number): number {
  return ICON_SLOTS[page]?.indexOf(num) ?? -1;
}

/** L'icône est-elle visible (sur la page courante) ? Hors page : image 1×1 ignorée par les clics (`15f8:000e`). */
export function isIconAvailable(page: number, num: number): boolean {
  return slotOf(page, num) >= 0;
}

/** Page suivante : clic gauche ou deux boutons +1, clic droit -1, modulo 3 (`1564:0470`). */
export function nextPage(page: number, right: boolean, left: boolean): number {
  const delta = right && !left ? -1 : 1;
  return (page + delta + ICON_PAGE_COUNT) % ICON_PAGE_COUNT;
}

// ---------------------------------------------------------------------------------------------------------------
// Natures et tailles

export type IconKind = "tool" | "ladder" | "system";

/** Icônes qui choisissent un outil (101 à 113, 198). */
export function isToolIcon(num: number): boolean {
  return (num >= 101 && num <= 113) || num === TOOL_BOOTS;
}

export function iconKind(num: number): IconKind | undefined {
  if (isToolIcon(num)) return "tool";
  if (num === ICON_LADDER) return "ladder";
  if (num >= 201 && num <= 210) return "system";
  return undefined;
}

/** Commande système portée par une icône de la page 2 (interface.md § 2.1). */
export type SystemCommand = "save" | "restore" | "quit" | "continue" | "restart" | "volume" | "score" | "music" | "speed" | "pause";

export const SYSTEM_ICONS: ReadonlyMap<number, SystemCommand> = new Map([
  [201, "save"],
  [202, "restore"],
  [203, "quit"],
  [204, "continue"],
  [205, "restart"],
  [206, "volume"],
  [207, "score"],
  [208, "music"],
  [209, "speed"],
  [210, "pause"],
]);

export interface ImageSize {
  width: number;
  height: number;
}

/** Tailles des images des icônes (interface.md § 2.1), `[variante 0, variante 1]` ; une seule image si identiques. */
const ICON_IMAGE_SIZES: ReadonlyMap<number, readonly [ImageSize, ImageSize]> = new Map(
  (
    [
      [101, 16, 7, 10, 10],
      [102, 14, 10, 15, 10],
      [103, 9, 12, 9, 11],
      [104, 9, 11, 8, 12],
      [105, 10, 12, 8, 10],
      [106, 7, 12, 7, 13],
      [107, 12, 9, 12, 9],
      [108, 13, 10, 13, 10],
      [109, 14, 12, 14, 12],
      [110, 13, 9, 13, 9],
      [111, 15, 12, 15, 12],
      [112, 12, 11, 12, 11],
      [113, 9, 8, 9, 12],
      [198, 16, 10, 16, 10],
      [199, 7, 11, 7, 11],
      [201, 11, 12, 11, 12],
      [202, 16, 13, 16, 13],
      [203, 15, 10, 15, 10],
      [204, 15, 13, 15, 13],
      [205, 13, 11, 13, 11],
      [206, 12, 11, 12, 11],
      [207, 14, 10, 14, 10],
      [208, 9, 8, 9, 8],
      [209, 11, 10, 11, 10],
      [210, 10, 11, 10, 11],
    ] as const
  ).map(([num, w0, h0, w1, h1]) => [
    num,
    [
      { width: w0, height: h0 },
      { width: w1, height: h1 },
    ] as const,
  ]),
);

/** Taille de l'image d'une icône pour une variante (sert au rectangle du curseur et au recouvrement). */
export function iconImageSize(num: number, variant: 0 | 1 = 0): ImageSize | undefined {
  return ICON_IMAGE_SIZES.get(num)?.[variant];
}
