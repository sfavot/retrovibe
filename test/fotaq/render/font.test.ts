import { describe, expect, it } from "vitest";
import { parseCutaway } from "../../../src/games/fotaq/data/cut";
import { parseDog } from "../../../src/games/fotaq/data/dog";
import { CHAR_WIDTH, drawChar, drawText, glyphIndex, textWidth, toGlyphText } from "../../../src/games/fotaq/render/font";
import { FONT_REGULAR } from "../../../src/games/fotaq/render/font-data";
import { dataFiles, hasOriginalFiles, readOriginal } from "../helpers";
import { gameData } from "../engine/test-host";

/** Glyphe `index` sous forme de 8 chaînes de `#` et `.`. */
function picture(index: number): string[] {
  return Array.from({ length: 8 }, (_, y) => {
    const row = FONT_REGULAR[index * 8 + y];
    return Array.from({ length: 8 }, (_, x) => (row & (0x80 >> x) ? "#" : ".")).join("");
  });
}

const glyphOf = (char: string): Uint8Array => FONT_REGULAR.subarray(glyphIndex(char) * 8, glyphIndex(char) * 8 + 8);
const isEmpty = (glyph: Uint8Array): boolean => glyph.every((row) => row === 0);

describe("police 8 x 8 (display.cpp)", () => {
  it("a 256 glyphes de 8 octets", () => {
    expect(FONT_REGULAR.length).toBe(2048);
  });

  it("glyphes connus : « ! », « A » et « é » (position Latin-1)", () => {
    expect(picture(0x21)).toEqual(["##......", "##......", "##......", "##......", "........", "##......", "##......", "........"]);
    expect(picture(0x41)).toEqual(["..###...", ".#####..", "##...##.", "##...##.", "#######.", "##...##.", "##...##.", "........"]);
    expect(picture(0xe9)).toEqual(["....##..", "...##...", "..####..", ".##..##.", ".######.", ".##.....", "..####..", "........"]);
  });

  it("largeurs : colonne la plus à droite + 2, espace 4, accent circonflexe moins un", () => {
    expect(CHAR_WIDTH[0x21]).toBe(3);
    expect(CHAR_WIDTH[0x41]).toBe(8);
    expect(CHAR_WIDTH[0x49]).toBe(5);
    expect(CHAR_WIDTH[0x20]).toBe(4);
    expect(CHAR_WIDTH[0x5e]).toBe(8);
    expect(CHAR_WIDTH[0xe9]).toBe(8);
    expect(textWidth("AI !")).toBe(8 + 5 + 4 + 3);
    expect(textWidth("")).toBe(0);
  });

  it("les lettres du français existent aux positions Latin-1 et, sauf ä, ç et ÿ, aux positions CP850 avec le même dessin", () => {
    // Positions du code page 850 (celles du 437 pour ces lettres).
    const cp850: Record<string, number> = { à: 0x85, â: 0x83, é: 0x82, è: 0x8a, ê: 0x88, ë: 0x89, î: 0x8c, ï: 0x8b, ô: 0x93, ö: 0x94, ù: 0x97, û: 0x96, ü: 0x81, Ç: 0x80, É: 0x90 };
    for (const char of "àâäçéèêëîïôöùûüÿÇÉÀÈÊÎÔÙÛ") expect(isEmpty(glyphOf(char)), `${char} (Latin-1 0x${glyphIndex(char).toString(16)}) a un glyphe`).toBe(false);
    for (const [char, position] of Object.entries(cp850)) expect(picture(position), char).toEqual(picture(glyphIndex(char)));
    // Écarts de la police aux positions CP850 : `ä` et `ÿ` vides, `ç` dessiné comme `Ç`.
    expect(isEmpty(FONT_REGULAR.subarray(0x84 * 8, 0x84 * 8 + 8))).toBe(true);
    expect(isEmpty(FONT_REGULAR.subarray(0x98 * 8, 0x98 * 8 + 8))).toBe(true);
    expect(picture(0x87)).toEqual(picture(glyphIndex("Ç")));
    expect(picture(0x87)).not.toEqual(picture(glyphIndex("ç")));
    // Les majuscules accentuées ont un glyphe distinct de leur lettre de base, à leur position Latin-1.
    for (const [accented, base] of [["À", "A"], ["Â", "A"], ["È", "E"], ["Ê", "E"], ["Î", "I"], ["Ô", "O"], ["Ù", "U"], ["Û", "U"], ["Ï", "I"], ["Ë", "E"]]) {
      expect(picture(glyphIndex(accented))).not.toEqual(picture(glyphIndex(base)));
    }
  });

  it("remplace les caractères de Windows-1252 sans glyphe par leur forme ASCII", () => {
    expect(toGlyphText("œuvre… « l’été »")).toBe("oeuvre... « l'été »");
    expect(glyphIndex("é")).toBe(0xe9);
    expect(glyphIndex("→")).toBe(0x3f);
  });

  it("drawChar et drawText : pixels, contour en huit passes, rognage et arrêt au bord droit", () => {
    const screen = new Uint8Array(320 * 200);
    drawChar(screen, 10, 20, 9, 0x21);
    expect(screen[20 * 320 + 10]).toBe(9);
    expect(screen[20 * 320 + 11]).toBe(9);
    expect(screen[20 * 320 + 12]).toBe(0);
    expect(screen[24 * 320 + 10]).toBe(0);
    expect(screen[25 * 320 + 10]).toBe(9);

    const outlined = new Uint8Array(320 * 200);
    drawText(outlined, 10, 20, 9, "!", true, 16);
    expect(outlined[20 * 320 + 10]).toBe(9);
    expect(outlined[19 * 320 + 9]).toBe(16); // contour en haut à gauche
    expect(outlined[19 * 320 + 12]).toBe(16); // contour en haut à droite du pixel (11, 20)
    expect(outlined[24 * 320 + 10]).toBe(16); // la ligne vide entre les deux points est comblée par le contour

    // Hors écran : rogné sans erreur.
    drawText(new Uint8Array(320 * 200), -4, -3, 1, "AAAAAAAAAA", true, 2);
    drawText(new Uint8Array(320 * 200), 315, 195, 1, "AAA", true, 2);
  });
});

