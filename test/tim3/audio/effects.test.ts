import { describe, expect, it } from "vitest";
import type { Sample, SampleVoice } from "../../../src/audio/web-sample-output";
import { EffectMixer } from "../../../src/games/tim3/audio/effects";
import { EFFECT_VOICES, SOUND_LOOP, SOUND_NO_RESTART, SOUND_UNIQUE, effectFileName, normalizeEffect } from "../../../src/games/tim3/audio/ids";

class FakeVoice implements SampleVoice {
  playing = true;
  stops = 0;
  readonly duration = 1;
  constructor(readonly sample: Sample, readonly loop: boolean) {}
  stop(): void {
    this.playing = false;
    this.stops++;
  }
}

function rig(missing: number[] = []) {
  const voices: FakeVoice[] = [];
  const mixer = new EffectMixer(
    {
      play: (sample, options) => {
        const v = new FakeVoice(sample, options?.loop ?? false);
        voices.push(v);
        return v;
      },
    },
    { load: (id) => (missing.includes(id) ? null : { data: new Float32Array([id]), rate: 11025 }) },
  );
  return { mixer, voices };
}

describe("effets : numéros", () => {
  it("transforme les ambiances (< 92) en 3800 + n avec les drapeaux 7", () => {
    expect(normalizeEffect(24, 0)).toEqual({ id: 3824, flags: 7 });
    expect(normalizeEffect(91, 0)).toEqual({ id: 3891, flags: 7 });
    expect(normalizeEffect(92, 0)).toEqual({ id: 92, flags: 0 });
    expect(normalizeEffect(3611, 0)).toEqual({ id: 3611, flags: 0 });
    expect(effectFileName(3611)).toBe("SX_3611.WAV");
    expect(effectFileName(24 + 3800)).toBe("SX_3824.WAV");
  });
});

describe("EffectMixer", () => {
  it("joue plusieurs effets à la fois, limités à 16 emplacements", () => {
    const { mixer, voices } = rig();
    for (let i = 0; i < EFFECT_VOICES; i++) expect(mixer.play(3000 + i, 1)).toBe(true);
    expect(mixer.active).toBe(16);
    // le 17e, de même priorité, est abandonné : aucun emplacement de priorité inférieure
    expect(mixer.play(3100, 1)).toBe(false);
    expect(voices).toHaveLength(16);
  });

  it("remplace l'emplacement de plus basse priorité quand un effet plus prioritaire arrive", () => {
    const { mixer, voices } = rig();
    for (let i = 0; i < 16; i++) mixer.play(3000 + i, i === 5 ? 1 : 3);
    expect(mixer.play(3100, 2)).toBe(true);
    expect(voices[5].playing).toBe(false);
    expect(voices.filter((v) => v.playing)).toHaveLength(16);
    expect(mixer.isPlaying(3005)).toBe(false);
    expect(mixer.isPlaying(3100)).toBe(true);
  });

  it("libère un emplacement quand le son se termine", () => {
    const { mixer, voices } = rig();
    for (let i = 0; i < 16; i++) mixer.play(3000 + i, 1);
    voices[3].playing = false;
    expect(mixer.play(3200, 1)).toBe(true);
    expect(voices).toHaveLength(17);
  });

  it("drapeau 4 : relance le même numéro, ou garde le premier avec le drapeau 1", () => {
    const { mixer, voices } = rig();
    mixer.play(3300, 1, SOUND_UNIQUE);
    mixer.play(3300, 1, SOUND_UNIQUE);
    expect(voices.map((v) => v.playing)).toEqual([false, true]);
    expect(mixer.play(3300, 1, SOUND_UNIQUE | SOUND_NO_RESTART)).toBe(false);
    expect(voices).toHaveLength(2);
    // sans le drapeau 4, deux exemplaires du même effet peuvent jouer ensemble
    mixer.play(3301, 1);
    mixer.play(3301, 1);
    expect(voices.filter((v) => v.playing)).toHaveLength(3);
  });

  it("drapeau 2 : boucle jusqu'à l'arrêt ; une ambiance boucle sans se relancer", () => {
    const { mixer, voices } = rig();
    mixer.play(3400, 1, SOUND_LOOP);
    expect(voices[0].loop).toBe(true);
    mixer.play(24);
    mixer.play(24);
    expect(voices[1].loop).toBe(true);
    expect(voices.filter((v) => v.playing)).toHaveLength(2); // 3400 et une seule ambiance 3824
    expect(mixer.isPlaying(24)).toBe(true);
    mixer.stop(24);
    expect(mixer.isPlaying(24)).toBe(false);
    expect(mixer.isPlaying(3400)).toBe(true);
    mixer.stopAll();
    expect(mixer.active).toBe(0);
  });

  it("abandonne un effet dont le fichier manque sans occuper d'emplacement", () => {
    const { mixer } = rig([3999]);
    expect(mixer.play(3999)).toBe(false);
    expect(mixer.active).toBe(0);
  });
});
