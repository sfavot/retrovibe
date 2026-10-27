/**
 * Ressources `NODE` et `PATH` : points de passage et chemins des Zoombinis sur un écran (`1168:2a5c` charge les deux avec l'id 1000 ;
 * `1168:2b30` les utilise, `docs/zoombinis/engine.md` §4.1 et §4.2). Présentes dans 9 archives.
 *
 * `NODE` (big-endian) : u16 nombre de points `n`, puis `n` couples u16 `x`, u16 `y` (pixels de l'écran 640 × 480).
 *
 * `PATH` : u16 nombre de chemins `n` (seul mot échangé par le moteur, le reste est lu octet par octet), puis `n` blocs de 24 octets :
 * indices de nœuds (1-based dans `NODE`) terminés par 0, le reste du bloc étant du bourrage à 0.
 */
import { BinaryReader } from "../../../data/reader";

/** Taille d'un chemin dans `PATH`, en octets. */
export const PATH_ENTRY_SIZE = 24;

export interface NodePoint {
  x: number;
  y: number;
}

export function parseNode(bytes: Uint8Array): NodePoint[] {
  if (bytes.length < 2) throw new Error("NODE : ressource trop courte");
  const r = new BinaryReader(bytes);
  const count = r.u16be();
  if (2 + count * 4 > bytes.length) throw new Error("NODE : points tronqués");
  const points: NodePoint[] = [];
  for (let i = 0; i < count; i++) points.push({ x: r.u16be(), y: r.u16be() });
  return points;
}

/** Chemins : chacun est la liste des indices de nœuds (1-based) jusqu'au 0 de fin. Un bloc sans 0 donne ses 24 indices. */
export function parsePath(bytes: Uint8Array): number[][] {
  if (bytes.length < 2) throw new Error("PATH : ressource trop courte");
  const count = (bytes[0]! << 8) | bytes[1]!;
  if (2 + count * PATH_ENTRY_SIZE > bytes.length) throw new Error("PATH : chemins tronqués");
  const paths: number[][] = [];
  for (let i = 0; i < count; i++) {
    const start = 2 + i * PATH_ENTRY_SIZE;
    const block = bytes.subarray(start, start + PATH_ENTRY_SIZE);
    const end = block.indexOf(0);
    paths.push([...(end === -1 ? block : block.subarray(0, end))]);
  }
  return paths;
}
