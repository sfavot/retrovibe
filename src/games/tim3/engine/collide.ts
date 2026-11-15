/**
 * Détection et résolution des collisions entre polygones (42bb02 et ses fonctions, TIMWIN.EXE 0x42b7f0–0x42c606).
 *
 * Le principe : chaque sommet de la pièce qui bouge décrit un segment de sa position précédente à sa position
 * actuelle ; s'il coupe un côté de l'autre pièce (42be0c), on la ramène sur ce côté. Puis l'inverse : les sommets de
 * l'autre pièce contre les côtés de la pièce qui bouge, à mouvement relatif inversé (42c1d6). Le contact retenu (pièce,
 * angle du côté, côtés touchés) sert ensuite au rebond ou au roulement (`bounce.ts`).
 * L'exe garde son état dans des globales (0x480380 … 0x4803d0) : elles sont ici dans `CollisionState`.
 * OpenTIM n'a pas traduit ces fonctions (pas d'équivalent dans `src/parts/mod.rs`) : traduction directe de l'exe.
 */
import { QUAD_DX, QUAD_DY } from "../data/tables/quadrants";
import { abs32, idiv, imul, s16, u16 } from "./fixed";
import { extendSegment, updateGeometry } from "./move";
import type { Part } from "./part";
import { F0C, F10, F14 } from "./part";
import { angleOf } from "./tables";
import type { World } from "./world";

/** Globales 0x480380 … 0x4803d0. */
export class CollisionState {
  /** 0x480380 : angle du mouvement de la pièce. */
  motionAngle = 0;
  /** 0x480382 / 0x480384 : angle (et quadrant) du contact du pas précédent. */
  lastContactAngle = 0;
  lastContactQuadrant = 0;
  /** 0x480388 … 0x4803a8, 0x4803c4 : boîte de la pièce qui bouge, élargie au mouvement, et déplacement (dx, dy). */
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  cx = 0;
  cy = 0;
  sweepX = 0;
  sweepY = 0;
  dx = 0;
  dy = 0;
  /** 0x4803ac … 0x4803c0 : boîte de l'autre pièce. */
  ox0 = 0;
  oy0 = 0;
  ox1 = 0;
  oy1 = 0;
  ocx = 0;
  ocy = 0;
  /** 0x4803c8 / 0x4803cc / 0x4803d0 : pièce qui bouge, autre pièce, contact du pas précédent. */
  cur: Part | null = null;
  other: Part | null = null;
  lastContact: Part | null = null;
}

/** 42ba82 : quadrant (0 … 3) d'un angle 16 bits ; les diagonales 0x2000 et 0xA000 vont à 0 et 2. */
export function quadrant(angle: number): number {
  const a = u16(angle);
  if (a === 0x2000) return 0;
  if (a === 0xa000) return 2;
  return (s16(a + 0x2000) >> 14) & 3;
}

/** 42ba5f : angle du mouvement d'une pièce (de sa position précédente à l'actuelle). */
export function motionAngle(p: Part): number {
  return angleOf((p.prevPx - p.px) | 0, (p.py - p.prevPy) | 0);
}

/** 41352a : v entre a et b (bornes incluses), comparaison sur 16 bits non signés comme l'exe. */
function within(v: number, a: number, b: number): boolean {
  if (b < a) return u16(v - b) <= u16(a - b);
  return u16(v - a) <= u16(b - a);
}

