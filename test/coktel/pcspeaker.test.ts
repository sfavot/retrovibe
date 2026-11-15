import { describe, expect, it } from "vitest";
import type { SoundBackend } from "../../src/engine/coktel/audio/backend";
import { PcSpeaker, type SpeakerOutput } from "../../src/engine/coktel/audio/pcspeaker";
import { SoundEngine } from "../../src/engine/coktel/audio/sound";

function setup() {
  const clock = { t: 1000 };
  const out: (string | number)[][] = [];
  const output: SpeakerOutput = {
    play: (frequency, durationMs) => void out.push(["play", frequency, durationMs]),
    stop: (delayMs) => void out.push(["stop", delayMs]),
  };
  return { clock, out, speaker: new PcSpeaker(() => clock.t, output) };
}

describe("haut-parleur du PC (sound/pcspeaker.cpp)", () => {
  it("speakerOn(-1) sonne jusqu'à speakerOff", () => {
    const { clock, out, speaker } = setup();
    expect(speaker.playing).toBe(false);
    speaker.speakerOn(440, -1);
    expect([speaker.playing, speaker.frequency]).toEqual([true, 440]);
    clock.t += 60_000;
    expect(speaker.playing).toBe(true);
    speaker.speakerOff();
    expect(speaker.playing).toBe(false);
    expect(out).toEqual([["play", 440, Infinity], ["stop", 0]]);
  });

  it("une durée en millisecondes s'arrête seule", () => {
    const { clock, out, speaker } = setup();
    speaker.speakerOn(1000, 5);
    clock.t += 4;
    expect(speaker.playing).toBe(true);
    clock.t += 1;
    expect(speaker.playing).toBe(false);
    expect(out).toEqual([["play", 1000, 5]]);
  });

  it("onUpdate (attente de keyFunc) arrête la note au bout de l'attente, et rien sans note", () => {
    const { clock, out, speaker } = setup();
    speaker.onUpdate(100);
    expect(out).toEqual([]);
    speaker.speakerOn(200, -1);
    speaker.onUpdate(100);
    clock.t += 99;
    expect(speaker.playing).toBe(true);
    clock.t += 1;
    expect(speaker.playing).toBe(false);
    expect(out).toEqual([["play", 200, Infinity], ["stop", 100]]);
  });

  it("onUpdate fixe la fin à la fin de l'attente, même pour une note plus courte (PCSpeakerStream::stop)", () => {
    const { clock, speaker } = setup();
    speaker.speakerOn(50, 5);
    speaker.onUpdate(30);
    clock.t += 20;
    expect(speaker.playing).toBe(true);
    clock.t += 10;
    expect(speaker.playing).toBe(false);
  });

  it("une fréquence nulle ne joue rien", () => {
    const { out, speaker } = setup();
    speaker.speakerOn(0, -1);
    expect(speaker.playing).toBe(false);
    expect(out).toEqual([["stop", 0]]);
  });

  it("SoundEngine relaie au haut-parleur et à la sortie du backend", () => {
    const now = { t: 0 };
    const played: number[][] = [];
    const backend: SoundBackend = {
      playSample() {},
      stopSample() {},
      queuePcm() {},
      clearQueue() {},
      speaker: { play: (f, d) => void played.push([f, d]), stop() {} },
    };
    const sound = new SoundEngine({
      backend,
      host: { now: () => now.t, nextFrame: async () => {} },
      source: { getFile: () => undefined, getResource: () => null },
    });
    sound.speakerOn(880, -1);
    expect(sound.speaker.playing).toBe(true);
    sound.speakerOnUpdate(10);
    now.t = 10;
    expect(sound.speaker.playing).toBe(false);
    sound.speakerOn(660, 20);
    sound.speakerOff();
    expect(sound.speaker.playing).toBe(false);
    expect(played).toEqual([[880, Infinity], [660, 20]]);
  });
});
