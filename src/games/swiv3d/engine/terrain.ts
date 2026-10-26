/**
 * Carte de hauteur 512×512 torique (bloc SLV 100). Un octet = 4 unités de monde ; `gm_terrain_height` (`004256c0`) renvoie du
 * Q8 en interpolant bilinéairement les 4 cellules voisines (`octet · 0x400` aux coins, fractions sur 8 bits). Voir
 * `docs/swiv3d/player.md` §2.
 */
import { MAP_SIZE, type Level } from "../data/level";
import type { GameObject } from "./objects";
import type { World } from "./world";

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
/** Écart de hauteur entre une cellule et l'un de ses 8 voisins au-delà duquel la cellule est lissée (`0x13` = 19). */
const SMOOTH_STEP = 19;

/**
 * `gm_crater_site_ok` (`00424db4`) : le site est refusé si un objet « décor » (ni solide `0x02` ni en vol `0x10`), autre que `self`,
 * se trouve à moins de `sqrt(10 000 / 20 000 / 30 000)` unités (taille 0 / 1 / 2, distance² + 1 < limite). Le test parcourt les cases
 * de la grille d'objets (512 unités) de la cellule de carte `(cx, cz)` puis de `(cx + 4, cz)`, `(cx, cz + 4)`, `(cx + 4, cz + 4)` :
 * la seconde case de chaque ligne n'est lue que si elle change de case de grille. **Défaut fidèle** : l'abscisse n'est pas
 * remise à `cx` pour la seconde ligne (le compteur de l'exe, `00587d94`, garde sa valeur avancée), donc la seconde ligne est lue à
 * partir de `cx + 4` ou `cx + 8`. Ne regarde que les cases de la grille, pas la distance au-delà de leur contenu.
 */
export function craterSiteClear(world: World, self: GameObject, size: 0 | 1 | 2): boolean {
  const limit = size === 0 ? 10000 : size === 1 ? 20000 : 30000;
  let cx = self.x >> 14;
  let cz = self.z >> 14;
  let rows = 0;
  let bz = 0;
  do {
    bz = cz >> 3;
    let cols = 0;
    let bx = 0;
    do {
      bx = cx >> 3;
      const list = world.grid.cells[(bz & 63) * 64 + (bx & 63)]!;
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i]!;
        if ((o.classe & 0x12) !== 0 || o === self) continue;
        const dx = (self.x >> 8) - (o.x >> 8);
        const dz = (self.z >> 8) - (o.z >> 8);
        if (dx * dx + dz * dz + 1 < limit) return false;
      }
      cx += 4;
      cols++;
    } while (cols === 1 && cx >> 3 !== bx);
    cz += 4;
    rows++;
  } while (rows === 1 && cz >> 3 !== bz);
  return true;
}

/**
 * Cratère d'explosion d'un objet mourant (`00443ac0` → `00424f44`) : site libre de décor (`craterSiteClear`), puis `World.crater`
 * (eau, profils, lissage). `true` si le sol a été creusé.
 */
export function digCrater(world: World, o: GameObject, size: 0 | 1 | 2): boolean {
  if (!craterSiteClear(world, o, size)) return false;
  return world.crater(o.x, o.z, size);
}

/**
 * `gm_terrain_explosion_crater` (`00424f44`, `objects.md` §10.4), sans le test de décor (`craterSiteClear`) : `x`, `z` Q8.
 *  1. refus si l'une des 36 cellules `cx - 2 .. cx + 3` de la carte 102 (`groundMap`) vaut 0 (eau ou bord de mer) ;
 *  2. sur les 4 × 4 cellules `cx - 1 .. cx + 2`, `profondeur = profil[ligne · 4 + colonne]` (bloc 700, taille, sous-position
 *     `(z >> 12 & 3) · 4 + (x >> 12 & 3)`) : la carte 102 prend `min(240, valeur + 2 · profondeur)` là où elle n'est pas nulle (même
 *     quand la profondeur est nulle : une valeur > 240 est ramenée à 240), la hauteur perd `profondeur` (plancher 0) ;
 *  3. dernière passe sur les mêmes 16 cellules, dans l'ordre ligne par ligne, **en place** : si l'un des 8 voisins diffère de plus de 19
 *     de la cellule (valeurs déjà lissées pour les cellules précédentes), la cellule devient la moyenne entière des 9 cellules.
 * Retourne `false` si le site est refusé.
 */