/** 41355c : intersection de deux segments {x0, y0, x1, y1} ; écrit le point dans `out` et dit s'il est sur les deux. */
export function intersect(a: Int32Array, b: Int32Array, out: Int32Array): boolean {
  const a1 = (a[1]! - a[3]!) | 0;
  const b1 = (a[0]! - a[2]!) | 0;
  const c1 = (imul(a1, a[2]!) - imul(b1, a[3]!)) | 0;
  const a2 = (b[3]! - b[1]!) | 0;
  const b2 = (b[2]! - b[0]!) | 0;
  const c2 = (imul(a2, b[0]!) - imul(b2, b[1]!)) | 0;
  const det = (imul(a2, b1) - imul(a1, b2)) | 0;
  let x: number;
  let y: number;
  if (det !== 0) {
    x = idiv((imul(c2, b1) - imul(c1, b2)) | 0, det);
    y = idiv((imul(a1, c2) - imul(a2, c1)) | 0, det);
  } else if (((imul(a2, a[0]!) + imul(b2, a[1]!)) | 0) !== 0) {
    x = 0;
    y = 0;
  } else {
    x = a[2]!;
    y = a[3]!;
  }
  out[0] = x;
  out[1] = y;
  return within(x, a[0]!, a[2]!) && within(x, b[0]!, b[2]!) && within(y, a[1]!, a[3]!) && within(y, b[1]!, b[3]!);
}

/** 42b819 (+ 42b7f0) : boîte de la pièce qui bouge, élargie à sa position précédente, et son déplacement. */
function sweepCurrent(st: CollisionState): void {
  const p = st.cur!;
  st.x0 = st.sweepX = p.px;
  st.y0 = st.sweepY = p.py;
  st.x1 = (p.boxW + st.x0) | 0;
  st.y1 = (p.boxH + st.y0) | 0;
  st.cx = ((p.boxW >> 1) + st.x0) | 0;
  st.cy = ((p.boxH >> 1) + st.y0) | 0;
  st.dx = (st.x0 - p.prevPx) | 0;
  st.dy = (st.y0 - p.prevPy) | 0;
  if (p.prevPx < st.x0) st.sweepX = p.prevPx;
  if (p.prevPy < st.y0) st.sweepY = p.prevPy;
  st.x1 = (st.x1 + abs32(st.dx)) | 0;
  st.y1 = (st.y1 + abs32(st.dy)) | 0;
}

/** 42b8e6 : boîte de l'autre pièce. */
function boxOther(st: CollisionState): void {
  const o = st.other!;
  st.ox0 = o.px;
  st.oy0 = o.py;
  st.ox1 = (o.boxW + st.ox0) | 0;
  st.oy1 = (o.boxH + st.oy0) | 0;
  st.ocx = ((o.boxW >> 1) + st.ox0) | 0;
  st.ocy = ((o.boxH >> 1) + st.oy0) | 0;
}

function overlaps(st: CollisionState): boolean {
  return st.ox0 < st.x1 && st.ox1 > st.sweepX && st.oy0 < st.y1 && st.oy1 > st.sweepY;
}

/** 42b94f : le côté d'angle `angle` prolonge-t-il le contact précédent (même pente, sol ou plafond) ? */
function continuesContact(st: CollisionState, angle: number): boolean {
  if (!st.lastContact) return false;
  const a = u16(angle);
  if (a > 0x2000 && a < 0x6000) return false;
  if (a > 0xa000 && a < 0xe000) return false;
  if (a === u16(st.lastContactAngle)) return true;
  if (quadrant(a) !== st.lastContactQuadrant) return false;
  let ok = false;
  let x = s16(a + 0x2000);
  let y = s16(st.lastContactAngle + 0x2000);
  if (x >= 0 && x <= 0x4000 && y >= 0 && y <= 0x4000) ok = true;
  else {
    x = s16(a - 0x6000);
    y = s16(st.lastContactAngle + 0xa000);
    if (x >= 0 && x <= 0x4000 && y >= 0 && y <= 0x4000) ok = true;
  }
  if (!ok) return false;
  if (x === 0x2000 || y === 0x2000) return true;
  if (x < 0x2000 && y < 0x2000) return true;
  return x > 0x2000 && y > 0x2000;
}

/** 42baac : de quel côté du point de contact se trouve le centre de la pièce (+0xE0 / +0xE1). */
function contactSides(edge: Int32Array, v: number, p: Part): void {
  if (within(v, edge[0]!, edge[2]!)) {
    p.contactLeft = 1;
    p.contactRight = 1;
  } else if (edge[0]! < edge[2]!) {
    if (v < edge[0]!) p.contactRight = 1;
    else p.contactLeft = 1;
  } else if (v < edge[2]!) p.contactLeft = 1;
  else p.contactRight = 1;
}

