import { describe, expect, it, vi } from "vitest";
import { FakeAudioContext } from "../../support/fake-audio-context";
import type { SoundFiles } from "../../../src/audio/voice-bank";
import { goalVoice, helpVoice, musicFileName, effectFileName, hintVoice } from "../../../src/games/tim3/audio/ids";
import { parseLipSyncJson } from "../../../src/games/tim3/audio/lipsync";
import type { GmPort } from "../../../src/games/tim3/audio/music";
import { baseIndex, original } from "../data/real";

vi.mock("spessasynth_lib/dist/spessasynth_processor.min.js?url", () => ({ default: "processor.js" }));
vi.mock("spessasynth_lib", () => ({ WorkletSynthesizer: class {} }));

const { WebTim3Audio, VOICES_PREF_KEY } = await import("../../../src/games/tim3/audio/audio");

/** WAV 8 bits mono 11 025 Hz de `samples` échantillons. */
function wav(samples: number): Uint8Array {
  const out = new Uint8Array(44 + samples);
  const view = new DataView(out.buffer);
  out.set([..."RIFFxxxxWAVEfmt "].map((c) => c.charCodeAt(0)));
  view.setUint32(4, out.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 11025, true);
  view.setUint32(28, 11025, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  out.set([..."data"].map((c) => c.charCodeAt(0)), 36);
  view.setUint32(40, samples, true);
  out.fill(200, 44);
  return out;
}

function hmiSong(): Uint8Array {
  const head = new Array(0x60).fill(0);
  [..."HMI-MIDITRACK"].forEach((c, i) => (head[i] = c.charCodeAt(0)));
  head[0x57] = 0x60;
  const events = [0x00, 0xfe, 0x14, 0xff, 0xff, 0x00, 0x90, 0x40, 0x7f, 0x10, 0x78, 0xfe, 0x15, 0x80, 0x01, 0x6e, 0, 0, 0, 0x00, 0xff, 0x2f, 0x00];
  const track = [...head, ...events];
  const out = new Uint8Array(0x172 + 4 + track.length);
  [..."HMI-MIDISONG061595"].forEach((c, i) => (out[i] = c.charCodeAt(0)));
  const view = new DataView(out.buffer);
  view.setUint16(0xd4, 120, true);
  view.setUint32(0xe4, 1, true);
  view.setUint32(0xe8, 0x172, true);
  view.setUint32(0x172, 0x176, true);
  out.set(track, 0x176);
  return out;
}

function sync(): Uint8Array {
  const out = new Uint8Array(6 + 8 + 2);
  const view = new DataView(out.buffer);
  view.setUint32(0, 142, true);
  view.setUint16(6, 6, true);
  view.setInt16(8, 5, true);
  view.setUint16(10, 60, true);
  view.setInt16(12, -1, true);
  view.setUint16(14, 0xffff, true);
  return out;
}

function rig(options: { stored?: Record<string, string>; voiceFiles?: string[] } = {}) {
  const ctx = new FakeAudioContext(false);
  const clock = { now: 0 };
  const store = new Map<string, string>(Object.entries(options.stored ?? {}));
  const resources: Record<string, Uint8Array> = {
    [effectFileName(3200)]: wav(11025),
    [effectFileName(3824)]: wav(5000),
    [musicFileName(1000)]: hmiSong(),
    [musicFileName(1001)]: hmiSong(),
  };
  const midi: number[][] = [];
  const gm = { ready: true, resets: 0, loads: 0, closed: false };
  const voiceKeys = new Set(options.voiceFiles ?? ["goals/003", "help/001"]);
  const loads: string[] = [];
  const voices: SoundFiles<string> = {
    has: (k) => voiceKeys.has(k),
    load: async (k) => {
      loads.push(k);
      return new Uint8Array([1, 2, 3]);
    },
  };
  const audio = new WebTim3Audio({
    now: () => clock.now,
    resources: { has: (n) => n in resources, get: (n) => resources[n] },
    voices,
    lipsync: parseLipSyncJson({ help: { "1": btoa(String.fromCharCode(...sync())) } }),
    storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    soundfontUrl: "sf.sf2",
    createContext: () => ctx.asContext(),
    createGmPort: () =>
      ({
        get ready() {
          return gm.ready;
        },
        now: () => ctx.currentTime * 1000,
        send: (m: Uint8Array) => void midi.push([...m]),
        reset: () => void gm.resets++,
        load: async () => void gm.loads++,
        close: () => void (gm.closed = true),
      }) satisfies GmPort & { load(): Promise<void>; close(): void },
  });
  return { audio, ctx, clock, store, midi, gm, loads };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("WebTim3Audio", () => {
  it("joue des effets WAV, plusieurs à la fois, et coupe", () => {
    const { audio, ctx } = rig();
    audio.unlock();
    expect(audio.playEffect(3200)).toBe(true);
    expect(audio.playEffect(3200)).toBe(true);
    expect(audio.playEffect(24)).toBe(true); // ambiance 3824, en boucle
    expect(audio.playEffect(3999)).toBe(false); // fichier absent
    expect(audio.activeEffects).toBe(3);
    expect(ctx.sources).toHaveLength(3);
    expect(ctx.sources[2].loop).toBe(true);
    audio.stopEffect(24);
    expect(audio.activeEffects).toBe(2);
    audio.stopEffects();
    expect(audio.activeEffects).toBe(0);
  });

  it("démarre la musique du niveau, charge le synthétiseur une fois, change de morceau et arrête net", () => {
    const { audio, midi, gm } = rig();
    audio.enterPuzzle(1000);
    audio.update();
    expect(audio.musicNumber).toBe(1000);
    expect(gm.loads).toBe(1);
    expect(midi.some((m) => m[0] === 0x90)).toBe(true);
    audio.playMusic(1000);
    audio.playMusic(1001);
    expect(audio.musicNumber).toBe(1001);
    expect(gm.loads).toBe(1);
    const resets = gm.resets;
    audio.stopMusic();
    expect(gm.resets).toBeGreaterThan(resets);
    expect(audio.musicNumber).toBe(0);
    audio.enterPuzzle(0); // puzzle sans musique
    expect(audio.musicNumber).toBe(0);
  });

  it("joue une voix à la demande, active pendant sa durée, absente = texte seul", async () => {
    const { audio, ctx, loads, clock } = rig();
    audio.unlock();
    ctx.decoded = { sampleRate: 22050, length: 22050 * 2, channels: 1 };
    expect(audio.playVoice(goalVoice(99))).toBe(false); // fichier absent : pas d'attente
    expect(audio.voiceActive).toBe(false);
    expect(audio.playVoice(goalVoice(3))).toBe(true);
    expect(audio.voiceActive).toBe(true); // en chargement
    await flush();
    expect(loads).toEqual(["goals/003"]);
    expect(ctx.sources).toHaveLength(1);
    clock.now = 1000;
    expect(audio.voiceActive).toBe(true);
    clock.now = 2500;
    expect(audio.voiceActive).toBe(false);
    expect(audio.playVoice(hintVoice(8, 3) ?? goalVoice(500))).toBe(false);
  });

  it("coupe la voix quand on change de puzzle, et les effets avec", async () => {
    const { audio, ctx } = rig();
    audio.unlock();
    audio.playEffect(3200);
    audio.playVoice(goalVoice(3));
    await flush();
    expect(audio.voiceActive).toBe(true);
    audio.enterPuzzle(1000);
    expect(audio.voiceActive).toBe(false);
    expect(audio.activeEffects).toBe(0);
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
  });

  it("préférence « voix activées » : activée par défaut, mémorisée, coupe la voix en cours", async () => {
    const { audio, store } = rig();
    expect(audio.voicesEnabled).toBe(true);
    audio.unlock();
    audio.playVoice(goalVoice(3));
    await flush();
    audio.voicesEnabled = false;
    expect(store.get(VOICES_PREF_KEY)).toBe("0");
    expect(audio.voiceActive).toBe(false);
    expect(audio.playVoice(goalVoice(3))).toBe(false);
    audio.voicesEnabled = true;
    expect(audio.playVoice(goalVoice(3))).toBe(true);
    expect(rig({ stored: { [VOICES_PREF_KEY]: "0" } }).audio.voicesEnabled).toBe(false);
  });

  it("expose la pose de la bouche d'après la synchro, sur l'horloge du jeu", async () => {
    const { audio, ctx, clock } = rig();
    audio.unlock();
    ctx.decoded = { sampleRate: 22050, length: 22050 * 3, channels: 1 };
    audio.playVoice(helpVoice(1));
    expect(audio.mouth().viseme).toBe(0);
    await flush();
    clock.now = 50;
    expect(audio.mouth().viseme).toBe(0);
    clock.now = 200; // 12 soixantièmes > 6
    expect(audio.mouth().viseme).toBe(5);
    clock.now = 1500; // fin de la parole (-1 à 60)
    expect(audio.mouth().viseme).toBe(0);
    audio.stopVoice();
    expect(audio.mouth().viseme).toBe(0);
  });

  it("interrupteur général du jeu (4115e6(10000, ·)) : coupé, tout s'arrête et rien ne part ; rallumé, la musique demandée repart", async () => {
    const { audio, ctx, midi } = rig();
    expect(audio.soundEnabled).toBe(true);
    audio.unlock();
    audio.enterPuzzle(1000);
    audio.update();
    audio.playEffect(3200);
    audio.playVoice(goalVoice(3));
    await flush();
    expect(midi.some((m) => m[0] === 0x90)).toBe(true);
    audio.soundEnabled = false;
    expect(audio.activeEffects).toBe(0);
    expect(audio.voiceActive).toBe(false);
    expect(audio.playEffect(3200)).toBe(false);
    expect(audio.playVoice(goalVoice(3))).toBe(false);
    // Le morceau demandé est retenu, sans jouer, même changé.
    audio.enterPuzzle(1001);
    audio.resumeMusic();
    midi.length = 0;
    audio.update();
    expect(audio.musicNumber).toBe(1001);
    expect(midi.some((m) => m[0] === 0x90)).toBe(false);
    // Indépendant du bouton « Son » du site : le gain général n'a pas bougé.
    expect(ctx.gains[0].gain.value).toBe(1);
    audio.soundEnabled = true;
    audio.update();
    expect(midi.some((m) => m[0] === 0x90)).toBe(true);
    expect(audio.playEffect(3200)).toBe(true);
  });

  it("interrupteur général coupé avant la première musique : le synthétiseur naît silencieux", () => {
    const { audio, midi } = rig();
    audio.soundEnabled = false;
    audio.enterPuzzle(1000);
    audio.update();
    expect(audio.musicNumber).toBe(1000);
    expect(midi.some((m) => m[0] === 0x90)).toBe(false);
  });

  it("muet du site : gain général à 0 sans rien arrêter ; onglet masqué : contexte suspendu", () => {
    const { audio, ctx, clock } = rig();
    audio.unlock();
    audio.playEffect(3200);
    audio.setMuted(true);
    expect(ctx.gains[0].gain.value).toBe(0);
    expect(audio.activeEffects).toBe(1);
    audio.setMuted(false);
    expect(ctx.gains[0].gain.value).toBe(1);
    audio.suspend();
    clock.now = 5000;
    audio.resume();
    audio.close();
    expect(ctx.closed).toBe(true);
  });

  it("ferme le synthétiseur à la fermeture", () => {
    const { audio, gm } = rig();
    audio.playMusic(1000);
    audio.close();
    expect(gm.closed).toBe(true);
  });
});

describe.skipIf(!original.has)("effets réels", () => {
  it("les 121 effets se décodent en échantillons", () => {
    const index = baseIndex();
    const names = index.names().filter((n) => /^SX_\d+\.WAV$/i.test(n));
    expect(names).toHaveLength(121);
    const ctx = new FakeAudioContext(false);
    const audio = new WebTim3Audio({
      now: () => 0,
      resources: index,
      voices: { has: () => false, load: async () => new Uint8Array() },
      storage: { get: () => null, set: () => {} },
      soundfontUrl: "x",
      createContext: () => ctx.asContext(),
    });
    audio.unlock();
    // priorité croissante : chaque effet remplace le plus ancien, donc les 121 démarrent
    names.forEach((n, i) => expect(audio.playEffect(Number(/\d+/.exec(n)![0]), i + 1), n).toBe(true));
    expect(ctx.sources).toHaveLength(121);
    expect(audio.activeEffects).toBe(16);
  });
});
