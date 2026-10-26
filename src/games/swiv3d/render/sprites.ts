/**
 * Sprites d'explosion (`render.md` §9) : `GLOBAL 505` en 21×35 non mis à l'échelle (`gm_sprite_505`, `004353f4`) et `GLOBAL 504`
 * en 64×64 mis à l'échelle au plus proche (`gm_sprite_504`, `00435688`). Les texels sont des numéros de ligne de la table 109
 * (`pixel' = t109[texel << 8 | pixel]`, 0 = identité donc transparent) ; clé de tri et découpe d'horizon = profondeur.
 */
import type { RenderAssets } from "./assets";
import type { Projection } from "./camera";
import type { Columns } from "./columns";
import { applyDeformers, type DeformedVertex } from "./deformers";
import { KIND_SPRITE_504, KIND_SPRITE_505, type RenderQueue } from "./queue";
import { idiv } from "./tables";
import { SCREEN_HEIGHT, SCREEN_WIDTH, VIEWPORT, wrapDelta, type RenderDeformer, type RenderSprite } from "./view";

export const SPRITE_505_WIDTH = 21;
export const SPRITE_505_HEIGHT = 35;
const DEFAULT_SIZE_504 = 23;
/** Garde-fou : un sprite 504 très proche couvre l'écran, inutile d'aller au-delà. */
const MAX_HALF_EXTENT = 4000;

const dv: DeformedVertex = { x: 0, y: 0, z: 0, light: 0, colour: 0 };

/**
 * Met un sprite en file (profondeur `D` avec recul de 0x19) ; ignoré s'il est derrière la caméra ou hors de l'écran. Sa position
 * passe d'abord par les déformations du terrain (`gm_render_objects`, `render.md` §10).
 */
export function addSprite(queue: RenderQueue, pr: Projection, sprite: RenderSprite, deformers: readonly RenderDeformer[] = []): void {
  const dx = wrapDelta(Math.trunc(sprite.x) - pr.camX);
  let dy = Math.trunc(sprite.y) - pr.camY;
  const dz = wrapDelta(Math.trunc(sprite.z) - pr.camZ);
  if (deformers.length > 0) {
    dv.x = Math.trunc(sprite.x);
    dv.y = Math.trunc(sprite.y);
    dv.z = Math.trunc(sprite.z);
    applyDeformers(deformers, dv);
    dy = dv.y - pr.camY;
  }
  const depth = ((dx * pr.fx + dy * pr.fy + dz * pr.fz) >> 8) + 0x19;
  if (depth <= 0 || depth >= 2000) return;
  const sx = idiv(dx * pr.rx + dy * pr.ry + dz * pr.rz, depth) + pr.cx;
  const sy = pr.cy - idiv(dx * pr.ux + dy * pr.uy + dz * pr.uz, depth);

  let halfW: number;
  let halfH: number;
  if (sprite.setId === 505) {
    halfW = 10;
    halfH = 17;
  } else {
    const size = sprite.size ?? DEFAULT_SIZE_504;
    halfW = Math.min(MAX_HALF_EXTENT, idiv(pr.scaleX * size, depth));
    halfH = Math.min(MAX_HALF_EXTENT, idiv(pr.scaleY * size, depth));
  }
  if (sx + halfW < VIEWPORT.left || sx - halfW > VIEWPORT.right || sy + halfH < 0 || sy - halfH > VIEWPORT.bottom) return;

  const qi = queue.claim(sprite.setId === 505 ? KIND_SPRITE_505 : KIND_SPRITE_504, depth);
  if (qi < 0) return;
  queue.x[qi * 3] = sx;
  queue.y[qi * 3] = sy;
  queue.aux[qi] = sprite.frame;
  queue.aux2[qi] = sprite.size ?? DEFAULT_SIZE_504;
}

