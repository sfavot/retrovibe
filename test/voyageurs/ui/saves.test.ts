import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { copy } from "../../../src/games/voyageurs/copy";
import type { VoyageursSave } from "../../../src/games/voyageurs/engine/save";
import { SAVE_PREFIX, createSaveSlots, describeSave, loadFromSlot, resultMessage, saveToSlot, summarizeSlots } from "../../../src/games/voyageurs/ui/saves";
import { prefixedStorage } from "../../../src/engine/storage";

/** Sauvegarde minimale valide pour les emplacements : `parseSave` la vérifie en profondeur, on passe donc par un faux analyseur du stockage. */
function fakeSave(bg: string): VoyageursSave {
  return { version: 1, names: { bg, part: "PART01" } } as unknown as VoyageursSave;
}

describe("saves", () => {
  it("préfixe les emplacements par voyageurs:", () => {
    expect(SAVE_PREFIX).toBe("voyageurs:");
  });

  it("dix emplacements vides au départ, avec leur numéro", () => {
    const slots = createSaveSlots(prefixedStorage(new MemoryStorage(), SAVE_PREFIX));
    const summaries = summarizeSlots(slots);
    expect(summaries).toHaveLength(10);
    expect(summaries.every((s) => s.empty)).toBe(true);
  });

  it("saveToSlot : refuse sans sauvegarde du moteur, écrit sinon", () => {
    const storage = new MemoryStorage();
    const slots = createSaveSlots(prefixedStorage(storage, SAVE_PREFIX));
    expect(saveToSlot({ save: () => null }, slots, 1, 0)).toBe("refused");
    expect(resultMessage("refused", "save")).toBe(copy.saveBusy);
  });

  it("loadToSlot : emplacement vide, et erreur du moteur = failed", () => {
    const slots = createSaveSlots(prefixedStorage(new MemoryStorage(), SAVE_PREFIX));
    expect(loadFromSlot({ load: () => undefined }, slots, 3)).toBe("empty");
    expect(resultMessage("empty", "load")).toBe(copy.loadEmpty);
    expect(resultMessage("failed", "load")).toBe(copy.loadFailed);
    expect(resultMessage("failed", "save")).toBe(copy.saveFailed);
  });

  it("décrit un emplacement par le décor et la date", () => {
    const text = describeSave({ savedAt: Date.UTC(2026, 10, 14, 12, 0), save: fakeSave("L12.PI1") });
    expect(text.startsWith("Décor 12 – ")).toBe(true);
    expect(copy.backgroundName("LOGO.PI1")).toBe("Décor");
  });
});
