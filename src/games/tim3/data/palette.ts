/**
 * Palettes de TIM3 (`docs/tim3/formats.md` § 4) vers 256 couleurs RGBA (1024 octets, `r, g, b, a` par entrée).
 *
 * - RIFF « PAL data » (25 fichiers dont `TIM_NEW.PAL`) : `u16 0x300`, `u16 256`, puis des entrées `R, G, B, drapeaux`.
 * - DGDS (`TIM2.PAL`, `PARTTEMP.PAL`, `BLACK.PAL`) : conteneur `PAL:` avec `VGA:` = 768 octets RVB sur 6 bits, étendus à 8 bits
 *   (`v << 2 | v >> 4`, soit 63 → 255) ; un éventuel `EGA:` est ignoré.
 *
 * L'index 0 est la **transparence** des sprites : alpha 0 (couleur conservée), tous les autres à 255.
 */
import { BinaryReader } from "../../../data/reader";
import { findChunk, readChunks } from "./dgds-chunk";

export const PALETTE_SIZE = 256;
export const TRANSPARENT_INDEX = 0;

const RIFF_VERSION = 0x300;

export function readPalette(bytes: Uint8Array): Uint8Array {
  const rgba = bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" ? readRiff(bytes) : readDgds(bytes);
  rgba[TRANSPARENT_INDEX * 4 + 3] = 0;
  return rgba;
}

function readRiff(bytes: Uint8Array): Uint8Array {
  const r = new BinaryReader(bytes);
  r.tag();
  const size = r.u32();
  if (size !== bytes.length - 8) throw new Error("TIM3 : taille RIFF de palette incohérente");
  if (r.tag() !== "PAL ") throw new Error("TIM3 : palette RIFF sans « PAL  »");
  if (r.tag() !== "data") throw new Error("TIM3 : palette RIFF sans bloc data");
  const dataSize = r.u32();
  const version = r.u16();
  const count = r.u16();
  if (version !== RIFF_VERSION || count !== PALETTE_SIZE || dataSize !== 4 + 4 * count || r.offset + 4 * count !== bytes.length) {
    throw new Error("TIM3 : palette RIFF mal formée");
  }
  const out = new Uint8Array(PALETTE_SIZE * 4);
  for (let i = 0; i < count; i++) {
    out[4 * i] = r.u8();
    out[4 * i + 1] = r.u8();
    out[4 * i + 2] = r.u8();
    r.u8(); // drapeaux (PC_NOCOLLAPSE…), sans effet ici
    out[4 * i + 3] = 255;
  }
  return out;
}

function readDgds(bytes: Uint8Array): Uint8Array {
  const top = readChunks(bytes);
  const vga = top.length === 1 && top[0].tag === "PAL:" ? findChunk(top[0].children, "VGA:") : undefined;
  if (!vga || vga.data.length !== PALETTE_SIZE * 3) throw new Error("TIM3 : palette DGDS sans VGA: de 768 octets");
  const out = new Uint8Array(PALETTE_SIZE * 4);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    for (let c = 0; c < 3; c++) {
      const v = vga.data[3 * i + c] & 0x3f;
      out[4 * i + c] = (v << 2) | (v >> 4);
    }
    out[4 * i + 3] = 255;
  }
  return out;
}
