import { afterEach, describe, expect, it, vi } from "vitest";

interface Sent {
  message: number[];
  time?: number;
}

const sent: Sent[] = [];

vi.mock("spessasynth_lib/dist/spessasynth_processor.min.js?url", () => ({ default: "processor.js" }));
vi.mock("spessasynth_lib", () => ({
  WorkletSynthesizer: class {
    soundBankManager = { addSoundBank: async () => {} };
    isReady = Promise.resolve();
    connect(): void {}
    destroy(): void {}
    stopAll(): void {}
    sendMessage(message: Uint8Array, _offset: number, options?: { time: number }): void {
      sent.push({ message: [...message], time: options?.time });
    }
  },
}));

const { WebAudioSink } = await import("../../src/games/mathemagique/audio/web-sink");

function fakeContext() {
  const gain = { gain: { value: 1 }, connect: () => {} };
  return {
    currentTime: 0,
    state: "running",
    destination: {},
    createGain: () => gain,
    audioWorklet: { addModule: async () => {} },
    resume: async () => {},
  };
}

async function readySink() {
  const ctx = fakeContext();
  vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  const sink = new WebAudioSink({ createContext: () => ctx as unknown as AudioContext });
  sink.startMidiLoading();
  sink.unlock();
  await new Promise<void>((resolve) => sink.onReady(resolve));
  sent.length = 0;
  return { sink, ctx };
}

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("WebAudioSink : reset du MIDI", () => {
  it("donne un note-off aux note-on déjà confiés au synthé mais pas encore joués", async () => {
    const { sink, ctx } = await readySink();
    ctx.currentTime = 1;
    sink.midi.send(Uint8Array.of(0x92, 60, 100), 1020); // dans la fenêtre : part tout de suite, daté
    sink.midi.send(Uint8Array.of(0x92, 64, 100), 1200); // hors fenêtre : encore dans la file locale
    sink.midi.reset();

    const noteOffs = sent.filter((s) => s.message[0] === 0x82);
    expect(noteOffs).toEqual([{ message: [0x82, 60, 0], time: 1.02 }]);
    expect(sent.some((s) => s.message[1] === 64)).toBe(false);
  });

  it("n'en donne pas aux notes déjà jouées ni après un second reset", async () => {
    const { sink, ctx } = await readySink();
    ctx.currentTime = 1;
    sink.midi.send(Uint8Array.of(0x90, 60, 100), 1010);
    ctx.currentTime = 1.05;
    sink.midi.reset();
    sink.midi.reset();
    expect(sent.filter((s) => (s.message[0] & 0xf0) === 0x80)).toEqual([]);
  });
});
