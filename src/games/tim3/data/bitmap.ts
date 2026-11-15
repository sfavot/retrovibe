/**
 * Images de TIM3 (`docs/tim3/formats.md` § 4). Deux familles de fichiers `.BMP`, toutes deux en 8 bits indexés, lignes de haut en bas :
 *
 * - **BMP plat** (« BMP: » dont la taille n'a pas le bit conteneur, v1000) : `u16 version = 1000`, `u16 nFrames`,
 *   `u32 offset[nFrames]` (absolus), puis par frame `u16 w`, `u16 h`, `u8 compression` (0 partout), `u32 octets` (= w×h), pixels.
 * - **BMP DGDS** (conteneur « BMP: ») : `INF:` = `u16 n, u16 w[n], u16 h[n]` ; `BIN:` et `VGA:` = charges compressées (§ 3) de
 *   quartets : le pixel `2i` vaut `BIN[i] & 0xF | (VGA[i] & 0xF) << 4`, le pixel `2i+1` vaut `BIN[i] >> 4 | VGA[i] & 0xF0` ;
 *   les frames se suivent sans alignement. `SCL:` (vide) est ignoré.
 *
 * Tout est lu à l'octet près : un reste, un trou ou une taille incohérente lève une erreur.
 */
import { BinaryReader } from "../../../data/reader";
import { decompress, decompressPayload } from "./compression";
import { findChunk, readChunks } from "./dgds-chunk";

export interface BitmapFrame {
  readonly width: number;
  readonly height: number;
  /** `width × height` indices de palette, ligne par ligne. */
  readonly pixels: Uint8Array;
}

export interface Bitmap {
  readonly frames: BitmapFrame[];
}

const FLAT_VERSION = 1000;
const CONTAINER_BIT = 0x80000000;

/** Lit un `.BMP`, plat ou DGDS. */
export function readBitmap(bytes: Uint8Array): Bitmap {
  if (bytes.length < 8 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "BMP:") {
    throw new Error("TIM3 : BMP sans signature « BMP: »");
  }
  const sizeField = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  return sizeField & CONTAINER_BIT ? readDgdsBitmap(bytes) : readFlatBitmap(bytes);
}

function readFlatBitmap(bytes: Uint8Array): Bitmap {
  const r = new BinaryReader(bytes);
  r.offset = 4;
  const size = r.u32();
  if (size !== bytes.length - 8) throw new Error("TIM3 : taille du BMP incohérente avec le fichier");
  const version = r.u16();
  if (version !== FLAT_VERSION) throw new Error(`TIM3 : version de BMP ${version} inconnue`);
  const count = r.u16();
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(r.u32());

  const frames: BitmapFrame[] = [];
  let expected = r.offset;
  for (const offset of offsets) {
    if (offset !== expected) throw new Error("TIM3 : frames de BMP non contiguës");
    r.offset = offset;
    const width = r.u16();
    const height = r.u16();
    const compression = r.u8();
    const byteCount = r.u32();
    if (r.offset + byteCount > bytes.length) throw new Error("TIM3 : frame de BMP tronquée");
    const raw = r.bytesView(byteCount);
    // La compression vaut 0 partout dans le jeu ; sinon `byteCount` serait la taille compressée, non attestée.
    if (compression !== 0) throw new Error(`TIM3 : compression ${compression} de frame non attestée`);
    if (byteCount !== width * height) throw new Error("TIM3 : taille de frame différente de largeur × hauteur");
    frames.push({ width, height, pixels: decompress(0, raw, byteCount) });
    expected = r.offset;
  }
  if (expected !== bytes.length) throw new Error("TIM3 : octets restants après la dernière frame");
  return { frames };
}

function readDgdsBitmap(bytes: Uint8Array): Bitmap {
  const top = readChunks(bytes);
  if (top.length !== 1 || top[0].tag !== "BMP:" || !top[0].container) throw new Error("TIM3 : BMP DGDS mal formé");
  const chunks = top[0].children;
  const inf = findChunk(chunks, "INF:");
  const bin = findChunk(chunks, "BIN:");
  const vga = findChunk(chunks, "VGA:");
  if (!inf || !bin || !vga) throw new Error("TIM3 : BMP DGDS sans INF:, BIN: ou VGA:");

  const r = new BinaryReader(inf.data);
  const count = r.u16();
  const widths: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i < count; i++) widths.push(r.u16());
  for (let i = 0; i < count; i++) heights.push(r.u16());
  if (!r.isAtEnd) throw new Error("TIM3 : octets restants dans INF:");

  const low = decompressPayload(bin.data);
  const high = decompressPayload(vga.data);
  if (low.length !== high.length) throw new Error("TIM3 : BIN: et VGA: de tailles différentes");
  const total = widths.reduce((sum, w, i) => sum + w * heights[i], 0);
  if (total !== low.length * 2) throw new Error("TIM3 : pixels du BMP DGDS différents de la somme des frames");

  const all = new Uint8Array(total);
  for (let i = 0; i < low.length; i++) {
    all[2 * i] = (low[i] & 0x0f) | ((high[i] & 0x0f) << 4);
    all[2 * i + 1] = (low[i] >> 4) | (high[i] & 0xf0);
  }
  const frames: BitmapFrame[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const n = widths[i] * heights[i];
    frames.push({ width: widths[i], height: heights[i], pixels: all.subarray(at, at + n) });
    at += n;
  }
  return { frames };
}
