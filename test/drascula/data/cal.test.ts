import { describe, expect, it } from "vitest";
import { parseCal } from "../../../src/games/drascula/data/cal";
import { GameFiles } from "../../../src/games/drascula/data/files";
import { byExtension, encodeGameText, hasOriginalFiles, listOriginal, readManifest, readOriginal } from "../helpers";

const lines = (...phrases: string[]) => [...phrases, "1.als", "2.als", "3.als", "4.als", "8", "9", "10"];

describe("parseCal (données synthétiques)", () => {
  it("lit quatre répliques, quatre voix et trois réponses, et rend les espaces", () => {
    const dialog = parseCal(encodeGameText(lines("UNºVAMPIRE!", "OUI.", "ÉCOUTE?", "ÀºBIENTÔT.")));
    expect(dialog.choices.map((c) => c.text)).toEqual(["UN VAMPIRE!", "OUI.", "ÉCOUTE?", "À BIENTÔT."]);
    expect(dialog.choices.map((c) => c.voice)).toEqual(["1.als", "2.als", "3.als", "4.als"]);
    expect(dialog.answers).toEqual([8, 9, 10]);
    expect(dialog.unread).toEqual([]);
  });

  it("refuse un fichier trop court", () => {
    expect(() => parseCal(encodeGameText(["A", "B"]))).toThrow(/CAL invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("dialogues .CAL du jeu", () => {
  const names = listOriginal(byExtension("CAL"));
  const dialogs = new Map(names.map((name) => [name, parseCal(readOriginal(name))]));
  const files = hasOriginalFiles ? new GameFiles(readManifest()) : new GameFiles([]);

  it("lit les 13 fichiers jusqu'à la fin : 4 répliques, 4 voix, 3 réponses", () => {
    expect(names).toHaveLength(13);
    for (const [name, dialog] of dialogs) {
      expect(dialog.choices, name).toHaveLength(4);
      expect(dialog.unread, name).toEqual([]);
      for (const choice of dialog.choices) {
        expect(choice.text.length, name).toBeGreaterThan(0);
        expect(choice.text, name).not.toContain("º");
      }
    }
  });

  it("lit OP_1.CAL en français, avec ses voix et ses réponses", () => {
    const dialog = dialogs.get("OP_1.CAL")!;
    expect(dialog.choices[0].text).toBe("UN VAMPIRE A KIDNAPPE LA FILLE DE LA 501!");
    expect(dialog.choices[1].text).toBe("TU NE POURRAIS PAS JOUER UNE CHANSON DE BLUR?");
    expect(dialog.choices.map((c) => c.voice)).toEqual(["357.als", "359.als", "360.als", "365.als"]);
    expect(dialog.answers).toEqual([8, 9, 10]);
  });

  it("renvoie à des voix qui existent", () => {
    for (const [name, dialog] of dialogs) {
      for (const { voice } of dialog.choices) expect(files.has(voice), `${name} : ${voice}`).toBe(true);
    }
  });

  it("ne garde que des espaces simples", () => {
    for (const dialog of dialogs.values()) {
      for (const { text } of dialog.choices) expect(text).not.toMatch(/\s{2,}|^\s|\s$/);
    }
  });
});
