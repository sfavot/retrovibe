/**
 * Données de `BOWLING.DAT` utiles à la logique du Bowling (screens/bowling.md §3) : unités, cibles et objets de l'estimation,
 * rangs. Lecture par `MohawkArchive` + `parseStrl`, sans rien décoder d'autre.
 *
 * Les ressources `UNIT`/`TARG` sont des tableaux de `u32` gros-boutistes, complétés par du bourrage : on prend le nombre
 * d'éléments dans la `STRL` du même id (une unité par chaîne de `STRL 1000+k`, un groupe de colonnes par chaîne de `STRL 1005+k`).
 */
import { MohawkArchive, TAG_STRL } from "../../data/mohawk";
import { parseStrl } from "../../data/strl";
import { STRL_RANKS, STRL_TARGETS_BASE, STRL_UNITS_BASE } from "./tables";

export const TAG_UNIT = "UNIT";
export const TAG_TARG = "TARG";

/** Catégories d'estimation, dans l'ordre des ressources : 0 longueurs, 1 durées, 2 poids. */
export const LENGTH = 0;
export const DURATION = 1;
export const WEIGHT = 2;
export const ESTIMATION_CATEGORIES = 3;

/** Colonnes de `TARG` par objet : longueur (long, tall, wide), durée (secondes, n° de phrase), poids (1 valeur). */
export const TARGET_COLUMNS: readonly number[] = [3, 2, 1];

export interface EstimationCategory {
  /** Noms des unités (`STRL 1000+k`). */
  units: string[];
  /** Taille de chaque unité (`UNIT 1000+k`) : 1/100 de pouce, secondes, 1/1000 d'once. */
  unitSizes: number[];
  /** Noms des objets ou évènements (`STRL 1005+k`). */
  objects: string[];
  /** `TARG 1005+k` à plat : `TARGET_COLUMNS[k]` valeurs par objet. */
  targets: number[];
}

export interface BowlingData {
  categories: EstimationCategory[];
  /** Les 25 rangs (`STRL 5000`), indexés par `grade − 1`. */
  ranks: string[];
}

/** Tableau de `u32` gros-boutistes (`count` éléments). */
export function parseU32Table(bytes: Uint8Array, count: number): number[] {
  if (bytes.length < count * 4) throw new Error(`table u32 : ${bytes.length} octets pour ${count} valeurs`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: count }, (_, i) => view.getUint32(i * 4));
}

export function loadBowlingData(archive: MohawkArchive): BowlingData {
  const categories: EstimationCategory[] = [];
  for (let k = 0; k < ESTIMATION_CATEGORIES; k++) {
    const units = parseStrl(archive.get(TAG_STRL, STRL_UNITS_BASE + k));
    const objects = parseStrl(archive.get(TAG_STRL, STRL_TARGETS_BASE + k));
    const unitSizes = parseU32Table(archive.get(TAG_UNIT, STRL_UNITS_BASE + k), units.length);
    const targets = parseU32Table(archive.get(TAG_TARG, STRL_TARGETS_BASE + k), objects.length * TARGET_COLUMNS[k]!);
    categories.push({ units, unitSizes, objects, targets });
  }
  return { categories, ranks: parseStrl(archive.get(TAG_STRL, STRL_RANKS)) };
}
