/**
 * Séquences différées (`SequenceDelayList`) : une séquence de `0x3F0C` exécutée après un délai en secondes, décompté de 80 ms à chaque
 * image ; au plus une séquence échue par image.
 *
 * Source (ScummVM, GPL v3+) : `SequenceDelayData`, `SequenceDelayList::add`, `tick`, `clear` (engines/lure/res_struct.cpp).
 *
 * Écarts : aucun (l'ajout se fait en tête, le parcours de `tick` part de la tête et s'arrête à la première séquence échue, comme
 * ScummVM).
 */

import { TICK_MS, delaySecondsToMs } from "./cadence";
import type { LureContext } from "./context";

export class DelayList {
  constructor(private readonly ctx: LureContext) {}

  private get list() {
    return this.ctx.world.state.delayList;
  }

  /** `add(delay, seqOffset, canClear)` : `delay` en secondes. */
  add(delay: number, sequenceOffset: number, canClear: boolean): void {
    this.list.unshift({ timeoutCtr: delaySecondsToMs(delay), sequenceOffset, canClear });
  }

  /** `tick()` : décompte une image ; la première séquence échue est retirée puis exécutée. */
  tick(): void {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]!;
      if (entry.timeoutCtr <= TICK_MS) {
        list.splice(i, 1);
        this.ctx.script.execute(entry.sequenceOffset);
        return;
      }
      entry.timeoutCtr -= TICK_MS;
    }
  }

  /** `clear(forceClear)` : retire les séquences effaçables (toutes avec `forceClear`). */
  clear(forceClear = false): void {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.canClear || forceClear) list.splice(i, 1);
  }
}
