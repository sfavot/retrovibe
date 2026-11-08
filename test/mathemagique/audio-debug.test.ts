import { describe, expect, it } from "vitest";
import { beepSound, describeExperiment, readAudioDebugParams } from "../../src/ui/mohawk/audio-debug";

describe("diagnostic audio : paramètres d'URL", () => {
  it("sans paramètre : ni panneau, ni réglage d'essai", () => {
    expect(readAudioDebugParams("")).toEqual({ overlay: false, experiment: {} });
    expect(describeExperiment({})).toBe("—");
  });

  it("lit le panneau et les réglages combinés", () => {
    const params = readAudioDebugParams("?audiodebug&audio=one,nomidi&latency=playback&rate=44100");
    expect(params).toEqual({ overlay: true, experiment: { singleContext: true, noMidi: true, latencyHint: "playback", sampleRate: 44100 } });
    expect(describeExperiment(params.experiment)).toBe("1 contexte, sans synthé, latencyHint=playback, rate=44100");
  });

  it("accepte une latence en secondes et ignore les valeurs invalides", () => {
    expect(readAudioDebugParams("?latency=0.02").experiment).toEqual({ latencyHint: 0.02 });
    expect(readAudioDebugParams("?latency=vite&rate=12&audio=autre").experiment).toEqual({});
  });
});

describe("diagnostic audio : bip de test", () => {
  it("70 ms, sans clic aux bords, sous la saturation", () => {
    const { samples, sampleRate } = beepSound(22050);
    expect(samples.length).toBe(Math.round(22050 * 0.07));
    expect(sampleRate).toBe(22050);
    expect(samples[0]).toBe(0);
    expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(1e-6);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.5);
  });
});
