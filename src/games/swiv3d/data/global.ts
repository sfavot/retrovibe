/**
 * `GLOBAL.BD` de SWIV 3D : en-tête, drapeaux et lecteurs des ressources graphiques (voir docs/swiv3d/global-bd.md).
 * Les chaînes sont dans `strings.ts` (bloc 100), la police dans `font.ts` (507, 508), le script des missions dans `missions.ts` (600).
 * Les blocs dont la structure n'est pas établie sont exposés en octets bruts par `BdArchive.get`.
 */
import { BinaryReader } from "../../../data/reader";
import { vga6ToRgb8 } from "../../../ui/indexed-canvas";
import type { BdArchive } from "./bd";
import { parseFont, parseRleSprites, type Font, type RleSprite } from "./font";
import { parseMissions, type MissionScript } from "./missions";
import { parseStrings, type StringTables } from "./strings";

/** Drapeaux du bloc 2 (`DAT_0048462c`), tels que les teste `gm_global_init` (`0046fa58`) et `gm_main_game` (`00421614`). */
export const GLOBAL_FLAGS = {
  /** Version démo : lit `swivdemo.cfg` et charge l'écran 1005. */
  demo: 0x01,
  /** Testé par `gm_main_game` ; effet exact non établi (charge l'écran 1005 pendant l'intro). */
  flag02: 0x02,
  /** Charge l'écran 1004 en plus. */
  extraScreens: 0x20,
  /** Force la piste de CD 2. */
  forceTrack2: 0x40,
  /** Saute le chargement de l'écran 1000 (absent) et active la séquence d'intro de `gm_main_game`. */
  intro: 0x80,
} as const;

export interface GlobalHeader {
  /** Texte du bloc 1 (« Global.bd … Generated with options: CUTDOWN USENGLISH INTERPLAY IPLOGOISANIM »), jamais lu par le jeu. */
  text: string;
  /** Options de génération listées à la fin du texte. */
  options: string[];
  /** Valeur du bloc 2. */
  flags: number;
}

export function parseHeader(bd: BdArchive): GlobalHeader {
  const raw = bd.get(1);
  const end = raw.indexOf(0);
  const text = String.fromCharCode(...raw.subarray(0, end < 0 ? raw.length : end));
  const marker = "Generated with options:";
  const at = text.indexOf(marker);
  const options = at < 0 ? [] : text.slice(at + marker.length).match(/[A-Z]{2,}/g) ?? [];
  return { text, options, flags: new BinaryReader(bd.get(2)).u32() };
}

// --- Écrans plein cadre (blocs 1001 à 1005) -------------------------------------------------------------------------------------

export const SCREEN_IDS = [1001, 1002, 1003, 1004, 1005] as const;
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 400;

const SCREEN_PALETTE_BYTES = 0x300;
const SCREEN_TABLE_BYTES = 0x2000;
const SCREEN_PLANE_BYTES = 80 * SCREEN_HEIGHT;
const SCREEN_BYTES = SCREEN_PALETTE_BYTES + SCREEN_TABLE_BYTES + 4 * SCREEN_PLANE_BYTES;

export interface Screen {
  /** Palette VGA 6 bits (768 octets). */
  palette6: Uint8Array;
  /** Palette 8 bits (768 octets). */
  palette: Uint8Array;
  /** 8192 octets après la palette (32 lignes de 256, `DAT_005bc158`) : table d'usage inconnu, voir la documentation. */
  table: Uint8Array;
  /** 320 × 400 indices de palette, ligne par ligne (le fichier stocke 4 plans du mode X). */
  pixels: Uint8Array;
}

/** Écran de `GLOBAL.BD` : palette (0x300), table (0x2000) puis 4 plans de 80 × 400 octets, la colonne `x` étant dans le plan `x & 3`. */
export function parseScreen(bytes: Uint8Array): Screen {
  if (bytes.length !== SCREEN_BYTES) throw new Error(`écran : ${bytes.length} octets au lieu de ${SCREEN_BYTES}`);
  const planes = SCREEN_PALETTE_BYTES + SCREEN_TABLE_BYTES;
  const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) pixels[y * SCREEN_WIDTH + x] = bytes[planes + (x & 3) * SCREEN_PLANE_BYTES + y * 80 + (x >> 2)]!;
  }
  const palette6 = bytes.subarray(0, SCREEN_PALETTE_BYTES);
  return { palette6, palette: vga6ToRgb8(palette6), table: bytes.subarray(SCREEN_PALETTE_BYTES, planes), pixels };
}

// --- Police vectorielle (bloc 200) ----------------------------------------------------------------------------------------------

export const VECTOR_FONT_BLOCK = 200;
const VECTOR_GLYPH_SLOTS = 1024;
const VECTOR_GLYPH_SIZE = 28;

