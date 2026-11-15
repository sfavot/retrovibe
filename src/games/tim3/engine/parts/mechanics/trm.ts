/**
 * Trans-Roto-Matic (89 : traction de corde → rotation) et convertisseur Roto-Trans (90 : rotation → corde), mixeur (107).
 * Traduit de TIMWIN.EXE 446dfc (slot 0), 446e49 (slot 2), 446ed4 (slot 3), 446f10 (slot 5), 446f52 (slot 1) pour 89 ;
 * 447108, 44718a, 4471d1, 4472d2 pour 90 ; 447608 pour 107. Pièces propres à TIM3.
 */
import { clampVelocity } from "../../gravity";
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import { boxScan, chain } from "../../zone";
import type { HandlerRegistry } from "../registry";
import { otherBeltEnd } from "./belt";
import { setPoly, stateAt } from "./common";
import { otherEnd, ropeFlags } from "./rope";

/** 0x4782f0 / 0x4782f9 : x du point d'attache de la corde du 89 par image (droit / retourné, octets signés). */
const TRM_ROPE_X = [80, 80, 84, 88, 92, 96, 92, 88, 84] as const;
const TRM_ROPE_X_FLIP = [2, 2, -2, -6, -10, -14, -10, -6, -2] as const;
/** 0x4782e8 / 0x4782f4 (indexées par l'image 7 … 9) : bord de la zone poussée par le piston. */
const TRM_PUSH_X0: Record<number, number> = { 7: 8, 8: 4, 9: 0 };
const TRM_PUSH_X1: Record<number, number> = { 7: 75, 8: 79, 9: 83 };
/** 0x47831c / 0x478325 : y du point d'attache de la corde du 90 par image (droit / retourné en Y). */
const RT_ROPE_Y = [3, 3, 6, 10, 11, 10, 6, 3, -1] as const;
const RT_ROPE_Y_FLIP = [66, 66, 63, 56, 55, 56, 60, 63, 67] as const;

function flippedSide(world: World, c: Part, owner: Part): number {
  let s = c.contactIndex;
  if (owner.flags10 & 0x10) {
    const n = world.types.get(owner.type).vertexCount;
    s = (n - s - 2) | 0;
    if (s < 0) s = (s + n) | 0;
  }
  return s;
}

/** 446e49 (slot 2) : polygone (retournement, image > 3), attache de corde et poulie. */
function trmReset(world: World, p: Part): void {
  const flip = (p.flags10 & 0x10) !== 0;
  setPoly(world, p, (flip ? 2 : 0) + (p.frame > 3 ? 1 : 0));
  p.ropeAnchor[0] = flip ? TRM_ROPE_X_FLIP[p.frame]! : TRM_ROPE_X[p.frame]!;
  p.f88 = flip ? 0x25 : 0x2d;
  p.ropeAnchor[1] = 0x0c;
  p.f89 = 0x1f;
  p.f8C = 7;
  updateGeometry(world, p);
}

/** 446dfc (slot 0) : au repos, une pièce qui tombe sur le plateau (côté 0) le déclenche. */
function trmAccept(world: World, c: Part): number {
  const t = c.contact!;
  if (t.frame === 0 && flippedSide(world, c, t) === 0) t.f24 = 1;
  return 1;
}

/** 446f10 (slot 5) : mode 1 : comptage ; sinon une traction dans le bon sens (drapeaux 8 / 0x10) le déclenche. */
function trmPull(t: Part, flags: number): number {
  if (flags === 1) {
    const r = t.ropes[0];
    if (r) r.n18 = (r.n18 + 1) | 0;
    return 0;
  }
  const m = flags & 0x18;
  if (t.flags10 & 0x10 ? m === 8 : m === 0x10) t.f24 = 1;
  return 0;
}

