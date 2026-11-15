/**
 * Moteur électrique (50) et aspirateur (51), alimentés par une prise (+0x24 posé par le groupe `electric`).
 * Traduit de TIMWIN.EXE 443e50 (slot 1), 443ede (slot 2), 443f5b (slot 3) pour le moteur ; 443f98 (slot 0), 443ffc
 * (slot 2), 444029 (slot 1), 44423f (slot 3), 444270, 4442d8 pour l'aspirateur. Pièces propres à TIM3.
 */
import { mul16 } from "../../fixed";
import { clampVelocity } from "../../gravity";
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { TypeTable } from "../../types";
import type { World } from "../../world";
import { chain, imageScan } from "../../zone";
import type { HandlerRegistry } from "../registry";
import { otherBeltEnd } from "./belt";
import { flipEdit, setPoly, stateAt } from "./common";

/** 0x481ebc : premier début d'état après l'image 2 de l'ANM du moteur (boucle de rotation). */
const loopCache = new WeakMap<TypeTable, number>();
function motorLoop(types: TypeTable): number {
  let n = loopCache.get(types);
  if (n !== undefined) return n;
  const anim = types.anims[50];
  n = 2;
  do n = (n + 1) | 0;
  while (n !== 0 && (anim ? anim.stateAt(n) : -1) === 0);
  loopCache.set(types, n);
  return n;
}

/** 443ede (slot 2) : polygone et poulie (0x38 ou 9, 0x1d, rayon 8) selon le retournement. */
function motorReset(world: World, p: Part): void {
  motorLoop(world.types);
  const flip = (p.flags10 & 0x10) !== 0;
  setPoly(world, p, flip ? 1 : 0);
  p.f88 = flip ? 0x38 : 9;
  p.f89 = 0x1d;
  p.f8C = 8;
}

/** 443e50 (slot 1) : la courroie reçoit ±2 tant que le moteur est alimenté ; animation. */
function motorRun(world: World, p: Part): void {
  const q = otherBeltEnd(p);
  if (q && !(q.flags10 & 0x800)) q.f24 = p.f24 === 0 ? 0 : p.flags10 & 0x10 ? -2 : 2;
  if (p.f24 !== 0) {
    p.frame++;
    if (stateAt(world, 50, p.frame) === -1) {
      if (world.animFlags & 1) p.frame = motorLoop(world.types);
      else p.frame -= 2;
    }
  } else p.frame = 0;
  if (p.frame !== p.framePrev) updateGeometry(world, p);
}

/** 4442d8 : l'aspirateur avale une pièce (ballon : crevé ; autres : disparaissent). */
function swallow(b: Part): void {
  if (b.type === 4) b.f24 = 1;
  else b.flags10 |= 0x2000;
}

/** 443f98 (slot 0) : en marche, une pièce qui touche la bouche (côté 5, ou angle 0x8000) est avalée. */
function vacuumAccept(world: World, c: Part): number {
  const v = c.contact!;
  let side = c.contactIndex;
  if (v.flags10 & 0x10) {
    const n = world.types.get(0x33).vertexCount;
    side = (n - side - 2) | 0;
    if (side < 0) side = (side + n) | 0;
  }
  if (v.f24 !== 0 && (side === 5 || (c.contactAngle & 0xffff) === 0x8000)) {
    swallow(c);
    return 0;
  }
  return 1;
}

/** 444270 : aspiration selon la masse. */
function suction(b: Part): number {
  const m = b.mass;
  if (m < 2) return 0xc00;
  if (m < 6) return 0xa00;
  if (m < 10) return 0x800;
  if (m < 0x15) return 0x600;
  if (m < 0x79) return 0x400;
  if (m < 0x97) return 0x200;
  if (m < 0xc9) return 0x100;
  return 0x80;
}

/** 444029 (slot 1) : en marche, aspire vers la bouche les mobiles au-dessus (434cc4, 64 px) et avale les plus proches. */
function vacuumRun(world: World, v: Part): void {
  if (v.f24 === 0) v.frame = 0;
  else {
    if (!(world.animFlags & 1)) v.frame = v.frame === 2 ? 1 : 2;
    else {
      v.frame++;
      if (stateAt(world, 0x33, v.frame) === -1) v.frame = 1;
    }
    imageScan(world, v, 0x1000, 0, 0, 0, 0x40);
    const mouth = ((v.flags10 & 0x10 ? 0x2c : 0x10) + v.px) | 0;
    let pull = 0;
    for (const b of chain(v)) {
      const bx = ((b.frameW >> 1) + b.px) | 0;
      if (((v.py + 0x1f) | 0) < b.py) {
        b.flags0C &= ~1;
        if (bx >= mouth - 0x10 && bx <= mouth + 0x10 && ((v.py + 0x21) | 0) > b.py) swallow(b);
        if (b.vy > -0x400) {
          pull = mul16(suction(b), 0x50 - Math.abs(b.fCC)) >> 6;
          b.vy = (b.vy - pull) | 0;
          clampVelocity(b, world.types);
          if (b.vy < -0x400) b.vy = -0x400;
        }
        if (b.py !== b.prevPy) {
          if (b.type === 0x36 && b.frame < 6) {
            b.frame = 6;
            updateGeometry(world, b);
          }
          const h = pull >> 1;
          if (bx < mouth - 4) {
            if (b.vx < 0x200) {
              b.vx = (b.vx + h) | 0;
              if (b.vx > 0x200) b.vx = 0x200;
            }
          } else if (bx > mouth + 4) {
            if (b.vx > -0x200) {
              b.vx = (b.vx - h) | 0;
              if (b.vx < -0x200) b.vx = -0x200;
            }
          } else if (b.vx > 0) {
            b.vx = (b.vx - h) | 0;
            if (b.vx < 0) b.vx = 0;
          } else {
            b.vx = (b.vx + h) | 0;
            if (b.vx > 0) b.vx = 0;
          }
        }
      }
      if (b.type === 0x2d) b.f104 = b.f24 = b.frame = 0;
    }
  }
  if (v.frame !== v.framePrev) updateGeometry(world, v);
}

const vacuumReset = (world: World, p: Part) => setPoly(world, p, p.flags10 & 0x10 ? 1 : 0);

export function register(r: HandlerRegistry): void {
  r.register(0x443ede, "electricMotor.reset", (w, p) => motorReset(w, p));
  r.register(0x443e50, "electricMotor.run", (w, p) => motorRun(w, p));
  r.register(0x443f5b, "electricMotor.edit", (w, p, a) => flipEdit(w, p, typeof a === "number" ? a : 0, motorReset));
  r.register(0x443f98, "vacuum.accept", (w, _p, a) => vacuumAccept(w, a as Part));
  r.register(0x443ffc, "vacuum.reset", (w, p) => vacuumReset(w, p));
  r.register(0x444029, "vacuum.run", (w, p) => vacuumRun(w, p));
  r.register(0x44423f, "vacuum.edit", (w, p, a) => flipEdit(w, p, typeof a === "number" ? a : 0, vacuumReset));
}
