import { describe, expect, it } from "vitest";
import { TickScheduler } from "../../src/ui/tick-scheduler";
import { type DialogCopy, parseVolume, slotLabel, slotSelectable, volumeKey } from "../../src/ui/point-click-dialogs";

const copy = { saveSlot: (n: number) => `Emplacement ${n}`, saveEmpty: "Emplacement vide" } as DialogCopy;

describe("fenêtres des jeux de pointer-et-cliquer : parties pures", () => {
  it("charger : un emplacement vide n'est pas choisissable ; sauvegarder : tous le sont", () => {
    const empty = { slot: 4, empty: true, description: "Emplacement 4", savedAt: null };
    const full = { slot: 5, empty: false, description: "Un lieu – 7 nov.", savedAt: 1 };
    expect(slotSelectable("load", empty)).toBe(false);
    expect(slotSelectable("load", full)).toBe(true);
    expect(slotSelectable("save", empty)).toBe(true);
    expect(slotLabel(copy, empty)).toBe("Emplacement 4 : emplacement vide");
    expect(slotLabel(copy, full)).toBe("Emplacement 5 : Un lieu – 7 nov.");
  });

  it("volume mémorisé : un pourcentage, 100 % par défaut, borné ; une clé par jeu", () => {
    expect(parseVolume(null)).toBe(1);
    expect(parseVolume("40")).toBe(0.4);
    expect(parseVolume("250")).toBe(1);
    expect(parseVolume("-5")).toBe(0);
    expect(parseVolume("abc")).toBe(1);
    expect(volumeKey("fotaq")).toBe("retrovibe:fotaq:music-volume");
  });
});

describe("TickScheduler", () => {
  it("rend les ticks échus, limite le rattrapage et repart de l'instant présent après resync", () => {
    const scheduler = new TickScheduler(100, 3);
    expect(scheduler.due(1000)).toBe(0);
    expect(scheduler.due(1250)).toBe(2);
    expect(scheduler.due(5000)).toBe(3);
    scheduler.resync();
    expect(scheduler.due(5050)).toBe(0);
  });
});
