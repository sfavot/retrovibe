import type { SamplePlayer } from "../../../src/audio/sample-channel";
import type { PlayOptions, Sample, SampleVoice } from "../../../src/audio/web-sample-output";
import { MUSIC_LIST } from "../../../src/games/bass/data/tables/sfx-list";

export interface TestSound {
  rate: number;
  size: number;
  /** Octets de fin rejoués en boucle. */
  loop?: number;
}

const SIGNATURE_AT = 0x7e;
const RATE_TABLE = 0x100;
const BASE = 0x200;
/** Chaque son dispose de 256 octets de PCM (16 unités de 16 octets). */
const SLOT_UNITS = 16;

/** Fichier d'effets synthétique au format du pilote d'origine (`SfxFile`) : les octets de PCM d'un son valent `n + 1 + rang` (modulo 256). */
export function buildSfxFile(sounds: readonly TestSound[]): Uint8Array {
  const out = new Uint8Array(BASE + (1 + sounds.length * SLOT_UNITS) * 16 + 256);
  const view = new DataView(out.buffer);
  const a = SIGNATURE_AT;
  out[a] = 0x3c;
  out[a + 1] = sounds.length;
  out[a + 0x27] = 0x8d;
  out[a + 0x28] = 0x1e;
  out[a + 0x2f] = 0x8d;
  out[a + 0x30] = 0x36;
  view.setUint16(a + 0x29, RATE_TABLE, true);
  view.setUint16(a + 0x31, BASE, true);
  sounds.forEach((sound, n) => {
    if (sound.size > SLOT_UNITS * 16) throw new Error("son de test trop long");
    view.setUint16(RATE_TABLE + n * 4, sound.rate, false);
    const unit = 1 + n * SLOT_UNITS;
    view.setUint16(BASE + n * 8, unit, false);
    view.setUint16(BASE + n * 8 + 2, sound.size, false);
    view.setUint16(BASE + n * 8 + 6, sound.loop ?? 0, false);
    for (let i = 0; i < sound.size; i++) out[BASE + unit * 16 + i] = (n + 1 + i) & 0xff;
  });
  return out;
}

/** 40 sons de 100 octets à 8 kHz (assez pour toutes les entrées de `SFX_DEFS`), avec des surcharges par rang. */
export function standardSounds(overrides: Record<number, TestSound> = {}): TestSound[] {
  return Array.from({ length: 40 }, (_, n) => overrides[n] ?? { rate: 8000, size: 100 });
}

/** Numéro d'effet (`256 + i`) du premier `musicList` qui pointe vers la définition `defIndex` de `SFX_DEFS`. */
export function effectOfDef(defIndex: number): number {
  const i = MUSIC_LIST.indexOf(defIndex);
  if (i < 0) throw new Error(`définition ${defIndex} sans effet`);
  return 256 + i;
}

export interface Played {
  sample: Sample;
  options: PlayOptions | undefined;
  stopped: boolean;
  end: number;
}

/** Sortie factice : horloge manuelle, voix qui durent leur durée (ou pour toujours en boucle), liste des lectures. */
export class FakeOutput implements SamplePlayer {
  clock = 0;
  readonly played: Played[] = [];

  clockNow(): number {
    return this.clock;
  }

  advance(ms: number): void {
    this.clock += ms;
  }

  play(sample: Sample, options?: PlayOptions): SampleVoice {
    const looped = options?.loopStart !== undefined || options?.loop === true;
    const state: Played = { sample, options, stopped: false, end: this.clock + (sample.data.length / sample.rate) * 1000 };
    this.played.push(state);
    const output = this;
    return {
      get playing() {
        return !state.stopped && (looped || output.clock < state.end);
      },
      duration: sample.data.length / sample.rate,
      stop: () => {
        state.stopped = true;
      },
    };
  }

  /** Lectures qui jouent encore. */
  get live(): Played[] {
    return this.played.filter((p) => !p.stopped && (p.options?.loopStart !== undefined || this.clock < p.end));
  }
}
