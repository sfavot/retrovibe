/**
 * Taquet (23) : point d'attache de corde, avec une petite animation au repos. Traduit de TIMWIN.EXE 440e94 (slot 2),
 * 440eb9 (slot 1), 440f2e (slot 3). Pièce propre à TIM3.
 */
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { stateAt } from "./common";

/** 440e94 (slot 2) : point d'attache (0x0e, 7 ou 8 si retourné en Y). */
function cleatReset(_w: World, p: Part): void {
  p.ropeAnchor[0] = 0x0e;
  p.ropeAnchor[1] = p.flags10 & 0x20 ? 8 : 7;
}

/** 440eb9 (slot 1) : animations décoratives (0x481034 & 1) : au repos, un délai aléatoire (20 … 119 pas) relance l'animation. */
function cleatRun(world: World, p: Part): void {
  if (!(world.animFlags & 1)) return;
  if (p.frame === 0) {
    // 0x477fb4 : délai avant l'animation suivante.
    world.cleatTimer = (world.cleatTimer - 1) | 0;
    if (world.cleatTimer >= 0) return;
    world.cleatTimer = (world.rng.next() % 100) + 0x14;
    p.frame = 1;
    updateGeometry(world, p);
    return;
  }
  p.frame++;
  if (stateAt(world, 23, p.frame) === -1) p.frame = 0;
  updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  r.register(0x440e94, "cleat.reset", (w, p) => cleatReset(w, p));
  r.register(0x440eb9, "cleat.run", (w, p) => cleatRun(w, p));
  r.register(0x440f2e, "cleat.edit", (w, p, a) => {
    if (a) p.flags10 ^= 0x20;
    cleatReset(w, p);
    w.redraw(p, 2);
  });
}
