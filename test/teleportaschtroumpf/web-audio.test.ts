import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAudioBackend } from "../../src/games/teleportaschtroumpf/audio/web-audio";

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
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
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

const sound = (seconds: number) => ({ samples: new Uint8Array(seconds * 1000).fill(128), sampleRate: 1000 });

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
