import { BinaryReader } from "../../../data/reader";

/** Entrée de la table d'index d'un `.VGA` : `{u16 id, u32 offset, u32 taille}`, offset absolu dans le fichier. */
export interface VgaEntry {
  id: number;
  offset: number;
  size: number;
}

export interface VgaArchive {
  /** Ressources non vides, dans l'ordre du fichier. */
  entries: VgaEntry[];
  /** Octets de la ressource d'identifiant `id` (vue sur le fichier, sans copie). Lance si l'id est absent. */
  bytes(id: number): Uint8Array;
}

/** Taille d'une entrée d'index (les deux variantes). */
const ENTRY_BYTES = 10;

/** Emplacements de la table fixe d'un fichier de scènes (`gm_load_scene`, `1cc3:000e` : `lib_fread(buf, 10, 5)`). */
export const SCENE_SLOTS = 5;

function fail(message: string): never {
  throw new Error(`Archive VGA invalide : ${message}`);
}

function build(data: Uint8Array, entries: VgaEntry[]): VgaArchive {
  for (const entry of entries) {
    if (entry.offset + entry.size > data.length)
      fail(`ressource ${entry.id} hors du fichier`);
  }
  return {
    entries,
    bytes(id) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) throw new Error(`Archive VGA : ressource ${id} absente`);
      return data.subarray(entry.offset, entry.offset + entry.size);
    },
  };
}

/**
 * Variante A (`A1FOBJ`, `A1FANM`, `A1FDEC`, `A1FINT`) : `u16 nombre`, puis `nombre` entrées. Lue par
 * `gm_load_sprite_resource` (`1735:000e`).
 */
export function readCountedArchive(data: Uint8Array): VgaArchive {
  if (data.length < 2) fail("fichier trop court");
  const reader = new BinaryReader(data);
  const count = reader.u16();
  if (2 + count * ENTRY_BYTES > data.length)
    fail("table d'index hors du fichier");
  const entries: VgaEntry[] = [];
  for (let i = 0; i < count; i++)
    entries.push({
      id: reader.u16(),
      offset: reader.u32(),
      size: reader.u32(),
    });
  return build(data, entries);
}

/**
 * Variante B (`A1F00A`..`A1F03D`) : table fixe de 5 emplacements, sans compteur ; un emplacement vide est nul (taille 0).
 * Le moteur cherche l'id dans les 5 emplacements et exige un offset ou une taille non nuls (`gm_load_scene`).
 * Un id 0 est donc valide (`A1F00A` id 0) : seuls les emplacements de taille 0 sont ignorés.
 */
export function readSceneArchive(data: Uint8Array): VgaArchive {
  if (data.length < SCENE_SLOTS * ENTRY_BYTES) fail("fichier trop court");
  const reader = new BinaryReader(data);
  const entries: VgaEntry[] = [];
  for (let i = 0; i < SCENE_SLOTS; i++) {
    const entry = {
      id: reader.u16(),
      offset: reader.u32(),
      size: reader.u32(),
    };
    if (entry.offset !== 0 || entry.size !== 0) entries.push(entry);
  }
  return build(data, entries);
}
