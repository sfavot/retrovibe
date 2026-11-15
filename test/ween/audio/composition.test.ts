import { describe, expect, it } from "vitest";
import type { SoundBackend } from "../../../src/engine/coktel/audio/backend";
import { SoundEngine } from "../../../src/engine/coktel/audio/sound";

/**
 * Compositions de sons (`o1_playComposition`, `Sound::blasterPlayComposition`, `nextCompositionPos`) et `o1_waitEndPlay` :
 * échantillons synthétiques de 1 s, 0,5 s et 2 s à 8 000 Hz (taille = durée × fréquence), donc indépendants du jeu.
 */
class Clock {
  time = 0;
  now = (): number => this.time;
  nextFrame = async (): Promise<void> => {
    this.time += 16;
  };
}

function snd(size: number, frequency = 8000): Uint8Array {
  const out = new Uint8Array(6 + size);
  new DataView(out.buffer).setUint32(0, size, false);
  new DataView(out.buffer).setUint16(4, frequency, false);
  return out;
}

function setup() {
  const clock = new Clock();
  const plays: { at: number; size: number }[] = [];
  const backend: SoundBackend = {
    playSample: (pcm) => void plays.push({ at: clock.time, size: pcm.length }),
    stopSample() {},
    queuePcm() {},
    clearQueue() {},
  };
  const sound = new SoundEngine({ backend, host: clock, source: { getFile: () => undefined, getResource: () => null } });
  sound.setSample(0, "snd", snd(8000), 100);
  sound.setSample(1, "snd", snd(4000), 101);
  sound.setSample(2, "snd", snd(16000), 102);
  sound.setSample(3, "adl", new Uint8Array(100), 103);
  return { clock, plays, sound };
}

const list = (...slots: number[]): number[] => [...slots, ...Array<number>(50 - slots.length).fill(-1)];

describe("compositions de sons", () => {
  it("enchaîne les échantillons de la liste, chacun à la fin du précédent, jusqu'à -1", async () => {
    const { clock, plays, sound } = setup();
    await sound.playComposition(list(0, 1, 2), 0);
    expect(plays.map((p) => p.size)).toEqual([8000]);
    clock.time = 999;
    expect(sound.isPlaying()).toBe(true);
    expect(plays).toHaveLength(1);
    clock.time = 1001;
    expect(sound.isPlaying()).toBe(true);
    expect(sound.playingSlot).toBe(1);
    clock.time = 1501;
    expect(sound.playingSlot).toBe(2);
    expect(plays.map((p) => [p.size, Math.round(p.at)])).toEqual([[8000, 0], [4000, 1001], [16000, 1501]]);
    clock.time = 3499;
    expect(sound.isPlaying()).toBe(true);
    clock.time = 3501;
    expect(sound.isPlaying()).toBe(false);
    expect(plays).toHaveLength(3);
  });

  it("saute les emplacements vides ou qui ne sont pas des SND, et l'entrée 255 vaut -1 (int8)", async () => {
    const { clock, plays, sound } = setup();
    await sound.playComposition([0, 7, 3, 1, 255, 2, ...Array<number>(44).fill(-1)], 0);
    clock.time = 5000;
    sound.isPlaying();
    expect(plays.map((p) => p.size)).toEqual([8000, 4000]);
    expect(sound.isPlaying()).toBe(false);
  });

  it("waitEndPlay finit la composition après l'échantillon en cours : pas de suite", async () => {
    const { clock, plays, sound } = setup();
    await sound.playComposition(list(0, 1, 2), 0);
    clock.time = 200;
    await sound.waitEndPlay();
    // attente par pas de 200 ms (longDelay) : rend la main à la première vérification après la fin du premier échantillon
    expect(clock.time).toBeGreaterThanOrEqual(1000);
    expect(clock.time).toBeLessThan(1000 + 200 + 16);
    expect(plays.map((p) => p.size)).toEqual([8000]);
    expect(sound.isPlaying()).toBe(false);
  });

  it("une composition attend d'abord la fin du son en cours (waitEndPlay), puis démarre", async () => {
    const { clock, plays, sound } = setup();
    sound.play(2, 1, 0); // 2 s
    await sound.playComposition(list(1), 0);
    expect(clock.time).toBeGreaterThanOrEqual(2000);
    expect(plays.map((p) => p.size)).toEqual([16000, 4000]);
    expect(sound.playingSlot).toBe(1);
  });

  it("le son suivant remplace le précédent : sans composition, un son qui joue encore est coupé", () => {
    const { clock, plays, sound } = setup();
    sound.play(0, 1, 0);
    clock.time = 300;
    sound.play(1, 1, 0);
    expect(plays.map((p) => p.size)).toEqual([8000, 4000]);
    clock.time = 799;
    expect(sound.isPlaying()).toBe(true);
    clock.time = 801;
    expect(sound.isPlaying()).toBe(false);
  });
});
