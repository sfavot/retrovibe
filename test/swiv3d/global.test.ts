import { describe, expect, it } from "vitest";
import { parseBd } from "../../src/games/swiv3d/data/bd";
import {
  GAUGE_HEIGHT,
  GAUGE_WIDTH,
  GLOBAL_FLAGS,
  parseGauge,
  parseGlobal,
  parseScreen,
  SCREEN_HEIGHT,
  SCREEN_IDS,
  SCREEN_WIDTH,
} from "../../src/games/swiv3d/data/global";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("lecteurs synthétiques", () => {
  it("rejette un écran de mauvaise taille", () => {
    expect(() => parseScreen(new Uint8Array(10))).toThrow(/écran/);
  });

  it("range les 4 plans de la jauge en lignes de 20 pixels", () => {
    const frame = new Uint8Array(4 * GAUGE_HEIGHT * 5);
    frame[0] = 1; // plan 0, ligne 0, octet 0 -> pixel (0, 0)
    frame[GAUGE_HEIGHT * 5 + 1] = 2; // plan 1, ligne 0, octet 1 -> pixel (5, 0)
    frame[GAUGE_HEIGHT * 5 * 3 + 5 * 2 + 4] = 3; // plan 3, ligne 2, octet 4 -> pixel (19, 2)
    const [image] = parseGauge(frame);
    expect([image![0], image![5], image![2 * GAUGE_WIDTH + 19]]).toEqual([1, 2, 3]);
  });
});

describe.skipIf(!hasOriginalFiles)("GLOBAL.BD (fichier du jeu)", () => {
  const bd = parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD");
  const global = parseGlobal(bd);

  it("lit l'en-tête et les drapeaux", () => {
    expect(global.header.options).toEqual(["CUTDOWN", "USENGLISH", "INTERPLAY", "IPLOGOISANIM"]);
    expect(global.header.flags).toBe(0xb2);
    expect(global.header.flags & GLOBAL_FLAGS.extraScreens).toBe(GLOBAL_FLAGS.extraScreens);
    expect(global.header.flags & GLOBAL_FLAGS.demo).toBe(0);
  });

  it("décode les cinq écrans en 320x400 avec une palette 6 bits", () => {
    for (const id of SCREEN_IDS) {
      const screen = global.screen(id);
      expect(screen.pixels).toHaveLength(SCREEN_WIDTH * SCREEN_HEIGHT);
      expect(screen.palette6).toHaveLength(768);
      expect(Math.max(...screen.palette6)).toBeLessThanOrEqual(63);
      expect(screen.table).toHaveLength(8192);
    }
    expect(() => global.screen(1000)).toThrow(/pas un écran/);
    // 1001 (mentions légales) et 1002 (crédits) partagent palette et table ; 1003 à 1005 ont les leurs.
    expect(global.screen(1001).palette6).toEqual(global.screen(1002).palette6);
    expect(global.screen(1001).palette6).not.toEqual(global.screen(1003).palette6);
  });

  it("lit la police vectorielle : 158 glyphes dont les lettres et les accents", () => {
    const { glyphs, normals } = global.vectorFont;
    expect(glyphs.size).toBe(158);
    expect(normals).toHaveLength(23 * 3);
    expect([...normals.slice(0, 3)]).toEqual([0, 0, -256]);
    const a = glyphs.get(65)!;
    expect(a.width).toBe(124);
    expect(a.vertices).toHaveLength(30 * 3);
    expect(a.triangles).toHaveLength(52 * 4);
    expect(glyphs.has(0x82)).toBe(true);
    for (const glyph of glyphs.values()) {
      for (let t = 0; t < glyph.triangles.length; t += 4) {
        expect(Math.max(glyph.triangles[t]!, glyph.triangles[t + 1]!, glyph.triangles[t + 2]!)).toBeLessThan(glyph.vertices.length / 3);
        expect(glyph.triangles[t + 3]!).toBeLessThan(23);
      }
    }
  });

  it("lit les profils de cratère (3 tailles x 16 phases x 16 profondeurs)", () => {
    expect(global.craters).toHaveLength(3);
    expect(global.craters.every((size) => size.length === 16 && size.every((p) => p.length === 16))).toBe(true);
    expect([...global.craters[0]![0]!]).toEqual([0, 1, 0, 0, 1, 11, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(Math.max(...global.craters[2]![0]!)).toBe(18);
  });

  it("compte les images des planches de sprites", () => {
    expect(global.weaponIcons).toHaveLength(22);
    expect(global.weaponIcons[0]).toMatchObject({ width: 24, height: 38 });
    expect([global.radar.frames510.length, global.radar.frames511.length, global.radar.frames512.length]).toEqual([32, 128, 128]);
    expect(global.gauge).toHaveLength(44);
    expect(global.gauge[0]).toHaveLength(GAUGE_WIDTH * GAUGE_HEIGHT);
    expect(global.textures).toHaveLength(56);
    expect(global.sprites21x35).toHaveLength(96);
    expect(global.sprites29x40).toHaveLength(32);
  });

  it("fournit la table de mélange 256x256 (ligne 0xf0 = identité) et la rampe de 256 couleurs", () => {
    expect(global.blendTable).toHaveLength(65536);
    expect(Array.from(global.blendTable.subarray(0xf000, 0xf100))).toEqual(Array.from({ length: 256 }, (_, i) => i));
    expect(global.colorRamp).toHaveLength(256);
    expect(global.colorRamp[0]).toBe(0xf000);
    expect(global.colorRamp[255]).toBe(0x0fff);
  });

  it("assemble les chaînes, la police et les missions", () => {
    expect(global.strings.get(1, 1, 10)).toBe("Commencer le jeu");
    expect(global.font.glyphs).toHaveLength(384);
    expect(global.missions.missions).toHaveLength(17);
  });
});