/**
 * Sprite 21×35 : image choisie par la distance, `taille = clamp(Sx * 21 / D - 5, 0, 15)`, `image = (15 - taille) + série * 16`,
 * centré en `(sx, sy)` (colonnes `sx - 10 .. sx + 10`, lignes `sy - 17 .. sy + 17`).
 */
export function drawSprite505(fb: Uint8Array, cols: Columns, assets: RenderAssets, pr: Projection, queue: RenderQueue, qi: number): void {
  const sx = queue.x[qi * 3]!;
  const sy = queue.y[qi * 3]!;
  const depth = queue.key[qi]!;
  const size = Math.min(15, Math.max(0, idiv(pr.scaleX * 0x15, depth) - 5));
  const image = assets.images505[15 - size + queue.aux[qi]! * 16];
  if (!image) return;
  const top = sy - 17;
  for (let c = 0; c < SPRITE_505_WIDTH; c++) {
    const x = sx - 10 + c;
    if (x < VIEWPORT.left || x > VIEWPORT.right) continue;
    let first = 0; // première ligne de l'image tracée
    let last = SPRITE_505_HEIGHT - 1;
    if (top < 0) first = -top;
    if (top + last > SCREEN_HEIGHT - 1) last = SCREEN_HEIGHT - 1 - top;
    if (first > last) continue;
    const count = cols.clipByHorizon(x, depth, top + first, top + last - 1, last - first + 1);
    let p = (top + first) * SCREEN_WIDTH + x;
    for (let i = 0; i < count; i++, p += SCREEN_WIDTH) {
      const texel = image[(first + i) * SPRITE_505_WIDTH + c]!;
      if (texel !== 0) fb[p] = assets.table109[(texel << 8) | fb[p]!]!;
    }
  }
}

/**
 * Image 64×64 mise à l'échelle sur `(2w + 1) × (2h + 1)` pixels autour de `(sx, sy)`, `w = Sx * demi-taille / D`, `h = Sy * demi-taille / D` ;
 * colonne `c = ((n + 1) * (0x3fff / largeur)) >> 8`, ligne `r = (k * (0x3f00 / hauteur)) >> 8`.
 */
export function drawSprite504(fb: Uint8Array, cols: Columns, assets: RenderAssets, pr: Projection, queue: RenderQueue, qi: number): void {
  const sx = queue.x[qi * 3]!;
  const sy = queue.y[qi * 3]!;
  const depth = queue.key[qi]!;
  const image = assets.images504[queue.aux[qi]!];
  if (!image) return;
  const size = queue.aux2[qi]!;
  const w = Math.min(MAX_HALF_EXTENT, idiv(pr.scaleX * size, depth));
  const h = Math.min(MAX_HALF_EXTENT, idiv(pr.scaleY * size, depth));
  const width = 2 * w + 1;
  const height = 2 * h + 1;
  const columnStep = idiv(0x3fff, width);
  const rowStep = idiv(0x3f00, height);
  const top = sy - h;
  const nFirst = Math.max(0, VIEWPORT.left - (sx - w));
  const nLast = Math.min(width - 1, VIEWPORT.right - (sx - w));
  let first = 0;
  let last = height - 1;
  if (top < 0) first = -top;
  if (top + last > SCREEN_HEIGHT - 1) last = SCREEN_HEIGHT - 1 - top;
  if (first > last) return;
  for (let n = nFirst; n <= nLast; n++) {
    const x = sx - w + n;
    const c = Math.min(63, ((n + 1) * columnStep) >> 8);
    const count = cols.clipByHorizon(x, depth, top + first, top + last - 1, last - first + 1);
    let p = (top + first) * SCREEN_WIDTH + x;
    for (let i = 0; i < count; i++, p += SCREEN_WIDTH) {
      const r = Math.min(63, ((first + i) * rowStep) >> 8);
      const texel = image[(r << 6) + c]!;
      if (texel !== 0) fb[p] = assets.table109[(texel << 8) | fb[p]!]!;
    }
  }
}
