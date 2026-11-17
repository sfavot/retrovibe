import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAudioBackend } from "../../src/engine/infogrames/audio/web-audio";
import { pcmSound, soundFrom, type Sound } from "../../src/engine/infogrames/audio/sound";

/** Nœud audio minimal : enregistre ses connexions. */
class FakeNode {
  connections: unknown[] = [];
  connect(target: unknown): void {
    this.connections.push(target);
  }
}

class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  loopEnd = 0;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  /** Arguments de `start(when, offset, duration)`. */
  startArgs: number[] = [];
  start(...args: number[]): void {
    this.started = true;
    this.startArgs = args;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeContext {
  static last: FakeContext;
  state = "running";
  currentTime = 0;
  destination = new FakeNode();
  gainNode = Object.assign(new FakeNode(), { gain: { value: 1 } });
  sources: FakeSource[] = [];
  constructor() {
    FakeContext.last = this;
  }
  createGain() {
    return this.gainNode;
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

const sound = (seconds: number) => pcmSound(new Uint8Array(seconds * 1000).fill(128), 1000);

describe("WebAudioBackend : canal de bruitages", () => {
  beforeEach(() => vi.stubGlobal("AudioContext", FakeContext));
  afterEach(() => vi.unstubAllGlobals());

  it("avant le premier geste, un bruitage ne sonne pas", () => {
    const backend = new WebAudioBackend();
    backend.playEffect(sound(1));
    expect(backend.effectPlaying).toBe(false);
  });

  it("le bruitage est une seconde source sur le même GainNode que la voie : il ne coupe ni la voix ni la musique et suit le volume", () => {
    const backend = new WebAudioBackend();
    backend.unlock();
    const ctx = FakeContext.last;
    backend.play(sound(10), true);
    backend.playEffect(sound(1));
    const [voice, effect] = ctx.sources;
    expect(voice.stopped).toBe(false);
    expect(backend.playing).toBe(true);
    expect(backend.effectPlaying).toBe(true);
    expect(voice.connections).toEqual([ctx.gainNode]);
    expect(effect.connections).toEqual([ctx.gainNode]); // même volume, somme écrêtée à la sortie
    expect(ctx.gainNode.connections).toEqual([ctx.destination]);
    backend.setGain(0.4);
    expect(ctx.gainNode.gain.value).toBe(0.4);
  });

  it("un second bruitage remplace le premier ; la fin du bruitage ne touche pas la voie", () => {
    const backend = new WebAudioBackend();
    backend.unlock();
    const ctx = FakeContext.last;
    backend.play(sound(10), true);
    backend.playEffect(sound(1));
    backend.playEffect(sound(1));
    const [voice, first, second] = ctx.sources;
    expect(first.stopped).toBe(true);
    expect(second.stopped).toBe(false);
    first.onended?.(); // l'ancien source est déjà détaché : sans effet
    expect(backend.effectPlaying).toBe(true);
    second.onended?.();
    expect(backend.effectPlaying).toBe(false);
    expect(backend.playing).toBe(true);
    expect(voice.stopped).toBe(false);
  });

  it("stop coupe la voie seule ; stopEffect le bruitage seul", () => {
    const backend = new WebAudioBackend();
    backend.unlock();
    const ctx = FakeContext.last;
    backend.play(sound(10), false);
    backend.playEffect(sound(5));
    backend.stop();
    expect(ctx.sources[0].stopped).toBe(true);
    expect(backend.effectPlaying).toBe(true);
    backend.stopEffect();
    expect(ctx.sources[1].stopped).toBe(true);
    expect(backend.effectPlaying).toBe(false);
  });
});

describe("WebAudioBackend : sons MP3", () => {
  /** Décodeur factice : rend un tampon plus long que le son d'origine (remplissage de fin d'un MP3), et note ce qu'il reçoit. */
  class FakeDecoder {
    static created: { channels: number; length: number; rate: number }[] = [];
    static decoded: ArrayBuffer[] = [];
    static fail = false;
    constructor(channels: number, length: number, rate: number) {
      FakeDecoder.created.push({ channels, length, rate });
    }
    decodeAudioData(bytes: ArrayBuffer) {
      FakeDecoder.decoded.push(bytes);
      return FakeDecoder.fail ? Promise.reject(new Error("illisible")) : Promise.resolve({ duration: 2.05 });
    }
  }
  /** MP3 de 2 s d'origine (37 736 échantillons à 18 868 Hz) : la durée vient de l'index, pas des données. */
  const mp3 = (): Sound => ({ format: "mp3", data: new Uint8Array([0xff, 0xf3, 1, 2]), sampleCount: 37_736, sampleRate: 18_868 });

  beforeEach(() => {
    FakeDecoder.created = [];
    FakeDecoder.decoded = [];
    FakeDecoder.fail = false;
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("OfflineAudioContext", FakeDecoder);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("prepare décode une seule fois, avant tout geste, sans toucher aux octets du fichier", async () => {
    const backend = new WebAudioBackend();
    const sound = mp3();
    await backend.prepare(sound);
    await backend.prepare(sound);
    expect(FakeDecoder.created).toEqual([{ channels: 1, length: 1, rate: 22050 }]);
    expect(FakeDecoder.decoded).toHaveLength(1);
    expect([...new Uint8Array(FakeDecoder.decoded[0])]).toEqual([0xff, 0xf3, 1, 2]);
    expect(FakeDecoder.decoded[0]).not.toBe(sound.data.buffer);
  });

  it("joue le tampon décodé sur la durée d'origine exacte, voix comme bruitage", async () => {
    const backend = new WebAudioBackend();
    const sound = mp3();
    await backend.prepare(sound);
    backend.unlock();
    const ctx = FakeContext.last;
    backend.play(sound, false);
    backend.playEffect(sound);
    const [voice, effect] = ctx.sources;
    expect(voice.buffer).toEqual({ duration: 2.05 });
    expect(voice.startArgs).toEqual([0, 0, 2]);
    expect(effect.startArgs).toEqual([0, 0, 2]);
    expect(backend.playing).toBe(true);
    ctx.currentTime = 5;
    expect(backend.position).toBe(2); // bornée à la durée d'origine, pas à celle du tampon décodé
  });

  it("un son repris en cours de route (soundFrom) démarre à l'échantillon sauté et dure ce qui reste", async () => {
    const backend = new WebAudioBackend();
    const sound = mp3();
    await backend.prepare(sound);
    backend.unlock();
    const resumed = soundFrom(sound, 9434);
    expect(resumed).toMatchObject({ format: "mp3", sampleCount: 37_736 - 9434, skipSamples: 9434 });
    expect(resumed.data).toBe(sound.data);
    backend.play(resumed, false);
    expect(FakeContext.last.sources[0].startArgs).toEqual([0, 0.5, 1.5]);
    // PCM : une vue sur la fin des échantillons, sans rien à sauter.
    const pcm = soundFrom(pcmSound(Uint8Array.of(1, 2, 3, 4), 4000), 3);
    expect([[...pcm.data], pcm.sampleCount, pcm.skipSamples]).toEqual([[4], 1, undefined]);
    expect(soundFrom(sound, 0)).toBe(sound);
  });

  it("en boucle, le tour dure la durée d'origine", async () => {
    const backend = new WebAudioBackend();
    const sound = mp3();
    await backend.prepare(sound);
    backend.unlock();
    const ctx = FakeContext.last;
    backend.play(sound, true);
    expect(ctx.sources[0].loop).toBe(true);
    expect(ctx.sources[0].loopEnd).toBe(2);
    ctx.currentTime = 5;
    expect(backend.position).toBe(1);
  });

  it("un MP3 non préparé ne joue pas ; un MP3 illisible fait échouer prepare", async () => {
    const backend = new WebAudioBackend();
    backend.unlock();
    backend.play(mp3(), false);
    expect(backend.playing).toBe(false);
    expect(FakeContext.last.sources).toHaveLength(0);
    FakeDecoder.fail = true;
    await expect(backend.prepare(mp3())).rejects.toThrow(/illisible/);
  });

  it("le PCM n'a pas besoin d'être préparé et joue sur toute la longueur de son tampon", async () => {
    const backend = new WebAudioBackend();
    const pcm = pcmSound(new Uint8Array(12_000).fill(128), 4000);
    await backend.prepare(pcm);
    expect(FakeDecoder.created).toHaveLength(0);
    backend.unlock();
    backend.play(pcm, false);
    expect(FakeContext.last.sources[0].startArgs).toEqual([0, 0, 3]);
  });
});

/** Contexte dont `resume()` / `suspend()` ne se résolvent qu'à la demande, comme dans un navigateur. */
class SlowContext extends FakeContext {
  override state = "suspended";
  pending: (() => void)[] = [];
  resumeCalls = 0;
  private later(next: string): Promise<void> {
    return new Promise((resolve) =>
      this.pending.push(() => {
        this.state = next;
        resolve();
      }),
    );
  }
  override resume() {
    this.resumeCalls++;
    return this.later("running");
  }
  suspend() {
    return this.later("suspended");
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Laisse la chaîne de promesses avancer, puis résout l'opération du contexte en attente. */
const settle = async (ctx: SlowContext) => {
  await flush();
  ctx.pending.shift()?.();
  await flush();
};

describe("WebAudioBackend : reprise du contexte", () => {
  beforeEach(() => vi.stubGlobal("AudioContext", SlowContext));
  afterEach(() => vi.unstubAllGlobals());

  it("pendant la reprise, la voie et le bruitage restent vivants (rien ne les relance ni ne les croit finis)", async () => {
    const backend = new WebAudioBackend();
    backend.unlock();
    const ctx = FakeContext.last as SlowContext;
    await settle(ctx); // premier déblocage résolu
    backend.play(sound(10), true);
    backend.playEffect(sound(2));
    backend.suspend();
    await settle(ctx); // suspension résolue
    backend.resume();
    await flush();
    expect(ctx.state).toBe("suspended"); // promesse de reprise non résolue
    expect(backend.playing).toBe(true);
    expect(backend.effectPlaying).toBe(true);
    await settle(ctx);
    expect(ctx.state).toBe("running");
    expect(backend.playing).toBe(true);
  });

  it("un resume() juste après suspend() n'abandonne pas le contexte suspendu", async () => {
    const backend = new WebAudioBackend();
    backend.unlock();
    const ctx = FakeContext.last as SlowContext;
    await settle(ctx);
    expect(ctx.state).toBe("running");
    backend.suspend();
    backend.resume(); // la suspension n'est pas encore terminée
    for (let i = 0; i < 3; i++) await settle(ctx);
    expect(ctx.state).toBe("running");
  });
});
