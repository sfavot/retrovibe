/**
 * Tests de chevauchement de 437208 (`overlapsAnother`) : les deux tests de polygones 4372f8 (arêtes qui se coupent) et
 * 4374e9 (centre d'une pièce dans le polygone de l'autre). Le binaire de TIM3 fait foi ; pas d'équivalent OpenTIM.
 */
import { half, idiv } from "../../fixed";
import { intersect } from "../../collide";
import type { Part, Polygon } from "../../part";

const segA = new Int32Array(4);
const segB = new Int32Array(4);
const hit = new Int32Array(2);

/** Coordonnées absolues du sommet `i` (lecture hors tableau : 0, comme une mémoire non initialisée sans effet ici). */
function vx(poly: Polygon, i: number, ox: number): number {
  return ((poly.x[i] ?? 0) + ox) | 0;
}
function vy(poly: Polygon, i: number, oy: number): number {
  return ((poly.y[i] ?? 0) + oy) | 0;
}

/**
 * 4372f8(a, b) : une arête du polygone de `a` coupe-t-elle une arête de celui de `b` ailleurs qu'en son point d'arrivée ?
 * Chaque arête de `a` est translatée à l'origine (41355c) ; une intersection exactement à l'extrémité de l'arête de `a`
 * ne compte pas.
 */
export function edgesCross(a: Part, b: Part): boolean {
  const pa = a.poly;
  if (!pa) return false;
  const ax = a.px;
  const ay = a.py;
  const bx = b.px;
  const by = b.py;
  const na = a.vertexCount;
  const nb = b.vertexCount;
  const pb = b.poly;
  // Arête courante de a : A0 → A1 (le premier sommet sert à fermer le polygone).
  let a0x = vx(pa, 0, ax);
  let a0y = vy(pa, 0, ay);
  const firstX = a0x;
  const firstY = a0y;
  let a1x = vx(pa, 1, ax);
  let a1y = vy(pa, 1, ay);
  let i = 1;
  let ia = 0; // indice du sommet de départ de l'arête de a
  for (;;) {
    segA[0] = 0;
    segA[1] = 0;
    segA[2] = (a1x - a0x) | 0;
    segA[3] = (a1y - a0y) | 0;
    if (pb) {
      let j = 1;
      let ib = 0;
      let b0x = vx(pb, 0, bx);
      let b0y = vy(pb, 0, by);
      const bFirstX = b0x;
      const bFirstY = b0y;
      let b1x = vx(pb, 1, bx);
      let b1y = vy(pb, 1, by);
      for (;;) {
        segB[0] = (b0x - a0x) | 0;
        segB[1] = (b0y - a0y) | 0;
        segB[2] = (b1x - a0x) | 0;
        segB[3] = (b1y - a0y) | 0;
        if (intersect(segA, segB, hit)) {
          if (hit[1] !== segA[3] || hit[0] !== segA[2]) return true;
        }
        j++;
        if (nb < j) break;
        ib++;
        b0x = b1x;
        b0y = b1y;
        if (nb === j) {
          b1x = bFirstX;
          b1y = bFirstY;
        } else {
          b1x = vx(pb, ib + 1, bx);
          b1y = vy(pb, ib + 1, by);
        }
      }
    }
    i++;
    if (na < i) return false;
    ia++;
    a0x = a1x;
    a0y = a1y;
    if (na === i) {
      a1x = firstX;
      a1y = firstY;
    } else {
      a1x = vx(pa, ia + 1, ax);
      a1y = vy(pa, ia + 1, ay);
    }
  }
}

/**
 * 4374e9(a, b) : le centre de la forme de `a` (position + moitié de +0x64/+0x68) est-il dans le polygone de `b` ?
 * Lancer de rayons par les quatre demi-axes : pour chaque arête, on note de quel côté du centre elle passe ; le centre
 * est dedans quand les quatre directions ont rencontré une arête. Seule la branche `a` non nul est portée (437208 n'appelle
 * jamais 4374e9 avec une pièce nulle : celle-ci teste le point de l'écran contre `b`).
 */
export function centerInside(a: Part, b: Part): boolean {
  const pa = a.poly;
  const pb = b.poly;
  if (!pa || a.vertexCount === 0 || !pb || b.vertexCount === 0) return false;
  const cx = (a.px + half(a.shapeW)) | 0;
  const cy = (a.py + half(a.shapeH)) | 0;
  let fRight = 0; // [-0xC]
  let fLeft = 0; // [-0x14]
  let fBelow = 0; // [-0x8]
  let fAbove = 0; // [-0x10]
  const ox = b.px;
  const oy = b.py;
  let n = b.vertexCount;
  let x1 = vx(pb, n - 1, ox);
  let y1 = vy(pb, n - 1, oy);
  let k = 0;
  while (n !== 0) {
    n = (n - 1) | 0;
    const x0 = x1;
    const y0 = y1;
    x1 = vx(pb, k, ox);
    y1 = vy(pb, k, oy);
    k++;
    const xin = (cx >= x0 && cx <= x1) || (cx >= x1 && cx <= x0);
    const yin = (cy >= y0 && cy <= y1) || (cy >= y1 && cy <= y0);
    if (yin || xin) {
      if (xin && !yin) {
        if (cy >= y0) fBelow = 1;
        else fAbove = 1;
      }
      if (yin && !xin) {
        if (cx >= x0) fRight = 1;
        else fLeft = 1;
      }
      if (yin && xin) {
        const dx = (x0 - x1) | 0;
        const dy = (y0 - y1) | 0;
        if (dx !== 0) {
          const yl = (idiv(Math.imul(dy, cx), dx) + y0 - idiv(Math.imul(dy, x0), dx)) | 0;
          if (cy > yl) fBelow = 1;
          else fAbove = 1;
        }
        if (dy !== 0) {
          const xl = (idiv(Math.imul(dx, cy), dy) + x0 - idiv(Math.imul(dx, y0), dy)) | 0;
          if (cx > xl) fRight = 1;
          else fLeft = 1;
        }
      }
    }
    if (fRight && fLeft && fBelow && fAbove) return true;
  }
  return false;
}
