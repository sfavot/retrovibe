import { describe, expect, it } from "vitest";
import { lureData } from "./catalog-helper";
import { gameTextToUnicode } from "../../../src/games/lure/data/charset";
import { CharacterDecoder, LureTexts, composeText } from "../../../src/games/lure/data/strings";
import { hasOriginalFiles } from "./helpers";

const bytes = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));

/** Table : 'a' = 00, 'b' = 01, 'c' = 10, fin de texte (0) = 11 ; terminée par 0xFF. */
const DECODER = Uint8Array.from([...bytes("a00"), 0, ...bytes("b01"), 0, ...bytes("c10"), 0, 0, ...bytes("11"), 0, 0xff]);

/**
 * Ressource à deux textes : « ab » (bits `0 0 | 00 01 11` = `0x07`) puis « c » (`0 0 | 10 11` = `0x2C`).
 * En-tête : position des longueurs 6, des données 8 ; un mot de bloc ; longueurs 4 et 3 (unités de 2 bits).
 */
const STRINGS = Uint8Array.from([6, 0, 8, 0, 0, 0, 4, 3, 0x07, 0x2c]);

describe("CharacterDecoder (données synthétiques)", () => {
  it("lit les codes préfixes dans l'ordre du flux, le premier bit lu étant le bit de rang 0", () => {
    const decoder = new CharacterDecoder(DECODER);
    expect(decoder.size).toBe(4);
    expect([...decoder.characters].sort()).toEqual([0, 0x61, 0x62, 0x63]);
    const bits = [0, 1, 1, 0, 1, 1];
    let next = 0;
    expect([decoder.read(() => bits[next++]!), decoder.read(() => bits[next++]!), decoder.read(() => bits[next++]!)]).toEqual([0x62, 0x63, 0]);
  });

  it("refuse une séquence inconnue, un préfixe d'un autre code et une table mal terminée", () => {
    const only = new CharacterDecoder(Uint8Array.from([...bytes("a0"), 0, 0xff]));
    expect(() => only.read(() => 1)).toThrow(/inconnue/);
    expect(() => new CharacterDecoder(Uint8Array.from([...bytes("a0"), 0, ...bytes("b01"), 0, 0xff]))).toThrow(/préfixe|conflit/);
    expect(() => new CharacterDecoder(Uint8Array.from([...bytes("a0"), 0]))).toThrow(/0xFF/);
    expect(() => new CharacterDecoder(Uint8Array.from([...bytes("a0x"), 0, 0xff]))).toThrow(/inattendu/);
    expect(() => new CharacterDecoder(Uint8Array.from([...bytes("a0"), 0, 0xff, 0]))).toThrow(/après la marque/);
  });
});

describe("LureTexts (données synthétiques)", () => {
  const names = Uint8Array.from([4, 0, 6, 0, ...bytes("x"), 0, ...bytes("yz"), 0]);
  const texts = new LureTexts(names, [STRINGS, STRINGS, STRINGS], DECODER);

  it("positionne chaque texte d'après la somme des longueurs qui le précèdent", () => {
    expect(texts.count(0)).toBe(2);
    expect(gameTextToUnicode(composeText(texts, texts.decodeAt(0, 0)))).toBe("ab");
    expect(gameTextToUnicode(composeText(texts, texts.decodeAt(0, 1)))).toBe("c");
    expect(() => texts.decodeAt(0, 2)).toThrow(RangeError);
  });

  it("choisit la ressource d'après l'identifiant et remappe selon la pièce", () => {
    expect(texts.locate(5)).toEqual({ set: 0, index: 5 });
    expect(texts.locate(0x7d0 + 3)).toEqual({ set: 1, index: 3 });
    expect(texts.locate(0xfa0 + 4)).toEqual({ set: 2, index: 4 });
    expect(texts.locate(0x7d0 + 3, 0x2a)).toEqual({ set: 0, index: 0x76 });
    expect(texts.locate(0x7d0 + 3, 0x29)).toEqual({ set: 1, index: 3 });
    expect(texts.locate(0xfa0 + 4, 0x29)).toEqual({ set: 0, index: 0x76 });
    expect(texts.locate(0xfa0 + 4, 0x2a)).toEqual({ set: 2, index: 4 });
  });

  it("ignore les bits d'article de l'identifiant et renvoie rien pour l'identifiant 0", () => {
    expect(texts.decode(0)).toBeUndefined();
    expect(texts.decode(0x2000)).toBeUndefined();
    expect(texts.decode(0x2000 | 1)?.parts).toEqual(texts.decode(1)?.parts);
  });

  it("lit les noms par indice", () => {
    expect(texts.nameCount).toBe(2);
    expect(String.fromCharCode(...texts.nameCodes(1))).toBe("yz");
    expect(() => texts.nameCodes(2)).toThrow(RangeError);
  });
});

