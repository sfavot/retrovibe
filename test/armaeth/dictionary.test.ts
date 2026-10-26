import { describe, expect, it } from "vitest";
import { lookupWord, parseDictionary, wordClass, wordKind, wordRole } from "../../src/games/armaeth/data/dictionary";
import { MessageTable, normalizeText, parseAccentTable, parsePlainMessages } from "../../src/games/armaeth/data/text";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("dictionnaire : fonctions pures", () => {
  it("déduit classe et rôle du code", () => {
    expect(wordClass(22021)).toBe(22);
    expect(wordRole(1008)).toBe("preposition");
    expect(wordRole(22021)).toBe("verb");
    expect(wordRole(26001)).toBe("ignored");
    expect(wordRole(9003)).toBe("noun");
  });

  it("classe 13 : emplacement du verbe, sens « nom magique » ; classes 4, 9, 6, 15, 19 et chiffres : nominaux", () => {
    expect(wordRole(13001)).toBe("verb");
    expect(wordKind(13001)).toBe("magic-name");
    expect(wordRole(24009)).toBe("verb");
    expect(wordKind(24009)).toBe("system-command");
    for (const code of [4003, 6001, 9003, 15217, 19001, 7]) expect(wordRole(code)).toBe("noun");
    expect(wordKind(4003)).toBe("decor-mobile");
    expect(wordKind(9003)).toBe("decor");
    expect(wordKind(7)).toBe("number");
    expect(wordKind(26005)).toBe("article");
    expect(wordKind(99000)).toBeUndefined();
  });

  it("cherche par préfixe et ignore un s ou x final", () => {
    const entries = [
      { code: 1, word: "arbre" },
      { code: 2, word: "arbuste" },
      { code: 3, word: "chene" },
    ];
    expect(lookupWord(entries, "arbre")).toEqual([1]);
    expect(lookupWord(entries, "arbres")).toEqual([1]);
    expect(lookupWord(entries, "chenes")).toEqual([3]);
    expect(lookupWord(entries, "arb")).toEqual([]);
    expect(lookupWord(entries, "inconnu")).toEqual([]);
  });

  it("refuse une taille incohérente", () => {
    expect(() => parseDictionary(Uint8Array.of(2, 0, 0, 0))).toThrow(/DIC invalide/);
  });
});

describe("ordre des codes de `gm_dic_lookup` (1dd4:0156)", () => {
  const entry = (code: number) => ({ code, word: "mot" });
  const filler = (word: string, code: number) => ({ code, word });

  it("le mot du milieu de la dichotomie d'abord, puis le balayage vers le bas, puis vers le haut", () => {
    // 7 mots : mid = 6, hi = 6 -> comparaison avec le dernier (« zzz » > « mot ») : lo = 6 ... puis (6+6)/2 : la dichotomie s'arrête
    // sur le dernier mot seulement s'il correspond ; ici le mot cherché est avant lui : hi = 6, lo = 0 -> mid = 3
    const entries = [filler("a", 1), filler("b", 2), entry(10), entry(11), entry(12), entry(13), filler("zzz", 3)];
    expect(lookupWord(entries, "mot")).toEqual([11, 10, 12, 13]);
  });

  it("doublon remplacé par le dernier code du tableau", () => {
    const entries = [filler("a", 1), entry(10), entry(11), entry(10), entry(12), filler("z", 2)];
    // mid : 5 -> (0+5)>>1 = 2 : 11 ; bas : 10 ; haut : 10, 12 -> [11, 10, 10, 12] -> doublon (indice 2) cède la place à 12
    expect(lookupWord(entries, "mot")).toEqual([11, 10, 12]);
  });

  it("s'arrête à 60 codes", () => {
    const entries = Array.from({ length: 100 }, (_, i) => entry(i + 1));
    expect(lookupWord(entries, "mot")).toHaveLength(60);
  });
});

describe.skipIf(!hasOriginalFiles)("dictionnaire d'Armaeth (fichiers du jeu)", () => {
  const entries = parseDictionary(readOriginal("A1FDIC.SYS"));
  const messages = new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));

  it("lit 669 mots triés, tous non vides et sans remplissage", () => {
    expect(entries).toHaveLength(669);
    expect(entries[0]).toEqual({ code: 1008, word: "a" });
    expect(entries.every((e) => /^[a-z]+$/.test(e.word) && e.word.length <= 13)).toBe(true);
    const words = entries.map((e) => e.word);
    expect(words).toEqual([...words].sort());
  });

  it("les classes sont celles attendues", () => {
    const classes = new Set(entries.map((e) => wordClass(e.code)));
    expect([...classes].sort((a, b) => a - b)).toEqual([1, 4, 6, 9, 13, 15, 19, 22, 24, 26]);
    expect(entries.filter((e) => wordRole(e.code) === "preposition")).toHaveLength(18);
    expect(entries.filter((e) => wordRole(e.code) === "ignored")).toHaveLength(9);
    expect(entries.every((e) => wordKind(e.code) !== undefined)).toBe(true);
  });

  it("les codes des classes 4, 9, 15 et 22 sont des identifiants de message", () => {
    for (const e of entries) {
      if ([4, 9, 15, 22].includes(wordClass(e.code))) expect(messages.has(e.code), e.word).toBe(true);
    }
    expect(messages.messages(4003)).toMatch(/abeilles/);
  });

  it("« clef » : sens dans l'ordre de l'original (108, 22, 6, 109, 331), sous DOSBox-X", () => {
    expect(lookupWord(entries, "clef").map((c) => c % 1000)).toEqual([108, 22, 6, 109, 331]);
  });

  it("retrouve les synonymes et le pluriel", () => {
    const attack = lookupWord(entries, "frapper");
    expect(attack).toEqual([22021]);
    expect(lookupWord(entries, "assommer")).toEqual(attack);
    expect(lookupWord(entries, "abeilles")).toEqual([4003]);
    expect(lookupWord(entries, "armaeth")).toEqual([13001]);
    const accents = parseAccentTable(parsePlainMessages(readOriginal("MSGINT")));
    expect(lookupWord(entries, normalizeText("brûler", accents))).toContain(22001);
  });
});
