import { describe, expect, it } from "vitest";
import { encodeCp850 } from "../../../src/data/cp850";
import { parseAlg } from "../../../src/games/drascula/data/alg";
import { type DatCharEntry, parseDat } from "../../../src/games/drascula/data/dat";
import {
  DIALOG_FONT_SHEET,
  DIALOG_GLYPH,
  FONT_SHEET,
  GLYPH,
  GameFont,
  centerText,
  layoutCenteredText,
  textFitsCentered,
} from "../../../src/games/drascula/render/font";
import { Plane, TRANSPARENT, WIDTH } from "../../../src/games/drascula/render/plane";
import { hasOriginalFiles, readOriginal } from "../helpers";

const entry = (inChar: string | number, mappedChar: number, charType: number): DatCharEntry => ({
  inChar: typeof inChar === "string" ? inChar.charCodeAt(0) : inChar,
  mappedChar,
  charType,
});

describe("table des caractères", () => {
  const maps = {
    letters: [entry("A", 6, 0), entry("N", 123, 0), entry(164, 132, 0), entry(165, 132, 0)],
    signs: [entry(".", 6, 1)],
    accented: [entry(160, 6, 2), entry(181, 6, 2), entry("A", 33, 2)],
  };
  const font = new GameFont(maps);

  it("la table donne la colonne, le type la rangée de 95.ALG", () => {
    expect(font.glyphOrigin(65)).toEqual({ x: 6, y: 158 });
    expect(font.glyphOrigin(46)).toEqual({ x: 6, y: 169 });
    expect(font.glyphOrigin(160)).toEqual({ x: 6, y: 180 });
    expect(font.glyphOrigin(78)).toEqual({ x: 123, y: 158 });
  });

  it("passe en majuscule avant de chercher, comme toupper ; la première entrée gagne ; sans entrée, pas de glyphe", () => {
    expect(font.glyphOrigin("a".charCodeAt(0))).toEqual({ x: 6, y: 158 });
    expect(font.find("n".charCodeAt(0))?.inChar).toBe(78);
    expect(font.glyphOrigin("@".charCodeAt(0))).toBeNull();
    // toupper ne touche que a-z : 0xA0 reste 0xA0 (et ne devient pas 0x80)
    expect(font.find(0xa0)?.charType).toBe(2);
  });

  it("la police des dialogues dérive de la position : (position - 6) / 9 x 7 + 10", () => {
    const [a, n, , , dot] = [...maps.letters, ...maps.signs];
    expect(font.dialogGlyphOrigin(a, "selected")).toEqual({ x: 10, y: 31 });
    expect(font.dialogGlyphOrigin(n, "selected")).toEqual({ x: 13 * 7 + 10, y: 31 });
    expect(font.dialogGlyphOrigin(dot, "selected")).toEqual({ x: 10, y: 40 });
    expect(font.dialogGlyphOrigin(a, "unselected")).toEqual({ x: 10, y: 6 });
    expect(font.dialogGlyphOrigin(dot, "clicked")).toEqual({ x: 10, y: 65 });
  });
});

/** Feuille de glyphes synthétique : A en (6, 158), N en (123, 158), « . » en (6, 169), chaque glyphe plein d'un indice propre. */
function syntheticSheet(): Plane {
  const sheet = new Plane();
  sheet.clear(TRANSPARENT);
  const fill = (x: number, y: number, value: number): void => {
    for (let row = 0; row < GLYPH.height; row++) for (let col = 0; col < GLYPH.width; col++) sheet.pixels[(y + row) * WIDTH + x + col] = value;
  };
  fill(6, 158, 11);
  fill(123, 158, 22);
  fill(6, 169, 33);
  return sheet;
}

describe("print_abc", () => {
  const font = new GameFont({
    letters: [entry("A", 6, 0), entry("N", 123, 0)],
    signs: [entry(".", 6, 1)],
    accented: [],
  });

  it("recopie un glyphe de 8 x 6 par caractère, au pas de 8", () => {
    const dest = new Plane();
    dest.clear(1);
    font.print(dest, syntheticSheet(), "AN.", 20, 30);
    expect([dest.at(20, 30), dest.at(27, 35), dest.at(28, 30), dest.at(35, 35), dest.at(36, 30), dest.at(43, 35)]).toEqual([11, 11, 22, 22, 33, 33]);
    expect([dest.at(19, 30), dest.at(44, 30), dest.at(20, 29), dest.at(20, 36)]).toEqual([1, 1, 1, 1]);
  });

  it("l'indice 255 de la feuille est transparent", () => {
    const sheet = syntheticSheet();
    sheet.pixels[158 * WIDTH + 6] = TRANSPARENT;
    const dest = new Plane();
    dest.clear(1);
    font.print(dest, sheet, "A", 0, 0);
    expect([dest.at(0, 0), dest.at(1, 0)]).toEqual([1, 11]);
  });

  it("passe à la ligne après x = 317 : colonne 0, 8 pixels plus bas", () => {
    const dest = new Plane();
    // 40 glyphes de 8 pixels depuis x = 0 : le 40e se termine en 320, x dépasse 317 après le 40e caractère
    font.print(dest, syntheticSheet(), `${"A".repeat(40)}N`, 0, 10);
    expect(dest.at(312, 10)).toBe(11);
    expect(dest.at(0, 18)).toBe(22);
    expect(dest.at(8, 18)).toBe(0);
  });

  it("un octet sans glyphe recopie le glyphe précédent (le premier : le coin haut gauche de la feuille), comme ScummVM", () => {
    const sheet = syntheticSheet();
    sheet.pixels[0] = 77;
    const dest = new Plane();
    font.print(dest, sheet, "?A?", 0, 0);
    expect(dest.at(0, 0)).toBe(77);
    expect(dest.at(8, 0)).toBe(11);
    expect(dest.at(16, 0)).toBe(11);
  });
});

