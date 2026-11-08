import { describe, expect, it } from "vitest";
import { SampleChannel, type SamplePlayer } from "../../../src/games/fotaq/audio/channel";
import { LOAD_TIMEOUT_MS, VoiceBank, soundFileName, type SoundFiles } from "../../../src/games/fotaq/audio/voices";
import type { Sample, SampleVoice } from "../../../src/audio/web-sample-output";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

/** Fichiers factices : le contenu d'un son est sa longueur en échantillons. */
function setup(names: Record<string, number>, options: { failDecode?: Set<string> } = {}) {
  const loads: string[] = [];
  const decodes: number[] = [];
  const files: SoundFiles = {
    has: (name) => name in names,
    load: async (name) => {
      loads.push(name);
      return Uint8Array.of(names[name] & 255, (names[name] >> 8) & 255, names[name] >> 16);
    },
  };
  const decoder = {
    decode: async (bytes: Uint8Array): Promise<Sample> => {
      const length = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
      decodes.push(length);
      if (options.failDecode?.has(String(length))) throw new Error("décodage");
      return { data: new Float32Array(length), rate: 1000 };
    },
  };
  const bank = new VoiceBank(files, decoder);
  let clock = 0;
  const started: Sample[] = [];
  const voices: { stopped: boolean; end: number }[] = [];
  const player: SamplePlayer = {
    clockNow: () => clock,
    play: (sample) => {
      started.push(sample);
      const state = { stopped: false, end: clock + sample.data.length };
      voices.push(state);
      const voice: SampleVoice = {
        get playing() {
          return !state.stopped && clock < state.end;
        },
        duration: sample.data.length / 1000,
        stop: () => (state.stopped = true),
      };
      return voice;
    },
  };
  return { bank, loads, decodes, player, started, voices, advance: (ms: number) => (clock += ms) };
}

describe("soundFileName", () => {
  it("remplace les espaces par des zéros et met en majuscules (PCSound::playSound)", () => {
    expect(soundFileName("02 1P2 1")).toBe("0201P201");
    expect(soundFileName("116Bssss")).toBe("116BSSSS");
  });
});

describe("VoiceBank", () => {
  it("décode une fois, garde en cache, peek ne lance rien", async () => {
    const { bank, loads } = setup({ A: 100 });
    expect(bank.peek("A")).toBeUndefined();
    const first = await bank.sample("A");
    expect(first?.data).toHaveLength(100);
    expect(bank.peek("A")).toBe(first);
    await bank.sample("A");
    expect(loads).toEqual(["A"]);
  });

  it("deux demandes simultanées partagent le même chargement", async () => {
    const { bank, loads } = setup({ A: 10 });
    const [a, b] = await Promise.all([bank.sample("A"), bank.sample("A")]);
    expect(a).toBe(b);
    expect(loads).toHaveLength(1);
  });

  it("un fichier absent ou illisible rend null sans lever", async () => {
    const { bank } = setup({ A: 7 }, { failDecode: new Set(["7"]) });
    expect(await bank.sample("ABSENT")).toBeNull();
    expect(await bank.sample("A")).toBeNull();
  });

  it("preload charge sans doublon, ignore les absents et compte les prêts", async () => {
    const { bank, loads } = setup({ A: 5, B: 6, C: 7 });
    expect(await bank.preload(["a", "B", "B", "ABSENT", "C"])).toBe(3);
    expect(loads.sort()).toEqual(["A", "B", "C"]);
    expect(bank.peek("C")).toBeDefined();
  });

  it("oublie les plus anciennes au-delà de la limite de mémoire", async () => {
    const { bank } = setup({ A: 7_000_000, B: 7_000_000 });
    await bank.sample("A");
    await bank.sample("B");
    expect(bank.peek("A")).toBeUndefined();
    expect(bank.peek("B")).toBeDefined();
  });
});

describe("SampleChannel", () => {
  it("joue tout de suite un son en cache, pendant sa durée sur l'horloge du jeu", async () => {
    const { bank, player, advance } = setup({ A: 500 });
    await bank.sample("A");
    const channel = new SampleChannel(bank, player);
    expect(channel.play("A")).toBe(true);
    expect(channel.active).toBe(true);
    advance(499);
    expect(channel.active).toBe(true);
    advance(1);
    expect(channel.active).toBe(false);
  });

  it("un son en chargement est actif, puis dure sa durée à partir du début de la lecture", async () => {
    const { bank, player, advance, started } = setup({ A: 300 });
    const channel = new SampleChannel(bank, player);
    channel.play("A");
    expect(channel.active).toBe(true);
    expect(started).toHaveLength(0);
    await flush();
    expect(started).toHaveLength(1);
    advance(299);
    expect(channel.active).toBe(true);
    advance(1);
    expect(channel.active).toBe(false);
  });

  it("un fichier absent rend faux ; un fichier illisible libère la voie sans attendre le délai", async () => {
    const { bank, player } = setup({ A: 9 }, { failDecode: new Set(["9"]) });
    const channel = new SampleChannel(bank, player);
    expect(channel.play("ABSENT")).toBe(false);
    expect(channel.active).toBe(false);
    channel.play("A");
    await flush();
    // le décodage a échoué : rien à jouer, la voie est libre tout de suite (la réplique ne reste pas bloquée)
    expect(channel.active).toBe(false);
  });

  it("une attente trop longue libère la voie (délai de chargement)", () => {
    const never: SoundFiles = { has: () => true, load: () => new Promise(() => undefined) };
    const bank = new VoiceBank(never, { decode: async () => ({ data: new Float32Array(1), rate: 1000 }) });
    let clock = 0;
    const channel = new SampleChannel(bank, { clockNow: () => clock, play: () => ({ playing: true, duration: 1, stop() {} }) });
    channel.play("X");
    clock = LOAD_TIMEOUT_MS - 1;
    expect(channel.active).toBe(true);
    clock = LOAD_TIMEOUT_MS;
    expect(channel.active).toBe(false);
  });

  it("le son suivant remplace le précédent, et stop() annule un chargement en cours", async () => {
    const { bank, player, started, voices } = setup({ A: 100, B: 200 });
    const channel = new SampleChannel(bank, player);
    channel.play("A");
    channel.play("B");
    await flush();
    expect(started.map((s) => s.data.length)).toEqual([200]);
    channel.stop();
    expect(voices[0].stopped).toBe(true);
    expect(channel.active).toBe(false);
    channel.play("A"); // cache: jouée tout de suite
    channel.stop();
    await flush();
    expect(channel.active).toBe(false);
  });
});