describe("composeText", () => {
  const texts = new LureTexts(Uint8Array.from([2, 0, 0]), [STRINGS, STRINGS, STRINGS], DECODER);
  const text = {
    includeArticles: true,
    parts: [{ kind: "text", value: "Prends " }, { kind: "hotspot" }, { kind: "text", value: " de " }, { kind: "character" }] as const,
    codes: [],
    startBit: 0,
    endBit: 0,
  };

  it("insère les noms, avec l'article quand le texte les accepte, et saute un nom absent", () => {
    const articles = ["", "les ", "le "];
    expect(composeText(texts, { ...text, parts: [...text.parts] }, { hotspotName: "pot", characterName: "Ratpouch", hotspotArticle: 3, characterArticle: 0, articles })).toBe("Prends le pot de Ratpouch");
    expect(composeText(texts, { ...text, parts: [...text.parts] }, { hotspotName: "pot", articles })).toBe("Prends pot de ");
    expect(composeText(texts, { ...text, parts: [...text.parts], includeArticles: false }, { hotspotName: "pot", characterName: "R", hotspotArticle: 3, articles })).toBe("Prends pot de R");
  });
});

describe.skipIf(!hasOriginalFiles)("textes du jeu", () => {
  const texts = () => lureData().texts;
  const sets = [0, 1, 2] as const;

  it("compte 400, 1 278 et 126 textes et 83 fragments de noms ; la table de décodage a 145 codes", () => {
    expect(sets.map((set) => texts().count(set))).toEqual([400, 1278, 126]);
    expect(texts().nameCount).toBe(83);
    expect(texts().characterDecoder.size).toBe(145);
  });

  it("décode les 1 804 textes sans séquence inconnue ni texte non terminé, et chaque caractère a un glyphe", () => {
    const { font } = lureData();
    let total = 0;
    for (const set of sets) {
      for (let index = 0; index < texts().count(set); index++) {
        const text = texts().decodeAt(set, index);
        total++;
        for (const code of text.codes.filter((c) => c < 0xa0)) expect(font.has(code), `texte ${set}/${index} code 0x${code.toString(16)}`).toBe(true);
        expect(text.codes.length).toBeLessThan(400);
      }
    }
    expect(total).toBe(1804);
    for (let name = 0; name < texts().nameCount; name++) for (const code of texts().nameCodes(name)) expect(font.has(code), `nom ${name}`).toBe(true);
  });

  it("chaque code que la table de décodage sait produire a un glyphe (hors fin de texte et fragments de noms)", () => {
    const { font } = lureData();
    for (const code of texts().characterDecoder.characters) {
      if (code === 0 || code >= 0xa0) continue;
      expect(font.has(code), `code 0x${code.toString(16)}`).toBe(true);
    }
  });

  it("les textes se suivent dans le flux : 2 à 20 bits de remplissage entre deux textes, au plus 18 bits après le dernier", () => {
    for (const set of sets) {
      let previousEnd = -1;
      let last = 0;
      for (let index = 0; index < texts().count(set); index++) {
        const text = texts().decodeAt(set, index);
        if (previousEnd >= 0) {
          expect(text.startBit - previousEnd, `texte ${set}/${index}`).toBeGreaterThanOrEqual(2);
          expect(text.startBit - previousEnd, `texte ${set}/${index}`).toBeLessThanOrEqual(20);
        }
        previousEnd = text.endBit;
        last = text.endBit;
      }
      const size = lureData().resources.size([0x10, 0x11, 0x12][set]!);
      expect(size * 8 - last).toBeGreaterThanOrEqual(0);
      expect(size * 8 - last).toBeLessThanOrEqual(18);
    }
  });

  // Textes lus à l'écran dans les ressources, vérifiés avec le jeu (identifiants cités par ScummVM : titre des pièces, messages d'état).
  it.each([
    [2, "La Cellule Extérieure"],
    [9, "Le Portail du Château"],
    [45, "La Salle à manger"],
    [151, "Ça t'apprendra à te moquer de nous autres, les Skorl!"],
    [380, "Vous êtes sûr (o/n)?"],
    [0x7d0, "Salut, raconte-moi quelque chose d'intéressant."],
    [0xfa0, "CAVE A VIN. La salle aux murs de pierre est fraîche et remplie des vapeurs douces et enivrantes du vin."],
  ])("le texte %i est « %s »", (id, expected) => {
    expect(gameTextToUnicode(composeText(texts(), texts().decode(id)!))).toBe(expected);
  });

  it("insère le nom du hotspot et du personnage (« Mais monsieur, je n'ai pas %1. »)", () => {
    const text = texts().decode(106)!;
    expect(text.includeArticles).toBe(true);
    expect(gameTextToUnicode(composeText(texts(), text, { hotspotName: "bijou", hotspotArticle: 0 }))).toBe("Mais monsieur, je n'ai pas bijou.");
  });

  it("remplace les identifiants hors de la plage de la pièce par le texte 0x76 (« ? »)", () => {
    const remapped = texts().decode(0x7d0 + 5, 0x2a)!;
    expect(gameTextToUnicode(composeText(texts(), remapped))).toBe("?");
    expect(texts().decode(0xfa0, 5)).toEqual(remapped);
  });
});
