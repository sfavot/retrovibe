import { describe, expect, it } from "vitest";
import { DOG_HEADER_SIZE, parseDog } from "../../../src/games/fotaq/data/dog";
import { GameFiles } from "../../../src/games/fotaq/data/files";
import { dataFiles, hasOriginalFiles, readManifest, readOriginal } from "../helpers";

/** Construit un `.DOG` : les chaînes sont alignées sur la position absolue (après les 20 octets d'en-tête). */
class DogBuilder {
  readonly body: number[] = [];
  word(...values: number[]): this {
    for (const v of values) this.body.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  string(text: string, align: number): this {
    this.body.push(text.length);
    for (const char of text) this.body.push(char.charCodeAt(0));
    if (text.length) while (this.body.length % align !== 0) this.body.push(0);
    return this;
  }
  get position(): number {
    return this.body.length;
  }
  set(position: number, value: number): void {
    this.body[position] = (value >> 8) & 0xff;
    this.body[position + 1] = value & 0xff;
  }
  build(): Uint8Array {
    return Uint8Array.from([...new Array(DOG_HEADER_SIZE).fill(0), ...this.body]);
  }
}

/** Dialogue à un niveau, 1 phrase de Joe (tête 0, `*FR`), 2 du personnage, cutscene `c1a.CUT`. */
function sampleDog(levelMax = 1, extraTail = 0): Uint8Array {
  const b = new DogBuilder();
  b.word(levelMax, 7, 9, 1, 2); // levelMax, uniqueKey, talkKey, jMax, pMax
  b.word(5, 6, -3, 0, 0, 0); // deux conditions
  b.word(0, 0, 0); // décalages à remplir
  b.word(0, Math.abs(levelMax));
  for (let level = 0; level < Math.abs(levelMax); level++) {
    for (let option = 0; option < 6; option++) b.word(0, option === 0 ? 1 : 5 + option, 0, option, 0, -2, 0, 3);
  }
  const joe = b.position;
  b.word(0, 0).string("*FR", 4);
  const person = b.position;
  b.word(0, 0).string("0", 4);
  b.word(0, 1).string("Salut!*01", 4);
  const cutaway = b.position;
  b.word(53, 0).string("c1a.CUT", 2);
  while (b.position % 4 !== 0) b.body.push(0);
  const person2 = b.position;
  b.string("Re!", 2).string("Ah.", 2);
  for (let i = 0; i < extraTail; i++) b.body.push(0);
  b.set(22, person);
  b.set(24, cutaway);
  b.set(26, person2);
  expect(joe).toBe(32 + Math.abs(levelMax) * 96);
  return b.build();
}

describe("parseDog (données synthétiques)", () => {
  it("lit l'en-tête, l'arbre, les trois sections de phrases et la cutscene", () => {
    const dog = parseDog(sampleDog());
    expect(dog).toMatchObject({ levelCount: 1, cannotQuit: false, uniqueKey: 7, talkKey: 9, jMax: 1, pMax: 2, reservedHeader: [0, 1] });
    expect(dog.conditions[0]).toEqual({ state: 5, value: 6, item: -3 });
    expect(dog.tree).toHaveLength(1);
    expect(dog.tree[0]).toHaveLength(6);
    expect(dog.tree[0][0]).toEqual({ head: 1, node: 0, stateIndex: -2, stateValue: 3, reserved: [0, 0, 0, 0] });
    expect(dog.joeSentences).toEqual([{ head: 0, text: "*FR", encoding: "ascii" }]);
    expect(dog.personSentences).toEqual([
      { head: 0, text: "0", encoding: "ascii" },
      { head: 1, text: "Salut!*01", encoding: "ascii" },
    ]);
    expect(dog.cutaway).toEqual({ state: 53, value: 0, file: "c1a.CUT" });
    expect(dog.person2).toEqual({ greeting: "Re!", joe: "Ah." });
  });

  it("lit un niveau maximal négatif comme un dialogue qu'on ne peut pas quitter", () => {
    const dog = parseDog(sampleDog(-1));
    expect(dog.cannotQuit).toBe(true);
    expect(dog.levelCount).toBe(1);
  });

  it("compte le remplissage nul de fin de fichier", () => {
    expect(parseDog(sampleDog(1, 10)).padding).toBeGreaterThanOrEqual(10);
  });

  it("refuse des données non nulles après la dernière chaîne, un fichier trop court et une section mal enchaînée", () => {
    const withTail = sampleDog(1, 4);
    withTail[withTail.length - 1] = 9;
    expect(() => parseDog(withTail)).toThrow(/après la dernière chaîne/);
    expect(() => parseDog(new Uint8Array(30))).toThrow(/trop court/);
    const broken = sampleDog();
    broken[DOG_HEADER_SIZE + 23] += 4;
    expect(() => parseDog(broken)).toThrow(/finit en/);
  });
});

describe.skipIf(!hasOriginalFiles)("dialogues .DOG du jeu", () => {
  const names = dataFiles("DOG");
  const dogs = new Map(names.map((name) => [name, parseDog(readOriginal(name))]));
  const files = new GameFiles(hasOriginalFiles ? readManifest() : []);

  it("lit les 73 fichiers jusqu'au dernier octet : sections enchaînées exactement, reste nul", () => {
    expect(names).toHaveLength(73);
    expect(dogs.size).toBe(73);
    for (const [name, dog] of dogs) {
      expect(dog.jMax, name).toBe(dog.joeSentences.length);
      expect(dog.pMax, name).toBe(dog.personSentences.length);
      expect(dog.reservedHeader[1], name).toBe(dog.levelCount);
    }
  });

  it("répartit les niveaux : 1 niveau (5 fichiers) à 17 niveaux (1 fichier), dont 9 dialogues qu'on ne peut pas quitter", () => {
    const histogram = new Map<number, number>();
    for (const dog of dogs.values()) histogram.set(dog.levelCount, (histogram.get(dog.levelCount) ?? 0) + 1);
    expect(Object.fromEntries([...histogram].sort((a, b) => a[0] - b[0]))).toEqual({ 1: 5, 2: 5, 3: 8, 4: 11, 5: 10, 6: 12, 7: 7, 8: 3, 9: 1, 10: 5, 11: 4, 14: 1, 17: 1 });
    expect([...dogs.values()].filter((dog) => dog.cannotQuit)).toHaveLength(9);
  });

  it("lit AND1.DOG : 5 niveaux sans sortie, clé 2, voix 02xxxx", () => {
    const and1 = dogs.get("AND1.DOG")!;
    expect(and1).toMatchObject({ levelCount: 5, cannotQuit: true, uniqueKey: 2, talkKey: 2, jMax: 18, pMax: 15 });
    expect(and1.joeSentences[0]).toEqual({ head: 0, text: "*FR", encoding: "ascii" });
    expect(and1.personSentences[1].text).toBe("*FLTu ne pourrais même pas piloter dans un simulateur!*02");
    expect(and1.cutaway.file).toBe("c75b.CUT");
  });

  it("commence chaque arbre par la tête 1 du personnage, et chaque section par la tête 0", () => {
    for (const [name, dog] of dogs) {
      expect(dog.tree[0][0].head, name).toBe(1);
      expect(dog.joeSentences[0].head, name).toBe(0);
      expect(dog.personSentences[0].head, name).toBe(0);
    }
  });

  it("garde les mots que ScummVM ne lit pas à zéro, sauf -1 (65535) à la position 2 ou 4 d'une option retirée", () => {
    const seen = new Set<number>();
    for (const dog of dogs.values()) {
      for (const level of dog.tree) {
        for (const option of level) {
          expect([option.reserved[0], option.reserved[3]]).toEqual([0, 0]);
          seen.add(option.reserved[1]);
          seen.add(option.reserved[2]);
        }
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 65535]);
  });

  it("lit CHIEF1.DOG en français : « Bonjour... Je suis Joe King, pilote privé. »", () => {
    const chief = dogs.get("CHIEF1.DOG")!;
    const texts = [...chief.joeSentences, ...chief.personSentences].map((sentence) => sentence.text);
    expect(texts.some((text) => text === "*19*18*18Bonjour...*17Je suis Joe King, pilote privé.*17")).toBe(true);
  });

  it("est uniforme dans chaque fichier : 60 en CP850, 12 en Latin-1 (dont CHIEF1 et CHIEF2), 1 sans accent", () => {
    const groups = { cp850: [] as string[], latin1: [] as string[], ascii: [] as string[] };
    const counts = { ascii: 0, cp850: 0, latin1: 0 };
    for (const [name, dog] of dogs) {
      const encodings = new Set<string>();
      for (const sentence of [...dog.joeSentences, ...dog.personSentences]) {
        counts[sentence.encoding]++;
        if (sentence.encoding !== "ascii") encodings.add(sentence.encoding);
      }
      expect(encodings.size, name).toBeLessThanOrEqual(1);
      (encodings.has("cp850") ? groups.cp850 : encodings.has("latin1") ? groups.latin1 : groups.ascii).push(name);
    }
    expect(groups.cp850).toHaveLength(60);
    expect(groups.ascii).toEqual(["DOG.DOG"]);
    expect(groups.latin1).toEqual(["BOB1.DOG", "BOB2.DOG", "BOB3.DOG", "BOB5.DOG", "BUD1.DOG", "BUD2.DOG", "CHIEF1.DOG", "CHIEF2.DOG", "ORACLE3.DOG", "TAM4.DOG", "WEDGE.DOG", "ZOMBIE2.DOG"]);
    expect(counts).toEqual({ ascii: 932, cp850: 1169, latin1: 246 });
  });

  it("décode toutes les phrases en caractères français : aucun contrôle, aucun symbole de page de code mal choisie", () => {
    // Les textes mélangent le CP850 et le Latin-1 (voir `decodeGameText`) : une détection fausse laisserait
    // des symboles ou des lettres étrangères.
    const allowed = /^[\u0013 -~àâäçéèêëîïôöùûüÿœÀÂÇÉÈÊËÎÏÔÖÙÛÜŒ«»°]*$/;
    for (const [name, dog] of dogs) {
      for (const sentence of [...dog.joeSentences, ...dog.personSentences]) expect(sentence.text, name).toMatch(allowed);
      expect(dog.person2.greeting, name).toMatch(allowed);
      expect(dog.person2.joe, name).toMatch(allowed);
    }
  });

  it("référence des cinématiques de fin qui existent toutes", () => {
    const referenced = new Set<string>();
    for (const dog of dogs.values()) if (dog.cutaway.file) referenced.add(dog.cutaway.file);
    expect(referenced.size).toBe(21);
    for (const file of referenced) expect(files.has(file), file).toBe(true);
  });

  it("donne à chaque dialogue sa propre clé de voix (`talkKey`), entre 1 et 84", () => {
    const keys = new Set([...dogs.values()].map((dog) => dog.talkKey));
    expect(keys.size).toBe(73);
    expect(Math.min(...keys)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...keys)).toBeLessThanOrEqual(84);
  });
});
