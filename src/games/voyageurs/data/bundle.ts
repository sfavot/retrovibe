/**
 * Bundles de ressources `PARTxx` (un par chapitre) : répertoire et lecture d'une entrée.
 *
 * Référence : ScummVM engines/cine/part.cpp (`loadPart`, `findFileInBundle`, `readBundleFile`) et unpack.cpp (`CineUnpacker::unpack`)
 * (GPL v3 ou ultérieure). Format : docs/voyageurs/formats.md § 1. En-tête : nombre d'entrées (u16) et taille d'entrée (30), tout en
 * grand-boutiste ; puis par entrée un nom de 14 octets, l'offset, la taille compressée, la taille décompressée et un mot inutilisé.
 *
 * Écarts volontaires : `loadPart` charge aussi le `PARTxx.PAL` voisin (tables CGA/Tandy ignorées, voir palette.ts) : non fait ici ;
 * un bundle tronqué ou une entrée hors du fichier lève `BundleError` au lieu de lire hors du tampon ; la décompression Delphine est celle de
 * src/engine/delphine/unpack.ts (partagée avec Croisière), qui complète par un zéro les flux « un octet trop courts » (63 entrées), comme
 * le tampon alloué par `calloc` de ScummVM. Une entrée dont les deux tailles sont égales est stockée telle quelle (`unpack` : `srcLen == dstLen`).
 * Seul le jeu de fichiers FW est géré (pas de `vol.cnf` ni de partition multi-disques d'Opération Stealth).
 */
import { BinaryReader } from "../../../data/reader";
import { DelphineUnpackError, delphineUnpack } from "../../../engine/delphine/unpack";

const ENTRY_NAME_LENGTH = 14;
/** `loadPart` lit toujours 30 octets par entrée, quelle que soit la « taille d'entrée » de l'en-tête. */
const ENTRY_SIZE = 30;

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

export interface BundleEntry {
  /** Nom du fichier tel que stocké (ex. `L201.ANI`), sans les octets nuls de remplissage. */
  readonly name: string;
  readonly offset: number;
  readonly packedSize: number;
  readonly unpackedSize: number;
}

export class Bundle {
  readonly entries: readonly BundleEntry[];
  /** Nom en minuscules -> index de la première entrée de ce nom (comme la recherche linéaire de `findFileInBundle`). */
  private readonly byName = new Map<string, number>();

  constructor(private readonly data: Uint8Array) {
    if (data.length < 4) throw new BundleError("bundle trop court");
    const reader = new BinaryReader(data);
    const count = reader.u16be();
    reader.u16be(); // taille d'entrée annoncée : ignorée par ScummVM
    if (4 + count * ENTRY_SIZE > data.length) throw new BundleError(`répertoire de ${count} entrées hors du fichier`);
    const entries: BundleEntry[] = [];
    for (let i = 0; i < count; i++) {
      const raw = reader.bytesView(ENTRY_NAME_LENGTH);
      const end = raw.indexOf(0);
      const name = String.fromCharCode(...(end === -1 ? raw : raw.subarray(0, end)));
      const offset = reader.u32be();
      const packedSize = reader.u32be();
      const unpackedSize = reader.u32be();
      reader.u32be(); // inutilisé
      entries.push({ name, offset, packedSize, unpackedSize });
      const key = name.toLowerCase();
      if (!this.byName.has(key)) this.byName.set(key, i);
    }
    this.entries = entries;
  }

  /** Index de l'entrée `name` (casse indifférente, première occurrence), ou -1 (`findFileInBundle`). */
  indexOf(name: string): number {
    return this.byName.get(name.toLowerCase()) ?? -1;
  }

  has(name: string): boolean {
    return this.indexOf(name) >= 0;
  }

  find(name: string): BundleEntry | undefined {
    return this.entries[this.indexOf(name)];
  }

  /** `readBundleFile` : contenu décompressé d'une entrée (nom ou index), copie neuve de `unpackedSize` octets. */
  read(target: string | number): Uint8Array {
    const index = typeof target === "number" ? target : this.indexOf(target);
    const entry = this.entries[index];
    if (!entry) throw new BundleError(`fichier absent du bundle : ${String(target)}`);
    if (entry.offset + entry.packedSize > this.data.length) throw new BundleError(`${entry.name} : données hors du fichier`);
    const packed = this.data.subarray(entry.offset, entry.offset + entry.packedSize);
    if (entry.packedSize === entry.unpackedSize) return packed.slice();
    try {
      return delphineUnpack(packed, entry.unpackedSize);
    } catch (error) {
      if (error instanceof DelphineUnpackError) throw new BundleError(`${entry.name} : ${error.message}`);
      throw error;
    }
  }
}
