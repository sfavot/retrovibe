import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext } from "../support/fake-audio-context";
import { WebAudioSoundBackend } from "../../src/engine/coktel/audio/web-audio";

/** Faux AudioContext : trace les créations, et le chargement du module worklet est résolu à la main. */
class FakeNode {
  gain = { value: 1 };
  port = { onmessage: null as unknown, posted: [] as unknown[], postMessage(m: unknown) { this.posted.push(m); }, close() {} };
  connect(): FakeNode {
    return this;
  }
  disconnect(): void {}
}
const instances: FakeContext[] = [];
let releaseModule: () => void = () => {};
class FakeContext {
  state = "suspended";
  destination = new FakeNode();
  audioWorklet = { addModule: () => new Promise<void>((r) => (releaseModule = r)) };
  gains: FakeNode[] = [];
  constructor() {
    instances.push(this);
  }
  createGain(): FakeNode {
    const gain = new FakeNode();
    this.gains.push(gain);
    return gain;
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
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

/** Morceau ADL minimal : un timbre, une note tenue sur la voix 0 pendant 100 ms, fin. */
function noteSong(): Uint8Array {
  const bytes = new Uint8Array(3 + 56 + 8);
  bytes.set([0x00, 0x00, 60, 127, 100, 0x80, 0, 0xff], 59);
  return bytes;
}

/** Écritures OPL reçues par le worklet de la musique, `[registre, valeur]`. */
function oplWrites(node: FakeNode): number[][] {
  return (node.port.posted as unknown as { writes: number[] }[]).flatMap((m) => m.writes.map((p) => [p >> 8, p & 0xff]));
}

describe("WebAudioSoundBackend", () => {
  it("unlock() crée et reprend les contextes (effets, musique), une seule fois", async () => {
    const backend = new WebAudioSoundBackend({ now: () => 0 });
    expect(instances).toHaveLength(0);
    backend.unlock();
    backend.unlock();
    expect(instances).toHaveLength(2);
    await flush(); // la reprise passe par la file de transitions de WebSampleOutput
    expect(instances.map((c) => c.state)).toEqual(["running", "running"]);
  });

  it("la musique AdLib suit l'horloge du jeu : rien ne bouge tant qu'elle est arrêtée, puis la fin est signalée", () => {
    let ms = 0;
    const backend = new WebAudioSoundBackend({ now: () => ms });
    let stopped = 0;
    backend.adlib.onStopped = () => stopped++;
    backend.adlib.load(noteSong());
    backend.adlib.play();
    for (let i = 0; i < 100; i++) backend.update(); // horloge arrêtée (pause) : pas de tick
    expect(backend.adlib.playing).toBe(true);
    ms = 1000;
    backend.update();
    expect(backend.adlib.playing).toBe(false);
    expect(stopped).toBe(1);
  });

  it("une musique jouée avant le premier geste ne crée pas de contexte ; son état des registres est rejoué à la connexion", async () => {
    let ms = 0;
    const backend = new WebAudioSoundBackend({ now: () => ms });
    backend.adlib.load(noteSong());
    backend.adlib.play();
    ms = 20;
    backend.update(); // la note sonne
    await flush();
    expect(instances).toHaveLength(0);
    backend.unlock();
    releaseModule();
    await flush();
    expect(workletNodes).toHaveLength(1);
    const writes = new Map(oplWrites(workletNodes[0]).map(([reg, value]) => [reg, value]));
    expect(writes.get(0xb0)! & 0x20).toBe(0x20); // note en cours sur la voix 0
    // la suite part au fil des ticks, coupure comprise
    ms = 200;
    backend.update();
    await flush();
    const last = oplWrites(workletNodes[0]).filter(([reg]) => reg === 0xb0).at(-1)!;
    expect(last[1] & 0x20).toBe(0);
  });

  it("coupure du son, suspension et fermeture valent aussi pour la musique", async () => {
    const backend = new WebAudioSoundBackend({ now: () => 0 });
    backend.unlock();
    await flush();
    const music = instances[1];
    const musicGain = music.gains[0];
    backend.muted = true;
    expect(musicGain.gain.value).toBe(0);
    backend.muted = false;
    expect(musicGain.gain.value).toBe(1);
    backend.suspend();
    expect(music.state).toBe("suspended");
    backend.resume();
    expect(music.state).toBe("running");
    backend.close();
    expect(music.state).toBe("closed");
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
    const backend = new WebAudioSoundBackend({ now: () => 0 });
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
    const backend = new WebAudioSoundBackend({ now: () => 0 });
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
    const backend = new WebAudioSoundBackend({ now: () => 0 });
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
    const backend = new WebAudioSoundBackend({ now: () => 0 });
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
    const backend = new WebAudioSoundBackend({ now: () => 0 });
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
