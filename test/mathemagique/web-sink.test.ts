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

const { WebAudioSink } = await import("../../src/ui/mohawk/web-sink");

function fakeContext() {
  const gain = { gain: { value: 1 }, connect: () => {} };
  const started: number[] = [];
  const ctx = {
    currentTime: 0,
    state: "running",
    destination: {},
    worklets: 0,
    started,
    createGain: () => gain,
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({ length, sampleRate, getChannelData: () => new Float32Array(length) }),
    createBufferSource() {
      return { connect: () => {}, start: () => started.push(1), stop: () => {}, onended: null, buffer: null, loop: false };
    },
    audioWorklet: {
      addModule: async () => {
        ctx.worklets++;
      },
    },
    resume: async () => {},
  };
  return ctx;
}

type FakeContext = ReturnType<typeof fakeContext>;
let ctxs: FakeContext[] = [];

async function readySink() {
  const created: FakeContext[] = [];
  ctxs = created;
  vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  const sink = new WebAudioSink({
    createContext: () => {
      const ctx = fakeContext();
      created.push(ctx);
      return ctx as unknown as AudioContext;
    },
  });
  sink.startMidiLoading();
  sink.unlock();
  await new Promise<void>((resolve) => sink.onReady(resolve));
  sent.length = 0;
  const [wave, midi] = created;
  return { sink, wave: wave!, ctx: midi! };
}

describe("WebAudioSink : contextes", () => {
  it("joue les WAVE dans un contexte sans worklet, séparé de celui du synthétiseur", async () => {
    const { sink, wave, ctx } = await readySink();
    expect(ctxs).toHaveLength(2);
    expect(wave.worklets).toBe(0);
    expect(ctx.worklets).toBe(1);
    sink.playWave({ samples: new Float32Array(4000), sampleRate: 11025 }, false);
    expect(wave.started).toHaveLength(1);
    expect(ctx.started).toHaveLength(0);
  });

  it("prend l'horloge du contexte MIDI pour `now()`", async () => {
    const { sink, wave, ctx } = await readySink();
    wave.currentTime = 5;
    ctx.currentTime = 2;
    expect(sink.now()).toBe(2000);
  });
});

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
