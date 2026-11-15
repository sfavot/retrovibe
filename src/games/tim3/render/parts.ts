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
 * - **Aplats** (43e74b : types 121 à 124, 203, 205, 271, 280) : l'image 0 répétée sur la zone, alignée sur une grille de
 *   la taille de l'image, si l'option 4 (fonds) est active.
 * - **Ensemble de couleurs** (127, 44827f) : pas d'image ; un rectangle plein de la taille de la pièce, si l'option 4 est active.
 *   Couleur : +0xFC (5 si nul, valeur que le jeu écrit alors dans la pièce ; le port ne la modifie pas en dessinant), quartet bas
 *   `a`, quartet haut `b` : sans `b`, la couleur logique `a` ; sinon la couleur de la palette la plus proche (`GetNearestPaletteIndex`)
 *   de la moyenne des couleurs `a` + 15 et `b` + 15 de la palette (467389, moitié de chaque somme).
 * - **Loupe** (30, 441a0a) : la pièce, puis, la machine en marche (`[0x4815b0]` = 0x2000) et une pièce mise au point (+0xA0), un
 *   triangle plein de couleur logique 14 (457bf4) de la lentille, (x + 18, y + 6) et (x + 18, y + 16), ou (x − 1, …) retournée,
 *   jusqu'au point de mise à feu de la cible (+0xB8, +0xB9 ajoutés à sa position).
 * - **Message d'ordinateur** (136, 448424) : la pièce, puis, allumée (+0x24), le caractère +0xFC (« A » à la création, 448380) en
 *   couleur logique 0x14, centré sur (x + 18, y + 3) (largeur et hauteur de la police divisées par deux) ; police : `COMPUTER_FONTS`.
 * - **Seaux** (11, 17, 108) : image normale à l'arrière, image du devant au plan 2.
 * - **Avant au plan 0** (types aux plans 4 et 0, le slot 6 choisit l'image selon le plan) :
 *   - boîtes 71 (445ce0) : image courante au plan 4 et image + 5 (l'avant : verre, cadre, osier, grille) au plan 0, ce qui
 *     met le contenu entre les deux ; la caisse en carton (image 4) n'a pas d'arrière et n'est dessinée qu'au plan 0 ;
 *   - taille-haie 37 (442a75) : au plan 0, si l'image courante est avant le début de l'état 0xB (0x481e6c, la lame seule),
 *     cette lame passe devant ;
 *   - cisailles 77 (442ab8) : au plan 0, à l'image 0 (ouvertes), la lame seule (début de l'état 5, 0x481e7c) passe devant.
 * - **Lasers et mélangeur** (91 à 93, 95 : slot 6 = 43cd22, plan 3) : le corps (42deab), puis, s'il est allumé (+0x24), le
 *   faisceau : ligne de Bresenham (4570c8) d'un point du tampon (+0x90) au suivant, sur les +0xFC tronçons posés par la passe
 *   43d013 ; le dernier s'arrête au point d'impact (+0x54, +0x58) sauf si +0x54 = −0x1000 (faisceau jusqu'au bout). Couleur
 *   logique (43cdfd → 413388) : 12 pour 91, 10 pour 92, 9 pour 93 ; pour 95, table 0x477d64 indexée par les faisceaux reçus.
 */
import type { Anm } from "../data/anm";
import type { Part } from "../engine/part";
import type { World } from "../engine/world";
import { FLIP_X, FLIP_Y, drawAnmImage, imageFrame, stateStart } from "./anm-draw";
import type { RenderAssets } from "./assets";
import { mapColor, nearestColor } from "./palette";
import { drawText, measureText } from "./text";
import { drawBelt, drawRope } from "./ropes";
import type { Surface } from "./surface";

export const LAYER_COUNT = 9;

/** Types dessinés par 42dcec (étirables). */
const STRETCHED = new Set([1, 46, 48, 56, 60, 82, 83, 84, 85, 97, 118, 125]);
/** Types dessinés par 43e74b (aplats). */
const AREA = new Set([121, 122, 123, 124, 203, 205, 271, 280]);
/** Types à dessin propre : loupe (441a0a), ensemble de couleurs (44827f), message d'ordinateur (448424). */
const MAGNIFIER = 30;
const COLOR_BLOCK = 127;
const COMPUTER = 136;
/**
 * 4483a4 charge `RMN1_18.PFT`, absente des volumes et du disque du jeu : la poignée reste nulle, 456d10(0) ne change rien, et le
 * caractère s'écrit dans la police courante du contexte de dessin (la dernière choisie). Supposé : celle de la barre du but.
 */
const COMPUTER_FONTS = ["RMN1_18.PFT", "GOALFONT.PFT"] as const;
/** Options d'affichage du joueur (`World.animFlags`, `engine/display.ts`). */
const SCENERY = 0x2;
const BACKGROUND = 0x4;
const BUCKETS: Record<number, number> = { 11: 1, 17: 1, 108: 0x5a };
/** 43cdfd : couleur logique du faisceau des lasers 91, 92, 93. */
const BEAM_COLORS: Record<number, number> = { 0x5b: 12, 0x5c: 10, 0x5d: 9 };
/** 0x477d64 : couleur logique du faisceau du mélangeur 95, selon les faisceaux reçus (+0x24 : 4 = 91, 2 = 92, 1 = 93). */
const MIXER_COLORS = [0, 9, 10, 11, 12, 1, 14, 15] as const;
/** +0x54 d'un laser dont le faisceau ne touche rien (43d013). */
const BEAM_UNBLOCKED = -0x1000;

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
  if (!(world.animFlags & SCENERY) && p.flags14 & 0x1000) return;
  if (p.type === COLOR_BLOCK) return drawColorBlock(surface, assets, world, p, view);
  const anm = assets.partAnm(p.type);
  if (p.type === 8) return drawBelt(surface, p, view);
  if (p.type === 10 || p.type === 76) return drawRope(surface, assets, p, view);
  if (isBeamSource(p.type)) return drawLaser(surface, assets, anm, p, view);
  if (!anm) return;
  if (STRETCHED.has(p.type)) return drawStretched(surface, assets, anm, p, view);
  if (AREA.has(p.type)) return drawArea(surface, assets, world, anm, p, view);
  const frame = layerFrame(anm, p, layer);
  if (frame !== null) drawOrdinary(surface, assets, anm, p, frame, view);
  if (p.type === MAGNIFIER) drawFocus(surface, world, p, view);
  else if (p.type === COMPUTER) drawComputerText(surface, assets, p, view);
}

/** 44827f : couleur de l'ensemble de couleurs (index de palette). */
export function colorBlockColor(palette: Uint8Array, value: number): number {
  const v = value === 0 ? 5 : value;
  const a = v & 0xf;
  const b = (v & 0xf0) >> 4;
  if (b === 0) return mapColor(a);
  const channel = (k: number): number => (palette[(a + 15) * 4 + k]! + palette[(b + 15) * 4 + k]!) >> 1;
  return mapColor(nearestColor(palette, channel(0), channel(1), channel(2)));
}

/** 44827f : rectangle plein de la taille de la pièce (448345 : seulement avec l'option « fond »). */
function drawColorBlock(surface: Surface, assets: RenderAssets, world: World, p: Part, view: { x: number; y: number }): void {
  if (!(world.animFlags & BACKGROUND)) return;
  const color = colorBlockColor(assets.gamePalette(), p.fFC);
  if (color >= 0) surface.fillRect(p.px - view.x, p.py - view.y, p.frameW, p.frameH, color);
}

/** 441a0a : faisceau de la loupe vers la pièce mise au point, machine en marche. */
function drawFocus(surface: Surface, world: World, p: Part, view: { x: number; y: number }): void {
  const target = p.links[4];
  if (!target || !world.running) return;
  const tipX = target.px + target.ropeAnchor[8]! - view.x;
  const tipY = target.py + target.ropeAnchor[9]! - view.y;
  const x = (p.flags10 & 0x10 ? p.px - 1 : p.px + 0x12) - view.x;
  fillTriangle(surface, [x, tipX, x], [p.py + 6 - view.y, tipY, p.py + 0x10 - view.y], mapColor(14));
}

/** 448424 : le caractère du message d'ordinateur allumé, centré sur (x + 18, y + 3). */
function drawComputerText(surface: Surface, assets: RenderAssets, p: Part, view: { x: number; y: number }): void {
  if (!p.f24) return;
  const font = COMPUTER_FONTS.map((name) => assets.font(name)).find((f) => f !== null) ?? null;
  if (!font) return;
  const text = String.fromCharCode(p.fFC & 0xff);
  const x = p.px + 0x12 - (measureText(font, text) >> 1) - view.x;
  const y = p.py + 3 - (font.height >> 1) - view.y;
  drawText(surface, font, text, x, y, mapColor(0x14));
}

/** Polygone plein (457bf4) : balayage par lignes, centres des pixels. */
export function fillTriangle(surface: Surface, xs: readonly number[], ys: readonly number[], color: number): void {
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  for (let y = top; y <= bottom; y++) {
    let left = Infinity;
    let right = -Infinity;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const [x0, y0, x1, y1] = [xs[i]!, ys[i]!, xs[j]!, ys[j]!];
      if (y < Math.min(y0, y1) || y > Math.max(y0, y1)) continue;
      if (y0 === y1) {
        left = Math.min(left, x0, x1);
        right = Math.max(right, x0, x1);
        continue;
      }
      const x = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    if (left <= right) for (let x = Math.round(left); x <= Math.round(right); x++) surface.plot(x, y, color);
  }
}

/** Lasers 91, 92, 93 et mélangeur 95 : types dont le slot 6 est 43cd22. */
function isBeamSource(type: number): boolean {
  return type === 0x5f || type in BEAM_COLORS;
}

/**
 * 43cd22 : le corps (42deab ; l'exe le saute lors d'un redessin partiel si l'image n'a pas changé, sans objet ici), puis le
 * faisceau.
 */
function drawLaser(surface: Surface, assets: RenderAssets, anm: Anm | null, p: Part, view: { x: number; y: number }): void {
  if (anm) drawOrdinary(surface, assets, anm, p, p.frame, view);
  drawBeam(surface, p, view);
}

/** 43cdfd : couleur logique du faisceau d'un laser ou du mélangeur, `undefined` hors table. */
export function beamColor(p: Part): number | undefined {
  return p.type === 0x5f ? MIXER_COLORS[p.f24] : BEAM_COLORS[p.type];
}

/**
 * 43cd22 (après le corps) : faisceau d'un laser allumé, tronçon par tronçon depuis le tampon +0x90 ; le dernier des +0xFC
 * tronçons s'arrête au point d'impact (+0x54, +0x58) s'il y en a un. Le tampon est en coordonnées de l'aire.
 */
export function drawBeam(surface: Surface, p: Part, view: { x: number; y: number }): void {
  const buf = p.beam;
  if (p.f24 === 0 || !buf) return;
  const logical = beamColor(p);
  if (logical === undefined) return;
  const color = mapColor(logical);
  if (color < 0) return;
  const n = Math.min(p.fFC, (buf.length >> 1) - 1);
  for (let i = 0; i < n; i++) {
    const x0 = buf[2 * i]! - view.x;
    const y0 = buf[2 * i + 1]! - view.y;
    const hit = i === n - 1 && p.vx !== BEAM_UNBLOCKED;
    const x1 = (hit ? p.vx : buf[2 * i + 2]!) - view.x;
    const y1 = (hit ? p.vy : buf[2 * i + 3]!) - view.y;
    surface.line(x0, y0, x1, y1, color);
  }
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
  if (!(world.animFlags & BACKGROUND)) return;
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
