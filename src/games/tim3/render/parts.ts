/**
 * Dessin des pièces de l'aire de jeu, dans l'ordre et selon les règles de TIMWIN.EXE.
 *
 * - **Ordre** (42d5a8, 42d54a) : 9 plans, de 8 (fond) à 0 (devant). Chaque type a deux plans (octets +0x20 et +0x21 du
 *   descripteur, 0xFF = aucun) et la pièce est dessinée une fois par plan. Dans un plan, une pièce insérée en tête : on part
 *   des pièces posées prises en ordre inverse de leur liste, puis des mobiles en ordre inverse (les mobiles passent devant).
 *   Les pièces sorties de l'aire (+0x10 & 0x2000) ou en attente (+0x14 & 0x4000) ne sont pas dessinées ; les décors
 *   (+0x14 & 0x1000) ne le sont que si l'option d'affichage 2 est active (`World.animFlags`, 7 au démarrage).
 * - **Pièce ordinaire** (slot 6 = 42deab) : image `frame` de l'ANM à (x, y) de la pièce, retournée selon +0x10 (0x10 = X,
 *   0x20 = Y) ; le décalage de retournement part de la taille de la forme et de l'image 0.
 * - **Pièces étirables** (42dcec : murs, pentes, tuyaux…) : bord gauche, motif répété, bord droit (pièce plus large que haute)
 *   ou bord haut, motif, bord bas (sinon), en tuiles de la taille de l'image 0 ; le nombre de tuiles est `largeur / tuile`.
 * - **Aplats** (43e74b : types 121 à 124, 127, 203, 205, 271, 280) : l'image 0 répétée sur la zone, alignée sur une grille de
 *   la taille de l'image, si l'option 4 est active.
 * - **Seaux** (11, 17, 108) : image normale à l'arrière, image du devant au plan 2.
 * - **Avant au plan 0** (types aux plans 4 et 0, le slot 6 choisit l'image selon le plan) :
 *   - boîtes 71 (445ce0) : image courante au plan 4 et image + 5 (l'avant : verre, cadre, osier, grille) au plan 0, ce qui
 *     met le contenu entre les deux ; la caisse en carton (image 4) n'a pas d'arrière et n'est dessinée qu'au plan 0 ;
 *   - taille-haie 37 (442a75) : au plan 0, si l'image courante est avant le début de l'état 0xB (0x481e6c, la lame seule),
 *     cette lame passe devant ;
 *   - cisailles 77 (442ab8) : au plan 0, à l'image 0 (ouvertes), la lame seule (début de l'état 5, 0x481e7c) passe devant.
 * - Pas portés (dessinés comme des pièces ordinaires ou omis) : faisceau des lasers (43cd22), détails des types 30, 127, 136.
 */
import type { Anm } from "../data/anm";
import type { Part } from "../engine/part";
import type { World } from "../engine/world";
import { FLIP_X, FLIP_Y, drawAnmImage, imageFrame, stateStart } from "./anm-draw";
import type { RenderAssets } from "./assets";
import { drawBelt, drawRope } from "./ropes";
import type { Surface } from "./surface";

export const LAYER_COUNT = 9;

/** Types dessinés par 42dcec (étirables). */
const STRETCHED = new Set([1, 46, 48, 56, 60, 82, 83, 84, 85, 97, 118, 125]);
/** Types dessinés par 43e74b (aplats). */
const AREA = new Set([121, 122, 123, 124, 203, 205, 271, 280]);
const BUCKETS: Record<number, number> = { 11: 1, 17: 1, 108: 0x5a };

export interface DrawOptions {
  /** Décalage de la vue (0x481580 / 0x481584), nul dans TIM3. */
  viewX?: number;
  viewY?: number;
}

/** Plans (octets +0x20 et +0x21 du descripteur) d'un type. */
export function layersOf(f20: number): [number, number] {
  return [f20 & 0xff, (f20 >> 8) & 0xff];
}

/** Pièces visibles dans l'ordre de dessin : plan 8 d'abord, chaque pièce avec le plan où elle est dessinée. */
export function drawOrder(world: World): { part: Part; layer: number }[] {
  const inserted: Part[] = [];
  for (const p of world.mobiles) inserted.push(p);
  for (const p of world.statics) inserted.push(p);
  const out: { part: Part; layer: number }[] = [];
  for (let layer = LAYER_COUNT - 1; layer >= 0; layer--) {
    for (let i = inserted.length - 1; i >= 0; i--) {
      const p = inserted[i]!;
      if (p.flags10 & 0x2000 || p.flags14 & 0x4000) continue;
      const [a, b] = layersOf(world.types.get(p.type).f20);
      if (a === layer || b === layer) out.push({ part: p, layer });
    }
  }
  return out;
}

/** Dessine toutes les pièces de l'aire de jeu (origine de la surface = coin haut gauche de l'aire). */
export function drawParts(surface: Surface, assets: RenderAssets, world: World, options: DrawOptions = {}): void {
  const view = { x: options.viewX ?? 0, y: options.viewY ?? 0 };
  for (const { part, layer } of drawOrder(world)) drawPart(surface, assets, world, part, layer, view);
}

