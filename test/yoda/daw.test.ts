import { describe, expect, it } from "vitest";
import { extractPalette } from "../../src/engine/desktop-adventures/data/palette";
import { HotspotType } from "../../src/engine/desktop-adventures/data/types";
import { YODA_OPCODES } from "../../src/games/yoda/opcodes";
import { INDY_OPCODES } from "../../src/games/indy/opcodes";
import { loadGameData as loadIndy, hasOriginalFiles as hasIndy } from "../indy/helpers";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

describe.skipIf(!hasOriginalFiles)("YODESK.DTA (version française)", () => {
  it("lit toutes les sections", () => {
    const data = loadGameData();
    expect(data.version).toBe(0x200);
    expect(data.startupImage.length).toBe(288 * 288);
    expect(data.tiles).toHaveLength(2135);
    expect(data.zones).toHaveLength(658);
    expect(data.puzzles).toHaveLength(205);
    expect(data.characters).toHaveLength(77);
    expect(data.sounds).toHaveLength(64);
  });

  it("range les zones par planète et lit leurs données auxiliaires", () => {
    const data = loadGameData();
    const byPlanet = new Map<number, number>();
    for (const z of data.zones) byPlanet.set(z.planet, (byPlanet.get(z.planet) ?? 0) + 1);
    expect(Object.fromEntries(byPlanet)).toEqual({ 1: 219, 2: 227, 3: 202, 5: 10 });
    expect(data.zones.reduce((n, z) => n + z.actions.length, 0)).toBe(8697);
    // Le X-Wing de Dagobah dessert les trois planètes.
    const ships = data.zones[93].hotspots.filter((h) => h.type === HotspotType.ShipToPlanet).map((h) => h.argument);
    expect(ships.sort((a, b) => a - b)).toEqual([2, 151, 476]);
  });

  it("garde les textes français et leurs marqueurs d'objet", () => {
    const data = loadGameData();
    expect(data.puzzles[10].texts[0]).toContain("ORDINATEUR DE NAVIGATION");
    const texts = data.zones.flatMap((z) => z.actions.flatMap((a) => a.instructions.map((i) => i.text)));
    expect(texts.some((t) => t.includes("¢"))).toBe(true);
  });

  it("trouve la palette après « CDeskcppDoc »", () => {
    const palette = extractPalette(loadExe(), "yoda");
    expect(palette).toHaveLength(256);
    expect(new Set(palette).size).toBeGreaterThan(200);
  });

  it("connaît tous les opcodes utilisés, sauf la condition 0x15 (jamais vraie dans l'original)", () => {
    const data = loadGameData();
    const unknown = new Set<string>();
    for (const z of data.zones) {
      for (const a of z.actions) {
        for (const c of a.conditions) if (!(c.opcode in YODA_OPCODES.conditions) && c.opcode !== 0x15) unknown.add(`c${c.opcode}`);
        for (const i of a.instructions) if (!(i.opcode in YODA_OPCODES.instructions)) unknown.add(`i${i.opcode}`);
      }
    }
    expect([...unknown]).toEqual([]);
  });
});

describe.skipIf(!hasIndy)("DESKTOP.DAW : table d'opcodes d'Indy", () => {
  it("chaque instruction utilisée a une opération", () => {
    const used = new Set(loadIndy().zones.flatMap((z) => z.actions.flatMap((a) => a.instructions.map((i) => i.opcode))));
    expect([...used].filter((op) => !(op in INDY_OPCODES.instructions))).toEqual([]);
  });
});
