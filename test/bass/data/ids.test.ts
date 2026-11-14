import { describe, expect, it } from "vitest";
import {
  CONTROL_PANEL_FIRST,
  CONTROL_PANEL_LAST,
  CURSOR_FIRST,
  CURSOR_LAST,
  FONT_CONTROL_PANEL,
  FONT_LINK,
  FONT_MAIN,
  GRID_FIRST,
  GRID_LAST,
  INTRO_FIRST,
  INTRO_LAST,
  LANGUAGE_FRENCH,
  SPEECH_FIRST,
  SPEECH_LAST,
  gridFile,
  musicFile,
  sfxFile,
  speechFile,
  textFile,
} from "../../../src/games/bass/data/ids";
import { hasOriginalFiles, skyDisk } from "./helpers";

describe("identifiants de fichiers", () => {
  it("calcule les identifiants de texte, de voix, de musique, d'effets et de grilles", () => {
    expect(textFile(LANGUAGE_FRENCH, 0)).toBe(60616);
    expect(textFile(LANGUAGE_FRENCH, 7)).toBe(60623);
    expect(textFile(0, 0)).toBe(60600);
    expect(textFile(7, 7)).toBe(60663);
    expect(speechFile(0, 7)).toBe(50007);
    expect(speechFile(7, 47)).toBe(50000 + 5230 + 47);
    expect(musicFile(0)).toBe(60202);
    expect(musicFile(6)).toBe(60226);
    expect(sfxFile(0)).toBe(60203);
    expect(sfxFile(6)).toBe(60227);
    expect(gridFile(69)).toBe(GRID_LAST);
  });

  it("refuse les numéros hors plage", () => {
    expect(() => textFile(8, 0)).toThrow(RangeError);
    expect(() => textFile(0, 8)).toThrow(RangeError);
    expect(() => musicFile(7)).toThrow(RangeError);
    expect(() => sfxFile(-1)).toThrow(RangeError);
    expect(() => speechFile(8, 0)).toThrow(RangeError);
    expect(() => gridFile(70)).toThrow(RangeError);
  });
});

describe.skipIf(!hasOriginalFiles)("identifiants de fichiers (sky.dnr du jeu)", () => {
  const disk = skyDisk();

  it("tous les fichiers nommés existent dans sky.dsk, sauf les voix retirées", () => {
    const expected: number[] = [];
    for (let s = 0; s < 8; s++) expected.push(textFile(LANGUAGE_FRENCH, s));
    for (let s = 0; s < 7; s++) expected.push(musicFile(s), sfxFile(s));
    for (let i = GRID_FIRST; i <= GRID_LAST; i++) expected.push(i);
    for (let i = CONTROL_PANEL_FIRST; i <= CONTROL_PANEL_LAST; i++) expected.push(i);
    for (let i = CURSOR_FIRST; i <= CURSOR_LAST; i++) expected.push(i);
    expected.push(FONT_MAIN, FONT_CONTROL_PANEL, FONT_LINK);
    expect(expected.filter((id) => !disk.has(id))).toEqual([]);
    expect(disk.has(INTRO_FIRST)).toBe(true);
    expect(disk.has(INTRO_LAST)).toBe(true);
    expect(disk.entries.filter((e) => e.id >= SPEECH_FIRST && e.id <= SPEECH_LAST)).toEqual([]);
  });

  it("les textes français ont les tailles du document de format", () => {
    const sizes = Array.from({ length: 8 }, (_, s) => disk.entry(textFile(LANGUAGE_FRENCH, s))!.storedSize);
    expect(sizes).toEqual([12328, 12238, 28991, 24026, 28744, 14796, 2598, 2057]);
  });
});
