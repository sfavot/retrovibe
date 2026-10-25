import { describe, expect, it } from "vitest";
import { readDefaultPalette } from "../../src/games/armaeth/data/palette";
import {
  DAYLIGHT_CURVE,
  SHIFTED_COLORS,
  applyLight,
  applyPaletteOffsets,
  daylight,
  isTooDark,
  lightLevel,
} from "../../src/games/armaeth/render/light";
import { hasOriginalFiles, readOriginal } from "./helpers";

const outdoor = { outdoor: true, lightOffset: 0 };
const indoor = { outdoor: false, lightOffset: 0 };

describe("daylight", () => {
  it("vaut la courbe aux heures pleines et interpole par les minutes", () => {
    expect(daylight(0, 0)).toBe(15);
    expect(daylight(11, 0)).toBe(63);
    expect(daylight(5, 30)).toBe(25); // 22 + (29 - 22) * 500 / 1000, tronqué
  });

  it("tronque vers zéro comme le C", () => {
    expect(daylight(16, 30)).toBe(60); // 63 + trunc(-7 * 500 / 1000) = 63 - 3
    expect(daylight(23, 59)).toBe(15);
    expect(DAYLIGHT_CURVE).toHaveLength(25);
  });

  it("refuse une heure hors de 0..23", () => {
    expect(() => daylight(24, 0)).toThrow(RangeError);
  });
});

describe("lightLevel", () => {
  it("de nuit dehors : 15 - 63 = -48 ; en plein jour : 0", () => {
    expect(lightLevel({ room: outdoor, hour: 2, minute: 0, lamps: 0 })).toBe(-48);
    expect(lightLevel({ room: outdoor, hour: 12, minute: 0, lamps: 0 })).toBe(0);
  });

  it("à l'intérieur : -63, plus les lampes (une torche de 32 donne -31)", () => {
    expect(lightLevel({ room: indoor, hour: 12, minute: 0, lamps: 0 })).toBe(-63);
    expect(lightLevel({ room: indoor, hour: 12, minute: 0, lamps: 32 })).toBe(-31);
  });

  it("dehors, les lampes sont plafonnées pour que lampes + jour <= 31, et annulées en plein jour", () => {
    // nuit (jour 15) : lampes plafonnées à 16 -> 16 + 15 - 63 = -32
    expect(lightLevel({ room: outdoor, hour: 2, minute: 0, lamps: 100 })).toBe(-32);
    // jour 63 : lampes annulées
    expect(lightLevel({ room: outdoor, hour: 12, minute: 0, lamps: 20 })).toBe(0);
    // lampes négatives conservées en plein jour
    expect(lightLevel({ room: outdoor, hour: 12, minute: 0, lamps: -5 })).toBe(-5);
  });

  it("décalage de salle : intérieur l'ajoute, extérieur l'ajoute au jour (minimum 0)", () => {
    expect(lightLevel({ room: { outdoor: false, lightOffset: -32 }, hour: 12, minute: 0, lamps: 0 })).toBe(-63);
    expect(lightLevel({ room: { outdoor: false, lightOffset: 20 }, hour: 12, minute: 0, lamps: 0 })).toBe(-43);
    expect(lightLevel({ room: { outdoor: true, lightOffset: -32 }, hour: 12, minute: 0, lamps: 0 })).toBe(-32);
    expect(lightLevel({ room: { outdoor: true, lightOffset: -32 }, hour: 2, minute: 0, lamps: 0 })).toBe(-63);
  });

  it("borne à -63..63", () => {
    expect(lightLevel({ room: indoor, hour: 0, minute: 0, lamps: -500 })).toBe(-63);
    expect(lightLevel({ room: { outdoor: false, lightOffset: 500 }, hour: 0, minute: 0, lamps: 0 })).toBe(63);
  });

  it("hors salle : 0, puis surcharge (non nulle) ou plafond", () => {
    expect(lightLevel({ room: null, hour: 0, minute: 0, lamps: 50 })).toBe(0);
    expect(lightLevel({ room: null, hour: 0, minute: 0, lamps: 0, override: -20 })).toBe(-20);
    expect(lightLevel({ room: outdoor, hour: 12, minute: 0, lamps: 0, cap: -10 })).toBe(-10);
    expect(lightLevel({ room: indoor, hour: 12, minute: 0, lamps: 0, cap: -10, override: 5 })).toBe(5);
  });

  it("trop sombre sous -40", () => {
    expect(isTooDark(-40)).toBe(false);
    expect(isTooDark(-41)).toBe(true);
  });
});

describe("applyPaletteOffsets", () => {
  const palette = Uint8Array.from({ length: 768 }, (_, i) => (i * 7) % 64);

  it("décale chaque composante des 216 premières couleurs, borné à 0..63", () => {
    const out = applyPaletteOffsets(palette, 10, -10, 0);
    expect(out).toHaveLength(768);
    for (let i = 0; i < SHIFTED_COLORS * 3; i++) {
      const d = [10, -10, 0][i % 3];
      expect(out[i]).toBe(Math.max(0, Math.min(63, palette[i] + d)));
    }
  });

  it("copie les 40 dernières couleurs telles quelles", () => {
    const out = applyLight(palette, -63);
    expect([...out.subarray(SHIFTED_COLORS * 3)]).toEqual([...palette.subarray(SHIFTED_COLORS * 3)]);
    expect(out.subarray(0, SHIFTED_COLORS * 3).every((v) => v === 0)).toBe(true);
    expect(applyLight(palette, 63).subarray(0, 3 * SHIFTED_COLORS).every((v) => v === 63)).toBe(true);
  });

  it("borne les décalages à -63..63 et ne modifie pas l'entrée", () => {
    const copy = palette.slice();
    expect(applyPaletteOffsets(palette, -200, 200, 0)[0]).toBe(0);
    expect(palette).toEqual(copy);
    expect(() => applyLight(new Uint8Array(3), 0)).toThrow(RangeError);
  });
});

describe.skipIf(!hasOriginalFiles)("lumière sur la palette du jeu", () => {
  it("un niveau nul rend la palette d'origine, les niveaux sombres l'assombrissent", () => {
    const palette = readDefaultPalette(readOriginal("AM1.EXE"));
    expect([...applyLight(palette, 0)]).toEqual([...palette]);
    const night = applyLight(palette, -48);
    expect(night.every((v) => v <= 63)).toBe(true);
    expect(night.reduce((a, b) => a + b, 0)).toBeLessThan(palette.reduce((a, b) => a + b, 0) / 2);
  });
});