export interface VectorGlyph {
  /** Largeur : l'avance du jeu est `width >> 2` + 5 (`FUN_00424454`). */
  width: number;
  /** Sommets `(x, y, z)`. */
  vertices: Int32Array;
  /** Triangles `(sommet a, sommet b, sommet c, normale)` : indices dans `vertices` et dans `VectorFont.normals`. */
  triangles: Int32Array;
}

export interface VectorFont {
  /** Normales `(x, y, z)` partagées (23 vecteurs, 256 = longueur 1). */
  normals: Int32Array;
  /** Glyphes renseignés, par index de glyphe (même numérotation que la police 2D : caractère, ou `page·128 + code`). */
  glyphs: Map<number, VectorGlyph>;
}

/**
 * Table de 1024 enregistrements de 28 octets `(largeur, off. sommets, nb sommets, off. triangles, nb triangles, off. normales,
 * nb normales)`, puis les données ; les emplacements vides valent `(45, -1, 0, -1, 0, 0x7000, 23)`. Lue par `FUN_00423974`.
 */
export function parseVectorFont(bytes: Uint8Array): VectorFont {
  const r = new BinaryReader(bytes);
  const glyphs = new Map<number, VectorGlyph>();
  let normals: Int32Array = new Int32Array(0);
  for (let index = 0; index < VECTOR_GLYPH_SLOTS; index++) {
    r.offset = index * VECTOR_GLYPH_SIZE;
    const width = r.i32();
    const vertexOffset = r.i32();
    const vertexCount = r.i32();
    const triangleOffset = r.i32();
    const triangleCount = r.i32();
    const normalOffset = r.i32();
    const normalCount = r.i32();
    if (index === 0) normals = readInts(bytes, normalOffset, normalCount * 3);
    if (vertexCount === 0) continue;
    glyphs.set(index, {
      width,
      vertices: readInts(bytes, vertexOffset, vertexCount * 3),
      triangles: readInts(bytes, triangleOffset, triangleCount * 4),
    });
  }
  return { normals, glyphs };
}

function readInts(bytes: Uint8Array, offset: number, count: number): Int32Array {
  const r = new BinaryReader(bytes);
  r.offset = offset;
  return Int32Array.from({ length: count }, () => r.i32());
}

// --- Cratères (bloc 700) ----------------------------------------------------------------------------------------------------------

export const CRATERS_BLOCK = 700;

/**
 * Profils de cratère de `FUN_00424f44` : 3 tailles (rayons 10000, 20000, 30000) × 16 phases (`(z >> 12 & 3) * 4 + (x >> 12 & 3)`,
 * position de l'impact dans la cellule de terrain) × 4 × 4 profondeurs i32. `craters[taille][phase]` : 16 valeurs, ligne par ligne.
 */
export function parseCraters(bytes: Uint8Array): Int32Array[][] {
  const r = new BinaryReader(bytes);
  return Array.from({ length: 3 }, () => Array.from({ length: 16 }, () => Int32Array.from({ length: 16 }, () => r.i32())));
}

// --- Jauge d'énergie (bloc 503) -------------------------------------------------------------------------------------------------

export const GAUGE_BLOCK = 503;
export const GAUGE_WIDTH = 20;
export const GAUGE_HEIGHT = 81;
const GAUGE_FRAME_BYTES = 4 * GAUGE_HEIGHT * 5;

/**
 * Images de 20 × 81 pixels (`FUN_00437af0`, appelée par `gm_draw_hud`) : par image 4 plans × 81 lignes × 5 octets ; chaque octet est un
 * numéro de ligne de la table de mélange (0xf0 : identité, donc transparent). Retourne, par image, 20 × 81 octets ligne par ligne.
 */
export function parseGauge(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length % GAUGE_FRAME_BYTES !== 0) throw new Error(`jauge : ${bytes.length} octets, pas un multiple de ${GAUGE_FRAME_BYTES}`);
  return Array.from({ length: bytes.length / GAUGE_FRAME_BYTES }, (_, frame) => {
    const out = new Uint8Array(GAUGE_WIDTH * GAUGE_HEIGHT);
    let p = frame * GAUGE_FRAME_BYTES;
    for (let plane = 0; plane < 4; plane++) {
      for (let y = 0; y < GAUGE_HEIGHT; y++) for (let c = 0; c < 5; c++) out[y * GAUGE_WIDTH + c * 4 + plane] = bytes[p++]!;
    }
    return out;
  });
}

// --- Textures et sprites à numéros de ligne (blocs 504, 505, 506) ------------------------------------------------------------