describe("print_abc_opc (choix de dialogue)", () => {
  const font = new GameFont({ letters: [entry("A", 6, 0), entry(164, 15, 0), entry(" ", 24, 0)], signs: [], accented: [] });
  const sheet = new Plane();
  sheet.clear(TRANSPARENT);
  // glyphes 6 x 5 des trois états, colonnes 10, 17 et 24
  const mark = (x: number, y: number, value: number): void => {
    for (let row = 0; row < DIALOG_GLYPH.height; row++) for (let col = 0; col < DIALOG_GLYPH.width; col++) sheet.pixels[(y + row) * WIDTH + x + col] = value;
  };
  mark(10, 6, 1);
  mark(10, 31, 2);
  mark(10, 56, 3);
  mark(17, 6, 4);

  it("choisit la rangée de l'état, avance de 6 pixels à partir de x = 1 et rend le nombre de lignes", () => {
    for (const [state, value] of [["unselected", 1], ["selected", 2], ["clicked", 3]] as const) {
      const dest = new Plane();
      expect(font.printChoice(dest, sheet, "A", 50, state)).toBe(1);
      expect([dest.at(1, 50), dest.at(6, 54), dest.at(7, 50), dest.at(0, 50)]).toEqual([value, value, 0, 0]);
    }
  });

  it("remplace l'apostrophe par l'octet 164", () => {
    const dest = new Plane();
    font.printChoice(dest, sheet, "'", 0, "unselected");
    expect(dest.at(1, 0)).toBe(4);
  });

  it("un mot qui ne tient pas avant x = 317 passe à la ligne suivante", () => {
    const dest = new Plane();
    const lines = font.printChoice(dest, sheet, `${"A".repeat(50)} AA`, 0, "unselected");
    // 50 lettres de 6 pixels dépassent 317 dès le début : le mot est sur la ligne suivante, à x = 0
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(dest.at(0, 8)).toBe(1);
  });
});

