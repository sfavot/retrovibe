import { describe, expect, it } from "vitest";
import { SmackerDecoder, parseSmacker, type SmackerAudio } from "../../src/data/smacker";
import { hasOriginalFiles, readOriginal } from "../swiv3d/helpers";

describe("parseSmacker", () => {
  it("refuse un fichier trop court ou à la signature inconnue", () => {
    expect(() => parseSmacker(new Uint8Array(10))).toThrow(/trop court/);
    expect(() => parseSmacker(new Uint8Array(200))).toThrow(/signature/);
  });
});

describe.skipIf(!hasOriginalFiles)("Smacker : vidéos de SWIV 3D (fichiers du jeu)", () => {
  // [fichier, images, durée d'une image (ms), fréquence audio, voies]
  const expected: [string, number, number, number, 1 | 2][] = [
    ["BR_TER0", 406, 71.42, 11025, 1],
    ["BR_TER1", 343, 71.42, 11025, 1],
    ["BR_TER2", 327, 71, 11025, 1],
    ["BR_TER3", 280, 71.42, 11025, 1],
    ["INTRO1", 315, 71, 22050, 2],
    ["INTRO2", 957, 71, 22050, 2],
    ["IPLAY", 491, 71, 22050, 2],
  ];

  it.each(expected)("%s : en-tête", (name, frames, ms, rate, channels) => {
    const file = parseSmacker(readOriginal(`ANIMS/${name}.SMK`));
    expect(file).toMatchObject({ signature: "SMK2", width: 320, height: 400, frameCount: frames, frameDurationMs: ms });
    expect(file.flags).toEqual({ ring: false, yInterlaced: false, yDouble: false });
    expect(file.audioTracks).toEqual([{ index: 0, rate, channels, bits: 8, packed: true }]);
  });

  /** Décode `limit` images et agrège le PCM de la piste 0. */
  function decode(name: string, limit = Infinity) {
    const decoder = new SmackerDecoder(readOriginal(`ANIMS/${name}.SMK`));
    const frames = [];
    const audio: SmackerAudio[] = [];
    for (let f = decoder.nextFrame(); f && frames.length < limit; f = decoder.nextFrame()) {
      frames.push(f);
      if (f.audio[0]) audio.push(f.audio[0]);
    }
    return { decoder, frames, audio };
  }

  it("BR_TER3 : décode toutes les images, la palette et l'audio sont cohérents", () => {
    const { decoder, frames, audio } = decode("BR_TER3");
    expect(frames).toHaveLength(280);
    expect(decoder.nextFrame()).toBeNull();
    expect(frames.map((f) => f.index)).toEqual(frames.map((_, i) => i));

    const first = frames[0]!;
    expect(first.paletteChanged).toBe(true);
    expect(first.palette.some((v) => v !== 0)).toBe(true);
    expect(first.pixels).toHaveLength(320 * 400);
    expect(first.yDouble).toBe(false);

    // Image du milieu : plusieurs couleurs réellement utilisées, sans qu'une seule domine tout.
    const histogram = new Uint32Array(256);
    for (const p of frames[100]!.pixels) histogram[p]!++;
    expect(histogram.filter(Boolean).length).toBeGreaterThan(16);
    expect(Math.max(...histogram)).toBeLessThan(320 * 400 * 0.9);

    // Les images sont des copies indépendantes de l'état interne.
    expect(frames[0]!.pixels).not.toBe(frames[1]!.pixels);

    const samples = audio.reduce((n, a) => n + a.samples.length, 0);
    const expectedSamples = (280 * 71.42 * 11025) / 1000;
    expect(Math.abs(samples - expectedSamples) / expectedSamples).toBeLessThan(0.05);
    expect(audio.every((a) => a.rate === 11025 && a.channels === 1)).toBe(true);
    expect(audio.some((a) => a.samples.some((v) => Math.abs(v) > 1000))).toBe(true);
  });

  it("INTRO2 : décode les 60 premières images (audio stéréo 22050 Hz)", () => {
    const { frames, audio } = decode("INTRO2", 60);
    expect(frames).toHaveLength(60);
    expect(frames[0]!.palette.some((v) => v !== 0)).toBe(true);
    expect(audio.length).toBeGreaterThan(0); // le son démarre en avance sur l'image : le volume des 60 premières images n'est pas proportionnel
    expect(audio.every((a) => a.channels === 2 && a.samples.length % 2 === 0)).toBe(true);
  });

  it("INTRO2 : la durée audio totale correspond à la durée vidéo", () => {
    const { audio } = decode("INTRO2");
    const samples = audio.reduce((n, a) => n + a.samples.length, 0);
    const expectedSamples = (957 * 71 * 22050 * 2) / 1000;
    expect(Math.abs(samples - expectedSamples) / expectedSamples).toBeLessThan(0.05);
  });

  it("reset() rejoue exactement les mêmes images", () => {
    const decoder = new SmackerDecoder(readOriginal("ANIMS/BR_TER3.SMK"));
    const a = Array.from({ length: 20 }, () => decoder.nextFrame()!.pixels);
    decoder.reset();
    expect(decoder.position).toBe(0);
    // Comparaison par Buffer : `toEqual` sur 20 images de 128 000 octets dépasse le délai quand toute la suite tourne.
    for (const pixels of a) expect(Buffer.from(decoder.nextFrame()!.pixels).equals(Buffer.from(pixels))).toBe(true);
  });
});
