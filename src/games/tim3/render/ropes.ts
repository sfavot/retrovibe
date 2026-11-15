/**
 * Cordes, câbles et courroies, tracés comme TIMWIN.EXE : des lignes, pas des sprites.
 *
 * - **Ligne de corde** (42d7a9) : trois lignes parallèles de 1 pixel (décalées de −1, +1 puis 0 sur l'axe le moins incliné),
 *   chacune d'une teinte de la couleur courante (cinq teintes, couleurs 0x84 … 0x88 de la palette).
 * - **Flèche** (42d757) : si le mou (longueur de la corde − distance, 43a1e8 et 43a0dc) dépasse 4 pixels, le segment est une
 *   courbe de Bézier quadratique à 16 segments dont le point de contrôle est le milieu abaissé du mou ; sinon une ligne droite.
 * - **Corde** (42db30, types 10 et 76) : suite de segments d'une extrémité à l'autre, en passant par les poulies (7) ; l'image 0
 *   de la corde (le nœud, 16×5) est posée aux deux extrémités, sauf contre une poulie ou une pièce de type 0x31.
 *   Couleur 0x86 pour la corde, 0x85 pour le câble.
 * - **Courroie** (42da79, type 8) : deux lignes droites, couleur 0x84, entre les points calculés par le moteur.
 * Les extrémités viennent de `RopeData.ends` et `BeltData.pos`, tenus à jour par le moteur (438db6, 438c70).
 */
import type { Part, RopeData } from "../engine/part";
import { drawAnmImage } from "./anm-draw";
import type { RenderAssets } from "./assets";
import { mapColor } from "./palette";
import type { Surface } from "./surface";

/** Couleurs de la corde et de la courroie (numéros de palette d'avant 413388). */
export const ROPE_COLOR = 0x86;
export const CABLE_COLOR = 0x85;
export const BELT_COLOR = 0x84;

/** Teintes {côté −1, centre, côté +1} (numéros logiques de 413388) selon la couleur courante, 42d7dd. */
const SHADES: Record<number, readonly [number, number, number]> = {
  0x84: [7, 8, 5],
  0x85: [8, 7, 5],
  0x86: [6, 0xe, 0xd],
  0x87: [4, 0xc, 5],
  0x88: [2, 0xa, 5],
};

/** 42d7a9 : segment de corde épais de 3 pixels dans la couleur `color` (0x84 … 0x88). */
export function ropeLine(surface: Surface, x1: number, y1: number, x2: number, y2: number, color: number): void {
  const shades = SHADES[color];
  if (!shades) return;
  const [a, c, b] = shades.map(mapColor) as [number, number, number];
  if (Math.abs(x1 - x2) < Math.abs(y1 - y2)) {
    surface.line(x1 - 1, y1, x2 - 1, y2, a);
    surface.line(x1 + 1, y1, x2 + 1, y2, b);
  } else {
    surface.line(x1, y1 - 1, x2, y2 - 1, a);
    surface.line(x1, y1 + 1, x2, y2 + 1, b);
  }
  surface.line(x1, y1, x2, y2, c);
}

/** 42d757 / 42d667 : segment avec flèche `sag` ; au-delà de 4, courbe de Bézier à 16 segments (différences finies, comme l'exe). */
export function ropeSegment(surface: Surface, x1: number, y1: number, x2: number, y2: number, sag: number, color: number): void {
  if (sag <= 4) return ropeLine(surface, x1, y1, x2, y2, color);
  const cx = (x1 + x2) >> 1;
  const cy = ((y1 + y2) >> 1) + sag;
  const n = 4;
  const dd = [x1 + x2 - 2 * cx, y1 + y2 - 2 * cy];
  const d1 = [(cx - x1) << (n + 1), (cy - y1) << (n + 1)];
  let px = x1 << (2 * n);
  let py = y1 << (2 * n);
  let lastX = px >> (2 * n);
  let lastY = py >> (2 * n);
  for (let i = 0; i <= 1 << n; i++) {
    const x = px >> (2 * n);
    const y = py >> (2 * n);
    if (x !== lastX || y !== lastY) {
      ropeLine(surface, lastX, lastY, x, y, color);
      lastX = x;
      lastY = y;
    }
    px += (2 * i + 1) * dd[0]! + d1[0]!;
    py += (2 * i + 1) * dd[1]! + d1[1]!;
  }
}

/** 43a0dc : distance approchée (le plus grand écart plus 3/8 du plus petit). */
function approxDistance(dx: number, dy: number): number {
  const a = Math.abs(dx);
  const b = Math.abs(dy);
  return a < b ? (a >> 2) + (a >> 3) + b : (b >> 2) + (b >> 3) + a;
}

/** 43a1e8 (cas d'une corde droite entre ses deux bouts, ou d'un segment sans poulie) : longueur de la corde moins distance. */
function slack(rope: RopeData, first: boolean): number {
  const owner = rope.ropePart;
  const length = first ? owner.fFC : owner.f104;
  const e = rope.ends;
  return length - approxDistance(e[0]! - e[2]!, e[1]! - e[3]!);
}

type View = { x: number; y: number };

/** 42db30 : corde ou câble. */
export function drawRope(surface: Surface, assets: RenderAssets, part: Part, view: View): void {
  const rope = part.ropes[0];
  if (!rope) return;
  const anm = assets.partAnm(part.type);
  let a: Part | null = rope.end1;
  if (!a) return;
  let b: Part | null = a.links[rope.slot1 & 1] ?? null;
  if (!b) b = rope.end2;
  const color = part.type === 0x0a ? ROPE_COLOR : CABLE_COLOR;
  for (let guard = 0; a && b && guard < 64; guard++) {
    let x1: number;
    let y1: number;
    let direct1 = false;
    if (a.type === 7) {
      const pr = a.ropes[0];
      x1 = (pr?.ends[2] ?? 0) - view.x;
      y1 = (pr?.ends[3] ?? 0) - view.y;
    } else {
      x1 = rope.ends[0]! - view.x;
      y1 = rope.ends[1]! - view.y;
      direct1 = true;
    }
    let x2: number;
    let y2: number;
    let direct2 = false;
    if (b.type === 7) {
      const pr = b.ropes[0];
      x2 = (pr?.ends[0] ?? 0) - view.x;
      y2 = (pr?.ends[1] ?? 0) - view.y;
    } else {
      x2 = rope.ends[2]! - view.x;
      y2 = rope.ends[3]! - view.y;
      direct2 = true;
    }
    if (direct1 || direct2) ropeSegment(surface, x1, y1, x2, y2, slack(rope, a === rope.end1), color);
    else ropeLine(surface, x1, y1, x2, y2, color);
    if (anm && a.type !== 0x31 && a.type !== 7) drawAnmImage(surface, assets, anm, 0, x1 - 8, y1 - 7);
    if (anm && b.type !== 0x31 && b.type !== 7) drawAnmImage(surface, assets, anm, 0, x2 - 8, y2 - 7);
    a = b;
    b = a.type === 7 ? (a.links[0] ?? null) : null;
  }
}

/** 42da79 : courroie, deux brins droits. */
export function drawBelt(surface: Surface, part: Part, view: View): void {
  const belt = part.belt;
  if (!belt?.end1 || !belt.end2) return;
  const p = belt.pos;
  ropeLine(surface, p[0]! - view.x, p[1]! - view.y, p[2]! - view.x, p[3]! - view.y, BELT_COLOR);
  ropeLine(surface, p[4]! - view.x, p[5]! - view.y, p[6]! - view.x, p[7]! - view.y, BELT_COLOR);
}
