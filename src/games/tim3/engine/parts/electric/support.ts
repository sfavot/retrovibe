/**
 * Fonctions communes à la famille « electric » : lecture des animations (44b2c0), choix du polygone d'un type et
 * propagation du signal d'une pièce aux pièces qu'elle alimente (liens +0xA0 / +0xA4).
 * Traduit de TIMWIN.EXE ; l'affichage (43050d, 43087b, 439695 : zones à redessiner) n'a aucun effet sur la simulation.
 */
import { computeEdgeAngles } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";

/** Types dont le descripteur est cité par adresse dans les handlers (table 0x4733a0 + 4 × type). */
export const T = {
  pulse: 20,
  switch: 21,
  remote: 22,
  flashlight: 25,
  superPhazer: 27,
  lavaLamp: 29,
  magnifier: 30,
  solar: 38,
  laserRed: 91,
  laserGreen: 92,
  laserBlue: 93,
  mirror: 94,
  mixer: 95,
  laserOutlet: 96,
  outlet: 120,
  computer: 136,
  timer: 137,
  detector: 148,
} as const;

/**
 * 44b2c0(anim, n) : première image de l'état n (celle de la fin de la liste si n n'existe pas), n = −1 : nombre
 * d'images ; 0 si l'animation n'a pas d'états. `type` : type dont l'animation est lue.
 */
export function stateFirst(world: World, type: number, n: number): number {
  const anim = world.types.anims[type];
  if (n === -1) return anim ? anim.count : 0;
  if (!anim || anim.anm.states.length === 0) return 0;
  for (const s of anim.anm.states) if (s.state === 0 || s.state === n) return s.first;
  return 0;
}

/** 44b19c(anim du type, i). */
export function stateAt(world: World, type: number, i: number): number {
  return world.types.anims[type]?.stateAt(i) ?? -1;
}

/** Polygone n° `index` du descripteur de `type` pour la pièce, puis angles de ses côtés (439e38). */
export function setPolygon(world: World, p: Part, type: number, index: number): void {
  p.poly = world.types.get(type).polygons![index]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** Le bit « retournée en X » (+0x10 & 0x10) donne l'indice de polygone 1, sinon 0 (même motif dans presque tous les slots 2). */
export const flipIndex = (p: Part): number => (p.flags10 & 0x10 ? 1 : 0);

/** Boucle `for (i = 4; i < 6; i++)` des slots 1 : la pièce liée en +0x90 + 4i reçoit la valeur donnée. */
export function feedLinks(p: Part, value: number): void {
  for (let i = 4; i < 6; i++) {
    const l = p.links[i];
    if (l) l.f24 = value;
  }
}

/** Image d'une pièce qui reçoit un signal : bit 0 si +0xA0 est lié, bit 1 si +0xA4 l'est (448218, 440c8b, 4412a6…). */
export function linkBits(p: Part): number {
  return (p.links[4] ? 1 : 0) | (p.links[5] ? 2 : 0);
}
