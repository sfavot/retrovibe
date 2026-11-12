import { describe, expect, it } from "vitest";
import { describeSave, placeOf } from "../../../src/games/lure/ui/saves";

describe("lieu d'une sauvegarde", () => {
  it("le titre en capitales de la description de la pièce, tel que le jeu l'écrit", () => {
    expect(placeOf({ room: 1, roomName: "LA CELLULE. Une puanteur de crasse émane d'un tas de paille." })).toBe("LA CELLULE");
    expect(placeOf({ room: 7, roomName: "LA BOUCHE D'EGOUT. Le tuyau déverse un flot régulier." })).toBe("LA BOUCHE D'EGOUT");
    expect(placeOf({ room: 15, roomName: "WEREGATE. Dans ce coin tranquille de la ville." })).toBe("WEREGATE");
  });

  it("une pièce sans titre : le nom donné par copy.ts, à défaut « Pièce N »", () => {
    expect(placeOf({ room: 8, roomName: "La ruelle est l'une de celles qui relient les principales rues." })).toBe("Une ruelle");
    expect(placeOf({ room: 5, roomName: "Les formations rocheuses brillent d'une lueur étrange." })).toBe("La caverne");
    expect(placeOf({ room: 99, roomName: "" })).toBe("Pièce 99");
  });

  it("la description d'un emplacement ajoute la date", () => {
    const text = describeSave({ savedAt: Date.UTC(2026, 10, 12, 18, 36), save: { room: 1, roomName: "LA CELLULE. Une puanteur." } as never });
    expect(text.startsWith("LA CELLULE – ")).toBe(true);
    expect(text).toContain("2026");
  });
});
