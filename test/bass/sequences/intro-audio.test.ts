import { describe, expect, it } from "vitest";
import type { SamplePlayer } from "../../../src/audio/sample-channel";
import type { PlayOptions, Sample, SampleVoice } from "../../../src/audio/web-sample-output";
import { createIntroAudio } from "../../../src/games/bass/engine/sequences/intro-audio";

class FakePlayer implements SamplePlayer {
  time = 0;
  readonly played: { sample: Sample; options?: PlayOptions; stopped: boolean }[] = [];
  clockNow(): number {
    return this.time;
  }
  play(sample: Sample, options?: PlayOptions): SampleVoice {
    const entry = { sample, options, stopped: false };
    this.played.push(entry);
    const end = this.time + (sample.data.length / sample.rate) * 1000;
    const player = this;
    return {
      get playing() {
        return !entry.stopped && (options?.loop === true || player.time < end);
      },
      duration: sample.data.length / sample.rate,
      stop: () => {
        entry.stopped = true;
      },
    };
  }
}

describe("son de l'introduction (PCM 8 bits non signé à 11 025 Hz)", () => {
  const sound = () => {
    const calls: string[] = [];
    return { calls, sound: { loadSection: (s: number) => calls.push(`section ${s}`), startMusic: (m: number) => calls.push(`music ${m}`) } };
  };

  it("section et musique passent au son du moteur", () => {
    const { calls, sound: s } = sound();
    const audio = createIntroAudio({ sound: s, clock: () => 0 });
    audio.loadSection(0);
    audio.startMusic(2);
    expect(calls).toEqual(["section 0", "music 2"]);
  });

  it("la voix est convertie (127 : silence de l'en-tête, 128 : zéro) et dure octets / 11 025 Hz", () => {
    const player = new FakePlayer();
    const audio = createIntroAudio({ sound: sound().sound, player, clock: () => 0 });
    const pcm = new Uint8Array(11_025).fill(255);
    pcm.fill(127, 0, 22);
    const voice = audio.playVoice(pcm);
    const { sample } = player.played[0]!;
    expect(sample.rate).toBe(11_025);
    expect(sample.data[0]).toBeCloseTo(-1 / 128);
    expect(sample.data[100]).toBeCloseTo(127 / 128);
    expect(voice.playing).toBe(true);
    player.time = 999;
    expect(voice.playing).toBe(true);
    player.time = 1000;
    expect(voice.playing).toBe(false);
  });

  it("une nouvelle voix remplace la précédente", () => {
    const player = new FakePlayer();
    const audio = createIntroAudio({ sound: sound().sound, player, clock: () => 0 });
    audio.playVoice(new Uint8Array(1000));
    audio.playVoice(new Uint8Array(1000));
    expect(player.played.map((p) => p.stopped)).toEqual([true, false]);
  });

  it("ambiance : boucle ou non, remplacée puis arrêtée ; la voix n'est pas touchée", () => {
    const player = new FakePlayer();
    const audio = createIntroAudio({ sound: sound().sound, player, clock: () => 0 });
    const voice = audio.playVoice(new Uint8Array(5000));
    audio.playBackground(new Uint8Array(100), true);
    audio.playBackground(new Uint8Array(100), false);
    expect(player.played.map((p) => [p.options?.loop ?? false, p.stopped])).toEqual([
      [false, false],
      [true, true],
      [false, false],
    ]);
    audio.stopBackground();
    expect(player.played[2]!.stopped).toBe(true);
    expect(voice.playing).toBe(true);
    audio.stopBackground(); // sans effet
  });

  it("sans sortie d'échantillons, la voix dure autant sur l'horloge de l'introduction", () => {
    let now = 5000;
    const audio = createIntroAudio({ sound: sound().sound, clock: () => now });
    const voice = audio.playVoice(new Uint8Array(22_050));
    expect(voice.playing).toBe(true);
    now = 6999;
    expect(voice.playing).toBe(true);
    now = 7000;
    expect(voice.playing).toBe(false);
    const other = audio.playVoice(new Uint8Array(22_050));
    other.stop();
    expect(other.playing).toBe(false);
    audio.playBackground(new Uint8Array(10), true); // muet : ne plante pas
    audio.stopBackground();
  });
});
