import { describe, expect, it } from "vitest";
import { parseWorld } from "../../src/games/armaeth/data/world";
import { loadWorldState, serializeWorld } from "../../src/games/armaeth/engine/save";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe.skipIf(!hasOriginalFiles)("sauvegarde du monde (fichiers du jeu)", () => {
  const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

  for (const file of ["A1FCFG.SYS", "SVG001.STD", "A1FTMP.SVG"]) {
    it(`${file} : deux cycles charger puis écrire redonnent les mêmes octets, un seul inverse l'ordre des listes`, () => {
      const bytes = readOriginal(file);
      const once = serializeWorld(loadWorldState(bytes));
      expect(once.length).toBe(bytes.length);
      // défaut de l'original reproduit (engine.md §12.5) : l'insertion en tête inverse les listes à chaque cycle
      expect(same(once, bytes)).toBe(false);
      const orderOf = (b: Uint8Array) => parseWorld(b).objects.map((o) => o.serial);
      expect(orderOf(once)).not.toEqual(orderOf(bytes));
      expect([...orderOf(once)].sort((x, y) => x - y)).toEqual([...orderOf(bytes)].sort((x, y) => x - y));
      expect(same(serializeWorld(loadWorldState(once)), bytes)).toBe(true);
    });
  }

  it("les modifications d'état sont écrites et relues", () => {
    const state = loadWorldState(readOriginal("A1FCFG.SYS"));
    state.addScore(0);
    state.clock.hour = 17;
    state.clock.minute = 42;
    state.cadence.delay = 9;
    const hero = state.hero!;
    const created = state.createObject({ typ: 2, num: 9, weight: 3 });
    state.moveToContainer(created, hero);
    const back = parseWorld(serializeWorld(state));
    expect(back.header).toMatchObject({ score: state.score, lastSerial: created.serial, objectCount: 133 });
    expect(back.header.words[5] >> 8).toBe(9);
    expect(back.header.words[7]).toBe(17 | (42 << 8));
    const stored = back.objects.find((o) => o.serial === created.serial)!;
    expect(stored).toMatchObject({ num: 9, weight: 3, location: 2, container: hero.serial });
    expect(back.scoreTable[0].points).toBeLessThan(0);
  });
});