export function applyCrater(
  heightmap: Uint8Array,
  groundMap: Uint8Array,
  profiles: readonly (readonly Int32Array[])[],
  x: number,
  z: number,
  size: 0 | 1 | 2,
): boolean {
  const cx = (x >> 14) - 1;
  const cz = (z >> 14) - 1;
  const at = (ax: number, az: number): number => (az & MASK) * MAP_SIZE + (ax & MASK);
  for (let dz = -1; dz < 5; dz++)
    for (let dx = -1; dx < 5; dx++) if (groundMap[at(cx + dx, cz + dz)] === 0) return false;
  const profile = profiles[size]?.[(((z >> 12) & 3) << 2) | ((x >> 12) & 3)];
  if (!profile) return false;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const i = at(cx + c, cz + r);
      const depth = profile[r * 4 + c]!;
      if (groundMap[i] !== 0) groundMap[i] = Math.min(GROUND_MAX, groundMap[i]! + 2 * depth);
      heightmap[i] = Math.max(0, heightmap[i]! - depth);
    }
  }
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const ax = cx + c;
      const az = cz + r;
      const center = heightmap[at(ax, az)]!;
      let rough = false;
      let sum = center;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const h = heightmap[at(ax + dx, az + dz)]!;
          sum += h;
          if (Math.abs(h - center) > SMOOTH_STEP) rough = true;
        }
      }
      if (rough) heightmap[at(ax, az)] = Math.trunc(sum / 9);
    }
  }
  return true;
}

/**
 * `gm_terrain_crater` (`00424a24`, mode de création 3) : creuse de `depth` (plancher 0) les 4 cellules `(cx, cz)`, `(cx + 1, cz)`,
 * `(cx, cz + 1)`, `(cx + 1, cz + 1)` de la carte de hauteur sous le point `(x, z)` Q8 ; ni test de site ni lissage.
 */
export function applyPointCrater(heightmap: Uint8Array, x: number, z: number, depth: number): void {
  const cx = x >> 14;
  const cz = z >> 14;
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const i = ((cz + dz) & MASK) * MAP_SIZE + ((cx + dx) & MASK);
    heightmap[i] = heightmap[i]! < depth ? 0 : heightmap[i]! - depth;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Éclairs au sol (`005624c8`)
// ---------------------------------------------------------------------------------------------------------------------

/** Côté de la carte d'éclairs au sol `005624c8` : 64×64 entiers, repliée sur la carte de terrain (cellule `& 63`). */
export const GROUND_FLASH_SIZE = 64;
const FLASH_MASK = GROUND_FLASH_SIZE - 1;
/** Baisse d'une case par tick (`gm_ground_flash_fade`). */
const FLASH_FADE = 0x1e;
/** Motif de `gm_ground_flash_add`, dans l'ordre de l'exe : `[dx, dz, poids]`, poids 0 = centre, 1 = bord, 2 = coin ou distance 2. */
const FLASH_PATTERN = [
  [-1, -1, 2], [0, -1, 1], [1, -1, 2],
  [-1, 0, 1], [0, 0, 0], [1, 0, 1],
  [-1, 1, 2], [0, 1, 1], [1, 1, 2],
  [0, -2, 2], [0, 2, 2], [-2, 0, 2], [2, 0, 2],
] as const;

/** Nouvelle carte d'éclairs, à zéro comme après `gm_slv_load` (`004545a8` efface les 4 096 cases au chargement du niveau). */
export const newGroundFlash = (): Int32Array => new Int32Array(GROUND_FLASH_SIZE * GROUND_FLASH_SIZE);

/**
 * `gm_ground_flash_add` (`004259b4`) : éclair d'explosion autour de la cellule de `(x, z)` Q8 (`x >> 14`, `& 63`). Intensité
 * `level` 0..3 : centre `0x100 · (level + 1)`, 4 bords la moitié, 4 coins et 4 cases à distance 2 le quart (carré 3×3 plus une
 * croix de rayon 2). Les cases s'ajoutent sans plafond. `gm_object_explode` passe `level` = taille d'explosion + 1 (1..3).
 */
export function addGroundFlash(map: Int32Array, x: number, z: number, level: 0 | 1 | 2 | 3): void {
  const cx = x >> 14;
  const cz = z >> 14;
  const centre = 0x100 * (level + 1);
  for (const [dx, dz, weight] of FLASH_PATTERN) {
    const i = ((cz + dz) & FLASH_MASK) * GROUND_FLASH_SIZE + ((cx + dx) & FLASH_MASK);
    map[i] = map[i]! + (centre >> weight);
  }
}

/** `gm_ground_flash_fade` (`0042fc70`, chaque tick de jeu) : chaque case non nulle perd `0x1e`, plancher 0. */
export function fadeGroundFlash(map: Int32Array): void {
  for (let i = 0; i < map.length; i++) {
    const v = map[i]!;
    if (v !== 0) map[i] = v - FLASH_FADE < 1 ? 0 : v - FLASH_FADE;
  }
}
