import { describe, expect, it } from "vitest";
import { decodeCp437 } from "../../src/data/cp437";
import { parseConfirmationTexts, parseDescription, parseKeyedTexts, parseQuiz } from "../../src/games/teleportaschtroumpf/data/text";
import { hasOriginalFiles, readData } from "./helpers";

describe("decodeCp437", () => {
  it("décode les caractères accentués du français", () => {
    const bytes = Uint8Array.from([0x82, 0x85, 0x8a, 0x87, 0x93, 0x41]);
    expect(decodeCp437(bytes)).toBe("éàèçôA");
  });

  it("couvre la table complète", () => {
    const all = decodeCp437(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(all).toHaveLength(256);
    expect(all[0xe1]).toBe("ß");
    expect(all[0xff]).toBe(" ");
    expect(new Set(all).size).toBe(256);
  });
});

describe("parseKeyedTexts (données synthétiques)", () => {
  it("ignore les commentaires et sépare les blocs", () => {
    const bytes = new TextEncoder().encode('# note\r\n\r\n"a"\r\nun\r\ndeux\r\n\r\n"b"\r\ntrois\r\n');
    expect(parseKeyedTexts(bytes)).toEqual([
      { key: "a", lines: ["un", "deux"] },
      { key: "b", lines: ["trois"] },
    ]);
  });
});

describe.skipIf(!hasOriginalFiles)("textes du jeu", () => {
  it("DESCRIPT.ION : 46 scènes", () => {
    const scenes = parseDescription(readData("DESCRIPT.ION"));
    expect(scenes).toHaveLength(46);
    expect(scenes[0]).toEqual({ id: "s18", name: "Le Lac Glacé" });
    expect(scenes.find((s) => s.id === "s16")?.name).toBe("Le Pont Branlant");
  });

  it("S40A.DAT : 44 questions de quiz", () => {
    const quiz = parseQuiz(readData("S40/S40A/S40A.DAT"));
    expect(quiz.header).toBe("100");
    expect(quiz.questions).toHaveLength(44);
    expect(quiz.questions[0]).toEqual({ id: 0, text: "Faire la sourde schtroumpf.", correct: "oreille", wrong: ["tête", "manoeuvre"] });
    expect(quiz.questions[8].wrong).toContain("déménager");
    expect(quiz.questions[43].correct).toBe("bleue");
  });

  it("S49A.DAT : 12 textes de confirmation", () => {
    const texts = parseConfirmationTexts(readData("S49/S49A/S49A.DAT"));
    expect(Object.keys(texts)).toHaveLength(12);
    expect(texts.S49_06T).toBe("Schtroumpf Grognon, es-tu sûr de quitter la partie?");
    expect(texts.S49_07T).toBe("OUI");
  });
});
