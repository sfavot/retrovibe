/**
 * Archive Mohawk (Broderbund, big-endian) : `*.DAT` et `MPC/PVG.MHK`.
 *
 * Entête : `MHWK`, taille u32, `RSRC`, version u16 (0x100), compaction u16, taille du fichier u32,
 * décalage absolu u32 (octet 20), puis table des fichiers (offset u16 + taille u16, relatifs au décalage absolu).
 * Au décalage absolu : offset de la liste de noms u16, nombre de types u16, puis par type `tag[4]`,
 * offset de la table de ressources u16, offset de la table de noms u16 (relatifs au décalage absolu).
 * Table de ressources : nombre u16, puis (id u16, index de fichier u16, 1-based).
 * Table de fichiers : nombre u32, puis entrées de 10 octets (offset u32, taille basse u16, taille haute u8, flags u8, u16).
 *
 * Aucune des archives du jeu ne porte de noms de ressources (toutes les tables de noms sont vides) : ils ne sont pas lus.
 * Les ressources sont souvent complétées jusqu'à un multiple de 2048 octets : la taille déclarée peut dépasser la taille utile.
 */
import { BinaryReader } from "../../../data/reader";

/** Tags de ressources vus dans le jeu (le NUL initial de `\0SND` / `\0SCR` fait partie du tag). */
export const TAG_SND = "\0SND";
export const TAG_SCR = "\0SCR";
export const TAG_SHAP = "SHAP";
export const TAG_SHPL = "SHPL";
export const TAG_SNDL = "SNDL";
export const TAG_STRL = "STRL";

interface FileSlot {
  offset: number;
  size: number;
}

export class MohawkArchive {
  /** tag -> (id de ressource -> emplacement). */
  private readonly resources = new Map<string, Map<number, FileSlot>>();

  private constructor(private readonly data: Uint8Array) {}

  static parse(data: Uint8Array): MohawkArchive {
    const archive = new MohawkArchive(data);
    const r = new BinaryReader(data);
    if (r.tag() !== "MHWK") throw new Error("Mohawk : signature MHWK absente");
    r.u32be();
    if (r.tag() !== "RSRC") throw new Error("Mohawk : signature RSRC absente");
    r.offset = 20;
    const abs = r.u32be();
    const fileTableOffset = r.u16be();

    r.offset = abs + fileTableOffset;
    const fileCount = r.u32be();
    const files: FileSlot[] = [];
    for (let i = 0; i < fileCount; i++) {
      const offset = r.u32be();
      const sizeLow = r.u16be();
      const sizeHigh = r.u8();
      r.u8(); // flags
      r.u16be();
      files.push({ offset, size: sizeLow | (sizeHigh << 16) });
    }

    r.offset = abs + 2;
    const typeCount = r.u16be();
    const types: { tag: string; resourceTable: number }[] = [];
    for (let i = 0; i < typeCount; i++) {
      const tag = r.tag();
      const resourceTable = r.u16be();
      r.u16be(); // table de noms (vide dans ce jeu)
      types.push({ tag, resourceTable });
    }

    for (const { tag, resourceTable } of types) {
      r.offset = abs + resourceTable;
      const count = r.u16be();
      const byId = archive.resources.get(tag) ?? new Map<number, FileSlot>();
      for (let i = 0; i < count; i++) {
        const id = r.u16be();
        const fileIndex = r.u16be();
        const slot = files[fileIndex - 1];
        if (!slot) throw new Error(`Mohawk : ressource ${tag} ${id} : fichier ${fileIndex} hors table`);
        if (slot.offset + slot.size > data.length) throw new Error(`Mohawk : ressource ${tag} ${id} hors du fichier`);
        byId.set(id, slot);
      }
      archive.resources.set(tag, byId);
    }
    return archive;
  }

  /** Tags présents, dans l'ordre de l'archive. */
  types(): string[] {
    return [...this.resources.keys()];
  }

  /** Nombre de ressources d'un tag (0 si absent). */
  count(tag: string): number {
    return this.resources.get(tag)?.size ?? 0;
  }

  /** Identifiants d'un tag, triés. */
  ids(tag: string): number[] {
    return [...(this.resources.get(tag)?.keys() ?? [])].sort((a, b) => a - b);
  }

  has(tag: string, id: number): boolean {
    return this.resources.get(tag)?.has(id) ?? false;
  }

  /** Octets bruts de la ressource (vue sur le tampon de l'archive, sans copie) ; `undefined` si absente. */
  find(tag: string, id: number): Uint8Array | undefined {
    const slot = this.resources.get(tag)?.get(id);
    return slot && this.data.subarray(slot.offset, slot.offset + slot.size);
  }

  get(tag: string, id: number): Uint8Array {
    const bytes = this.find(tag, id);
    if (!bytes) throw new Error(`Mohawk : ressource ${JSON.stringify(tag)} ${id} introuvable`);
    return bytes;
  }
}
