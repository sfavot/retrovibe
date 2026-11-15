/**
 * Lectures d'ANM partagées par les handlers du groupe `misc` (TIMWIN.EXE 44b2c0). Les autres lectures (44b314 =
 * `World.frameRect`, 44b19c = `TypeAnim.stateAt`) viennent du noyau.
 */
import type { World } from "../../world";

/**
 * 44b2c0(anim, n) : image (index dans la séquence) où commence l'état n ; n = −1 : nombre d'images (+0x0C) ; état
 * absent : `first` de l'entrée terminale (état 0), ou 0 ; type sans ANM : 0.
 */
export function stateFirst(world: World, type: number, n: number): number {
  const anim = world.types.anims[type];
  if (!anim) return 0;
  if (n === -1) return anim.count;
  for (const s of anim.anm.states) {
    if (s.state === 0) return s.first;
    if (s.state === n) return s.first;
  }
  return 0;
}
