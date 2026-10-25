import { describe, expect, it } from "vitest";
import { bankData, decodeMixKey, findBank, findTrack, mixKey, parseMix } from "../../src/games/armaeth/data/mix";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("clés de son", () => {
  it("calculent classe * 1000 + numéro + 0x218 sur 16 bits", () => {
    expect(mixKey("M", 1)).toBe(12001);
    expect(mixKey("M", 307)).toBe(12307);
    expect(mixKey("A", 1)).toBe(1);
    expect(mixKey("A", 309)).toBe(309);
    expect(mixKey("B", 2)).toBe(1002);
    expect(mixKey("E", 1)).toBe(4001);
    expect(mixKey("J", 3)).toBe(9003);
    expect(mixKey(0x4d, 1)).toBe(mixKey("M", 1));
  });

  it("se décodent en sens inverse", () => {
    expect(decodeMixKey(12001)).toEqual({ cls: "M", num: 1 });
    expect(decodeMixKey(9002)).toEqual({ cls: "J", num: 2 });
    expect(decodeMixKey(1304)).toEqual({ cls: "B", num: 304 });
    for (const cls of ["A", "B", "E", "J", "M"]) {
      for (const num of [0, 1, 999]) expect(decodeMixKey(mixKey(cls, num))).toEqual({ cls, num });
    }
  });
});

describe("parseMix : fichiers invalides", () => {
  it("refuse un fichier trop court ou un annuaire tronqué", () => {
    expect(() => parseMix(new Uint8Array(4))).toThrow(/MIX invalide/);
    expect(() => parseMix(Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3))).toThrow(/annuaire/);
  });

  it("refuse une banque hors du fichier", () => {
    const bytes = new Uint8Array(8 + 42);
    const view = new DataView(bytes.buffer);
    view.setUint16(2, 1, true); // une banque
    view.setUint16(8 + 36, 100, true); // taille 100 > fichier
    view.setUint16(8 + 38, 50, true); // offset 50
    expect(() => parseMix(bytes)).toThrow(/hors du fichier/);
  });

  it("lit une banque minimale", () => {
    const bytes = new Uint8Array(8 + 8 + 42 + 3);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 1, true);
    view.setUint16(2, 1, true);
    view.setUint16(8, 12001, true); // table 1 : clé
    bytes[10] = 3; // tempo
    view.setUint16(8 + 8, 7, true); // table 2 : id
    view.setUint16(8 + 8 + 2, 12001, true);
    view.setUint16(8 + 8 + 4, 9001, true);
    view.setUint16(8 + 8 + 36, 3, true); // taille
    view.setUint16(8 + 8 + 38, 58, true); // offset (poids faible)
    bytes.set([9, 8, 7], 58);
    const mix = parseMix(bytes);
    expect(mix.tracks[0]).toMatchObject({ key: 12001, tempo: 3 });
    expect(mix.banks[0]).toMatchObject({ id: 7, key: 12001, size: 3, offset: 58 });
    expect(mix.banks[0].effectKeys[0]).toBe(9001);
    expect(findTrack(mix, 12001)).toBe(mix.tracks[0]);
    expect(findBank(mix, 7)).toBe(mix.banks[0]);
    expect(findBank(mix, 7, 1)).toBeUndefined();
    expect([...bankData(mix, mix.banks[0])]).toEqual([9, 8, 7]);
  });
});

describe.skipIf(!hasOriginalFiles)("A1FMIX.SYS (fichier du jeu)", () => {
  const file = readOriginal("A1FMIX.SYS");
  const mix = parseMix(file);

  it("a 68 entrées, 55 banques et les deux tailles de tampon de l'en-tête", () => {
    expect(mix.tracks).toHaveLength(68);
    expect(mix.banks).toHaveLength(55);
    expect(mix.musicBufferSize).toBe(4666);
    expect(mix.effectBufferSize).toBe(2122);
  });

  it("consomme exactement le fichier : annuaire puis banques contiguës", () => {
    const directoryEnd = 8 + 68 * 8 + 55 * 42;
    expect(directoryEnd).toBe(0xb2e);
    expect(mix.banks[0].offset).toBe(directoryEnd);
    for (let i = 1; i < mix.banks.length; i++) {
      expect(mix.banks[i].offset).toBe(mix.banks[i - 1].offset + mix.banks[i - 1].size);
    }
    const last = mix.banks[mix.banks.length - 1];
    expect(last.offset + last.size).toBe(file.length);
    expect(file.length).toBe(101893);
  });

  it("dimensionne les tampons sur la plus grande banque de chaque famille", () => {
    const sizes = (music: boolean) =>
      mix.banks.filter((b) => (decodeMixKey(b.key)?.cls === "M") === music).map((b) => b.size);
    expect(Math.max(...sizes(true))).toBe(mix.musicBufferSize);
    expect(Math.max(...sizes(false))).toBe(mix.effectBufferSize);
  });

  it("n'utilise que cinq classes de sons et des clés uniques", () => {
    const keys = mix.tracks.map((t) => t.key);
    expect(new Set(keys).size).toBe(68);
    const classes = new Set(keys.map((k) => decodeMixKey(k)?.cls));
    expect([...classes].sort()).toEqual(["A", "B", "E", "J", "M"]);
  });

  it("retrouve dans la table 1 la clé de chaque banque et de chaque effet", () => {
    const known = new Set(mix.tracks.map((t) => t.key));
    for (const bank of mix.banks) {
      expect(known.has(bank.key)).toBe(true);
      for (const key of bank.effectKeys.filter((k) => k !== 0)) expect(known.has(key)).toBe(true);
    }
  });

  it("garde des réglages plausibles", () => {
    for (const t of mix.tracks) {
      expect(t.tempo).toBeGreaterThanOrEqual(1);
      expect(t.tempo).toBeLessThanOrEqual(3);
      expect(t.volume).toBeLessThanOrEqual(0x10);
      expect(t.voiceMask).toBeLessThan(1 << 11);
      expect(t.speakerTrack === 0xff || t.speakerTrack < 11).toBe(true);
    }
  });

  it("cherche une banque par identifiant et clé comme le moteur", () => {
    expect(findBank(mix, 1, mixKey("M", 1))?.size).toBe(4666);
    // deux banques partagent la clé 12201 : le mot 0 les distingue
    expect(findBank(mix, 201, 12201)?.offset).toBe(0xc3f8);
    expect(findBank(mix, 308, 12201)?.offset).toBe(0x14503);
    expect(findTrack(mix, mixKey("M", 1))).toMatchObject({ tempo: 3, volume: 7, voiceMask: 0x5ff, speakerTrack: 5 });
  });
});
