import { BinaryReader } from "../../../data/reader";
import type { Cursor, Icon } from "./resources";

/** Ressource d'un exécutable PE 32 bits : type et identifiant sont des nombres, ou des noms pour les ressources nommées. */
export interface PeResource {
  type: number | string;
  id: number | string;
  language: number;
  data: Uint8Array;
}

const RT_CURSOR = 1;
const RT_ICON = 3;
const RT_STRING = 6;
const DIB_HEADER_SIZE = 40;
const DIRECTORY_FLAG = 0x80000000;

/** Ressources de la section .rsrc d'un exécutable PE : type → nom ou identifiant → langue → données. */
export function readPeResources(exe: ArrayBuffer | Uint8Array): PeResource[] {
  const bytes = exe instanceof Uint8Array ? exe : new Uint8Array(exe);
  const r = new BinaryReader(bytes);
  r.offset = 0x3c;
  const pe = r.u32();
  r.offset = pe;
  if (r.u32() !== 0x4550) throw new Error("Signature PE introuvable");
  r.offset = pe + 6;
  const sectionCount = r.u16();
  r.offset = pe + 20;
  const optionalSize = r.u16();
  const optional = pe + 24;
  r.offset = optional;
  const magic = r.u16();
  if (magic !== 0x10b) throw new Error("Seuls les exécutables PE 32 bits sont gérés");
  r.offset = optional + 96 + 2 * 8; // répertoire de données n° 2 : ressources
  const rsrcRva = r.u32();
  if (!rsrcRva) return [];

  // table des sections : adresse virtuelle → offset fichier
  const sections: { rva: number; size: number; raw: number }[] = [];
  r.offset = optional + optionalSize;
  for (let i = 0; i < sectionCount; i++) {
    r.offset += 8; // nom
    const virtualSize = r.u32();
    const rva = r.u32();
    const rawSize = r.u32();
    const raw = r.u32();
    r.offset += 16;
    sections.push({ rva, size: Math.max(virtualSize, rawSize), raw });
  }
  const toOffset = (rva: number): number => {
    const s = sections.find((sec) => rva >= sec.rva && rva < sec.rva + sec.size);
    if (!s) throw new Error(`Adresse virtuelle hors section : 0x${rva.toString(16)}`);
    return s.raw + rva - s.rva;
  };
  const base = toOffset(rsrcRva);

  /** Nom UTF-16LE préfixé par sa longueur, relatif au début du répertoire. */
  const readName = (offset: number): string => {
    r.offset = base + offset;
    const length = r.u16();
    return new TextDecoder("utf-16le").decode(bytes.subarray(r.offset, r.offset + length * 2));
  };
  const readDirectory = (offset: number): { key: number | string; target: number }[] => {
    r.offset = base + offset + 12;
    const named = r.u16();
    const ids = r.u16();
    const raw = Array.from({ length: named + ids }, () => ({ key: r.u32(), target: r.u32() }));
    return raw.map(({ key, target }) => ({ key: key & DIRECTORY_FLAG ? readName(key & ~DIRECTORY_FLAG) : key, target }));
  };

  const resources: PeResource[] = [];
  for (const type of readDirectory(0)) {
    for (const name of readDirectory(type.target & ~DIRECTORY_FLAG)) {
      for (const lang of readDirectory(name.target & ~DIRECTORY_FLAG)) {
        r.offset = base + lang.target; // entrée de données : RVA, taille
        const rva = r.u32();
        const size = r.u32();
        const start = toOffset(rva);
        resources.push({ type: type.key, id: name.key, language: Number(lang.key), data: bytes.subarray(start, start + size) });
      }
    }
  }
  return resources;
}

/**
 * Curseurs de l'exécutable PE, indexés par identifiant. Même format que ceux de DESKADV.EXE :
 * un hotspot (2 × u16) suivi d'un DIB 1 bpp dont la hauteur couvre le masque XOR puis le masque AND.
 */
export function readPeCursors(exe: ArrayBuffer | Uint8Array): Map<number, Cursor> {
  const cursors = new Map<number, Cursor>();
  for (const { type, id, data } of readPeResources(exe)) {
    if (type !== RT_CURSOR || typeof id !== "number") continue;
    const cursor = decodeCursor(data, id);
    if (cursor) cursors.set(id, cursor);
  }
  return cursors;
}

