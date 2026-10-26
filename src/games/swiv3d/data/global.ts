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
  /**
   * Affiche l'écran 1005 pendant l'intro de `gm_main_game` (`0042174a`, `0042182c`), exactement comme `demo` à ces deux endroits ;
   * seul `demo` joue aussi un rôle ailleurs (`swivdemo.cfg`, menu). Ne sert à rien d'autre.
   */
  flag02: 0x02,
  /** Réservé : posé dans `GLOBAL.BD` du CD (`0xb2`) mais testé par aucun des trois exécutables (`SWIV_WIN`, `SWIV_WFX`, `SWIV_WDX`). */
  reserved10: 0x10,
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

/**
 * Images en 4 plans du mode X : par image, `planes × height × bytesPerRow` octets ; le pixel `x` d'une ligne est l'octet `x >> 2` du
 * plan `x & 3`. Retourne, par image, `(4 × bytesPerRow) × height` octets ligne par ligne.
 */
function planarFrames(bytes: Uint8Array, bytesPerRow: number, height: number, what: string): Uint8Array[] {
  const width = 4 * bytesPerRow;
  const frameBytes = width * height;
  if (bytes.length % frameBytes !== 0) throw new Error(`${what} : ${bytes.length} octets, pas un multiple de ${frameBytes}`);
  return Array.from({ length: bytes.length / frameBytes }, (_, frame) => {
    const out = new Uint8Array(frameBytes);
    let p = frame * frameBytes;
    for (let plane = 0; plane < 4; plane++) {
      for (let y = 0; y < height; y++) for (let c = 0; c < bytesPerRow; c++) out[y * width + c * 4 + plane] = bytes[p++]!;
    }
    return out;
  });
}

/**
 * Images de 20 × 81 pixels (`FUN_00437af0`, appelée par `gm_draw_hud`) : par image 4 plans × 81 lignes × 5 octets ; chaque octet est un
 * numéro de ligne de la table de mélange (0xf0 : identité, donc transparent). Retourne, par image, 20 × 81 octets ligne par ligne.
 */
export const parseGauge = (bytes: Uint8Array): Uint8Array[] => planarFrames(bytes, GAUGE_WIDTH / 4, GAUGE_HEIGHT, "jauge");

// --- Chiffres du HUD (bloc 502) ----------------------------------------------------------------------------------------------

export const DIGITS_BLOCK = 502;
export const DIGIT_WIDTH = 12;
export const DIGIT_HEIGHT = 14;

/**
 * Bloc 502 : 11 images de 12 × 14 pixels, 4 plans × 14 lignes × 3 octets chacune : les chiffres `0` à `9` (images 0 à 9) et le signe
 * `x` (image 10), de l'ancien compteur de munitions `x%02d`. Chaque octet est un numéro de ligne de la table de mélange (0xf0 :
 * identité, donc transparent ; 0xfc à 0xff : trait). Seul lecteur : `00437a7c`, code mort jamais appelé (le jeu écrit le compteur avec
 * `gm_draw_text`), absent de la décompilation mais présent dans l'exécutable et dans `SWIV_WFX.EXE`.
 */
export const parseDigitSprites = (bytes: Uint8Array): Uint8Array[] => planarFrames(bytes, DIGIT_WIDTH / 4, DIGIT_HEIGHT, "chiffres");

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

/**
 * Bloc 509 : 256 u16 ARGB 4-4-4-4, copiés tels quels dans `005bb810` par `0046f0c0`. Palette des textures 8 bits des versions accélérées
 * (blocs 500 et 504) : l'envoi de texture 64×64 (`SWIV_WFX.EXE` `004752f4`, commande `0x7d7`) remplace chaque texel `t` par
 * `rampe[t]` dans une texture Glide de format `0xc` (`GR_TEXFMT_ARGB_4444`). Confirmé.
 */
export function parseColorRamp(bytes: Uint8Array): Uint16Array {
  const r = new BinaryReader(bytes);
  return Uint16Array.from({ length: bytes.length / 2 }, () => r.u16());
}

/** Décompose un u16 ARGB 4-4-4-4 de la rampe 509 en `[r, g, b, a]` sur 8 bits. */
export function argb4444(value: number): [number, number, number, number] {
  return [((value >> 8) & 15) * 17, ((value >> 4) & 15) * 17, (value & 15) * 17, ((value >> 12) & 15) * 17];
}

// --- Ressources des versions accélérées 3Dfx / Direct3D (blocs 450, 451, 452, 500) ---------------------------------------------
// Chargées par `gm_global_init` seulement quand `DAT_0048464c != 0` ; `SWIV_WIN.EXE` (logiciel) ne les charge pas.

export const HARDWARE_FONT_BLOCK = 450;
export const HARDWARE_HUD_BLOCK = 451;
export const HARDWARE_GAUGE_BLOCK = 452;
export const PARTICLE_BLOCK = 500;

/**
 * Sprite à lignes compressées, format des blocs 450 (police) et 452 (jauge) : dessiné sur une surface 16 bits par `00414e81` (opaque)
 * ou `00414f0f` (mélangé) de `SWIV_WFX.EXE`. `pixels` vaut la valeur de l'octet source (un niveau de mélange, 0 hors couverture) et
 * `covered` 1 là où le sprite écrit.
 */
export interface RowRleSprite {
  width: number;
  height: number;
  pixels: Uint8Array;
  covered: Uint8Array;
}

/**
 * Table de `n` offsets u32 absolus (`n` = premier offset / 4), puis un flux par sprite. Octet `a` du flux : `0xff` fin du sprite ;
 * `0xfe` ligne suivante (le décodeur retranche 0x800 octets, soit les 1024 pixels dont chaque ligne est complétée par un saut, puis
 * ajoute le pas de la surface) ; sinon deux bits de tête et `n = a & 0x3f` : `00` saut de `(n << 8 | octet suivant)` pixels, `01` saut
 * de `n`, `10` `n` pixels de la valeur de l'octet suivant, `11` `n` pixels de valeurs littérales.
 */