/** Après une correction de position : géométrie, boîte, drapeaux de contact (commun à 42be0c et 42c1d6). */
function settle(world: World, st: CollisionState, byVertex: boolean): void {
  const p = st.cur!;
  const o = st.other!;
  updateGeometry(world, p);
  sweepCurrent(st);
  p.flags0C &= ~(F0C.CONTACT_HEAVY | F0C.CONTACT_MOBILE);
  if (byVertex) p.flags10 |= F10.HIT_BY_VERTEX;
  else p.flags10 &= ~F10.HIT_BY_VERTEX;
  if ((p.flags10 | o.flags10) & 0x8000 || o.flags0C & 0x4000) p.flags0C |= F0C.CONTACT_HEAVY;
  else p.flags0C |= F0C.CONTACT_MOBILE;
}

/**
 * 42be0c(test) : sommets de la pièce qui bouge (segments position précédente → actuelle) contre les côtés de l'autre.
 * `test` vrai : rend 1 au premier croisement, sans rien corriger.
 */
function verticesIntoEdges(world: World, st: CollisionState, test: boolean): boolean {
  const p = st.cur!;
  const o = st.other!;
  const ep = o.poly;
  if (!ep) return false;
  let hit = false;
  const n = o.vertexCount;
  const firstX = (ep.x[0]! + st.ox0) | 0;
  const firstY = (ep.y[0]! + st.oy0) | 0;
  let ax0 = firstX;
  let ay0 = firstY;
  let ax1 = (ep.x[1]! + st.ox0) | 0;
  let ay1 = (ep.y[1]! + st.oy0) | 0;
  let edgeAngle = ep.angle[0]!;
  const seg = new Int32Array(4);
  const edge = new Int32Array(4);
  const at = new Int32Array(2);
  for (let j = 1; ; ) {
    const q = quadrant(edgeAngle);
    if (s16(st.motionAngle - edgeAngle + 0x4000) > 0) {
      const vp = p.poly!;
      let prevAngle = vp.angle[0]!;
      let k = 1;
      let vi = 1;
      for (;;) {
        const a = s16(prevAngle - edgeAngle + 0x8000);
        const b = s16(vp.angle[vi]! - edgeAngle + 0x8000);
        if ((a >= 0 || a === -0x8000) && b <= 0 && (st.dx !== 0 || st.dy !== 0)) {
          seg[0] = (p.prevPx + vp.x[vi]! - ax0) | 0;
          seg[1] = (p.prevPy + vp.y[vi]! - ay0) | 0;
          seg[2] = (seg[0] + st.dx) | 0;
          seg[3] = (seg[1] + st.dy) | 0;
          const endX = seg[2];
          const endY = seg[3];
          edge[0] = 0;
          edge[1] = 0;
          edge[2] = (ax1 - ax0) | 0;
          edge[3] = (ay1 - ay0) | 0;
          extendSegment(edge);
          if (intersect(seg, edge, at) && !(at[1] === edge[3] && at[0] === edge[2])) {
            if (test) return true;
            edge[0] = QUAD_DX[q]!;
            edge[1] = QUAD_DY[q]!;
            edge[2] = (edge[2] + QUAD_DX[q]!) | 0;
            edge[3] = (edge[3] + QUAD_DY[q]!) | 0;
            if (!continuesContact(st, edgeAngle)) {
              if (!intersect(seg, edge, at)) {
                p.px = p.prevPx;
                p.py = p.prevPy;
              } else {
                p.px = (p.px + at[0]! - endX) | 0;
                p.py = (p.py + at[1]! - endY) | 0;
              }
            } else {
              // Le long d'un sol déjà touché : on garde x et on pose y sur la droite du côté.
              const ex = (edge[2] - edge[0]) | 0;
              const ey = (edge[3] - edge[1]) | 0;
              const c = (imul(ey, edge[0]) - imul(ex, edge[1])) | 0;
              const d = -ex | 0;
              if (d !== 0) {
                const y = idiv((c - imul(ey, endX)) | 0, d);
                p.py = (p.py + y - endY) | 0;
              } else {
                p.px = p.prevPx;
                p.py = p.prevPy;
              }
            }
            settle(world, st, false);
            p.contact = o;
            p.contactAngle = edgeAngle;
            p.contactIndex = j - 1;
            contactSides(edge, (st.cx - ax0) | 0, p);
            hit = true;
          }
        }
        k++;
        if (p.vertexCount < k) break;
        prevAngle = vp.angle[vi]!;
        vi = p.vertexCount === k ? 0 : vi + 1;
      }
    }
    j++;
    if (n < j) break;
    ax0 = ax1;
    ay0 = ay1;
    edgeAngle = ep.angle[j - 1]!;
    if (n === j) {
      ax1 = firstX;
      ay1 = firstY;
    } else {
      ax1 = (ep.x[j]! + st.ox0) | 0;
      ay1 = (ep.y[j]! + st.oy0) | 0;
    }
  }
  return hit;
}