/** 446f52 (slot 1) : course du piston : pousse les mobiles (images 7 … 9), entraîne la courroie, tire la corde. */
function trmRun(world: World, t: Part): void {
  if (t.f24 === 0 && t.frame === 0) return;
  t.frame++;
  const flip = (t.flags10 & 0x10) !== 0;
  if (t.frame > 6) {
    let force: number;
    if (flip) {
      boxScan(world, t, 0x1000, 0x40, TRM_PUSH_X1[t.frame] ?? 0, 7, 0x12);
      force = 0x1000;
    } else {
      boxScan(world, t, 0x1000, TRM_PUSH_X0[t.frame] ?? 0, 0x14, 7, 0x12);
      force = -0x1000;
    }
    for (const b of chain(t)) {
      if (b.flags0C & 0x1000) {
        b.vx = (b.vx + force) | 0;
        clampVelocity(b, world.types);
        if (b.type === 0x36) b.fFC = 1;
      } else if (b.type === 6) world.special(0x43f907, b);
      else if (b.type === 0x0f) world.special(0x440454, b);
      else if (b.type === 0x4e) b.f24 = 1;
    }
  }
  if (t.frame >= 9) {
    t.fFC = t.f24 = t.frame = 0;
    trmReset(world, t);
    return;
  }
  trmReset(world, t);
  const q = otherBeltEnd(t);
  if (q) {
    if (t.frame < 2 || t.frame > 7) q.f24 = 0;
    else if (!(q.flags10 & 0x800)) q.f24 = flip ? -2 : 2;
  }
  const rope = t.ropes[0];
  if (!rope) return;
  const first = t === rope.end1;
  const slot = first ? rope.slot2 : rope.slot1;
  const force = t.momentum > 0 ? t.momentum : -t.momentum | 0;
  const flags = ropeFlags(rope, first ? 0 : 1, -1);
  world.pull(t, otherEnd(t, rope)!, flags, 0, force, slot);
}

/** 447108 (slot 2) : polygone (retourné en Y), attache de corde selon l'image, poulie. */
function rtReset(world: World, p: Part): void {
  const flip = (p.flags10 & 0x20) !== 0;
  setPoly(world, p, flip ? 1 : 0);
  p.ropeAnchor[1] = flip ? RT_ROPE_Y_FLIP[p.frame]! : RT_ROPE_Y[p.frame]!;
  p.f89 = flip ? 0x0c : 0x39;
  p.ropeAnchor[0] = 0x0b;
  p.f88 = 0x0a;
  p.f8C = 7;
  updateGeometry(world, p);
}

/** 4471d1 (slot 1) : entraîné (+0x24), il fait un tour (9 images) et tire sa corde en montant ou en descendant. */
function rtRun(world: World, b: Part): void {
  if (b.f24 === 0) return;
  const old = b.frame;
  const flip = (b.flags10 & 0x20) !== 0;
  if (flip === b.f24 > 0) b.frame--;
  else b.frame++;
  if (b.frame === 9 || b.frame === 0) {
    b.f24 = 0;
    b.frame = 0;
    rtReset(world, b);
    return;
  }
  if (b.frame < 0) b.frame += 9;
  const tbl = flip ? RT_ROPE_Y_FLIP : RT_ROPE_Y;
  const down = tbl[b.frame]! > tbl[old]! ? 1 : 0;
  const rope = b.ropes[0];
  if (rope) {
    const first = b === rope.end1;
    const slot = first ? rope.slot2 : rope.slot1;
    world.pull(b, otherEnd(b, rope)!, ropeFlags(rope, first ? 0 : 1, down), 0, 0x88b8000, slot);
  }
  rtReset(world, b);
}

/** 447608 (slot 1 du mixeur) : alimenté, il tourne. */
function mixerRun(world: World, p: Part): void {
  if (p.f24 === 0) return;
  p.frame++;
  if (stateAt(world, 0x6b, p.frame) === -1) {
    if (world.animFlags & 1) p.frame = 0;
    else p.frame -= 2;
  }
  updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  r.register(0x446dfc, "trm.accept", (w, _p, a) => trmAccept(w, a as Part));
  r.register(0x446e49, "trm.reset", (w, p) => trmReset(w, p));
  r.register(0x446ed4, "trm.edit", (w, p, a) => {
    if (a) p.flags10 ^= 0x10;
    trmReset(w, p);
    w.redraw(p, 2);
  });
  r.register(0x446f10, "trm.pull", (_w, p, _a, _slot = 0, flags = 0) => trmPull(p, flags));
  r.register(0x446f52, "trm.run", (w, p) => trmRun(w, p));
  r.register(0x447108, "rotoTrans.reset", (w, p) => rtReset(w, p));
  r.register(0x44718a, "rotoTrans.edit", (w, p, a) => {
    if (a) p.flags10 ^= 0x20;
    rtReset(w, p);
    w.redraw(p, 2);
  });
  r.register(0x4471d1, "rotoTrans.run", (w, p) => rtRun(w, p));
  r.register(0x4472d2, "rotoTrans.pull", (_w, p, _a, _slot = 0, flags = 0) => {
    if (flags === 1 && p.ropes[0]) p.ropes[0].n18 = (p.ropes[0].n18 + 1) | 0;
    return 0;
  });
  r.register(0x447608, "mixer.run", (w, p) => mixerRun(w, p));
}
