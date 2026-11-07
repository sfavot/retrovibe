import { describe, expect, it } from "vitest";
import { encodeCp850 } from "../../../src/data/cp850";
import { DAT_LANGUAGES, DAT_TEXT_NAMES, parseDat } from "../../../src/games/drascula/data/dat";
import { GameFiles } from "../../../src/games/drascula/data/files";
import { hasOriginalFiles, readManifest, readOriginal } from "../helpers";

const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const s16 = u16;
const list = (count: number, make: (i: number) => number[]) => [...u16(count), ...Array.from({ length: count }, (_, i) => make(i)).flat()];

/** Bloc de textes d'une langue : remplissage de 2 octets puis, par ligne, longueur totale, chaîne NUL, remplissage. */
function textBlock(lines: string[]): number[] {
  const body = lines.flatMap((line) => {
    const raw = [...encodeCp850(line), 0];
    const pad = 4 - ((raw.length + 2) % 4);
    return [...u16(raw.length + pad + 2), ...raw, ...new Array<number>(pad).fill(0)];
  });
  return [...u16(2 + body.length), 0, 0, ...body];
}

function buildDat(options: { version?: number; lines?: string[]; languages?: number } = {}): Uint8Array {
  const lines = options.lines ?? ["", "Où ça?"];
  const languages = options.languages ?? 6;
  const sections = DAT_TEXT_NAMES.flatMap(() => [
    ...u16(lines.length),
    ...Array.from({ length: languages }, (_, language) => textBlock(language === 3 ? lines : lines.map((line) => `L${language}${line}`))).flat(),
  ]);
  return Uint8Array.from([
    ...encodeCp850("DRASCULA"),
    options.version ?? 7,
    ...u16(1), ...u16(1), ...u16(1), ...u16(1), // quatre tables de caractères d'une entrée
    65, ...s16(6), 0, 66, ...s16(15), 0, 200, ...s16(24), 1, 160, ...s16(33), 2,
    ...list(2, (i) => [...s16(10 + i), ...s16(20 + i)]), // itemLocations
    ...list(1, () => [...s16(1), ...s16(2)]), // x_pol / y_pol
    ...list(3, (i) => s16(6 + i)), // verbBarX
    ...list(1, () => [...s16(3), ...s16(4)]), // menu
    ...list(2, (i) => s16(i)), // frameX
    ...list(1, () => [...s16(14), ...s16(158)]), // bougies
    ...list(1, () => s16(1)), // pianistX
    ...list(1, () => s16(1)), // drunkX
    ...list(1, () => Array.from({ length: 10 }, (_, i) => s16(i + 1)).flat()), // roomPreUpdates
    ...list(0, () => []), // roomUpdates
    ...list(1, () => [...s16(5), ...s16(-1), ...s16(3), ...s16(-1), ...s16(54)]), // roomActions
    ...list(1, () => [...s16(1), ...s16(2), ...s16(16), ...s16(2)]), // talkSequences
    ...u16(languages),
    ...sections,
  ]);
}

describe("parseDat (données synthétiques)", () => {
  it("lit les tables, les langues et les textes, et consomme tout le fichier", () => {
    const bytes = buildDat();
    const dat = parseDat(bytes);
    expect(dat.version).toBe(7);
    expect(dat.bytesRead).toBe(bytes.length);
    expect(dat.charMaps.letters).toEqual([{ inChar: 65, mappedChar: 6, charType: 0 }]);
    expect(dat.charMaps.accented).toEqual([{ inChar: 160, mappedChar: 33, charType: 2 }]);
    expect(dat.itemLocations).toEqual([{ x: 10, y: 20 }, { x: 11, y: 21 }]);
    expect(dat.verbBarX).toEqual([6, 7, 8]);
    expect(dat.roomPreUpdates[0]).toEqual({ room: 1, flag: 2, flagValue: 3, sourceX: 4, sourceY: 5, destX: 6, destY: 7, width: 8, height: 9, type: 10 });
    expect(dat.roomActions).toEqual([{ room: 5, chapter: -1, action: 3, objectId: -1, speechId: 54 }]);
    expect(dat.talkSequences).toEqual([{ chapter: 1, sequence: 2, commandType: 16, action: 2 }]);
    expect(dat.languageCount).toBe(6);
    expect(Object.keys(dat.lineCounts)).toEqual([...DAT_TEXT_NAMES]);
    expect(dat.texts.text.fr).toEqual(["", "Où ça?"]);
    expect(dat.texts.text.en).toBeUndefined();
  });

  it("décode les langues demandées, les autres sont vérifiées sans être gardées", () => {
    const dat = parseDat(buildDat(), { languages: ["en", "fr", "it"] });
    expect(dat.texts.textd.en).toEqual(["L0", "L0Où ça?"]);
    expect(dat.texts.textd.it).toEqual(["L4", "L4Où ça?"]);
    expect(dat.texts.textd.de).toBeUndefined();
  });

  it("refuse le russe, qui n'est pas en CP850", () => {
    expect(() => parseDat(buildDat(), { languages: ["ru"] })).toThrow(/russe/);
  });

  it("refuse une signature, une version ou une structure incorrectes", () => {
    expect(() => parseDat(new Uint8Array(4))).toThrow(/signature/);
    expect(() => parseDat(buildDat({ version: 6 }))).toThrow(/version 6/);
    const bytes = buildDat();
    expect(() => parseDat(bytes.subarray(0, bytes.length - 3))).toThrow();
    // Remplissage non nul dans une ligne : le dernier octet du fichier est un octet de remplissage.
    const dirty = bytes.slice();
    dirty[dirty.length - 1] = 1;
    expect(() => parseDat(dirty)).toThrow(/mal formée/);
  });
});

