/**
 * Polices de TIM3 (`docs/tim3/formats.md` § 4).
 *
 * **FNT** (DGDS, 6 fichiers + `SYS12.FNT` français) : `u8 0xFF`, `u8 w`, `u8 h`, `u8 ligne de base`, `u8 premier caractère`,
 * `u8 nombre`, `u16 taille décompressée`, puis une charge compressée (`u8 méthode` (RLE), `u32 taille`, flux) qui contient
 * `u16 offset[n]`, `u8 largeur[n]`, puis les glyphes : `ceil(largeur / 8) × h` octets, bits de poids fort à gauche.
 * Les offsets sont relatifs au début des glyphes et se suivent sans trou.
 *
 * **PFT** (`PFNT`, police du moteur 32 bits `GFXFont`, 8 fichiers) : chunks `tag[4] + u32 taille` : `PFNT` (conteneur, dont la taille
 * est trop courte), `head` (12 × u32), `PBMA` (`head` 8 octets = 0x101 et 255, `user` de 3 060 octets, `rmap` = 255 × u32 indice de
 * glyphe + 1 par code de caractère), puis 255 chunks `PBMP` (`head` = version 1, largeur, hauteur, 8 bits, 1 ; `data` = hauteur lignes de
 * `(largeur + 3) & ~3` octets, comme un DIB, 0xFF = encre). **La taille de chaque `PBMP` est inférieure de 4 octets à son étendue réelle** : le chunk suivant commence
 * 4 octets après `taille + 8`, et les `PBMP` se prolongent au-delà de la fin déclarée de `PFNT` jusqu'à la fin du fichier.
 */
import { BinaryReader } from "../../../data/reader";
import { decompressPayload } from "./compression";

export interface FontGlyph {
  readonly width: number;
  readonly height: number;
  /** `width × height` valeurs, 0 = fond ; FNT : 1 = encre ; PFT : valeur d'origine (0xFF = encre). */
  readonly pixels: Uint8Array;
}

export interface Font {
  readonly kind: "fnt" | "pft";
  /** Hauteur de ligne. */
  readonly height: number;
  /** Ligne de base (FNT : champ d'en-tête ; PFT : 6e mot de `head`, supposé identique). */
  readonly baseline: number;
  /** Code du premier glyphe : 32 pour la plupart des FNT, 0 pour les autres FNT, 1 pour les PFT (`rmap` : codes 1 à 255). */
  readonly firstChar: number;
  /** Glyphes consécutifs à partir de `firstChar`. */
  readonly glyphs: FontGlyph[];
}

/** Glyphe d'un code de caractère (Windows-1252), ou `undefined` s'il est hors de la police. */
export function glyphFor(font: Font, code: number): FontGlyph | undefined {
  return font.glyphs[code - font.firstChar];
}

export function readFnt(bytes: Uint8Array): Font {
  const r = new BinaryReader(bytes);
  if (r.tag() !== "FNT:") throw new Error("TIM3 : police sans signature « FNT: »");
  const chunkSize = r.u32();
  if (chunkSize !== bytes.length - 8) throw new Error("TIM3 : taille de FNT incohérente");
  if (r.u8() !== 0xff) throw new Error("TIM3 : en-tête de FNT inconnu");
  const maxWidth = r.u8();
  const height = r.u8();
  const baseline = r.u8();
  const firstChar = r.u8();
  const count = r.u8();
  const size = r.u16();
  const data = decompressPayload(bytes.subarray(r.offset));
  if (data.length !== size) throw new Error("TIM3 : taille décompressée de FNT incohérente");

  const t = new BinaryReader(data);
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(t.u16());
  const widths: number[] = [];
  for (let i = 0; i < count; i++) widths.push(t.u8());
  const base = t.offset;

  const glyphs: FontGlyph[] = [];
  let expected = 0;
  for (let i = 0; i < count; i++) {
    const w = widths[i];
    const stride = (w + 7) >> 3;
    if (w > maxWidth || offsets[i] !== expected) throw new Error(`TIM3 : glyphe ${i} de FNT incohérent`);
    expected += stride * height;
    if (base + expected > data.length) throw new Error("TIM3 : glyphes de FNT tronqués");
    const pixels = new Uint8Array(w * height);
    for (let y = 0; y < height; y++) {
      const row = base + offsets[i] + y * stride;
      for (let x = 0; x < w; x++) pixels[y * w + x] = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
    }
    glyphs.push({ width: w, height, pixels });
  }
  if (base + expected !== data.length) throw new Error("TIM3 : octets restants après les glyphes de FNT");
  return { kind: "fnt", height, baseline, firstChar, glyphs };
}

const PFT_GLYPH_COUNT = 255;

export function readPft(bytes: Uint8Array): Font {
  const r = new BinaryReader(bytes);
  const expectChunk = (tag: string, size?: number): number => {
    if (r.offset + 8 > bytes.length || r.tag() !== tag) throw new Error(`TIM3 : chunk ${tag} attendu dans la police PFT`);
    const s = r.u32();
    if (size !== undefined && s !== size) throw new Error(`TIM3 : chunk ${tag} de taille ${s} (attendu ${size})`);
    return s;
  };
  expectChunk("PFNT"); // sa taille ne couvre pas les PBMP : non contrôlée
  expectChunk("head", 48);
  const head: number[] = [];
  for (let i = 0; i < 12; i++) head.push(r.u32());
  if (head[0] !== 1) throw new Error("TIM3 : version de PFT inconnue");
  expectChunk("PBMA");
  expectChunk("head", 8);
  if (r.u32() !== 0x101 || r.u32() !== PFT_GLYPH_COUNT) throw new Error("TIM3 : en-tête PBMA inconnu");
  const userSize = expectChunk("user");
  if (r.offset + userSize > bytes.length) throw new Error("TIM3 : PFT tronquée");
  r.bytesView(userSize);
  expectChunk("rmap", 4 * PFT_GLYPH_COUNT);
  const rmap: number[] = [];
  for (let i = 0; i < PFT_GLYPH_COUNT; i++) rmap.push(r.u32());

  const bitmaps: FontGlyph[] = [];
  while (!r.isAtEnd) {
    const size = expectChunk("PBMP");
    const start = r.offset;
    expectChunk("head", 20);
    const [version, width, height, depth, planes] = [r.u32(), r.u32(), r.u32(), r.u32(), r.u32()];
    if (version !== 1 || depth !== 8 || planes !== 1) throw new Error("TIM3 : PBMP inconnu");
    const stride = (width + 3) & ~3;
    expectChunk("data", stride * height);
    if (r.offset + stride * height > bytes.length) throw new Error("TIM3 : PFT tronquée");
    const raw = r.bytesView(stride * height);
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) pixels.set(raw.subarray(y * stride, y * stride + width), y * width);
    if (r.offset - start !== size + 4) throw new Error("TIM3 : taille de PBMP incohérente");
    bitmaps.push({ width, height, pixels });
  }
  if (bitmaps.length !== PFT_GLYPH_COUNT) throw new Error("TIM3 : nombre de glyphes de PFT inattendu");
  const glyphs = rmap.map((index) => {
    const g = bitmaps[index - 1];
    if (!g) throw new Error("TIM3 : rmap de PFT hors des glyphes");
    return g;
  });
  // `rmap` a une entrée par code de 1 à 255 (le code 0 n'a pas de glyphe) : établi sur le rendu, la lecture à partir de 0 décale tout d'un caractère.
  return { kind: "pft", height: head[4], baseline: head[5], firstChar: 1, glyphs };
}