/** Tranche de `count` images de `width × height` octets, rangées ligne par ligne. */
function frames(bytes: Uint8Array, width: number, height: number): Uint8Array[] {
  const size = width * height;
  if (bytes.length % size !== 0) throw new Error(`images ${width}x${height} : ${bytes.length} octets, pas un multiple de ${size}`);
  return Array.from({ length: bytes.length / size }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
}

/** Transpose des images rangées colonne par colonne (`columns` colonnes de `height` octets) en lignes. */
function columnMajor(bytes: Uint8Array, columns: number, height: number): Uint8Array[] {
  return frames(bytes, columns, height).map((frame) => {
    const out = new Uint8Array(columns * height);
    for (let c = 0; c < columns; c++) for (let y = 0; y < height; y++) out[y * columns + c] = frame[c * height + y]!;
    return out;
  });
}

export const TEXTURES_BLOCK = 504;
export const SPRITES_21X35_BLOCK = 505;
export const SPRITES_29X40_BLOCK = 506;

/** Bloc 504 : images de 64 × 64 octets, ligne par ligne (`FUN_00435688`, sprites étirés) ; chaque octet est un numéro de ligne de la table 109 des `.SLV`, 0 = transparent. */
export const parseTextures = (bytes: Uint8Array): Uint8Array[] => frames(bytes, 64, 64);
/** Bloc 505 : images de 21 × 35, rangées colonne par colonne dans le fichier (`FUN_004353f4`) ; rendues ici ligne par ligne. */
export const parseSprites21x35 = (bytes: Uint8Array): Uint8Array[] => columnMajor(bytes, 21, 35);
/** Bloc 506 : images de 29 × 40 (le jeu n'en dessine que 28 colonnes, `FUN_00437c38`), colonne par colonne dans le fichier ; rendues ligne par ligne. */
export const parseSprites29x40 = (bytes: Uint8Array): Uint8Array[] => columnMajor(bytes, 29, 40);

// --- Table de mélange et palette 16 bits ---------------------------------------------------------------------------------------

export const BLEND_BLOCK = 800;
export const BLEND_ROWS = 256;

/** Bloc 800 : table 256 × 256 ; la couleur obtenue en dessinant le numéro de ligne `r` sur le pixel `d` est `table[r << 8 | d]`. */
export function parseBlendTable(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== BLEND_ROWS * 256) throw new Error(`table de mélange : ${bytes.length} octets`);
  return bytes;
}

/** Bloc 509 : 256 u16, copiés tels quels dans `005bb810` par `0046f0c0` (hypothèse : dégradé ARGB 4-4-4-4 des versions accélérées). */
export function parseColorRamp(bytes: Uint8Array): Uint16Array {
  const r = new BinaryReader(bytes);
  return Uint16Array.from({ length: bytes.length / 2 }, () => r.u16());
}

// --- Ensemble ------------------------------------------------------------------------------------------------------------------

export interface GlobalData {
  header: GlobalHeader;
  strings: StringTables;
  font: Font;
  missions: MissionScript;
  vectorFont: VectorFont;
  blendTable: Uint8Array;
  craters: Int32Array[][];
  /** Icônes d'armes du HUD (bloc 501, 22 images) : cadre vide (0), armes (1 à 20) et flèche (21). */
  weaponIcons: RleSprite[];
  /** Éléments du radar : bloc 510 (32 images), 511 (128 petites images), 512 (128 images), dessinés à l'origine de l'écran. */
  radar: { frames510: RleSprite[]; frames511: RleSprite[]; frames512: RleSprite[] };
  gauge: Uint8Array[];
  textures: Uint8Array[];
  sprites21x35: Uint8Array[];
  sprites29x40: Uint8Array[];
  colorRamp: Uint16Array;
  /** Écran `id` (1001 à 1005), décodé à la demande. */
  screen(id: number): Screen;
}

export function parseGlobal(bd: BdArchive): GlobalData {
  return {
    header: parseHeader(bd),
    strings: parseStrings(bd),
    font: parseFont(bd),
    missions: parseMissions(bd),
    vectorFont: parseVectorFont(bd.get(VECTOR_FONT_BLOCK)),
    blendTable: parseBlendTable(bd.get(BLEND_BLOCK)),
    craters: parseCraters(bd.get(CRATERS_BLOCK)),
    weaponIcons: parseRleSprites(bd.get(501)),
    radar: {
      frames510: parseRleSprites(bd.get(510)),
      frames511: parseRleSprites(bd.get(511)),
      frames512: parseRleSprites(bd.get(512)),
    },
    gauge: parseGauge(bd.get(GAUGE_BLOCK)),
    textures: parseTextures(bd.get(TEXTURES_BLOCK)),
    sprites21x35: parseSprites21x35(bd.get(SPRITES_21X35_BLOCK)),
    sprites29x40: parseSprites29x40(bd.get(SPRITES_29X40_BLOCK)),
    colorRamp: parseColorRamp(bd.get(509)),
    screen: (id) => {
      if (!(SCREEN_IDS as readonly number[]).includes(id)) throw new Error(`écran : ${id} n'est pas un écran de GLOBAL.BD`);
      return parseScreen(bd.get(id));
    },
  };
}
