/**
 * Carte de hauteur 512×512 torique (bloc SLV 100). Un octet = 4 unités de monde ; `gm_terrain_height` (`004256c0`) renvoie du
 * Q8 en interpolant bilinéairement les 4 cellules voisines (`octet · 0x400` aux coins, fractions sur 8 bits). Voir
 * `docs/swiv3d/player.md` §2.
 */
import { MAP_SIZE, type Level } from "../data/level";

const MASK = MAP_SIZE - 1;

export class Terrain {
  constructor(readonly heightmap: Uint8Array) {
    if (heightmap.length !== MAP_SIZE * MAP_SIZE)
      throw new Error("carte de hauteur : 512×512 octets attendus");
  }

  static fromLevel(level: Pick<Level, "heightmap">): Terrain {
    return new Terrain(level.heightmap);
  }

  /** Octet de la carte à la cellule (cx, cz), repli torique. */
  cell(cx: number, cz: number): number {
    return this.heightmap[(cz & MASK) * MAP_SIZE + (cx & MASK)]!;
  }

  /** `gm_terrain_height` : hauteur Q8 en (x, z) Q8. Cellule `(x >> 14) & 0x1ff`, fraction `(x >> 6) & 0xff`. */
  height(x: number, z: number): number {
    const cx = x >> 14;
    const cz = z >> 14;
    const fx = (x >> 6) & 0xff;
    const fz = (z >> 6) & 0xff;
    const a = this.cell(cx, cz) * 0x400;
    const b = this.cell(cx + 1, cz) * 0x400;
    const c = this.cell(cx, cz + 1) * 0x400;
    const d = this.cell(cx + 1, cz + 1) * 0x400;
    const top = a + (((b - a) * fx) >> 8);
    const bot = c + (((d - c) * fx) >> 8);
    return top + (((bot - top) * fz) >> 8);
  }

  /** Hauteur en unités de monde (`>> 8`), position en unités de monde. Commodité pour la caméra. */
  heightUnits(xUnits: number, zUnits: number): number {
    return this.height(Math.round(xUnits * 256), Math.round(zUnits * 256)) >> 8;
  }
}

/** Plafond de la carte 102 après ajout de suie (`gm_terrain_explosion_crater`). */
const GROUND_MAX = 240;

/**
 * `gm_terrain_explosion_crater` (`00424f44`, `objects.md` §10.4) : si aucune des 36 cellules (6 × 6) de la carte 102 autour du point ne
 * vaut 0 (eau : `gm_crater_site_ok`), soustrait le profil 4 × 4 du bloc 700 (taille, sous-position `(z >> 12 & 3) * 4 + (x >> 12 & 3)`)
 * à la carte de hauteur (plancher 0) et ajoute `2 × profondeur` (plafond 240) à la carte 102 là où elle n'est pas nulle (le sol brunit).
 * `x`, `z` : Q8. Le profil est posé sur les cellules `cx - 1 .. cx + 2` (le centre des profils est en ligne 1, colonne 1 : hypothèse,
 * cohérente avec la symétrie des profils), le test d'emplacement sur `cx - 2 .. cx + 3` (hypothèse). La dernière passe de l'exe (8 voisins)
 * n'est pas décodée : non portée. Retourne `false` si le site est refusé.
 */
export function applyCrater(
  heightmap: Uint8Array,
  groundMap: Uint8Array,
  profiles: readonly (readonly Int32Array[])[],
  x: number,
  z: number,
  size: 0 | 1 | 2,
): boolean {
  const cx = (x >> 14) & MASK;
  const cz = (z >> 14) & MASK;
  const at = (ax: number, az: number): number => (az & MASK) * MAP_SIZE + (ax & MASK);
  for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++) if (groundMap[at(cx + dx, cz + dz)] === 0) return false;
  const profile = profiles[size]?.[(((z >> 12) & 3) << 2) | ((x >> 12) & 3)];
  if (!profile) return false;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const depth = profile[r * 4 + c]!;
      if (depth <= 0) continue;
      const i = at(cx - 1 + c, cz - 1 + r);
      heightmap[i] = Math.max(0, heightmap[i]! - depth);
      if (groundMap[i] !== 0) groundMap[i] = Math.min(GROUND_MAX, groundMap[i]! + 2 * depth);
    }
  }
  return true;
}