describe.skipIf(!hasOriginalFiles)("police : tous les textes du jeu sont lisibles", () => {
  it("chaque caractère des textes (objets, verbes, réponses, dialogues, cinématiques) a un glyphe ou un remplacement", () => {
    const data = gameData();
    const texts: string[] = [];
    const { texts: all } = data;
    for (const list of [all.objectDescriptions, all.objectNames, all.roomNames, all.verbs, all.joeResponses, all.actorNames]) texts.push(...list);
    for (const name of dataFiles("DOG")) {
      const dialog = parseDog(readOriginal(name));
      for (const sentence of [...dialog.joeSentences, ...dialog.personSentences]) texts.push(sentence.text);
      texts.push(dialog.person2.greeting, dialog.person2.joe);
    }
    for (const name of dataFiles("CUT")) {
      const cutaway = parseCutaway(readOriginal(name), () => false);
      for (const object of cutaway.objects) texts.push(object.sentence);
    }
    const missing = new Map<string, string>();
    for (const text of texts) {
      for (const char of toGlyphText(text)) {
        const glyph = glyphOf(char);
        if (char !== " " && (glyphIndex(char) === 0x3f && char !== "?" || isEmpty(glyph))) missing.set(char, text);
      }
    }
    // Les commandes `*` des répliques (`*FL`, `*12`) restent dans les phrases brutes : elles ne sont que des lettres et des chiffres.
    expect([...missing].map(([char, text]) => `${JSON.stringify(char)} dans ${JSON.stringify(text.slice(0, 40))}`)).toEqual([]);
    expect(texts.length).toBeGreaterThan(3000);
  });
});
