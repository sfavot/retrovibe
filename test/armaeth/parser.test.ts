import { describe, expect, it } from "vitest";
import { type DictionaryEntry, parseDictionary, wordClass, wordRole } from "../../src/games/armaeth/data/dictionary";
import { parseAccentTable, parsePlainMessages } from "../../src/games/armaeth/data/text";
import { parseWorld } from "../../src/games/armaeth/data/world";
import {
  type ResolverObject,
  type ResolverWorld,
  isExecutable,
  needsRetry,
  normalize,
  parseCommand,
  resolveNoun,
  resolveObjects,
  tokenize,
} from "../../src/games/armaeth/engine/parser";
import { hasOriginalFiles, readOriginal } from "./helpers";

// Table d'accents du message 10 de MSGINT, recopiée (parser.md § 3) pour les tests sans fichiers du jeu.
const ACCENTS = new Map(
  [..."//::--áaàaâaäaéeèeêeëeíiìiîiïióoòoôoöoúuùuûuüuçcÇCåaÄaÅaæaÆaÉEÿyÖOÜUñnÑN"].reduce<string[][]>((pairs, c, i) => {
    if (i % 2 === 0) pairs.push([c]);
    else pairs[pairs.length - 1].push(c);
    return pairs;
  }, []) as [string, string][],
);

const DICT: DictionaryEntry[] = [
  { code: 1008, word: "a" },
  { code: 1001, word: "dans" },
  { code: 1007, word: "avec" },
  { code: 9003, word: "arbre" },
  { code: 15006, word: "cle" },
  { code: 15021, word: "coffre" },
  { code: 15108, word: "clef" },
  { code: 22005, word: "regarder" },
  { code: 22006, word: "prendre" },
  { code: 22015, word: "mettre" },
  { code: 22021, word: "frapper" },
  { code: 24009, word: "score" },
  { code: 26001, word: "l" },
  { code: 26001, word: "la" },
  { code: 26001, word: "le" },
  { code: 26001, word: "les" },
  { code: 26002, word: "un" },
  { code: 4020, word: "braise" },
  { code: 6001, word: "objet" },
  { code: 13001, word: "armaeth" },
  { code: 22007, word: "fouiller" },
  { code: 15222, word: "ecu" },
  { code: 19001, word: "cabane" },
  { code: 9099, word: "chauvesouris" },
  { code: 1005, word: "devant" },
  { code: 22040, word: "devant" },
  { code: 15300, word: "devant" },
].sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));

const parse = (text: string) => parseCommand(text, DICT, ACCENTS);

describe("normalisation (§ 3)", () => {
  it("minuscules, accents retirés, séparateurs réduits à une espace", () => {
    expect(normalize("  Prendre   la CLé !", ACCENTS)).toBe("prendre la cle");
    expect(normalize("brûler,l'épée.", ACCENTS)).toBe("bruler l epee");
  });

  it("garde / : - et les chiffres dans les mots", () => {
    expect(normalize("chauve-souris 12", ACCENTS)).toBe("chauve-souris 12");
    expect(normalize("a/b:c", ACCENTS)).toBe("a/b:c");
  });

  it("majuscules accentuées É Ç Ö Ü Ñ : restent des majuscules ASCII (anomalie de l'original)", () => {
    expect(normalize("École", ACCENTS)).toBe("Ecole");
    expect(normalize("ÇA", ACCENTS)).toBe("Ca"); // Ç→C reste majuscule, A→a
    expect(normalize("ÉCU", ACCENTS)).toBe("Ecu");
  });

  it("les contrôles et la ponctuation sont des séparateurs, jamais en tête ni doublés", () => {
    expect(normalize("\t?!a\x07\x01 b..", ACCENTS)).toBe("a b");
    expect(tokenize(normalize(" a  b ", ACCENTS))).toEqual(["a", "b"]);
    expect(normalize("", ACCENTS)).toBe("");
  });
});

