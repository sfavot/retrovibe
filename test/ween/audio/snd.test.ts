import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoundBackend } from "../../../src/engine/coktel/audio/backend";
import { SoundEngine } from "../../../src/engine/coktel/audio/sound";
import { WebAudioSoundBackend } from "../../../src/engine/coktel/audio/web-audio";
import { parseSnd } from "../../../src/engine/coktel/data/snd";
import { FakeAudioContext } from "../../support/fake-audio-context";
import { hasOriginalFiles } from "../helpers";
import { weenSounds } from "./snd-data";

/** Échantillons de Ween (192, de 3 024 à 11 363 Hz dans les fichiers) : fréquence, durée et sortie, d'après `sound.cpp` / `sounddesc.cpp`. */
class Clock {
  time = 0;
  now = (): number => this.time;
  nextFrame = async (): Promise<void> => {
    this.time += 16;
  };
}

class Recorder implements SoundBackend {
  plays: { size: number; rate: number; passes: number }[] = [];
  playSample(pcm: Int8Array, rate: number, passes: number): void {
    this.plays.push({ size: pcm.length, rate, passes });
  }
  stopSample(): void {}
  queuePcm(): void {}
  clearQueue(): void {}
}

function engine() {
  const clock = new Clock();
  const backend = new Recorder();
  const sound = new SoundEngine({ backend, host: clock, source: { getFile: () => undefined, getResource: () => null } });
  return { clock, backend, sound };
}

describe.skipIf(!hasOriginalFiles)("SND de Ween dans le moteur de son", () => {
  const sounds = hasOriginalFiles ? weenSounds() : [];

  it("192 échantillons : fréquence relevée à 4 700 Hz comme ScummVM, durée = taille / fréquence", () => {
    expect(sounds).toHaveLength(192);
    let below = 0;
    let totalMs = 0;
    for (const [i, file] of sounds.entries()) {
      const raw = (file[4] << 8) | file[5];
      const snd = parseSnd(file);
      if (raw < 4700) below++;
      const { clock, backend, sound } = engine();
      expect(sound.setSample(0, "snd", file, i)).toBe(true);
      sound.play(0, 1, 0);
      expect(backend.plays, `#${i}`).toEqual([{ size: snd.data.length, rate: Math.max(raw, 4700), passes: 1 }]);
      const ms = (snd.data.length * 1000) / Math.max(raw, 4700);
      totalMs += ms;
      clock.time = ms - 2;
      expect(sound.isPlaying(), `#${i} avant la fin`).toBe(true);
      clock.time = ms + 2;
      expect(sound.isPlaying(), `#${i} après la fin`).toBe(false);
    }
    // Ceux dont la fréquence du fichier est sous 4 700 Hz jouent à 4 700 Hz (SoundDesc::loadSND, `MAX(freq, 4700)`)
    expect(below).toBe(EXPECTED.below);
    expect(Math.round(totalMs / 1000)).toBe(EXPECTED.seconds);
  });

  it("la fréquence demandée par le script (3e valeur de o1_playSound) remplace celle du fichier", () => {
    const { backend, sound } = engine();
    sound.setSample(0, "snd", sounds[0], 0);
    sound.play(0, 1, 11025);
    expect(backend.plays[0].rate).toBe(11025);
  });
});

/** Sortie navigateur : un tampon à la fréquence de l'échantillon, rééchantillonné par Web Audio (aucun rééchantillonnage dans le jeu). */
class SampleContext extends FakeAudioContext {
  audioWorklet = { addModule: () => new Promise<void>(() => {}) };
  constructor() {
    super();
    contexts.push(this);
  }
}
const contexts: SampleContext[] = [];

describe.skipIf(!hasOriginalFiles)("SND de Ween : sortie Web Audio", () => {
  beforeEach(() => {
    contexts.length = 0;
    vi.stubGlobal("AudioContext", SampleContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tampon créé à la fréquence (relevée) de chaque échantillon, durée conservée ; Web Audio rééchantillonne à la lecture", () => {
    const backend = new WebAudioSoundBackend();
    backend.unlock();
    const ctx = contexts[0];
    const rates = new Set<number>();
    for (const file of weenSounds()) {
      const snd = parseSnd(file);
      const pcm = new Int8Array(snd.data.buffer, snd.data.byteOffset, snd.data.length);
      backend.playSample(pcm, snd.frequency, 1);
      const buffer = ctx.sources.at(-1)!.buffer!;
      expect(buffer.sampleRate).toBe(snd.frequency);
      expect(buffer.length).toBe(snd.data.length);
      expect(buffer.duration).toBeCloseTo(snd.data.length / snd.frequency, 6);
      rates.add(snd.frequency);
    }
    // Toutes au-dessus du minimum de createBuffer (3 000 Hz) : aucune n'est relevée par MIN_BUFFER_RATE
    expect(Math.min(...rates)).toBe(4700);
    expect(Math.max(...rates)).toBe(11363);
  });
});

/** 18 fichiers sous 4 700 Hz (de 3 024 à 4 673 Hz) ; durée totale à la fréquence relevée. */
const EXPECTED = { below: 18, seconds: 156 };
