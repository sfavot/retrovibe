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
