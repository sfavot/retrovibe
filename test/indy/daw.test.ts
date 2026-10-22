import { describe, expect, it } from "vitest";
import { extractPalette } from "../../src/games/indy/data/palette";
import { PuzzleType, ZoneType } from "../../src/games/indy/data/types";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

describe.skipIf(!hasOriginalFiles)("DESKTOP.DAW", () => {
  it("lit toutes les sections", () => {
    const data = loadGameData();
    expect(data.version).toBe(0x200);
    expect(data.startupImage.length).toBe(288 * 288);
    expect(data.tiles).toHaveLength(1144);
    expect(data.zones).toHaveLength(366);
    expect(data.puzzles).toHaveLength(157);
    expect(data.characters).toHaveLength(27);
    expect(data.sounds).toHaveLength(18);
  });

  it("associe noms, objets et scripts aux zones", () => {
    const data = loadGameData();
    const town = data.zones[120];
    expect(town.type).toBe(ZoneType.Town);
    expect(town.width).toBe(18);
    expect(town.actions.map((a) => a.name)).toContain("WinCheck");
    expect(data.zones[108].npcs).toEqual([794]);
    expect(data.tiles[443].name).toBe("Map");
  });

  it("lit le type des puzzles", () => {
    const data = loadGameData();
    const missions = data.puzzles.filter((p) => p.type === PuzzleType.Mission);
    expect(missions.length).toBeGreaterThan(5);
    expect(data.puzzles[0].name).toBe("GasTX");
    expect(data.puzzles[0].type).toBe(PuzzleType.Transaction);
  });

  it("lit les champs auxiliaires des zones et puzzles", () => {
    const data = loadGameData();
    const monstersWithFlag = data.zones.filter((z) => z.flag === 1 && z.monsters.length > 0).length;
    expect(data.zones.filter((z) => z.flag === 1)).toHaveLength(247);
    expect(monstersWithFlag).toBe(245);
    expect(data.zones.filter((z) => z.flag === 0 && z.monsters.length === 0)).toHaveLength(94);
    for (const p of data.puzzles) {
      if (p.type === PuzzleType.Goal) expect(p.unknown).toBe(0x80);
      if (p.type === PuzzleType.Mission) expect(p.unknown).toBe(0);
    }
    expect(data.puzzles.filter((p) => p.unknown === 0x11f)).toHaveLength(65);
  });

  it("lit les armes et ennemis", () => {
    const data = loadGameData();
    expect(data.characters[0].name).toBe("HERO");
    expect(data.characters[2]).toMatchObject({ name: "PistolWeapon", reference: 10, damage: 5 });
    expect(data.characters[3]).toMatchObject({ name: "Jaguar", health: 10, damage: 25 });
  });

  it("extrait la palette de l'exécutable", () => {
    const palette = extractPalette(loadExe());
    expect(palette).toHaveLength(256);
    expect(palette[0]).toBe(0);
    expect(new Set(palette).size).toBeGreaterThan(200);
    // Valeurs de référence (palette publiée par WebFun) : un décalage d'une seule entrée fausse
    // les couleurs isolées (chapeaux, encadrements) tout en laissant les dégradés presque intacts.
    const rgb = (i: number) => [palette[i] & 0xff, (palette[i] >> 8) & 0xff, (palette[i] >> 16) & 0xff];
    expect(rgb(10)).toEqual([255, 0, 0]);
    expect(rgb(16)).toEqual([251, 251, 251]);
    expect(rgb(32)).toEqual([67, 199, 0]);
    expect(rgb(48)).toEqual([123, 251, 59]);
  });
});
