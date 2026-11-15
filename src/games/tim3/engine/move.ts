/**
 * Déplacement d'une pièce et géométrie dérivée de sa position (TIMWIN.EXE).
 * Pas de correspondance directe dans OpenTIM pour les tailles d'images ; le déplacement suit `advance_parts`
 * (`c_src/main.c`, `src/parts/mod.rs`) mais le binaire de TIM3 fait foi.
 */
import { partAccel } from "./gravity";
import type { Part, Polygon } from "./part";
import { F0C, F10, F14 } from "./part";
import { angleOf } from "./tables";
import type { World } from "./world";

/** Types dont la taille d'image vaut 0 (courroie, corde, câble). */
const SIZE_NONE = new Set([8, 10, 76]);
/** Types dont la taille vient du LEV (+0x7C/+0x80) : murs, pentes, tuiles, tuyaux, conveyor… (439bd7). */
const SIZE_FROM_LEV = new Set([
  1, 2, 5, 11, 13, 21, 25, 46, 48, 56, 60, 82, 83, 84, 85, 97, 99, 100, 101, 102, 118, 121, 122, 123, 124, 125, 126, 127,
  203, 205, 271, 280,
]);
/** Types dont forme et boîte prennent la taille de l'image courante. */
const SIZE_FROM_FRAME = new Set([4, 7, 22, 23, 57, 58, 71, 88]);

/** 439bd7 : tailles d'image (+0x6C), de forme (+0x64) et de boîte (+0x7C) selon le type et l'image courante. */
export function updateSizes(world: World, part: Part): void {
  const t = part.type;
  if (SIZE_NONE.has(t)) {
    part.frameW = part.frameH = 0;
    part.shapeW = part.shapeH = 0;
    return;
  }
  if (SIZE_FROM_LEV.has(t)) {
    part.frameW = part.boxW;
    part.frameH = part.boxH;
    part.shapeW = part.frameW;
    part.shapeH = part.frameH;
    return;
  }
  const anim = world.types.anims[t];
  if (SIZE_FROM_FRAME.has(t)) {
    if (!anim) return;
    const f = world.frameRect(part);
    part.frameW = f.w;
    part.frameH = f.h;
    part.shapeW = part.frameW;
    part.shapeH = part.frameH;
    part.boxW = part.shapeW;
    part.boxH = part.shapeH;
    return;
  }
  if (!anim) {
    part.frameW = part.frameH = 0;
    part.shapeW = part.shapeH = 0;
    part.boxW = part.boxH = 0;
    return;
  }
  const f = world.frameRect(part);
  part.frameW = f.w;
  part.frameH = f.h;
  const d = world.types.get(t);
  if (part.flags14 & 0x1000) {
    part.shapeW = part.frameW;
    part.shapeH = part.frameH;
  } else {
    part.shapeW = d.shapeW;
    part.shapeH = d.shapeH;
  }
  if (d.boxW !== 0 || d.boxH !== 0) {
    part.boxW = d.boxW;
    part.boxH = d.boxH;
  } else {
    part.boxW = part.shapeW;
    part.boxH = part.shapeH;
  }
}

/** 439b58 : position de dessin (+0x44) d'après la position, l'image et le retournement ; recalcule les tailles. */
export function updateGeometry(world: World, part: Part): void {
  const anim = world.types.anims[part.type];
  part.drawX = part.px;
  part.drawY = part.py;
  const flags = part.flags10;
  updateSizes(world, part);
  if (!anim) return;
  const f = world.frameRect(part);
  part.drawX = (part.drawX + (flags & F10.FLIP_X ? part.shapeW - f.x - part.frameW : f.x)) | 0;
  part.drawY = (part.drawY + (flags & F10.FLIP_Y ? part.shapeH - f.y - part.frameH : f.y)) | 0;
}

/** 41368c : allonge d'un pixel l'extrémité d'un segment {x0, y0, x1, y1}, dans le sens du segment. */
export function extendSegment(s: Int32Array): void {
  const dx = (s[2]! - s[0]!) | 0;
  if (dx > 0) s[2] = (s[2]! + 1) | 0;
  else if (dx < 0) s[2] = (s[2]! - 1) | 0;
  const dy = (s[3]! - s[1]!) | 0;
  if (dy > 0) s[3] = (s[3]! + 1) | 0;
  else if (dy < 0) s[3] = (s[3]! - 1) | 0;
}

/** 439e38 : angle de chaque côté (sommet i → i + 1) : 0xC000 − angle du segment allongé. */
export function computeEdgeAngles(poly: Polygon, count: number): void {
  const s = new Int32Array(4);
  for (let i = 0; i < count; i++) {
    const j = i + 1 < count ? i + 1 : 0;
    s[0] = poly.x[i]!;
    s[1] = poly.y[i]!;
    s[2] = poly.x[j]!;
    s[3] = poly.y[j]!;
    extendSegment(s);
    poly.angle[i] = (0xc000 - angleOf((s[2]! - s[0]!) | 0, (s[3]! - s[1]!) | 0)) & 0xffff;
  }
}

/** 43428c : intégration d'Euler, collage au sol d'une pièce qui roule (±0x400), sortie de l'aire, géométrie. */
export function movePart(world: World, part: Part): void {
  part.fx = (part.fx + part.vx) | 0;
  part.fy = (part.fy + part.vy) | 0;
  if (part.flags0C & F0C.ROLLING && !(part.flags10 & 0x4)) {
    let g = partAccel(part, world.types);
    if (part.flags14 & F14.REVERSED_GRAVITY) g = -g | 0;
    part.fy = (part.fy + (g > 0 ? 0x400 : -0x400)) | 0;
  }
  part.flags14 &= ~F14.REVERSED_GRAVITY;
  part.px = part.fx >> 9;
  part.py = part.fy >> 9;
  if (part.px < -1000 || part.px > 2000 || part.py < -1000 || part.py > 2000) part.flags10 |= F10.GONE;
  updateGeometry(world, part);
}