describe("remplissage des emplacements (§ 5)", () => {
  it("verbe + groupe nominal ; les articles disparaissent", () => {
    expect(parse("prendre la clé")).toMatchObject({ status: "ok", verb: 22006, preposition: 0, direct: [15006], indirect: [] });
    expect(parse("PRENDRE UN COFFRE").direct).toEqual([15021]);
  });

  it("préposition suivie d'un nom : complément indirect", () => {
    expect(parse("mettre la clef dans le coffre")).toMatchObject({
      verb: 22015,
      preposition: 1,
      direct: [15108],
      indirect: [15021],
    });
  });

  it("préposition avant le premier nom : il devient indirect", () => {
    expect(parse("regarder dans le coffre")).toMatchObject({ preposition: 1, direct: [], indirect: [15021] });
  });

  it("deux groupes nominaux sans préposition : le second est indirect avec « à » (8)", () => {
    expect(parse("frapper clef coffre")).toMatchObject({ preposition: 8, direct: [15108], indirect: [15021] });
  });

  it("un second verbe est jeté sans message", () => {
    expect(parse("prendre regarder la clé")).toMatchObject({ status: "ok", verb: 22006, direct: [15006] });
    expect(parse("prendre regarder").verb).toBe(22006);
  });

  it("une seconde préposition est jetée", () => {
    expect(parse("mettre clef dans avec coffre")).toMatchObject({ preposition: 1, indirect: [15021] });
  });

  it("classes 13 et 24 occupent l'emplacement du verbe", () => {
    expect(parse("armaeth").verb).toBe(13001);
    expect(parse("score").verb).toBe(24009);
  });

  it("un mot inconnu arrête l'analyse : saisie conservée", () => {
    const p = parse("prendre truc");
    expect(p).toMatchObject({ status: "unknown-word", unknownWord: "truc" });
    expect(needsRetry(p)).toBe(true);
    expect(parse("nord").status).toBe("unknown-word");
  });

  it("trois groupes nominaux : refus", () => {
    const p = parse("frapper clef coffre arbre");
    expect(p.status).toBe("too-many-nouns");
    expect(needsRetry(p)).toBe(true);
    // Avec préposition : direct, indirect, puis un troisième groupe.
    expect(parse("mettre clef dans coffre arbre").status).toBe("too-many-nouns");
  });

  it("phrase vide : rien à faire, la ligne revient", () => {
    expect(parse("   ").status).toBe("empty");
    expect(needsRetry(parse(""))).toBe(true);
  });

  it("ligne commençant par / : jeton de script, non analysée", () => {
    expect(parse("/dgs 99").status).toBe("script");
  });

  it("pluriel : s ou x final retiré", () => {
    expect(parse("prendre les clés").direct).toEqual([15006]);
    expect(parse("prendre un coffres").direct).toEqual([15021]);
  });

  it("préfixe de 8 lettres significatives", () => {
    expect(parse("chauvesouris").direct).toEqual([9099]);
    expect(parseCommand("prendre coffreXY", DICT, ACCENTS, 6).direct).toEqual([15021]);
  });

  it("un mot à la fois préposition et verbe : le premier code libre l'emporte et le mot est consommé", () => {
    // « devant » : préposition 5 (premier code dans l'ordre du dictionnaire), les autres sens sont perdus.
    const p = parse("devant");
    expect(p.preposition).toBe(5);
    expect(p.verb).toBe(0);
    expect(p.direct).toEqual([]);
  });

  it("un nombre tapé devient son propre code (atoi)", () => {
    expect(parse("22006")).toMatchObject({ status: "ok", verb: 22006 });
    expect(parse("prendre 7").direct).toEqual([7]);
    expect(parse("prendre 12abc").direct).toEqual([12]);
  });

  it("isExecutable : verbe requis, préposition avec complément indirect", () => {
    expect(isExecutable(parse("prendre la clé"))).toBe(true);
    expect(isExecutable(parse("regarder"))).toBe(true);
    expect(isExecutable(parse("la clé"))).toBe(false);
    expect(isExecutable(parse("dans le coffre"))).toBe(false);
    expect(isExecutable(parse("avec"))).toBe(false);
    expect(isExecutable(parse("regarder dans"))).toBe(false);
    expect(needsRetry(parse("la clé"))).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("analyseur sur les fichiers du jeu", () => {
  const dictionary = parseDictionary(readOriginal("A1FDIC.SYS"));
  const accents = parseAccentTable(parsePlainMessages(readOriginal("MSGINT")));
  const cfg = parseWorld(readOriginal("A1FCFG.SYS"));
  const heroObject = cfg.objects.find((o) => o.serial === cfg.header.heroSerial)!;

  /** Monde de test : le héros de `CFG` déplacé dans `room` ; visible si `hidden` nul, à portée dans la salle. */
  function fakeWorld(room: number): ResolverWorld {
    const hero = { ...heroObject, location: 1, container: room };
    const objects = cfg.objects.map((o) => (o.serial === hero.serial ? hero : o));
    return {
      objects,
      hero,
      room,
      isVisible: (o) => (o as (typeof objects)[number]).hidden === 0,
      isInReach: () => true,
      distanceSquared: (o) => {
        const w = o as (typeof objects)[number];
        return (w.x - hero.x) ** 2 + (w.p - hero.p) ** 2;
      },
      hasDecor: () => false,
    };
  }

  const parseReal = (text: string) => parseCommand(text, dictionary, accents, cfg.header.dictionaryLetters);

  it("chaque mot du dictionnaire est analysé selon sa classe", () => {
    for (const { code, word } of dictionary) {
      const p = parseReal(word);
      const role = wordRole(code);
      if (role === "ignored") {
        expect(p, word).toMatchObject({ status: "ok", verb: 0, preposition: 0, direct: [], indirect: [] });
      } else if (role === "preposition") {
        // Mot consommé comme préposition (ou, si un autre sens verbal vient d'abord, comme verbe).
        expect(p.status, word).toBe("ok");
        expect(p.preposition !== 0 || p.verb !== 0 || p.direct.length > 0, word).toBe(true);
      } else if (role === "verb") {
        expect(p.status, word).toBe("ok");
        expect(p.preposition !== 0 || p.verb !== 0 || p.direct.length > 0, word).toBe(true);
        if (p.verb !== 0) expect(["verb"], word).toContain(wordRole(p.verb));
      } else {
        expect(p.status, word).toBe("ok");
        const all = [...p.direct, ...p.indirect, p.verb, p.preposition].filter((c) => c !== 0);
        expect(all.length, word).toBeGreaterThan(0);
      }
    }
  });

  it("mots à sens unique : chaque classe va dans le bon emplacement", () => {
    const unique = (code: number) => dictionary.filter((e) => e.code === code).length === 1;
    const single = (e: DictionaryEntry) => parseReal(e.word);
    const byClass = (cls: number) => dictionary.find((e) => wordClass(e.code) === cls && unique(e.code) && single(e).status === "ok");
    expect(single(byClass(22)!).verb).toBe(byClass(22)!.code);
    expect(single(byClass(24)!).verb).toBe(byClass(24)!.code);
    expect(single(byClass(13)!).verb).toBe(byClass(13)!.code);
    expect(single(byClass(15)!).direct).toContain(byClass(15)!.code);
    expect(single(byClass(9)!).direct).toContain(byClass(9)!.code);
  });

  it("l'anomalie des majuscules accentuées coûte la reconnaissance du mot", () => {
    expect(parseReal("brûler").status).toBe("ok");
    expect(parseReal("brûler").verb).toBe(22001);
    expect(parseReal("École").status).toBe("unknown-word");
    expect(parseReal("École").unknownWord).toBe("Ecole");
  });

  // Exemple 1 (parser.md § 14.1) : « prendre la clé », clef d'or posée dans la salle 11.
  it("« prendre la clé » : verbe 22006, cinq clefs, la clef d'or (Num 6) est trouvée dans la salle", () => {
    const p = parseReal("prendre la clé");
    expect(p).toMatchObject({ status: "ok", normalized: "prendre la cle", verb: 22006, preposition: 0, indirect: [] });
    expect([...p.direct].sort()).toEqual([15006, 15022, 15108, 15109, 15331]);
    expect(isExecutable(p)).toBe(true);
    const resolved = resolveObjects(p, fakeWorld(11));
    expect(resolved.indirect).toEqual([]);
    const found = resolved.direct.flatMap((n) => n.objects);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ flagA: 0, flagB: 7 });
    expect(found[0].object).toMatchObject({ num: 6, serial: 146 });
    expect(resolved.direct.find((n) => n.code === 15006)!.objects).toHaveLength(1);
    // Ailleurs (salle 1) la clef n'est pas là.
    expect(resolveObjects(p, fakeWorld(1)).direct.flatMap((n) => n.objects)).toEqual([]);
  });

  // Exemple 2 (§ 14.2) : « regarder » seul.
  it("« regarder » : verbe 22005 seul, sans aucun nom", () => {
    for (const text of ["regarder", "voir", "r"]) {
      expect(parseReal(text)).toMatchObject({ status: "ok", verb: 22005, preposition: 0, direct: [], indirect: [] });
    }
    expect(parseReal("regarder la clé").direct).toHaveLength(5);
  });

  // Exemple 3 (§ 14.4) : « mettre la clef dans le coffre ».
  it("« mettre la clef dans le coffre » : 5 clefs directes, « dans » (1), 3 coffres indirects, contenu du coffre", () => {
    const p = parseReal("mettre la clef dans le coffre");
    expect(p).toMatchObject({ status: "ok", verb: 22015, preposition: 1 });
    expect(p.direct).toHaveLength(5);
    expect([...p.indirect].sort()).toEqual([15021, 15110, 15319]);
    // Le coffre Num 21 (série 160) est dans la salle 3 et contient la clef Num 22 (série 139).
    const world = fakeWorld(3);
    const resolved = resolveObjects(p, world);
    const chest = resolved.indirect.find((n) => n.code === 15021)!.objects[0];
    expect(chest.object).toMatchObject({ num: 21, serial: 160 });
    expect(resolved.indirect.find((n) => n.code === 15110)!.objects).toEqual([]);
    // La clef contenue n'est pas visible seule dans la salle…
    expect(resolved.direct.flatMap((n) => n.objects)).toEqual([]);
    // …mais le complément par le contenu du coffre la retrouve (A = B = 0).
    const inside = resolveNoun(15022, world, chest.object);
    expect(inside.objects).toHaveLength(1);
    expect(inside.objects[0]).toMatchObject({ flagA: 0, flagB: 0, distance: 0 });
    expect(inside.objects[0].object.serial).toBe(139);
    expect(resolveNoun(15006, world, chest.object).objects).toEqual([]);
  });

  // Exemple 4 (§ 14.3) : « nord ».
  it("« nord » : mot absent du dictionnaire", () => {
    const p = parseReal("nord");
    expect(p.status).toBe("unknown-word");
    expect(needsRetry(p)).toBe(true);
  });
});

describe("résolution des objets (§ 6.2)", () => {
  const obj = (serial: number, num: number, location: number, container: number, x = 0): ResolverObject & { x: number } => ({
    serial,
    num,
    location,
    container,
    x,
  });
  const hero = obj(1, 1, 1, 5);
  function world(objects: (ResolverObject & { x: number })[], extra: Partial<ResolverWorld> = {}): ResolverWorld {
    return {
      objects: [hero, ...objects],
      hero,
      room: 5,
      isVisible: () => true,
      isInReach: () => true,
      distanceSquared: (o) => (o as ResolverObject & { x: number }).x ** 2,
      hasDecor: (code) => code === 9003,
      ...extra,
    };
  }

  it("inventaire d'abord, puis du plus proche au plus loin", () => {
    const far = obj(10, 6, 1, 5, 50);
    const near = obj(11, 6, 1, 5, 5);
    const held = obj(12, 6, 2, hero.serial);
    const elsewhere = obj(13, 6, 1, 9, 1);
    const r = resolveNoun(15006, world([far, near, held, elsewhere]));
    expect(r.objects.map((o) => [o.object.serial, o.flagA, o.flagB])).toEqual([
      [12, 1, 7],
      [11, 0, 7],
      [10, 0, 7],
    ]);
  });

  it("n'inclut que les objets visibles, et au plus dix", () => {
    const many = Array.from({ length: 14 }, (_, i) => obj(20 + i, 6, 1, 5, i));
    expect(resolveNoun(15006, world(many)).objects).toHaveLength(10);
    const hidden = world([obj(30, 6, 1, 5)], { isVisible: () => false });
    expect(resolveNoun(15006, hidden).objects).toEqual([]);
  });

  it("le héros lui-même porte le drapeau A = 7", () => {
    const r = resolveNoun(15001, world([]));
    expect(r.objects).toHaveLength(1);
    expect(r.objects[0]).toMatchObject({ flagA: 7, flagB: 7 });
  });

  it("drapeau B à 0 hors de portée, distance bornée", () => {
    const o = obj(40, 6, 1, 5, 1000);
    const r = resolveNoun(15006, world([o], { isInReach: () => false }));
    expect(r.objects[0]).toMatchObject({ flagB: 0, distance: 64000 });
  });

  it("héros contenu dans un objet : la portée est le contenu de ce conteneur", () => {
    const inside: ResolverObject & { x: number } = { ...hero, location: 2, container: 77 };
    const sibling = obj(50, 6, 2, 77);
    const outside = obj(51, 6, 1, 5);
    const w: ResolverWorld = { ...world([sibling, outside]), objects: [inside, sibling, outside], hero: inside };
    expect(resolveNoun(15006, w).objects.map((o) => o.object.serial)).toEqual([50]);
  });

  it("décor (classes 4 et 9) : présence testée dans la salle ; autres classes sans objet", () => {
    const w = world([]);
    expect(resolveNoun(9003, w)).toMatchObject({ kind: "decor", decorPresent: true });
    expect(resolveNoun(9004, w)).toMatchObject({ kind: "decor", decorPresent: false });
    expect(resolveNoun(6001, w)).toMatchObject({ kind: "other", objects: [] });
  });

  it("complément par le contenu : un seul ajout, pas de doublon", () => {
    const chest = obj(60, 21, 1, 5);
    const key = obj(61, 22, 2, 60);
    const w = world([chest, key]);
    expect(resolveNoun(15022, w, chest).objects.map((o) => o.object.serial)).toEqual([61]);
    // Clef aussi visible hors du coffre (même série) : jamais ajoutée deux fois.
    expect(resolveNoun(15022, { ...w, objects: [...w.objects] }, chest).objects).toHaveLength(1);
  });
});
