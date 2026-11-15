/**
 * Cafetière (62) : chauffée (+0x24), elle bout (+0x104 monte jusqu'à 40), puis souffle sa vapeur sur les pièces devant le
 * bec. Traduit de TIMWIN.EXE 445294 (slot 2), 44530b (slot 3), 445343 (slot 1), 445540. Pièce propre à TIM3 (pas dans
 * OpenTIM).
 */
import { clampVelocity } from "../../gravity";
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import { chain, boxScan } from "../../zone";
import type { HandlerRegistry } from "../registry";
import { flipEdit, setPoly, stateFirst } from "./common";

/** 445294 : polygone selon le retournement en X. */
function coffeeReset(world: World, p: Part): void {
  setPoly(world, p, p.flags10 & 0x10 ? 1 : 0);
}

/** 445540 : poussée de la vapeur selon la masse de la pièce. */
const steamPush = (b: Part) => (b.mass < 0x97 ? 0x600 : 0x400);

/** 445343 (slot 1, avant la gravité dans 433334) : ébullition, animation, vapeur. */
function coffeeRun(world: World, p: Part): void {
  const boil = stateFirst(world, 0x3e, 3);
  const steam = stateFirst(world, 0x3e, 4);
  const end = stateFirst(world, 0x3e, -1);
  if (p.f24 !== 0) {
    if (p.f104 < 0x28 && p.frame < steam) {
      p.f104 = (p.f104 + 2) | 0;
      p.frame++;
      if (p.frame === steam) p.frame = boil;
    } else {
      p.f104 = 0x28;
      if (p.frame < steam) p.frame = steam - 1;
    }
    if (p.f104 === 0x28) {
      p.frame++;
      if (p.frame === end) {
        if (world.animFlags & 1) p.frame = steam;
        else p.frame -= 2;
      }
      updateGeometry(world, p);
    }
    p.f24 = 0;
  } else {
    if (p.f104 !== 0) p.f104--;
    if (p.f104 === 0) p.frame = 0;
    if (p.frame < steam) {
      if (p.f104 !== 0) {
        p.frame++;
        if (p.frame === steam) p.frame = boil;
      }
    } else if (p.f104 !== 0) {
      p.frame++;
      if (p.frame === end) p.frame = steam;
    }
    updateGeometry(world, p);
  }
  if (p.frame < steam) return;
  const left = (p.flags10 & 0x10) !== 0;
  if (left) {
    if (p.vx > -0x100) p.vx = (p.vx - 0x20) | 0;
    boxScan(world, p, 0x3000, 0x1e, 0x4b, -0x23, 0);
  } else {
    if (p.vx < 0x100) p.vx = (p.vx + 0x20) | 0;
    boxScan(world, p, 0x3000, -0x2d, 0, -0x23, 0);
  }
  for (const b of chain(p)) {
    if (b.flags0C & 0x1000) {
      const a = steamPush(b);
      if (left) {
        if (b.vx < 0x600) b.vx = (b.vx + a) | 0;
      } else if (b.vx > -0x600) b.vx = (b.vx - a) | 0;
      if (b.vy > -0x600) b.vy = (b.vy - a) | 0;
      clampVelocity(b, world.types);
      if (b.type === 0x2d || b.type === 0x4e || b.type === 0x8a) b.f104 = b.f24 = b.frame = 0;
    } else if (b.type === 0x28) {
      b.f24 = 1;
      b.f104 = 0x14;
    } else if (b.type === 6) world.special(0x43f907, b);
  }
}

export function register(r: HandlerRegistry): void {
  r.register(0x445294, "coffee.reset", (w, p) => coffeeReset(w, p));
  r.register(0x44530b, "coffee.edit", (w, p, a) =>
    flipEdit(w, p, typeof a === "number" ? a : 0, coffeeReset, () => updateGeometry(w, p)),
  );
  r.register(0x445343, "coffee.run", (w, p) => coffeeRun(w, p));
}
