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
    state: "running" as AudioContextState | "interrupted",
    destination: {},
    worklets: 0,
    started,
    gain,
    calls: [] as string[],
    /** Vrai : `resume()` reste en attente, comme WebKit pendant une interruption (`addReaction(Running, …)`). */
    holdResume: false,
    onstatechange: null as (() => void) | null,
    /** Change l'état comme le navigateur, avec l'évènement `statechange`. */
    setState(state: AudioContextState | "interrupted") {
      ctx.state = state;
      ctx.onstatechange?.();
    },
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
    resume: () => {
      ctx.calls.push("resume");
      if (ctx.holdResume) return new Promise<void>(() => {});
      ctx.state = "running";
      return Promise.resolve();
    },
    suspend: () => {
      ctx.calls.push("suspend");
      ctx.state = "suspended";
      return Promise.resolve();
    },
    close: () => {
      ctx.calls.push("close");
      ctx.state = "closed";
      return Promise.resolve();
    },
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

describe("WebAudioSink : reprise après une interruption d'iOS", () => {
  const pcm = { samples: new Float32Array(4000), sampleRate: 11025 };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("relance au geste un contexte `interrupted`, et pas seulement `suspended`", async () => {
    const { sink, wave, ctx } = await readySink();
    wave.holdResume = true;
    ctx.holdResume = true;
    wave.setState("interrupted");
    ctx.setState("interrupted");
    wave.calls.length = 0;
    ctx.calls.length = 0;
    sink.unlock();
    expect(wave.calls).toEqual(["resume"]);
    expect(ctx.calls).toEqual(["resume"]);
  });

  it("redemande la reprise dès que le navigateur arrête un contexte de lui-même", async () => {
    const { wave } = await readySink();
    wave.calls.length = 0;
    wave.setState("interrupted");
    expect(wave.calls).toEqual(["resume"]);
    expect(wave.state).toBe("running");
  });

  it("une reprise tenue en attente ne bloque ni les gestes suivants, ni la pause, ni la fermeture", async () => {
    const { sink, wave } = await readySink();
    wave.holdResume = true;
    wave.setState("interrupted");
    sink.unlock();
    await Promise.resolve();
    wave.calls.length = 0;
    wave.holdResume = false;
    sink.unlock();
    expect(wave.calls).toEqual(["resume"]);
    expect(wave.state).toBe("running");
    sink.suspend();
    sink.resume();
    sink.close();
    expect(wave.calls).toEqual(["resume", "suspend", "resume", "close"]);
  });

  it("le son revient au geste qui suit une interruption : les WAVE rejouent", async () => {
    const { sink, wave } = await readySink();
    wave.holdResume = true;
    wave.setState("interrupted");
    sink.playWave(pcm, false);
    expect(wave.started).toHaveLength(0);
    wave.holdResume = false;
    sink.unlock();
    sink.playWave(pcm, false);
    expect(wave.started).toHaveLength(1);
  });

  it("une voix d'un contexte interrompu ne reste pas « en cours » : elle est abandonnée passé le délai de reprise", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const { sink, wave } = await readySink();
    const handle = sink.playWave(pcm, false);
    wave.holdResume = true;
    wave.setState("interrupted");
    sink.unlock();
    expect(sink.isWavePlaying(handle)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(sink.isWavePlaying(handle)).toBe(false);
    // Le son revenu, la voix abandonnée ne repart pas.
    wave.holdResume = false;
    sink.unlock();
    expect(sink.isWavePlaying(handle)).toBe(false);
  });

  it("garde les voix pendant la pause du jeu (onglet masqué)", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const { sink } = await readySink();
    const handle = sink.playWave(pcm, false);
    sink.suspend();
    vi.advanceTimersByTime(5000);
    expect(sink.isWavePlaying(handle)).toBe(true);
    sink.resume();
    expect(sink.isWavePlaying(handle)).toBe(true);
  });

  it("le bouton Son coupé puis remis rend le gain aux deux sorties, plusieurs fois de suite", async () => {
    const { sink, wave, ctx } = await readySink();
    for (let i = 0; i < 3; i++) {
      sink.setMuted(true);
      expect([wave.gain.gain.value, ctx.gain.gain.value]).toEqual([0, 0]);
      sink.setMuted(false);
      sink.unlock();
      expect([wave.gain.gain.value, ctx.gain.gain.value]).toEqual([1, 1]);
    }
    expect([wave.state, ctx.state]).toEqual(["running", "running"]);
  });
});

describe("WebAudioSink : réglages d'essai et sonde du diagnostic", () => {
  function sinkWith(experiment: ConstructorParameters<typeof WebAudioSink>[0]) {
    const created: FakeContext[] = [];
    const sink = new WebAudioSink({
      ...experiment,
      createContext: () => {
        const ctx = fakeContext();
        created.push(ctx);
        return ctx as unknown as AudioContext;
      },
    });
    return { sink, created };
  }

  it("un seul contexte pour les WAVE et le synthétiseur, fermé une seule fois", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
    const { sink, created } = sinkWith({ experiment: { singleContext: true } });
    sink.startMidiLoading();
    sink.unlock();
    await new Promise<void>((resolve) => sink.onReady(resolve));
    expect(created).toHaveLength(1);
    expect(created[0]!.worklets).toBe(1);
    sink.playWave({ samples: new Float32Array(100), sampleRate: 11025 }, false);
    expect(created[0]!.started).toHaveLength(1);
    sink.close();
    expect(created[0]!.calls.filter((call) => call === "close")).toHaveLength(1);
  });

  it("sans synthétiseur : aucun worklet n'est chargé", async () => {
    const { sink, created } = sinkWith({ experiment: { noMidi: true } });
    sink.startMidiLoading();
    sink.unlock();
    await Promise.resolve();
    expect(created.map((ctx) => ctx.worklets)).toEqual([0, 0]);
    expect(sink.diagnostics.synth).toBe("off");
  });

  it("setExperiment n'a plus d'effet une fois les contextes créés", () => {
    const { sink, created } = sinkWith({});
    sink.unlock();
    sink.setExperiment({ singleContext: true });
    expect(created).toHaveLength(2);
    expect(sink.diagnostics.wave).not.toBe(sink.diagnostics.midi);
  });

  it("la sonde voit les contextes créés et chaque WAVE, lancé ou abandonné, sans changer la lecture", () => {
    const { sink, created } = sinkWith({});
    const roles: string[] = [];
    const starts: { started: boolean; state: string; when: number | undefined; ctxTime: number | null }[] = [];
    sink.setProbe({ contextCreated: (role) => roles.push(role), waveStarted: (event) => starts.push(event) });
    sink.unlock();
    expect(roles).toEqual(["wave", "midi"]);
    created[0]!.currentTime = 1.5;
    sink.playWave({ samples: new Float32Array(100), sampleRate: 11025 }, false);
    created[0]!.state = "closed";
    sink.playWave({ samples: new Float32Array(100), sampleRate: 11025 }, false);
    expect(starts).toEqual([
      expect.objectContaining({ started: true, state: "running", when: undefined, ctxTime: 1.5 }),
      expect.objectContaining({ started: false, state: "closed" }),
    ]);
    expect(created[0]!.started).toHaveLength(1);
  });
});
