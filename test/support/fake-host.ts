import type { HostStorage } from "../../src/engine/storage";
import { MemoryStorage } from "../../src/engine/storage";

/** Stockage en mémoire des hôtes de test (alias de `MemoryStorage`). */
export class FakeStorage extends MemoryStorage implements HostStorage {}

/** Horloge manuelle : le test avance `time` (ms), l'hôte la lit via `now()`. */
export class ManualClock {
  constructor(public time = 0) {}

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}
