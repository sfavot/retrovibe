import { describe, expect, it } from "vitest";
import { copy } from "../../../src/games/bass/copy";
import { describeSave, resultMessage } from "../../../src/games/bass/ui/saves";

describe("textes de l'interface", () => {
  it("la mention de version modifiée (article 4 de la licence) est dans l'aide et rappelée à l'écran titre", () => {
    const notice = copy.helpAbout.find((text) => text.startsWith("Version modifiée"));
    expect(notice).toContain("article 4");
    expect(notice).toContain("MP3");
    expect(notice).toContain("sky.dsk");
    expect(notice).toContain("réécrit");
    expect(copy.controls.some((text) => text.startsWith("Version modifiée"))).toBe(true);
  });

  it("la licence de Revolution (README-BASS.txt), ScummVM et la GPL sont cités", () => {
    expect(copy.helpLicenceLinks.map(([file]) => file)).toEqual(["README-BASS.txt"]);
    const about = copy.helpAbout.join(" ");
    expect(about).toContain("Revolution Software");
    expect(about).toContain("ScummVM");
    expect(about).toContain("GNU GPL version 3");
  });

  it("les commandes décrivent la souris, le doigt et les touches F5, Échap, point et P", () => {
    const controls = copy.controls.join(" ");
    for (const word of ["clic gauche", "clic droit", "appui long", "F5", "Échap", "point", "P met"]) expect(controls).toContain(word);
    expect(copy.helpKeys.map(([key]) => key)).toEqual(["F5", "Échap", ".", "P", "F1", "F10"]);
  });
});

describe("sauvegardes : description et messages", () => {
  it("un emplacement plein : la section et la date", () => {
    const text = describeSave({ savedAt: Date.UTC(2026, 10, 14, 12, 30), save: { section: 2 } as never });
    expect(text.startsWith("Section 3 – ")).toBe(true);
    expect(text).toContain("2026");
  });

  it("chaque issue d'une sauvegarde ou d'une restitution a son message", () => {
    expect(resultMessage("saved", "save")).toBe(copy.saveDone);
    expect(resultMessage("failed", "save")).toBe(copy.saveFailed);
    expect(resultMessage("loaded", "load")).toBe(copy.loadDone);
    expect(resultMessage("empty", "load")).toBe(copy.loadEmpty);
    expect(resultMessage("failed", "load")).toBe(copy.loadFailed);
    expect(resultMessage("choosing", "save")).toBe(copy.saveRefused.choosing);
    expect(resultMessage("busy", "save")).toBe(copy.saveRefused.busy);
  });
});