export function parseRowRleSprites(bytes: Uint8Array): RowRleSprite[] {
  const count = new BinaryReader(bytes).u32() / 4;
  const offsets = new BinaryReader(bytes);
  return Array.from({ length: count }, (_, index) => {
    offsets.offset = index * 4;
    let p = offsets.u32();
    const rows: Map<number, number>[] = [];
    let row = new Map<number, number>();
    let x = 0;
    let width = 0;
    for (;;) {
      if (p >= bytes.length) throw new Error(`sprite ${index} : flux non terminé`);
      const a = bytes[p++]!;
      if (a === 0xff) break;
      if (a === 0xfe) {
        rows.push(row);
        row = new Map();
        x = 0;
        continue;
      }
      const n = a & 0x3f;
      switch (a >> 6) {
        case 0:
          x += (n << 8) | bytes[p++]!;
          break;
        case 1:
          x += n;
          break;
        case 2: {
          const value = bytes[p++]!;
          for (let i = 0; i < n; i++) row.set(x++, value);
          width = Math.max(width, x);
          break;
        }
        default:
          for (let i = 0; i < n; i++) row.set(x++, bytes[p++]!);
          width = Math.max(width, x);
      }
    }
    const height = rows.length;
    const pixels = new Uint8Array(width * height);
    const covered = new Uint8Array(width * height);
    rows.forEach((r, y) =>
      r.forEach((value, cx) => {
        pixels[y * width + cx] = value;
        covered[y * width + cx] = 1;
      }),
    );
    return { width, height, pixels, covered };
  });
}

/** Texture 8 bits Glide `GR_TEXFMT_ALPHA_INTENSITY_44` : quartet haut = alpha, quartet bas = intensité. */
export interface Ai44Texture {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Côté d'une cellule d'icône dans l'atlas du bloc 451 (grille de 5 colonnes) : l'image `i` du HUD est en `(i % 5, i / 5)`. */
export const HUD_ICON_CELL = 51;
export const HUD_ICON_COLUMNS = 5;

export interface HardwareHud {
  /** Atlas 256×256, slot de texture 10 : 22 icônes (0 capsule vide, 1 à 20 armes, 21 flèche) en cellules de `HUD_ICON_CELL`. */
  icons: Ai44Texture;
  /** Deux textures 128×128, slots 11 et 12 : cadres tournants du radar (dessinés par `00437870`/`004379xx` de `SWIV_WFX.EXE`). */
  radar: [Ai44Texture, Ai44Texture];
}

/**
 * Bloc 451 (98 304 octets) : trois textures envoyées par `0046f0c0` aux commandes `0x7d8` (256×256) puis `0x7d9` (128×128 deux fois),
 * sans palette. Le HUD les dessine par la commande `0x3f3` (carré de 45 pixels, UV `(i % 5, i / 5) × 51`).
 */
export function parseHardwareHud(bytes: Uint8Array): HardwareHud {
  const sizes = [256, 128, 128];
  if (bytes.length !== sizes.reduce((sum, s) => sum + s * s, 0)) throw new Error(`atlas du HUD accéléré : ${bytes.length} octets`);
  let at = 0;
  const [icons, radarA, radarB] = sizes.map((size) => {
    const texture = { width: size, height: size, data: bytes.subarray(at, at + size * size) };
    at += size * size;
    return texture;
  }) as [Ai44Texture, Ai44Texture, Ai44Texture];
  return { icons, radar: [radarA, radarB] };
}

/** Rectangle `(x, y, taille)` de l'icône `index` (0 à 24) dans `HardwareHud.icons`. */
export function hudIconRect(index: number): { x: number; y: number; size: number } {
  return { x: (index % HUD_ICON_COLUMNS) * HUD_ICON_CELL, y: Math.floor(index / HUD_ICON_COLUMNS) * HUD_ICON_CELL, size: HUD_ICON_CELL };
}

/**
 * Bloc 500 : 7 textures 64×64 de texels 8 bits (indices de la rampe 509), slots de texture 0 à 6 : halos et anneaux d'impact
 * (orange, vert, bleu, anneau de flammes, petit flash) puis deux viseurs (carré à coins, croix). Équivalent des blocs 505/506.
 */
export const parseParticleTextures = (bytes: Uint8Array): Uint8Array[] => frames(bytes, 64, 64);

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
  /** Bloc 502 : chiffres `0`-`9` et `x` (12 × 14, numéros de ligne de la table de mélange), jamais dessinés par le jeu. */
  digits: Uint8Array[];
  /** Ressources des versions accélérées (jamais utilisées par `SWIV_WIN.EXE`). */
  hardware: { font: RowRleSprite[]; gauge: RowRleSprite[]; hud: HardwareHud; particles: Uint8Array[] };
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
    digits: parseDigitSprites(bd.get(DIGITS_BLOCK)),
    hardware: {
      font: parseRowRleSprites(bd.get(HARDWARE_FONT_BLOCK)),
      gauge: parseRowRleSprites(bd.get(HARDWARE_GAUGE_BLOCK)),
      hud: parseHardwareHud(bd.get(HARDWARE_HUD_BLOCK)),
      particles: parseParticleTextures(bd.get(PARTICLE_BLOCK)),
    },
    screen: (id) => {
      if (!(SCREEN_IDS as readonly number[]).includes(id)) throw new Error(`écran : ${id} n'est pas un écran de GLOBAL.BD`);
      return parseScreen(bd.get(id));
    },
  };
}
