import { describe, expect, it } from "vitest";
import { LOAD_TIMEOUT_MS, VoiceBank, type SoundFiles } from "../../../src/audio/voice-bank";
import type { Sample } from "../../../src/audio/web-sample-output";
import { BassSpeech } from "../../../src/games/bass/audio/speech";
import { FakeOutput } from "./sfx-support";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

/** Fichiers de voix factices : identifiant → durée en échantillons à 1 000 Hz (1 ms chacun). */
function setup(durations: Record<number, number>, options: { never?: boolean } = {}) {
  const output = new FakeOutput();
  const loads: number[] = [];
  const files: SoundFiles<number> = {
    has: (id) => id in durations,
    load: (id) => {
      loads.push(id);
      return options.never ? new Promise(() => undefined) : Promise.resolve(Uint8Array.of(id & 255, id >> 8));
    },
  };
  const decoder = { decode: async (bytes: Uint8Array): Promise<Sample> => ({ data: new Float32Array(durations[bytes[0]! | (bytes[1]! << 8)]!), rate: 1000 }) };
  const speech = new BassSpeech(new VoiceBank<number>(files, decoder), output);
  return { speech, output, loads };
}

/** Numéro de texte de la section 1, rang 5 : voix 50 000 + 600 + 5. */
const TEXT_1_5 = (1 << 12) | 5;
const FILE_1_5 = 50605;

describe("BassSpeech", () => {
  it("numéro de texte → fichier de voix ; absent = faux sans rien charger", async () => {
    const { speech, loads } = setup({ [FILE_1_5]: 100 });
    expect(speech.start((1 << 12) | 6)).toBe(false); // pas de fichier : le sous-titre seul
    expect(speech.finished()).toBe(true);
    expect(speech.start(8 << 12)).toBe(false); // sections 8 à 15 : hors table
    expect(speech.start(TEXT_1_5)).toBe(true);
    await flush();
    expect(loads).toEqual([FILE_1_5]);
  });

  it("la voix dure sa durée sur l'horloge du jeu, puis finished() devient vrai", async () => {
    const { speech, output } = setup({ [FILE_1_5]: 100 });
    speech.start(TEXT_1_5);
    expect(speech.finished()).toBe(false); // en chargement
    await flush();
    expect(output.played).toHaveLength(1);
    output.advance(99);
    expect(speech.finished()).toBe(false);
    output.advance(1);
    expect(speech.finished()).toBe(true);
  });

  it("un fichier qui n'arrive jamais ne bloque pas : la voix est considérée finie après le délai borné", () => {
    const { speech, output } = setup({ [FILE_1_5]: 100 }, { never: true });
    expect(speech.start(TEXT_1_5)).toBe(true);
    output.advance(LOAD_TIMEOUT_MS - 1);
    expect(speech.finished()).toBe(false);
    output.advance(1);
    expect(speech.finished()).toBe(true);
    expect(output.played).toHaveLength(0);
  });

  it("un MP3 illisible libère la voie tout de suite", async () => {
    const output = new FakeOutput();
    const files: SoundFiles<number> = { has: () => true, load: async () => Uint8Array.of(0) };
    const speech = new BassSpeech(new VoiceBank<number>(files, { decode: async () => Promise.reject(new Error("décodage")) }), output);
    speech.start(TEXT_1_5);
    await flush();
    expect(speech.finished()).toBe(true);
  });

  it("stop coupe la voix en cours ou annule le chargement", async () => {
    const { speech, output } = setup({ [FILE_1_5]: 100 });
    speech.start(TEXT_1_5);
    await flush();
    speech.stop();
    expect(output.played[0]!.stopped).toBe(true);
    expect(speech.finished()).toBe(true);
    speech.start(TEXT_1_5); // en cache : part tout de suite
    speech.stop();
    await flush();
    expect(output.played.filter((p) => !p.stopped)).toHaveLength(0);
  });

  it("une nouvelle voix remplace la précédente ; un fichier absent ne coupe pas la voix en cours", async () => {
    const { speech, output } = setup({ [FILE_1_5]: 100, 50606: 50 });
    speech.start(TEXT_1_5);
    await flush();
    expect(speech.start((1 << 12) | 9)).toBe(false);
    expect(output.played[0]!.stopped).toBe(false);
    speech.start((1 << 12) | 6);
    await flush();
    expect(output.played[0]!.stopped).toBe(true);
    expect(output.played).toHaveLength(2);
  });

  it("voix interdites (SF_ALLOW_SPEECH retiré) : faux", () => {
    const { speech, loads } = setup({ [FILE_1_5]: 100 });
    speech.allowed = false;
    expect(speech.start(TEXT_1_5)).toBe(false);
    expect(loads).toHaveLength(0);
  });

  it("preload charge les voix qui existent, sans doublon", async () => {
    const { speech, loads } = setup({ [FILE_1_5]: 10, 50606: 10 });
    expect(await speech.preload([TEXT_1_5, TEXT_1_5, (1 << 12) | 6, (1 << 12) | 7, 9 << 12])).toBe(2);
    expect(loads.sort()).toEqual([FILE_1_5, 50606]);
  });
});
