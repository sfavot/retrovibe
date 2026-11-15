/** Outils partagés par les handlers de la famille `mechanics`. */
import { computeEdgeAngles } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";

/** 44b2c0(anim du type, n) ; 0 sans ANM. */
export function stateFirst(world: World, type: number, n: number): number {
  return world.types.anims[type]?.stateFirst(n) ?? 0;
}

/** 44b19c(anim du type, i) ; −1 sans ANM. */
export function stateAt(world: World, type: number, i: number): number {
  return world.types.anims[type]?.stateAt(i) ?? -1;
}

/** Polygone n° `i` du type, angles des côtés (… 439e38), comme la fin de la plupart des slots 2. */
export function setPoly(world: World, p: Part, i: number): void {
  p.poly = world.types.get(p.type).polygons![i]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** Slot 3 typique (édition) : tout code non nul retourne la pièce en X, puis slot 2, géométrie, 439695(p, 2). */
export function flipEdit(world: World, p: Part, action: number, reset: (w: World, p: Part) => void, after?: () => void): void {
  if (action !== 0) p.flags10 ^= 0x10;
  reset(world, p);
  after?.();
  world.redraw(p, 2);
}
