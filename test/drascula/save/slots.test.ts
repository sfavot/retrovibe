import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "../../../src/games/drascula/copy";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { SAVE_VERSION, snapshotState } from "../../../src/games/drascula/engine/save";
import { createGameState } from "../../../src/games/drascula/engine/state";
import { slotKey } from "../../../src/engine/save-slots";
import { SAVE_PREFIX, SLOT_COUNT, createSaveSlots, describeSave, resultMessage, summarizeSlots } from "../../../src/games/drascula/ui/saves";

function sampleSave(chapter = 2, room = 14) {
  const state = createGameState(chapter);
  state.room = { number: room, music: 0, disk: "aux.alg", paletteLevel: 0, objects: [], walk: { x1: 0, y1: 0, x2: 1, y2: 1 }, hero: null, factors: null };
  return snapshotState(state, 500)!;
}

function slots() {
  const raw = new MemoryStorage();
  return { raw, slots: createSaveSlots(prefixedStorage(raw, SAVE_PREFIX)) };
}

afterEach(() => vi.restoreAllMocks());

describe("emplacements de sauvegarde", () => {
  it("dix emplacements, tous vides au départ, appelés par leur numéro", () => {
    const { slots: s } = slots();
    const all = summarizeSlots(s);
    expect(all).toHaveLength(SLOT_COUNT);
    expect(all.map((slot) => slot.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(all.every((slot) => slot.empty && slot.savedAt === null)).toBe(true);
    expect(all[2].description).toBe(copy.saveSlot(3));
    expect(copy.saveSlot(3)).toBe("Emplacement 3");
  });

  it("un emplacement écrit se relit à l'identique ; la clé porte le préfixe du jeu", () => {
    const { raw, slots: s } = slots();
    const save = sampleSave();
    expect(s.write(4, save, 1_700_000_000_000)).toBe(true);
    expect([...raw.data.keys()]).toEqual(["drascula:slot04"]);
    expect(slotKey(4)).toBe("slot04");
    const stored = s.read(4);
    expect(stored).toEqual({ savedAt: 1_700_000_000_000, save });
    expect(JSON.parse(raw.data.get("drascula:slot04")!)).toMatchObject({ savedAt: 1_700_000_000_000, save: { version: SAVE_VERSION, chapter: 2 } });
  });

  it("la description dit le chapitre, le lieu et la date", () => {
    const { slots: s } = slots();
    s.write(1, sampleSave(5, 53), Date.UTC(2026, 10, 7, 15, 5));
    const summary = summarizeSlots(s)[0];
    expect(summary.empty).toBe(false);
    expect(summary.description).toMatch(/^Chapitre 5 – Le laboratoire de Frankenstein – /);
    expect(summary.description).toContain("2026");
    expect(summary.description).toBe(describeSave(s.read(1)!));
    expect(summary.savedAt).toBe(Date.UTC(2026, 10, 7, 15, 5));
  });

  it("écraser un emplacement remplace son contenu, le vider le rend vide", () => {
    const { slots: s } = slots();
    s.write(1, sampleSave(1, 62), 1);
    s.write(1, sampleSave(3, 20), 2);
    expect(s.read(1)!.save.chapter).toBe(3);
    s.clear(1);
    expect(s.read(1)).toBeNull();
    expect(summarizeSlots(s)[0].empty).toBe(true);
  });

  it("une valeur illisible vaut emplacement vide, sans exception : JSON cassé, texte, autre version, champ manquant, date absente", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { raw, slots: s } = slots();
    const good = JSON.parse(JSON.stringify({ savedAt: 1, save: sampleSave() })) as { savedAt: number; save: Record<string, unknown> };
    const cases: Record<string, string> = {
      "drascula:slot01": "{pas du json",
      "drascula:slot02": "42",
      "drascula:slot03": "null",
      "drascula:slot04": JSON.stringify({ ...good, save: { ...good.save, version: SAVE_VERSION + 1 } }),
      "drascula:slot05": JSON.stringify({ ...good, save: { ...good.save, flags: [] } }),
      "drascula:slot06": JSON.stringify({ save: good.save }),
      "drascula:slot07": JSON.stringify({ savedAt: "hier", save: good.save }),
      "drascula:slot08": JSON.stringify({ savedAt: 1 }),
      "drascula:slot09": "",
    };
    for (const [key, value] of Object.entries(cases)) raw.set(key, value);
    const all = summarizeSlots(s);
    expect(all.slice(0, 9).every((slot) => slot.empty)).toBe(true);
    expect(s.read(1)).toBeNull();
    expect(warn).toHaveBeenCalled();
    // un emplacement bon à côté reste lisible
    raw.set("drascula:slot10", JSON.stringify(good));
    expect(summarizeSlots(s)[9].empty).toBe(false);
  });

  it("un emplacement qui n'existe pas n'écrit rien et ne lit rien", () => {
    const { raw, slots: s } = slots();
    for (const slot of [0, -1, 11, 1.5, Number.NaN]) {
      expect(s.write(slot, sampleSave(), 1)).toBe(false);
      expect(s.read(slot)).toBeNull();
    }
    expect(raw.data.size).toBe(0);
  });

  it("une écriture refusée par le stockage est signalée, pas levée", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = createSaveSlots({ get: () => null, set: () => false, remove: () => {} });
    expect(full.write(1, sampleSave(), 1)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("les messages du joueur", () => {
    expect(resultMessage("saved", "save")).toBe(copy.saveDone);
    expect(resultMessage("busy", "save")).toBe(copy.saveBusy);
    expect(resultMessage("failed", "save")).toBe(copy.saveFailed);
    expect(resultMessage("loaded", "load")).toBe(copy.loadDone);
    expect(resultMessage("empty", "load")).toBe(copy.loadEmpty);
    expect(resultMessage("failed", "load")).toBe(copy.loadFailed);
  });
});
