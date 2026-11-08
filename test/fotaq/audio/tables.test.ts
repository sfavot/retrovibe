import { describe, expect, it } from "vitest";
import { JUNGLE_LIST, SFX_NAMES, SONGS, TUNES } from "../../../src/games/fotaq/audio/tables";
import { hasOriginalFiles, readManifest } from "../helpers";

describe("tables de morceaux et d'effets (musicdata.cpp)", () => {
  it("ont la taille de celles de ScummVM et quelques valeurs relevées dans son texte", () => {
    expect(SONGS).toHaveLength(209);
    expect(TUNES).toHaveLength(212);
    expect(SFX_NAMES).toHaveLength(136);
    expect(SONGS[0]).toEqual({ name: "Hotel Gangsters", tune: 1, override: 1 });
    expect(SONGS[2]).toEqual({ name: "Jungle", tune: 3, override: 1 });
    expect(SONGS[87]).toEqual({ name: "Intro Credits", tune: 91, override: 1 });
    expect(TUNES[0]).toEqual({ name: "Hotel Gangsters", songs: [32], sfx: 0, mode: 1 });
    expect(TUNES[5]).toEqual({ name: "Jungle", songs: [7, 8, 9, 10, 11, 12, 13, 14], sfx: 0, mode: 0 });
    expect(TUNES[31].songs).toEqual([69, 2000]); // fanfare de l'hôtel, puis reprise du morceau d'avant
    expect(TUNES[27].sfx).toBe(1); // « Open Door » : effet 1
    expect(TUNES[211]).toEqual({ name: "Talk Frank", songs: [77, 1017], sfx: 0, mode: 1 });
    expect(SFX_NAMES[0]).toBe("116BSSSS");
    expect(SFX_NAMES[135]).toBe("1034SSSS");
    expect(JUNGLE_LIST).toEqual([15, 16, 17, 18, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("sont cohérentes : chaque morceau désigne une liste existante, chaque effet un nom", () => {
    for (const song of SONGS) {
      expect(song.tune).toBeGreaterThanOrEqual(1);
      expect(song.tune).toBeLessThanOrEqual(TUNES.length);
      expect([0, 1, 2]).toContain(song.override);
    }
    for (const tune of TUNES) {
      expect(tune.sfx).toBeGreaterThanOrEqual(0);
      expect(tune.sfx).toBeLessThanOrEqual(SFX_NAMES.length);
      expect(tune.songs.length).toBeLessThanOrEqual(9);
      for (const n of tune.songs) {
        if (n >= 1000 && n < 2000) expect(n - 1000).toBeLessThan(TUNES.length);
      }
    }
    for (const name of SFX_NAMES) expect(name).toMatch(/^[0-9A-Z]{8}$/);
  });
});

describe.skipIf(!hasOriginalFiles)("tables et fichiers du jeu", () => {
  it("tous les effets de _sfxName ont leur fichier de voix converti, sauf au plus un", () => {
    const voices = new Set(readManifest().map((e) => e.path.toUpperCase()));
    const missing = SFX_NAMES.filter((name) => !voices.has(`VOICES/${name}.MP3`));
    expect(missing.length).toBeLessThanOrEqual(1);
  });

  it("les musiques désignées par les listes sont dans AQBANK.MUS (102 morceaux), sauf les valeurs spéciales et le 177 (indice 176) de la course de voiture", () => {
    const unknown = TUNES.flatMap((t) => t.songs).filter((n) => n > 0 && n < 1000 && n > 102);
    expect(unknown).toEqual([177]);
  });
});