/** 42da3e : dessine une pièce pour un plan. */
export function drawPart(surface: Surface, assets: RenderAssets, world: World, p: Part, layer: number, view: { x: number; y: number }): void {
  if (!(world.animFlags & 2) && p.flags14 & 0x1000) return;
  const anm = assets.partAnm(p.type);
  if (p.type === 8) return drawBelt(surface, p, view);
  if (p.type === 10 || p.type === 76) return drawRope(surface, assets, p, view);
  if (!anm) return;
  if (STRETCHED.has(p.type)) return drawStretched(surface, assets, anm, p, view);
  if (AREA.has(p.type)) return drawArea(surface, assets, world, anm, p, view);
  const frame = layerFrame(anm, p, layer);
  if (frame !== null) drawOrdinary(surface, assets, anm, p, frame, view);
}

/** Image dessinée par le slot 6 d'une pièce ordinaire pour un plan, `null` pour rien. */
function layerFrame(anm: Anm, p: Part, layer: number): number | null {
  const bucketFrame = BUCKETS[p.type];
  if (bucketFrame !== undefined) return layer === 2 ? bucketFrame : 0;
  switch (p.type) {
    case 37: {
      // 442a75 : comparaison non signée avec 0x481e6c.
      if (layer !== 0) return p.frame;
      const blade = stateFirst(anm, 0xb);
      return p.frame >>> 0 < blade >>> 0 ? blade : null;
    }
    case 71: // 445ce0
      if (layer !== 0) return p.frame === 4 ? null : p.frame;
      return p.frame === 4 ? 4 : p.frame + 5;
    case 77: // 442ab8
      if (layer !== 0) return p.frame;
      return p.frame === 0 ? stateFirst(anm, 5) : null;
    default:
      return p.frame;
  }
}

/** 44b2c0 : première image de l'état `n` (celle du premier état si un état 0 le précède, 0 si absent). */
function stateFirst(anm: Anm, n: number): number {
  for (const s of anm.states) if (s.state === 0 || s.state === n) return s.first;
  return 0;
}

/** 42deab : pièce ordinaire. */
function drawOrdinary(surface: Surface, assets: RenderAssets, anm: Anm, p: Part, frame: number, view: { x: number; y: number }): void {
  const f0 = imageFrame(anm, 0);
  if (!f0) return;
  let x = p.px - view.x;
  let y = p.py - view.y;
  let flip = 0;
  if (p.flags10 & 0x10) {
    x += p.shapeW - f0.x - f0.width;
    flip |= FLIP_X;
  }
  if (p.flags10 & 0x20) {
    y += p.shapeH - f0.y - f0.height;
    flip |= FLIP_Y;
  }
  drawAnmImage(surface, assets, anm, frame, x, y, flip);
}

/** 42dcec : pièces étirables (tuiles : bord, motif répété, bord). */
function drawStretched(surface: Surface, assets: RenderAssets, anm: Anm, p: Part, view: { x: number; y: number }): void {
  let x = p.px - view.x;
  let y = p.py - view.y;
  const flipped = (p.flags10 & 0x30) !== 0;
  const horizontal = p.frameW >= p.frameH;
  const flip = flipped ? (horizontal ? FLIP_Y : FLIP_X) : 0;
  // Groupe d'images : le premier état pour une pièce plus large que haute, le deuxième sinon (44b19c).
  let first = 0;
  if (!horizontal) {
    first = 1;
    while (first < 4096 && stateStart(anm, first) === 0) first++;
  }
  let length = 1;
  while (length < 4096 && stateStart(anm, first + length) === 0) length++;
  const rect = imageFrame(anm, first);
  if (!rect) return;
  const tile = horizontal ? rect.width : rect.height;
  if (tile === 0) return;
  const count = Math.trunc((horizontal ? p.frameW : p.frameH) / tile);
  if (p.type === 0x76 && flip) x += rect.width - 16;
  for (let i = 0; i < count; i++) {
    let image: number;
    if (i === 0) image = first;
    else if (i === count - 1) image = first + length - 1;
    else image = first + 1 + ((i - 1) % (length - 2));
    drawAnmImage(surface, assets, anm, image, x, y, flip);
    if (horizontal) x += rect.width;
    else y += rect.height;
  }
}

/** 43e74b : aplat, l'image 0 répétée sur la zone de la pièce, alignée sur une grille de la taille de l'image. */
function drawArea(surface: Surface, assets: RenderAssets, world: World, anm: Anm, p: Part, view: { x: number; y: number }): void {
  if (!(world.animFlags & 4)) return;
  const f = imageFrame(anm, 0);
  if (!f || f.width <= 0 || f.height <= 0) return;
  const old = surface.clip;
  const saved = { ...old };
  // Intersection du rectangle de la pièce et du découpage courant.
  const left = Math.max(p.px - view.x, saved.x0);
  const right = Math.min(p.px - view.x + p.frameW, saved.x1);
  const top = Math.max(p.py - view.y, saved.y0);
  const bottom = Math.min(p.py - view.y + p.frameH, saved.y1);
  if (left >= right || top >= bottom) return;
  surface.setClip(left, top, right - left, bottom - top);
  const startX = Math.trunc(left / f.width) * f.width;
  const startY = Math.trunc(top / f.height) * f.height;
  for (let x = startX; x < right; x += f.width) for (let y = startY; y < bottom; y += f.height) drawAnmImage(surface, assets, anm, 0, x, y, 0);
  surface.restoreClip(saved);
}
