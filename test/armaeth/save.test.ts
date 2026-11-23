import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../src/engine/storage";
import { MAX_LEVEL, OBJECT_BYTES, ROOM_BYTES, WORLD_HEADER_WORDS, WORLD_SIGNATURE, parseWorld } from "../../src/games/armaeth/data/world";
import { loadWorldState, serializeWorld } from "../../src/games/armaeth/engine/save";
import { createSaveStorage, encodeBase64 } from "../../src/games/armaeth/ui/saves";
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

/** Monde minimal valide : une entrée de score, pas d'événement ; `objects` objets, `rooms` salles. */
function tinyWorld(options: { chapterLevel?: number; rooms?: number; objects?: number } = {}): Uint8Array {
  const { chapterLevel = 100, rooms = 0, objects = 0 } = options;
  const bytes = new Uint8Array(2 * WORLD_HEADER_WORDS + 2 + 8 + 4 + ROOM_BYTES * rooms + OBJECT_BYTES * objects);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, WORLD_SIGNATURE[0], true);
  view.setUint16(2, WORLD_SIGNATURE[1], true);
  view.setUint16(8, chapterLevel, true);
  view.setUint16(26, objects, true);
  view.setUint16(28, rooms, true);
  view.setUint16(2 * WORLD_HEADER_WORDS, 1, true);
  return bytes;
}

describe("sauvegarde du monde : une valeur forgée est refusée proprement", () => {
  it("un niveau hors de la place des drapeaux de l'en-tête est refusé à la lecture (sinon écriture hors de l'en-tête)", () => {
    expect(() => parseWorld(tinyWorld({ chapterLevel: 100 + MAX_LEVEL }))).not.toThrow();
    expect(() => parseWorld(tinyWorld({ chapterLevel: 100 + MAX_LEVEL + 1 }))).toThrow();
    expect(() => parseWorld(tinyWorld({ chapterLevel: 299 }))).toThrow();
  });

  it("un monde cohérent s'installe ; un objet rangé dans une salle inexistante lève, ce que l'emplacement traduit en « vide »", () => {
    expect(() => loadWorldState(tinyWorld({ rooms: 1 }))).not.toThrow();
    const forged = tinyWorld({ rooms: 1, objects: 1 }); // objet tout à zéro : nature de conteneur 0, invalide
    expect(() => loadWorldState(forged)).toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new MemoryStorage();
    const saves = createSaveStorage(store);
    store.set("svg001", encodeBase64(forged));
    expect(saves.read("svg001")).toBeNull();
    store.set("svg002", encodeBase64(tinyWorld({ rooms: 1 })));
    expect(saves.read("svg002")).toEqual(tinyWorld({ rooms: 1 }));
    warn.mockRestore();
  });
});