/**
 * 42c1d6(test) : sommets de l'autre pièce contre les côtés de la pièce qui bouge, à mouvement relatif inversé.
 * Pose le drapeau +0x10 & 0x1000 (« touchée par un sommet »).
 */
function edgesIntoVertices(world: World, st: CollisionState, test: boolean): boolean {
  const p = st.cur!;
  const o = st.other!;
  const ep = p.poly;
  if (!ep) return false;
  let hit = false;
  const firstX = (ep.x[0]! + st.x0) | 0;
  const firstY = (ep.y[0]! + st.y0) | 0;
  let ax0 = firstX;
  let ay0 = firstY;
  let ax1 = (ep.x[1]! + st.x0) | 0;
  let ay1 = (ep.y[1]! + st.y0) | 0;
  let edgeAngle = ep.angle[0]!;
  const seg = new Int32Array(4);
  const edge = new Int32Array(4);
  const at = new Int32Array(2);
  for (let j = 1; ; ) {
    const q = quadrant(edgeAngle - 0x8000);
    if (s16(st.motionAngle + 0x8000 - edgeAngle + 0x4000) > 0) {
      const vp = o.poly!;
      let prevAngle = vp.angle[0]!;
      let k = 1;
      let vi = 1;
      for (;;) {
        const a = s16(prevAngle - edgeAngle + 0x8000);
        const b = s16(vp.angle[vi]! - edgeAngle + 0x8000);
        if ((a >= 0 || a === -0x8000) && b <= 0 && (st.dx !== 0 || st.dy !== 0)) {
          const startX = (o.px + vp.x[vi]! - ax0) | 0;
          const startY = (o.py + vp.y[vi]! - ay0) | 0;
          seg[0] = (startX + st.dx) | 0;
          seg[1] = (startY + st.dy) | 0;
          seg[2] = startX;
          seg[3] = startY;
          edge[0] = 0;
          edge[1] = 0;
          edge[2] = (ax1 - ax0) | 0;
          edge[3] = (ay1 - ay0) | 0;
          extendSegment(edge);
          if (intersect(seg, edge, at) && !(at[1] === edge[3] && at[0] === edge[2])) {
            if (test) return true;
            edge[0] = -QUAD_DX[q]! | 0;
            edge[1] = -QUAD_DY[q]! | 0;
            edge[2] = (edge[2] - QUAD_DX[q]!) | 0;
            edge[3] = (edge[3] - QUAD_DY[q]!) | 0;
            const angleBack = (edgeAngle - 0x8000) & 0xffff;
            if (!continuesContact(st, angleBack)) {
              if (!intersect(seg, edge, at)) {
                p.px = p.prevPx;
                p.py = p.prevPy;
              } else {
                p.px = (p.px - (at[0]! - startX)) | 0;
                p.py = (p.py - (at[1]! - startY)) | 0;
              }
            } else {
              const ex = (edge[2] - edge[0]) | 0;
              const ey = (edge[3] - edge[1]) | 0;
              const c = (imul(ey, edge[0]) - imul(ex, edge[1])) | 0;
              const d = -ex | 0;
              if (d !== 0) {
                const y = idiv((c - imul(ey, startX)) | 0, d);
                p.py = (p.py - (y - startY)) | 0;
              } else {
                p.px = p.prevPx;
                p.py = p.prevPy;
              }
            }
            const centre = (st.cx - ax0) | 0;
            settle(world, st, true);
            p.contact = o;
            p.contactAngle = angleBack;
            if (ax0 > ax1) {
              if (centre > at[0]!) p.contactLeft = 1;
              else p.contactRight = 1;
            } else if (centre > at[0]!) p.contactRight = 1;
            else p.contactLeft = 1;
            p.contactIndex = k - 1;
            hit = true;
          }
        }
        k++;
        if (o.vertexCount < k) break;
        prevAngle = vp.angle[vi]!;
        vi = o.vertexCount === k ? 0 : vi + 1;
      }
    }
    j++;
    if (p.vertexCount < j) break;
    ax0 = ax1;
    ay0 = ay1;
    edgeAngle = ep.angle[j - 1]!;
    if (p.vertexCount === j) {
      ax1 = firstX;
      ay1 = firstY;
    } else {
      ax1 = (ep.x[j]! + st.x0) | 0;
      ay1 = (ep.y[j]! + st.y0) | 0;
    }
  }
  return hit;
}