describe("textFitsCentered et centerText", () => {
  it("à gauche de 160 les deux bords comptent, au-delà le complément à 315", () => {
    expect(textFitsCentered("A".repeat(15), 60)).toBe(true); // moitié 56 <= 60
    expect(textFitsCentered("A".repeat(16), 60)).toBe(false); // moitié 64 > 60
    expect(textFitsCentered("A".repeat(41), 160)).toBe(false); // bord droit : 160 + 160 + 8 > 320
    expect(textFitsCentered("A".repeat(40), 160)).toBe(true);
    expect(textFitsCentered("A".repeat(10), 255)).toBe(true); // 315 - 255 - 40 >= 0
    expect(textFitsCentered("A".repeat(20), 255)).toBe(false); // 315 - 255 - 80 < 0
  });

  it("un texte qui tient : une ligne centrée, quatre hauteurs de glyphe au-dessus du point", () => {
    expect(layoutCenteredText("AB CD", 160, 100)).toEqual([{ text: "AB CD", x: 160 - 2 * 8 - 1, y: 100 - 24 }]);
    // le centre est ramené entre 60 et 255, l'ordonnée entre 0 et 194
    expect(layoutCenteredText("AB", 5, 10)[0]).toEqual({ text: "AB", x: 60 - 8 - 1, y: 0 });
    expect(layoutCenteredText("AB", 300, 500)[0]).toEqual({ text: "AB", x: 255 - 8 - 1, y: 194 });
  });

  it("un mot seul qui ne tient pas glisse sur le côté", () => {
    const word = "A".repeat(30);
    const [line] = layoutCenteredText(word, 255, 100);
    expect(layoutCenteredText(word, 255, 100)).toHaveLength(1);
    expect(line.x).toBe(319 - 30 * 8);
  });

  it("coupe aux espaces ; la dernière ligne reçoit un espace final (défaut de l'original)", () => {
    const lines = layoutCenteredText("AAAAAAA BBBBBBB CCCCCCC", 10, 100);
    expect(lines).toEqual([
      { text: "AAAAAAA BBBBBBB", x: 60 - 7 * 8 - 1, y: 100 - 4 * 6 },
      { text: "CCCCCCC ", x: 60 - 4 * 8 - 1, y: 100 - 4 * 6 + 8 },
    ]);
  });

  it("quand l'espace final ne tient plus, il passe sur une ligne à part", () => {
    // 15 lettres tiennent à x = 60, avec l'espace final elles font 16 caractères : plus de place
    const lines = layoutCenteredText(`${"A".repeat(7)} ${"B".repeat(7)} ${"C".repeat(15)}`, 10, 100);
    expect(lines.map((line) => line.text)).toEqual(["AAAAAAA BBBBBBB", "CCCCCCCCCCCCCCC", " "]);
  });

  it("écrit chaque ligne avec la police", () => {
    const font = new GameFont({ letters: [entry("A", 6, 0)], signs: [], accented: [] });
    const dest = new Plane();
    centerText(font, dest, syntheticSheet(), "A", 160, 100);
    // x = 160 - 0 - 1, y = 76
    expect(dest.at(159, 76)).toBe(11);
    expect(dest.at(166, 81)).toBe(11);
    expect(dest.at(167, 76)).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("police du jeu (95.ALG et CAR.ALG)", () => {
  const dat = parseDat(readOriginal("drascula.dat"));
  const font = new GameFont(dat.charMaps);
  const sheet = new Plane(parseAlg(readOriginal(FONT_SHEET)).pixels);

  /** Rectangle d'un plan sous forme de texte : `#` un pixel posé, `.` un pixel transparent ou vide. */
  const cell = (plane: Plane, x: number, y: number, width: number, height: number): string => {
    const rows: string[] = [];
    for (let row = 0; row < height; row++) {
      let line = "";
      for (let col = 0; col < width; col++) line += [0, TRANSPARENT].includes(plane.at(x + col, y + row)) ? "." : "#";
      rows.push(line);
    }
    return rows.join("/");
  };

  it("chaque caractère du texte français du jeu a un glyphe, sauf le tréma de « AÏOLI » et « AÏE »", () => {
    const missing = new Set<string>();
    for (const [name, languages] of Object.entries(dat.texts)) {
      for (const line of languages.fr ?? []) for (const code of encodeCp850(line)) if (!font.find(code)) missing.add(`${name}:${code}`);
    }
    expect([...missing]).toEqual(["text:216"]);
  });

  it("une phrase française avec accents : chaque glyphe est celui de la feuille, la minuscule accentuée prend la capitale", () => {
    const dest = new Plane();
    const phrase = "ÇA ÉTAIT À DEUXIèME ÂGE";
    font.print(dest, sheet, phrase, 8, 20);
    // « è » minuscule (octet 138) et « È » (212) ont le même glyphe : colonne 60, rangée 180
    expect(cell(dest, 8 + 8 * 16, 20, 8, 6)).toBe(cell(sheet, 60, 180, 8, 6));
    // « Ç » (128) : colonne 150, rangée des accentués
    expect(cell(dest, 8, 20, 8, 6)).toBe(cell(sheet, 150, 180, 8, 6));
    // « A » : rangée des lettres
    expect(cell(dest, 8 + 8, 20, 8, 6)).toBe(cell(sheet, font.glyphOrigin(0x41)!.x, 158, 8, 6));
    // les glyphes ne sont pas vides
    expect(cell(dest, 8 + 8, 20, 8, 6)).toContain("#");
    // la phrase tient sur une ligne à y = 20 : rien en dessous
    expect(cell(dest, 0, 28, 320, 6)).not.toContain("#");
  });

  it("les pixels des glyphes sont en 254, la couleur du texte", () => {
    const dest = new Plane();
    font.print(dest, sheet, "ABC", 0, 0);
    const used = new Set<number>(dest.pixels);
    expect([...used].sort()).toEqual([0, 254]);
  });

  it("les choix de dialogue : trois états, glyphes de 6 x 5 pris dans CAR.ALG", () => {
    const car = new Plane(parseAlg(readOriginal(DIALOG_FONT_SHEET)).pixels);
    const states = (["unselected", "selected", "clicked"] as const).map((state) => {
      const dest = new Plane();
      font.printChoice(dest, car, "Il l'a dit, ça va?", 0, state);
      return cell(dest, 0, 0, 120, 5);
    });
    expect(new Set(states).size).toBe(1); // même forme dans les trois états (seule la couleur change)
    expect(states[0]).toContain("#");
    const dest = new Plane();
    font.printChoice(dest, car, "A", 100, "selected");
    expect(cell(dest, 1, 100, 6, 5)).toBe(cell(car, 10, 31, 6, 5));
    expect(cell(dest, 1, 100, 6, 5)).toContain("#");
  });
});
