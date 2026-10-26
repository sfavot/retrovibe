/**
 * Conteneur commun à `GLOBAL.BD`, `SOUNDS.BD` et aux niveaux `*.SLV` : les ressources sont bout à bout depuis
 * l'offset 0, puis vient un répertoire de `count` entrées de 12 octets (u32 LE) qui finit le fichier :
 *   - `count - 1` entrées (offset, taille, identifiant), dans l'ordre du fichier ;
 *   - une entrée finale (count, valeur inconnue, 0) : on lit `count` dans les 12 derniers octets.
 * Les ressources se suivent sans trou et la dernière s'arrête au début du répertoire.
 */
import { BinaryReader } from "../../../data/reader";

export interface BdEntry {
  id: number;
  offset: number;
  size: number;
}

export interface BdArchive {
  entries: BdEntry[];
  /** Deuxième champ de l'entrée finale, sens inconnu (somme de contrôle ?). */
  footer: number;
  has(id: number): boolean;
  /** Octets de la ressource `id` (vue sur le fichier) ; lève si elle est absente. */
  get(id: number): Uint8Array;
}

const ENTRY_SIZE = 12;

export function parseBd(bytes: Uint8Array, name = "BD"): BdArchive {
  if (bytes.length < ENTRY_SIZE) throw new Error(`${name} : fichier trop court`);
  const tail = new BinaryReader(bytes);
  tail.offset = bytes.length - ENTRY_SIZE;
  const count = tail.u32();
  const footer = tail.u32();
  const directory = bytes.length - ENTRY_SIZE * count;
  if (count < 1 || directory < 0) throw new Error(`${name} : répertoire de ${count} entrées invalide`);

  const r = new BinaryReader(bytes);
  r.offset = directory;
  const entries: BdEntry[] = [];
  const byId = new Map<number, BdEntry>();
  for (let i = 0; i < count - 1; i++) {
    const offset = r.u32();
    const size = r.u32();
    const id = r.u32();
    if (offset + size > directory) throw new Error(`${name} : ressource ${id} hors du fichier`);
    const entry = { id, offset, size };
    entries.push(entry);
    byId.set(id, entry);
  }

  return {
    entries,
    footer,
    has: (id) => byId.has(id),
    get(id) {
      const entry = byId.get(id);
      if (!entry) throw new Error(`${name} : ressource ${id} absente`);
      return bytes.subarray(entry.offset, entry.offset + entry.size);
    },
  };
}
