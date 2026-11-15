import type { OplSink } from "../../../src/audio/opl-stream";

/** Journal des écritures OPL : (tick, registre, valeur), le tick valant -1 avant le premier `beginTick`. */
export class LogSink implements OplSink {
  readonly writes: { tick: number; reg: number; value: number }[] = [];
  private tick = -1;

  beginTick(tick: number): void {
    this.tick = tick;
  }

  write(reg: number, value: number): void {
    this.writes.push({ tick: this.tick, reg, value });
  }

  /** FNV-1a 32 bits sur (tick i32 LE, registre u16 LE, valeur u8) : le même condensé que le banc C++ `a-harness`. */
  fnv(): string {
    let h = 2166136261;
    const byte = (b: number) => {
      h = Math.imul(h ^ (b & 0xff), 16777619) >>> 0;
    };
    for (const w of this.writes) {
      for (let i = 0; i < 4; i++) byte(w.tick >> (8 * i));
      byte(w.reg);
      byte(w.reg >> 8);
      byte(w.value);
    }
    return h.toString(16).padStart(8, "0");
  }
}
