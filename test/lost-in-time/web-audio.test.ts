import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext } from "../support/fake-audio-context";
import { WebAudioSoundBackend } from "../../src/games/lost-in-time/engine/audio/web-audio";

/** Faux AudioContext : trace les créations, et le chargement du module worklet est résolu à la main. */
class FakeNode {
  gain = { value: 1 };
  port = { onmessage: null as unknown, posted: [] as { type: string }[], postMessage(m: { type: string }) { this.posted.push(m); } };
  connect(): FakeNode {
    return this;
  }
}
const instances: FakeContext[] = [];
let releaseModule: () => void = () => {};
class FakeContext {
  state = "suspended";
  destination = new FakeNode();
  audioWorklet = { addModule: () => new Promise<void>((r) => (releaseModule = r)) };
  nodes: FakeNode[] = [];
  constructor() {
    instances.push(this);
  }
  createGain(): FakeNode {
    return new FakeNode();
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }
}
let workletNodes: FakeNode[] = [];

beforeEach(() => {
  instances.length = 0;
  workletNodes = [];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", class extends FakeNode {
    constructor() {
      super();
      workletNodes.push(this);
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

const flush = (): Promise<void> => new Promise((r) => setTimeout(r));

describe("WebAudioSoundBackend", () => {
  it("unlock() crée et reprend le contexte, une seule fois", async () => {
    const backend = new WebAudioSoundBackend();
    expect(instances).toHaveLength(0);
    backend.unlock();
    backend.unlock();
    expect(instances).toHaveLength(1);
    await flush(); // la reprise passe par la file de transitions de WebSampleOutput
    expect(instances[0].state).toBe("running");
  });

  it("un morceau ADL demandé avant l'attache du worklet est rejoué après", async () => {
    const backend = new WebAudioSoundBackend();
    backend.unlock();
    backend.adlib.load(new Uint8Array([1, 2, 3]));
    backend.adlib.setRepeating(2);
    backend.adlib.play();
    expect(workletNodes).toHaveLength(0);
    releaseModule();
    await flush();
    expect(workletNodes[0].port.posted.map((m) => m.type)).toEqual(["load", "repeat", "play"]);
  });

  it("sans geste préalable, la demande ADL crée le contexte (suspendu) puis rejoue", async () => {
    const backend = new WebAudioSoundBackend();
    backend.adlib.load(new Uint8Array([1]));
    backend.adlib.play();
    expect(instances).toHaveLength(1);
    expect(instances[0].state).toBe("suspended");
    releaseModule();
    await flush();
    expect(workletNodes[0].port.posted.map((m) => m.type)).toContain("play");
    backend.unlock();
    await flush();
    expect(instances[0].state).toBe("running");
  });
});

/** Contexte de test des échantillons : `FakeAudioContext` (sources, gains) avec un worklet jamais chargé. */
class SampleContext extends FakeAudioContext {
  audioWorklet = { addModule: () => new Promise<void>(() => {}) };
  constructor() {
    super();
    samples.push(this);
  }
}
const samples: SampleContext[] = [];

describe("WebAudioSoundBackend : échantillons et file", () => {
  beforeEach(() => {
    samples.length = 0;
    vi.stubGlobal("AudioContext", SampleContext);
  });

  const pcm = new Int8Array(8000); // 1 s à 8 kHz

  it("playSample : une passe, des passes bornées, ou en boucle ; le suivant remplace le précédent", async () => {
    const backend = new WebAudioSoundBackend();
    backend.unlock();
    await flush();
    const ctx = samples[0];
    backend.playSample(pcm, 8000, 1);
    expect(ctx.sources[0].loop).toBe(false);
    expect(ctx.sources[0].startArgs).toEqual([]);
    backend.playSample(pcm, 8000, 3);
    expect(ctx.sources[0].stopped).toBe(true);
    expect(ctx.sources[1].loop).toBe(true);
    expect(ctx.sources[1].startArgs).toEqual([0, 0, 3]);
    backend.playSample(pcm, 8000, Infinity);
    expect(ctx.sources[2].startArgs).toEqual([]);
    expect(ctx.sources[2].loop).toBe(true);
    expect(ctx.sources[1].buffer).toBe(ctx.sources[0].buffer); // même PCM : un seul tampon
  });

  it("stopSample coupe net, ou avec un fondu qui garde la source jusqu'au prochain arrêt", async () => {
    const backend = new WebAudioSoundBackend();
    backend.unlock();
    await flush();
    const ctx = samples[0];
    backend.playSample(pcm, 8000, Infinity);
    ctx.currentTime = 4;
    backend.stopSample(0.5);
    expect(ctx.sources[0].stopAt).toBe(4.5);
    expect(ctx.gains[1].ramps).toEqual([{ value: 0, at: 4.5 }]);
    backend.stopSample(0);
    expect(ctx.sources[0].stopAt).toBeUndefined(); // coupé net, plus de fondu
    backend.stopSample(0); // rien à arrêter
  });

  it("le son coupé passe par le gain général, qu'un échantillon soit en cours ou non", async () => {
    const backend = new WebAudioSoundBackend();
    backend.unlock();
    await flush();
    backend.playSample(pcm, 8000, 1);
    backend.muted = true;
    expect(samples[0].gains[0].gain.value).toBe(0);
    expect(samples[0].sources[0].stopped).toBe(false);
    backend.muted = false;
    expect(samples[0].gains[0].gain.value).toBe(1);
  });

  it("queuePcm planifie à la suite sur l'horloge du contexte, clearQueue arrête tout", async () => {
    const backend = new WebAudioSoundBackend();
    backend.unlock();
    await flush();
    const ctx = samples[0];
    ctx.currentTime = 2;
    const starts: number[] = [];
    backend.queuePcm(pcm, 8000);
    backend.queuePcm(pcm, 8000);
    for (const source of ctx.sources) starts.push(source.startArgs[0]);
    expect(starts).toEqual([2.05, 3.05]);
    backend.clearQueue();
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
  });

  it("suspend() / resume() suspendent et reprennent le contexte", async () => {
    const backend = new WebAudioSoundBackend();
    backend.unlock();
    await flush();
    backend.suspend();
    await flush();
    expect(samples[0].state).toBe("suspended");
    backend.resume();
    await flush();
    expect(samples[0].state).toBe("running");
  });
});
