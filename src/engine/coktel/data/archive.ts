import { BinaryReader } from "../../../data/reader";
import { unpackBlock } from "./lzss";

export interface ArchiveEntry {
  name: string;
  /** Taille stockée (compressée si `packed`). */
  size: number;
  offset: number;
  packed: boolean;
}

/** Archive STK / ITK : table de 22 octets par fichier, extraction à la demande. */
export class Archive {
  readonly entries: ArchiveEntry[];
  private readonly byName = new Map<string, ArchiveEntry>();

  constructor(private readonly data: Uint8Array) {
    const reader = new BinaryReader(data);
    const count = reader.u16();
    this.entries = [];
    for (let i = 0; i < count; i++) {
      const name = reader.fixedString(13);
      const size = reader.u32();
      const offset = reader.u32();
      const packed = reader.u8();
      if (packed > 1) throw new Error(`Archive : compression ${packed} non gérée (${name})`);
      const entry = { name, size, offset, packed: packed === 1 };
      this.entries.push(entry);
      const key = name.toUpperCase();
      if (!this.byName.has(key)) this.byName.set(key, entry);
    }
  }

  has(name: string): boolean {
    return this.byName.has(name.toUpperCase());
  }

  /** Contenu décompressé, ou `undefined` si le fichier n'existe pas (nom insensible à la casse). */
  get(name: string): Uint8Array | undefined {
    const entry = this.byName.get(name.toUpperCase());
    return entry && this.extract(entry);
  }

  extract(entry: ArchiveEntry): Uint8Array {
    if (entry.offset + entry.size > this.data.length) {
      throw new Error(`Archive : ${entry.name} dépasse la fin du fichier`);
    }
    const raw = this.data.subarray(entry.offset, entry.offset + entry.size);
    return entry.packed ? unpackBlock(raw) : raw;
  }
}
