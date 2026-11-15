/**
 * Volumes de Croisière pour un cadavre : `VOL.CNF` et les cinq « disquettes » `D1`..`D5` (docs/croisiere/formats.md § 1).
 *
 * Référence : `engines/cruise/volume.cpp` (`readVolCnf`, `getVolumeDataEntry`, `findFileInDisks`) et, pour le dépaquetage,
 * `cruise_main.cpp::loadFileSub1` de ScummVM (GPL v3+). Chaque `Dn` commence par son répertoire (nb d'entrées i16, taille
 * d'entrée i16 = 30, puis des entrées `nom[14] offset size extSize inutilisé`, tout en grand-boutiste).
 *
 * Écarts volontaires : le catalogue `VOL.CNF` ne sert qu'à contrôler les répertoires ; la recherche fusionne les cinq
 * répertoires dans l'ordre D1..D5 (premier trouvé, nom insensible à la casse), au lieu de chercher d'abord dans le volume
 * ouvert : les 115 noms présents sur plusieurs disques ont le même contenu à un octet de padding près (14 variantes
 * `.H32`/`.SPL`/`.FR` sans effet visible).
 */
import { delphineUnpack } from "../../../engine/delphine/unpack";

export const VOLUME_COUNT = 5;
const ENTRY_SIZE = 30;
const NAME_SIZE = 14;
const CNF_NAME_SIZE = 13;

export interface VolumeEntry {
  /** Nom tel que dans le répertoire (majuscules, sans octets parasites). */
  readonly name: string;
  /** Numéro du disque, de 1 à 5. */
  readonly disk: number;
  /** Position absolue des octets stockés dans `Dn`. */
  readonly offset: number;
  /** Octets stockés. */
  readonly size: number;
  /** Taille dépackée annoncée. */
  readonly extSize: number;
  /** Packé Delphine : `size != extSize` (seul indicateur du jeu). */
  readonly packed: boolean;
}

/** Nom jusqu'au premier NUL (des octets parasites suivent), en Latin-1. */
function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return String.fromCharCode(...bytes.subarray(0, end < 0 ? bytes.length : end));
}

/** Noms de fichiers de chaque disque d'après `VOL.CNF`. */
export function parseVolCnf(cnf: Uint8Array): string[][] {
  const view = new DataView(cnf.buffer, cnf.byteOffset, cnf.byteLength);
  if (cnf.length < 4) throw new Error("VOL.CNF trop court");
  const disks = view.getInt16(0);
  if (disks !== VOLUME_COUNT) throw new Error(`VOL.CNF : ${VOLUME_COUNT} disques attendus, ${disks} trouvés`);
  let pos = 4 + 20 * disks; // en-têtes de disque (ident, résidu de pointeur, numéro, taille provisoire) : ignorés
  const result: string[][] = [];
  for (let i = 0; i < disks; i++) {
    if (pos + 4 > cnf.length) throw new Error("VOL.CNF tronqué");
    const size = view.getInt32(pos);
    pos += 4;
    if (size < 0 || size % CNF_NAME_SIZE !== 0 || pos + size > cnf.length) throw new Error("VOL.CNF : liste de noms invalide");
    const names: string[] = [];
    for (let at = pos; at < pos + size; at += CNF_NAME_SIZE) names.push(cString(cnf.subarray(at, at + CNF_NAME_SIZE)));
    result.push(names);
    pos += size;
  }
  return result;
}

/** Répertoire d'un volume `Dn` (`disk` de 1 à 5). */
export function parseDirectory(data: Uint8Array, disk: number): VolumeEntry[] {
  if (data.length < 4) throw new Error(`D${disk} trop court`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getInt16(0);
  if (view.getInt16(2) !== ENTRY_SIZE || count < 0 || 4 + count * ENTRY_SIZE > data.length) throw new Error(`D${disk} : répertoire invalide`);
  const entries: VolumeEntry[] = [];
  for (let i = 0; i < count; i++) {
    const base = 4 + i * ENTRY_SIZE;
    const name = cString(data.subarray(base, base + NAME_SIZE)).toUpperCase();
    const offset = view.getUint32(base + 14);
    const size = view.getUint32(base + 18);
    const extSize = view.getUint32(base + 22);
    if (offset + size > data.length) throw new Error(`D${disk} : ${name} dépasse du volume`);
    entries.push({ name, disk, offset, size, extSize, packed: size !== extSize });
  }
  return entries;
}

export class CruiseVolumes {
  private readonly disks: Uint8Array[];
  private readonly byName = new Map<string, VolumeEntry>();
  /** Toutes les entrées, dans l'ordre de D1 à D5 (doublons inclus). */
  readonly entries: VolumeEntry[] = [];

  /** `cnf` : contenu de `VOL.CNF` ; `disks` : contenu de `D1`..`D5`. Contrôle que les répertoires concordent avec le catalogue. */
  constructor(cnf: Uint8Array, disks: Uint8Array[]) {
    if (disks.length !== VOLUME_COUNT) throw new Error(`${VOLUME_COUNT} volumes attendus`);
    this.disks = disks;
    const catalog = parseVolCnf(cnf);
    disks.forEach((data, i) => {
      const entries = parseDirectory(data, i + 1);
      const names = entries.map((e) => e.name);
      if (names.length !== catalog[i]!.length || names.some((n, k) => n !== catalog[i]![k]!.toUpperCase())) {
        throw new Error(`D${i + 1} : le répertoire ne correspond pas à VOL.CNF`);
      }
      for (const entry of entries) {
        this.entries.push(entry);
        if (!this.byName.has(entry.name)) this.byName.set(entry.name, entry); // premier trouvé
      }
    });
  }

  /** Ouvre les volumes via `read("D1")`, `read("VOL.CNF")`... (noms relatifs à `original/croisiere/`). */
  static open(read: (name: string) => Uint8Array): CruiseVolumes {
    return new CruiseVolumes(read("VOL.CNF"), [1, 2, 3, 4, 5].map((n) => read(`D${n}`)));
  }

  /** Entrée du nom donné (insensible à la casse), première trouvée de D1 à D5. */
  find(name: string): VolumeEntry | undefined {
    return this.byName.get(name.toUpperCase());
  }

  has(name: string): boolean {
    return this.byName.has(name.toUpperCase());
  }

  /** Octets stockés d'une entrée, tels quels (packés ou non). */
  readRaw(entry: VolumeEntry): Uint8Array {
    return this.disks[entry.disk - 1]!.subarray(entry.offset, entry.offset + entry.size);
  }

  /** Contenu dépacké d'une entrée : exactement `extSize` octets (complétés par un zéro si le dépaqueteur en rend un de moins). */
  readEntry(entry: VolumeEntry): Uint8Array {
    const raw = this.readRaw(entry);
    return entry.packed ? delphineUnpack(raw, entry.extSize) : raw.slice();
  }

  /** Contenu dépacké du fichier `name` ; lève une erreur s'il est absent. */
  readFile(name: string): Uint8Array {
    const entry = this.find(name);
    if (!entry) throw new Error(`Fichier absent des volumes : ${name}`);
    return this.readEntry(entry);
  }
}
