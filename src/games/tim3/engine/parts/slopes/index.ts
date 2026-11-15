/**
 * Pentes (bois 2, herbe 99, rondins 100, granit 101, briques 102, briques jaunes 126) : quatre inclinaisons (image),
 * retournables en X ; elles partagent les polygones de la pente 2 (43c500). Traduit de TIMWIN.EXE 43c5c0.
 */
import { computeEdgeAngles } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";

/** 43c5c0 : polygone de l'inclinaison courante (copie miroir si retournée en X). */
function slopeReset(world: World, p: Part): void {
  const index = (p.flags10 & 0x10 ? 4 : 0) + p.frame;
  p.poly = world.types.get(p.type).polygons![index]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

export function register(r: HandlerRegistry): void {
  r.register(0x43c5c0, "slope.reset", (w, p) => slopeReset(w, p));
}