/** Icônes de l'exécutable PE, indexées par identifiant (DIB 1, 4 ou 8 bpp avec masque AND, voir `readIcons` de DESKADV.EXE). */
export function readPeIcons(exe: ArrayBuffer | Uint8Array): Map<number, Icon> {
  const icons = new Map<number, Icon>();
  for (const { type, id, data } of readPeResources(exe)) {
    if (type !== RT_ICON || typeof id !== "number") continue;
    const dib = decodeIconDib(data);
    if (dib) icons.set(id, { id, ...dib });
  }
  return icons;
}

/**
 * Chaînes de l'exécutable PE (STRINGTABLE), indexées par identifiant. Le bloc `n` contient les ids (n-1)*16 à (n-1)*16+15 :
 * 16 chaînes UTF-16LE préfixées par leur longueur en caractères (0 pour un emplacement vide, qui est omis).
 */
export function readPeStrings(exe: ArrayBuffer | Uint8Array): Map<number, string> {
  const strings = new Map<number, string>();
  const decoder = new TextDecoder("utf-16le");
  for (const { type, id, data } of readPeResources(exe)) {
    if (type !== RT_STRING || typeof id !== "number") continue;
    const r = new BinaryReader(data);
    for (let i = 0; i < 16 && r.offset + 2 <= data.length; i++) {
      const length = r.u16();
      if (!length) continue;
      strings.set((id - 1) * 16 + i, decoder.decode(data.subarray(r.offset, r.offset + length * 2)));
      r.offset += length * 2;
    }
  }
  return strings;
}

function decodeCursor(data: Uint8Array, id: number): Cursor | null {
  const r = new BinaryReader(data);
  const hotspotX = r.u16();
  const hotspotY = r.u16();
  if (r.u32() !== DIB_HEADER_SIZE) return null;
  const width = r.i32();
  const height = r.i32() / 2;
  r.offset += 2; // plans
  if (r.u16() !== 1) return null; // seuls les curseurs 1 bpp sont gérés
  r.offset = 4 + DIB_HEADER_SIZE;
  const colors = [r.u32(), r.u32()]; // BGRx
  const stride = Math.ceil(width / 32) * 4;
  const masks = data.subarray(r.offset);
  if (masks.length < stride * height * 2) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const bit = (row: number, x: number) => (masks[row * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
  for (let y = 0; y < height; y++) {
    const stored = height - 1 - y; // le DIB est stocké de bas en haut
    for (let x = 0; x < width; x++) {
      // AND=1 : transparent (l'inversion de l'écran, AND=1 et XOR=1, est rendue transparente aussi).
      if (bit(height + stored, x)) continue;
      const color = colors[bit(stored, x)];
      const o = (y * width + x) * 4;
      rgba[o] = (color >> 16) & 0xff;
      rgba[o + 1] = (color >> 8) & 0xff;
      rgba[o + 2] = color & 0xff;
      rgba[o + 3] = 0xff;
    }
  }
  return { id, width, height, hotspotX, hotspotY, rgba };
}

/** DIB d'icône 1, 4 ou 8 bpp avec sa palette, suivi du masque AND 1 bpp (la hauteur de l'en-tête couvre les deux images). */
function decodeIconDib(data: Uint8Array): { width: number; height: number; rgba: Uint8ClampedArray } | null {
  const r = new BinaryReader(data);
  if (r.u32() !== DIB_HEADER_SIZE) return null;
  const width = r.i32();
  const height = r.i32() / 2;
  r.offset += 2; // plans
  const bpp = r.u16();
  if (bpp !== 1 && bpp !== 4 && bpp !== 8) return null;
  r.offset = 32;
  const count = r.u32() || 1 << bpp;
  r.offset = DIB_HEADER_SIZE;
  const colors = Array.from({ length: count }, () => r.u32()); // BGRx
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const pixels = data.subarray(r.offset);
  const mask = pixels.subarray(stride * height);
  if (pixels.length < stride * height || mask.length < maskStride * height) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const stored = height - 1 - y;
    for (let x = 0; x < width; x++) {
      if ((mask[stored * maskStride + (x >> 3)] >> (7 - (x & 7))) & 1) continue;
      const at = stored * stride;
      const index =
        bpp === 8 ? pixels[at + x] : bpp === 4 ? (pixels[at + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : (pixels[at + (x >> 3)] >> (7 - (x & 7))) & 1;
      const color = colors[index] ?? 0;
      const o = (y * width + x) * 4;
      rgba[o] = (color >> 16) & 0xff;
      rgba[o + 1] = (color >> 8) & 0xff;
      rgba[o + 2] = color & 0xff;
      rgba[o + 3] = 0xff;
    }
  }
  return { width, height, rgba };
}
