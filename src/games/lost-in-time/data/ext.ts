import { BinaryReader } from "../../../data/reader";
import { unpackBlock } from "./lzss";

export interface ExtItem {
  /** Décalage dans le .EXT, ou dans COMMUN.EX<n> si `inCommun`. */
  offset: number;
  /** Taille stockée, extensions de largeur incluses. */
  size: number;
  width: number;
  height: number;
  packed: boolean;
  inCommun: boolean;
}

export interface ExtResource {
  data: Uint8Array;
  width: number;
  height: number;
}

const HEADER_SIZE = 3;
const ITEM_SIZE = 10;

/** Table d'un fichier .EXT (ressources graphiques). */
export function parseExtTable(file: Uint8Array): ExtItem[] {
  const reader = new BinaryReader(file);
  const count = reader.i16();
  reader.u8();
  const items: ExtItem[] = [];
  for (let i = 0; i < count; i++) {
    const rawOffset = reader.i32();
    let size = reader.u16();
    const rawWidth = reader.u16();
    const height = reader.u16();

    const width = rawWidth & 0x7fff;
    if (width & 0x4000) size += 1 << 16;
    if (width & 0x2000) size += 2 << 16;
    if (width & 0x1000) size += 4 << 16;
    if (height === 0) size += width << 16;

    const inCommun = rawOffset < 0;
    items.push({
      offset: inCommun ? -rawOffset - 1 : rawOffset + HEADER_SIZE + ITEM_SIZE * count,
      size,
      width: width & 0xfff,
      height,
      packed: (rawWidth & 0x8000) !== 0,
      inCommun,
    });
  }
  return items;
}

/** Extrait (et décompresse) une ressource ; `commun` = contenu de COMMUN.EX<n>. */
export function readExtResource(
  file: Uint8Array,
  item: ExtItem,
  commun?: Uint8Array,
): ExtResource {
  const source = item.inCommun ? commun : file;
  if (!source) throw new Error("Ressource EXT : COMMUN.EX manquant");
  const raw = source.subarray(item.offset, item.offset + item.size);
  return {
    data: item.packed ? unpackBlock(raw) : raw,
    width: item.width,
    height: item.height,
  };
}
