/**
 * Générateur (26) : entraîné par une courroie, il alimente les prises (+0xA0, +0xA4) en leur passant son sens (+0x24).
 * Traduit de TIMWIN.EXE 441208 (slot 0), 441212 (slot 2), 4412a6 (slot 1). Pièce propre à TIM3 (pas dans OpenTIM).
 */
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { TypeTable } from "../../types";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { otherBeltEnd } from "./belt";
import { setPoly } from "./common";

/** 0x481e04 … : débuts des boucles d'animation selon les prises branchées (débuts d'états après l'image 3, 44b19c). */
const loopsCache = new WeakMap<TypeTable, number[]>();
function loops(types: TypeTable): number[] {
  let l = loopsCache.get(types);
  if (l) return l;
  const anim = types.anims[26];
  const starts = (i: number) => (anim ? anim.stateAt(i) : -1) !== 0;
  l = [];
  let n = 3;
  for (let i = 0; i < 5; i++) {
    do n = (n + 1) | 0;
    while (n !== 0 && !starts(n));
    l.push(n);
  }
  loopsCache.set(types, l);
  return l;
}

const plugs = (p: Part) => (p.links[4] ? 1 : 0) | (p.links[5] ? 2 : 0);

/** 441212 (slot 2) : poulie (0x49, 0x0e, rayon 8), polygone, image = prises branchées. */
function generatorReset(world: World, p: Part): void {
  loops(world.types);
  p.f88 = 0x49;
  p.f89 = 0x0e;
  p.f8C = 8;
  setPoly(world, p, 0);
  p.frame = plugs(p);
}

/** 4412a6 (slot 1) : tourne tant que l'engrenage qui l'entraîne tourne ; les prises reçoivent son sens. */
function generatorRun(world: World, p: Part): void {
  if (p.f24 !== 0) {
    const q = otherBeltEnd(p);
    if (q && (q.type === 0x0e || q.type === 0x56) && q.framePrev === q.framePrev2) p.f24 = 0;
  }
  if (p.f24 !== 0) {
    const l = loops(world.types);
    const e = plugs(p);
    if (p.frame < 4) p.frame = l[e]!;
    if (p.f24 > 0) {
      p.frame++;
      if (l[e + 1] === p.frame) p.frame = l[e]!;
    } else if (l[e] === p.frame) p.frame = l[e + 1]! - 1;
    else p.frame--;
    if (!(world.animFlags & 1)) {
      if (l[e]! + 2 === p.frame) p.frame = l[e]!;
      else if (l[e]! + 2 < p.frame) p.frame = l[e]! + 1;
    }
    updateGeometry(world, p);
  }
  for (let i = 4; i < 6; i++) {
    const q = p.links[i];
    if (q) q.f24 = p.f24;
  }
}

export function register(r: HandlerRegistry): void {
  r.register(0x441208, "generator.accept", () => 1);
  r.register(0x441212, "generator.reset", (w, p) => generatorReset(w, p));
  r.register(0x4412a6, "generator.run", (w, p) => generatorRun(w, p));
}