/** 4352d1 : `b` est-il dans le seau `a` (17, 108) ? (chaîne +0xC4) */
export function inBucket(a: Part, b: Part): boolean {
  if (a.type !== 0x11 && a.type !== 0x6c) return false;
  for (let q = a.bucketNext; q; q = q.bucketNext) if (q === b) return true;
  return false;
}

/** 4371af : paires de types qui ne se heurtent pas (chat, souris, fromage ; Mel et sa maison). */
export function ignoresCollision(t1: number, t2: number): boolean {
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (lo === 0x0c && (hi === 0x2a || hi === 0x34)) return true;
  if (lo === 0x2a && (hi === 0x34 || hi === 0x2a)) return true;
  return lo === 0x36 && (hi === 0x36 || hi === 0x3a);
}

function testPair(world: World, st: CollisionState): boolean {
  let hit = false;
  boxOther(st);
  if (overlaps(st) && verticesIntoEdges(world, st, false)) {
    hit = true;
    st.motionAngle = motionAngle(st.cur!);
  }
  if (overlaps(st) && edgesIntoVertices(world, st, false)) {
    hit = true;
    st.motionAngle = motionAngle(st.cur!);
  }
  return hit;
}

/** 42bb02 : collisions d'une pièce qui vient de bouger, contre le contact précédent puis toutes les pièces. */
export function collide(world: World, part: Part): boolean {
  const st = world.collision;
  st.cur = part;
  if (!part.poly) return false;
  st.lastContact = part.contact;
  if (st.lastContact) {
    st.lastContactAngle = part.contactAngle;
    st.lastContactQuadrant = quadrant(st.lastContactAngle);
  }
  part.contactLeft = 0;
  part.contactRight = 0;
  st.motionAngle = motionAngle(part);
  sweepCurrent(st);
  if (st.dx === 0 && st.dy === 0) return false;
  let hit = false;
  const last = st.lastContact;
  if (last && !inBucket(part, last)) {
    st.other = last;
    if (last.poly && !(last.flags10 & F10.GONE) && !(last.flags14 & F14.SUSPENDED)) {
      if (testPair(world, st)) hit = true;
    }
  }
  for (const o of world.staticThenMobile()) {
    st.other = o;
    if (inBucket(part, o) || o === part || o === last || !o.poly) continue;
    if (o.flags10 & F10.GONE || o.flags14 & F14.SUSPENDED) continue;
    if (ignoresCollision(part.type, o.type)) continue;
    if (testPair(world, st)) hit = true;
  }
  if (!hit) part.contact = null;
  else if (continuesContact(st, part.contactAngle)) part.flags0C |= F0C.ROLLING;
  return hit;
}
