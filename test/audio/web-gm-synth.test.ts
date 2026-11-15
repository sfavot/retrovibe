import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext, FakeGain } from "../support/fake-audio-context";

interface Sent {
  message: number[];
  time?: number;
}

const sent: Sent[] = [];
const state = { stopAll: 0, destroyed: 0, connected: 0 };

vi.mock("spessasynth_lib/dist/spessasynth_processor.min.js?url", () => ({ default: "processor.js" }));
vi.mock("spessasynth_lib", () => ({
  WorkletSynthesizer: class {
    soundBankManager = { addSoundBank: async () => {} };
    isReady = Promise.resolve();
    connect(): void {
      state.connected++;
    }
    destroy(): void {
      state.destroyed++;
    }
    stopAll(): void {
      state.stopAll++;
    }
    sendMessage(message: Uint8Array, _offset: number, options?: { time: number }): void {
      sent.push({ message: [...message], time: options?.time });
    }
  },
}));

const { WebGmSynth, FLUSH_WINDOW_MS } = await import("../../src/audio/web-gm-synth");

class WorkletContext extends FakeAudioContext {
  modules: string[] = [];
  audioWorklet = {
    addModule: async (url: string) => {
      this.modules.push(url);
    },
  };
}

const URL_SF = "https://exemple.test/jeu.sf2";

function fetchOk(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }));
}

async function ready(options: { onReady?: () => void; onError?: (e: unknown) => void } = {}) {
  const ctx = new WorkletContext(false);
  const out = new FakeGain();
  const synth = new WebGmSynth(ctx.asContext(), out as unknown as AudioNode, { soundfontUrl: URL_SF, ...options });
  await synth.load();
  return { ctx, synth };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sent.length = 0;
  state.stopAll = state.destroyed = state.connected = 0;
});

describe("WebGmSynth", () => {
  it("charge le worklet et la soundfont à l'URL donnée, puis signale qu'il est prêt", async () => {
    const fetcher = fetchOk();
    vi.stubGlobal("fetch", fetcher);
    const onReady = vi.fn();
    const { ctx, synth } = await ready({ onReady });
    expect(fetcher).toHaveBeenCalledWith(URL_SF);
    expect(ctx.modules).toEqual(["processor.js"]);
    expect(state.connected).toBe(1);
    expect(synth.ready).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("ignore les messages tant qu'il n'est pas prêt, et ne se charge qu'une fois", async () => {
    const fetcher = fetchOk();
    vi.stubGlobal("fetch", fetcher);
    const ctx = new WorkletContext(false);
    const synth = new WebGmSynth(ctx.asContext(), new FakeGain() as unknown as AudioNode, { soundfontUrl: URL_SF });
    synth.send(Uint8Array.of(0x90, 60, 100));
    expect(sent).toEqual([]);
    await Promise.all([synth.load(), synth.load()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    synth.send(Uint8Array.of(0x90, 60, 100));
    expect(sent).toEqual([{ message: [0x90, 60, 100], time: undefined }]);
  });

  it("signale un échec de chargement sans devenir prêt, et détruit le synthétiseur créé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const onError = vi.fn();
    const onReady = vi.fn();
    const { synth } = await ready({ onError, onReady });
    expect(synth.ready).toBe(false);
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(state.destroyed).toBe(1);
  });

  it("envoie tout de suite ce qui est dans la fenêtre, et retient le reste jusqu'à l'approche de son heure", async () => {
    vi.stubGlobal("fetch", fetchOk());
    const { ctx, synth } = await ready();
    vi.useFakeTimers();
    synth.send(Uint8Array.of(0x90, 60, 100), FLUSH_WINDOW_MS - 1);
    expect(sent.map((s) => s.time)).toEqual([(FLUSH_WINDOW_MS - 1) / 1000]);
    sent.length = 0;
    synth.send(Uint8Array.of(0x90, 62, 100), 500);
    synth.send(Uint8Array.of(0x90, 61, 100), 300);
    expect(sent).toEqual([]);
    ctx.currentTime = 0.28;
    vi.advanceTimersByTime(8);
    expect(sent.map((s) => s.message[1])).toEqual([61]);
    ctx.currentTime = 0.48;
    vi.advanceTimersByTime(8);
    expect(sent.map((s) => s.message[1])).toEqual([61, 62]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reset() abandonne la file, coupe les voix et donne un note-off aux note-on déjà partis", async () => {
    vi.stubGlobal("fetch", fetchOk());
    const { synth } = await ready();
    vi.useFakeTimers();
    synth.send(Uint8Array.of(0x92, 64, 90), 20); // dans la fenêtre : parti, mais encore à venir
    synth.send(Uint8Array.of(0x90, 60, 100), 1000); // en file
    sent.length = 0;
    synth.reset();
    expect(state.stopAll).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(sent[0]).toEqual({ message: [0x82, 64, 0], time: 0.02 });
    const rest = sent.slice(1);
    expect(rest).toHaveLength(32);
    expect(rest[0].message).toEqual([0xb0, 123, 0]);
    expect(rest[1].message).toEqual([0xb0, 121, 0]);
    expect(rest.every((s) => s.time === undefined)).toBe(true);
    // la note en file n'est jamais envoyée
    sent.length = 0;
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual([]);
  });

  it("close() coupe puis détruit le synthétiseur, de façon idempotente, sans toucher au contexte", async () => {
    vi.stubGlobal("fetch", fetchOk());
    const { ctx, synth } = await ready();
    synth.close();
    synth.close();
    expect(state.destroyed).toBe(1);
    expect(synth.ready).toBe(false);
    expect(ctx.closed).toBe(false);
    sent.length = 0;
    synth.send(Uint8Array.of(0x90, 60, 100));
    expect(sent).toEqual([]);
  });

  it("fermé pendant le chargement : rien n'est signalé et le synthétiseur créé est détruit", async () => {
    vi.stubGlobal("fetch", fetchOk());
    const onError = vi.fn();
    const onReady = vi.fn();
    const ctx = new WorkletContext(false);
    const synth = new WebGmSynth(ctx.asContext(), new FakeGain() as unknown as AudioNode, { soundfontUrl: URL_SF, onError, onReady });
    const loading = synth.load();
    await Promise.resolve();
    await Promise.resolve();
    synth.close();
    await loading;
    expect(onError).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(synth.ready).toBe(false);
  });
});
