import { describe, expect, it } from "vitest";
import { WebSampleOutput } from "../../../src/audio/web-sample-output";
import { webDigitalOutput } from "../../../src/games/gk1/audio/web-digital";

/** Contexte Web Audio factice : note ce que les nœuds reçoivent. */
function fakeContext(log: string[]) {
  const ctx = {
    state: "suspended" as AudioContextState,
    currentTime: 0,
    destination: {},
    createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => log.push("gain off") }),
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, sampleRate, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      const source = {
        buffer: null,
        loop: false,
        onended: null,
        connect: () => {},
        disconnect: () => {},
        start: (_when: number, offset: number) => log.push(`start ${offset.toFixed(2)} loop=${source.loop}`),
        stop: () => log.push("stop"),
      };
      return source;
    },
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return ctx;
}

describe("sortie Web Audio de l'audio numérique", () => {
  it("muette tant que le contexte est bloqué ; ensuite : lecture, volume en direct, pause et reprise à la bonne position", () => {
    const log: string[] = [];
    const ctx = fakeContext(log);
    const output = webDigitalOutput(new WebSampleOutput({ now: () => 0, createContext: () => ctx as unknown as AudioContext }));
    const sample = { data: new Float32Array(22050 * 4), rate: 22050 };
    const silent = output.play(sample, { loop: false, volume: 1 });
    silent.setVolume(0.5);
    silent.pause(true);
    silent.stop();
    expect(log).toEqual([]);

    ctx.state = "running";
    const voice = output.play(sample, { loop: true, volume: 0.5 });
    ctx.currentTime = 1.5;
    voice.pause(true);
    voice.pause(true);
    ctx.currentTime = 9;
    voice.pause(false);
    ctx.currentTime = 12;
    voice.pause(true);
    voice.pause(false);
    voice.stop();
    // Reprise à 1,5 s, puis à 4,5 s, soit 0,5 s dans la boucle de 4 s.
    expect(log).toEqual(["start 0.00 loop=true", "stop", "start 1.50 loop=true", "stop", "start 0.50 loop=true", "stop", "gain off"]);
    expect(output.play({ data: new Float32Array(0), rate: 22050 }, { loop: false, volume: 1 })).toBe(silent);
  });
});
