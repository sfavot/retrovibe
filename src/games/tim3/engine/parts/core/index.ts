/**
 * Handlers par défaut communs à la plupart des types (TIMWIN.EXE 434bf0 … 434cbd, 42deab, 42dcec).
 * Correspondance OpenTIM : les `default_*` de `src/parts/mod.rs`.
 */
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";

/** 434bff : polygone du type (première forme), angles de ses côtés. */
export function defaultReset(world: World, p: Part): void {
  const polys = world.types.get(p.type).polygons;
  if (!polys) return;
  p.poly = polys[0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** 434c33 : action d'édition (1 retourner en X, 2 en Y, 15 tourner d'un quart), puis slot 2 et géométrie. */
export function defaultEdit(world: World, p: Part, action: number): void {
  if (action === 1) p.flags10 ^= 0x10;
  else if (action === 2) p.flags10 ^= 0x20;
  else if (action === 15) {
    if (p.flags10 & 0x10) p.flags10 ^= p.flags10 & 0x20 ? 0x10 : 0x20;
    else p.flags10 ^= p.flags10 & 0x20 ? 0x20 : 0x10;
  }
  world.call(2, p);
  updateGeometry(world, p);
  // 43050d, 43087b, 439695 : zones à redessiner (affichage).
}

export function register(r: HandlerRegistry): void {
  r.register(0x434bf0, "default.accept", () => 1);
  r.register(0x434bfa, "default.run", () => undefined);
  r.register(0x434bff, "default.reset", (w, p) => defaultReset(w, p));
  r.register(0x434c33, "default.edit", (w, p, a) => defaultEdit(w, p, typeof a === "number" ? a : 0));
  r.register(0x434cb8, "default.secondary", () => undefined);
  r.register(0x434cbd, "default.collision", () => 0);
  // Slot 6 : dessin (vague R), jamais appelé par la simulation.
  r.register(0x42deab, "default.draw", () => undefined);
  r.register(0x42dcec, "wall.draw", () => undefined);
}
