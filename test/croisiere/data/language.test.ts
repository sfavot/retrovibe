import { describe, expect, it } from "vitest";
import { LANGUAGE_STRING_COUNT, LangId, parseLanguageFile } from "../../../src/games/croisiere/data/language";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "DELPHINE.LNG");

function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

describe("language (synthétique)", () => {
  it("lit les chaînes entre guillemets, séparateurs ignorés, en Latin-1", () => {
    const file = latin1(`${Array.from({ length: LANGUAGE_STRING_COUNT }, (_, i) => `"s${i}é"`).join("\r\n")}\r\n`);
    const strings = parseLanguageFile(file);
    expect(strings).toHaveLength(25);
    expect(strings[0]).toBe("s0é");
    expect(strings[24]).toBe("s24é");
  });

  it("refuse un fichier avec moins de 25 chaînes ou une chaîne non terminée", () => {
    expect(() => parseLanguageFile(latin1('"a"\r\n"b"'))).toThrow(/absente/);
    expect(() => parseLanguageFile(latin1('"a'))).toThrow(/non terminée/);
  });
});

describe.skipIf(!original.has)("language (fichier original)", () => {
  it("DELPHINE.LNG : 25 chaînes, indices des menus de ScummVM", () => {
    const strings = parseLanguageFile(original.read("DELPHINE.LNG"));
    expect(strings).toHaveLength(25);
    expect(strings[LangId.pause]).toBe("Pause");
    expect(strings[LangId.inventory]).toBe("Inventaire");
    expect(strings[LangId.speakAbout]).toBe("Parler de...");
    expect(strings[LangId.playerMenu]).toBe("Menu Joueur");
    expect(strings[LangId.save]).toBe("Sauvegarde");
    expect(strings[LangId.load]).toBe("Chargement");
    expect(strings[LangId.restart]).toBe("Recommencer le jeu");
    expect(strings[LangId.quit]).toBe("Quitter");
    expect(strings[13]).toBe("Confirmez vous ce choix?");
    expect(strings[18]).toBe("Sauvegarde non trouvée..."); // é = 0xE9 (Latin-1)
    expect(strings[24]).toBe("Pas de sauvegarde dans le lecteur...");
  });
});
