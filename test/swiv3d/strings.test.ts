import { describe, expect, it } from "vitest";
import { parseBd } from "../../src/games/swiv3d/data/bd";
import { parseStrings } from "../../src/games/swiv3d/data/strings";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe.skipIf(!hasOriginalFiles)("chaînes de GLOBAL.BD (fichier du jeu)", () => {
  const strings = parseStrings(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
  const FR = 1;

  it("expose 8 langues de 20 tables, dans l'ordre du jeu", () => {
    expect(strings.languages).toEqual(["English", "Francais", "Deutsch", "Espanol", "Italiano", "Polski", "Cestina", "Português"]);
    for (let language = 0; language < 8; language++) {
      expect(strings.tableIds(language)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 20, 22, 100, 200, 1000, 1001]);
    }
    expect(strings.glyphPages).toEqual([0, 0, 0, 0, 0, 1, 1, 0]);
  });

  it("retrouve en français les entrées du menu principal vues en anglais dans l'exécutable", () => {
    expect(strings.get(0, 1, 10)).toBe("Start Game");
    expect(strings.get(0, 1, 11)).toBe("Continue Game");
    expect(strings.get(0, 1, 12)).toBe("Retry Mission");
    expect(strings.get(FR, 1, 10)).toBe("Commencer le jeu");
    expect(strings.get(FR, 1, 11)).toBe("Continuer");
    expect(strings.get(FR, 1, 12)).toBe("Rejouer la mission");
    expect(strings.get(FR, 1, 19)).toBe("Quitter");
  });

  it("décode les accents du français (page de code 437)", () => {
    expect(strings.get(FR, 1, 15)).toBe("Crédits");
    expect(strings.get(FR, 2, 10)).toBe("Installation du contrôleur");
    expect(strings.get(FR, 200, 3)).toBe("Montagnes Russes");
    expect(strings.get(FR, 200, 100)).toBe("Combat à mort  1");
    expect(strings.get(FR, 11, 21)).toBe("Sélectionner la mission à|tester/Tricher");
  });

  it("lit les tables communes et rend les octets bruts", () => {
    expect(strings.getShared(0, 1)).toBe("Francais");
    expect(strings.getShared(2, 0)).toBe("00000110");
    expect(Array.from(strings.getBytes(FR, 1, 15)!)).toEqual([0x43, 0x72, 0x82, 0x64, 0x69, 0x74, 0x73]);
    expect(strings.get(FR, 999, 0)).toBeUndefined();
    expect(strings.get(FR, 1, 999)).toBeUndefined();
    expect(strings.table(FR, 22)?.size).toBe(4);
  });
});