describe.skipIf(!hasOriginalFiles)("drascula.dat du jeu", () => {
  const bytes = readOriginal("drascula.dat");
  const dat = parseDat(bytes, { languages: ["en", "es", "de", "fr", "it"] });

  it("est de version 7, signature DRASCULA, consommé jusqu'au dernier octet sans reste", () => {
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe("DRASCULA");
    expect(dat.version).toBe(7);
    expect(bytes.length).toBe(259625);
    expect(dat.bytesRead).toBe(259625);
  });

  it("a six langues dont le français à l'index 3", () => {
    expect(dat.languageCount).toBe(6);
    expect(DAT_LANGUAGES).toEqual(["en", "es", "de", "fr", "it", "ru"]);
    expect(DAT_LANGUAGES.indexOf("fr")).toBe(3);
  });

  it("compte 15 sections de textes, avec le nombre de lignes attendu dans chaque langue", () => {
    expect(DAT_TEXT_NAMES).toHaveLength(15);
    expect(dat.lineCounts).toEqual({
      text: 501, textd: 84, textb: 15, textbj: 29, texte: 24, texti: 33, textl: 32, textp: 20, textt: 25, textvb: 63, textsys: 4, texthis: 5, textverbs: 6, textmisc: 7, textd1: 11,
    });
    for (const name of DAT_TEXT_NAMES) {
      for (const language of ["en", "es", "de", "fr", "it"] as const) expect(dat.texts[name][language], `${name} ${language}`).toHaveLength(dat.lineCounts[name]);
    }
  });

  it("a les tables de caractères, positions et réponses du moteur, avec leurs tailles", () => {
    expect([dat.charMaps.letters.length, dat.charMaps.signs.length, dat.charMaps.cyrillic.length, dat.charMaps.accented.length]).toEqual([30, 30, 66, 33]);
    expect(dat.itemLocations).toHaveLength(44);
    expect(dat.inventoryCells).toHaveLength(44);
    expect(dat.verbBarX).toEqual([6, 51, 96, 141, 186, 232, 276, 321]);
    expect(dat.menuPoints).toHaveLength(29);
    expect(dat.frameX).toHaveLength(20);
    expect(dat.candles).toEqual([{ x: 14, y: 158 }, { x: 19, y: 172 }, { x: 24, y: 186 }]);
    expect(dat.pianistX).toHaveLength(9);
    expect(dat.drunkX).toHaveLength(8);
    expect(dat.roomPreUpdates).toHaveLength(41);
    expect(dat.roomUpdates).toHaveLength(16);
    expect(dat.roomActions).toHaveLength(307);
    expect(dat.talkSequences).toHaveLength(225);
  });

  it("lit le français : accents CP850, majuscules accentuées et minuscules codées pour la police", () => {
    const fr = (name: (typeof DAT_TEXT_NAMES)[number]) => dat.texts[name].fr!;
    expect(fr("text")[1]).toBe("C'EST LA DEUXIèME PORTE LA PLUS GRANDE QUE J'AI VUE DANS MA VIE.");
    expect(fr("textd")[1]).toBe("HÉ IGOR, COMMENT ÇA AVANCE?");
    expect(fr("textsys")[0]).toBe("APPUYEZ À NOUVEAU SUR 'SUPR' POUR RECOMMENCER");
    expect(fr("textverbs")).toEqual(["regarder", "ramasser", "ouvrir", "fermer", "parler", "pousser"]);
    expect(fr("textmisc")[0]).toBe("BOSSU");
    // Premières lignes lisibles du français dans chaque section : non vides, en français.
    for (const name of DAT_TEXT_NAMES) expect(fr(name)[1].length, name).toBeGreaterThan(0);
    expect(dat.texts.text.en![1]).toBe("THAT'S THE SECOND BIGGEST DOOR I'VE SEEN IN MY LIFE");
  });

  it("garde les écarts de la version française d'origine : texthis en casse mixte avec Ê et Â, textd1 en chiffres", () => {
    const history = dat.texts.texthis.fr!.join("\n");
    expect(history).toContain("Être prÊt");
    expect(history).toContain("chÂteau");
    expect(history).toContain("passÉ ce jour lÀ");
    for (const digits of dat.texts.textd1.fr!) expect(digits).toMatch(/^[0-9]+$/);
  });

  it("n'a aucun caractère de contrôle dans les textes", () => {
    for (const name of DAT_TEXT_NAMES) {
      for (const lines of Object.values(dat.texts[name])) for (const line of lines ?? []) expect(line, name).not.toMatch(/[\u0000-\u001f]/);
    }
  });

  it("a des numéros de voix qui tiennent dans le tableau de textes correspondant", () => {
    const files = new GameFiles(readManifest());
    const sections: Record<string, (typeof DAT_TEXT_NAMES)[number]> = {
      "": "text", D: "textd", BJ: "textbj", E: "texte", I: "texti", L: "textl", P: "textp", T: "textt", VB: "textvb",
    };
    const voices = files.voices();
    for (const [prefix, section] of Object.entries(sections)) {
      const numbers = voices.get(prefix)!;
      expect(Math.max(...numbers), prefix).toBeLessThan(dat.lineCounts[section]);
    }
    // Exception : les voix B vont jusqu'à 62 alors que textb n'a que 15 lignes.
    expect(Math.max(...voices.get("B")!)).toBeGreaterThan(dat.lineCounts.textb);
  });
});
