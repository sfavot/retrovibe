import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  it("unlock() crée et reprend le contexte, une seule fois", () => {
    const backend = new WebAudioSoundBackend();
    expect(instances).toHaveLength(0);
    backend.unlock();
    backend.unlock();
    expect(instances).toHaveLength(1);
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
    expect(instances[0].state).toBe("running");
  });
});
