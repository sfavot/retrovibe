import { describe, expect, it } from "vitest";
import { CUT_HEADER_SIZE, parseCutaway } from "../../../src/games/fotaq/data/cut";
import { GameFiles } from "../../../src/games/fotaq/data/files";
import { parseQueenJas } from "../../../src/games/fotaq/data/jas";
import { dataFiles, hasOriginalFiles, readManifest, readOriginal } from "../helpers";

/** Construit un `.CUT` : les décalages de l'en-tête sont posés par `build`. */
class CutBuilder {
  readonly body: number[] = [];
  word(...values: number[]): this {
    for (const v of values) this.body.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  string(text: string): this {
    this.body.push(text.length);
    for (const char of text) this.body.push(char.charCodeAt(0));
    if (text.length) while (this.body.length % 2 !== 0) this.body.push(0);
    return this;
  }
  get position(): number {
    return this.body.length;
  }
}

/** Objet de 17 mots : {objectNumber, ..., animList, execute, limitX1, ..., fromObject, ..., room}. */
function objectWords(fields: Partial<Record<"objectNumber" | "animList" | "execute" | "limitX1" | "fromObject" | "room", number>>): number[] {
  const words = new Array(17).fill(0);
  words[0] = fields.objectNumber ?? 0;
  words[4] = fields.animList ?? 0;
  words[5] = fields.execute ?? 0;
  words[6] = fields.limitX1 ?? 0;
  words[12] = fields.fromObject ?? 0;
  words[15] = fields.room ?? 0;
  return words;
}

function sampleCut(options: { trailer?: number[]; flags?: number; count?: number } = {}): Uint8Array {
  const b = new CutBuilder();
  const count = options.count ?? 4;
  b.word(2, count, options.flags ?? -7, 0, 0, 0); // panneau, nombre d'objets, drapeaux, décalages à remplir
  // 1. Joe sans animation : personne (ou rien à animer), deux personnes à allumer.
  b.word(...objectWords({ objectNumber: 0, room: 5 })).word(2, 41, 42);
  // 2. Un objet exécuté avec une animation de deux images, morceau 9 (limitX1 = -9) ; -1 : image de Joe, retournée.
  b.word(...objectWords({ objectNumber: 77, animList: 3, execute: 1, limitX1: -9, room: 5 })).word(0);
  b.word(77, -4, 9, 0, 10, 20, 0, 0, 100, 0);
  b.word(-1, 6, 3, 13, 0, 0, 0, 0, 100, 0);
  b.word(-2);
  // 3. Un texte dit et affiché (objet -3), sans animation.
  b.word(...objectWords({ objectNumber: -3, room: 5 })).word(0);
  // 4. Un objet « copié depuis » un autre : pas d'animation même exécuté.
  b.word(...objectWords({ objectNumber: 80, execute: 1, fromObject: 81, room: 5 })).word(0);
  for (const word of options.trailer ?? [0]) b.word(word);
  const states = b.position;
  b.word(1, -34, 1, 12, 0, 0, 0); // un état : positionne l'état 34 à 1, montre l'objet 12
  b.word(5, 120, 90); // pièce, x, y finals de Joe
  b.word(1, 7, 0, 100, 50, 21, 0, 0).word(0, 0); // section supplémentaire : 1 entrée de 7 mots + 2 mots
  const sentences = b.position;
  b.string("*FL").string("Ouvre.*03").string("").string("Voilà!").string("*");
  const banks = b.position;
  b.word(2).string("").string("CUTBANK.BBK").string("dialog1.dog").word(80);
  b.body.push(0, 0, 0, 0);
  b.body[6] = (states >> 8) & 0xff;
  b.body[7] = states & 0xff;
  b.body[8] = (sentences >> 8) & 0xff;
  b.body[9] = sentences & 0xff;
  b.body[10] = (banks >> 8) & 0xff;
  b.body[11] = banks & 0xff;
  return Uint8Array.from([...new Array(CUT_HEADER_SIZE).fill(0), ...b.body]);
}

const noPerson = () => false;

describe("parseCutaway (données synthétiques)", () => {
  it("lit l'en-tête : panneau, objets, drapeaux (pièce finale, non sautable)", () => {
    const cut = parseCutaway(sampleCut({ flags: -7, count: -4 }), noPerson);
    expect(cut).toMatchObject({ panel: 2, objectCount: 4, skippable: false, flags: -7, finalRoom: 7, anotherCutaway: false });
    expect(parseCutaway(sampleCut({ flags: 1 }), noPerson)).toMatchObject({ skippable: true, finalRoom: 0, anotherCutaway: true });
  });

  it("lit les objets : personnes à allumer, morceau codé dans la borne x1, chaîne d'animations, phrases", () => {
    const cut = parseCutaway(sampleCut(), noPerson);
    expect(cut.objects.map((o) => [o.objectNumber, o.kind, o.sentence])).toEqual([
      [0, "person", "Ouvre.*03"],
      [77, "animation", ""],
      [-3, "textDisplayAndSpeak", "Voilà!"],
      [80, "noAnimation", "*"],
    ]);
    expect(cut.entrySentence).toBe("*FL");
    expect(cut.objects[0].people).toEqual([41, 42]);
    const animated = cut.objects[1];
    expect(animated.song).toBe(9);
    expect(animated.limit.x1).toBe(0);
    expect(animated.animations).toEqual([
      { object: 77, unpackFrame: 4, flip: true, speed: 9, bank: 0, mx: 10, my: 20, cx: 0, cy: 0, scale: 100, song: 0 },
      { object: 0, unpackFrame: 6, flip: false, speed: 3, bank: 13, mx: 0, my: 0, cx: 0, cy: 0, scale: 100, song: 0 },
    ]);
  });

  it("lit les états, la position finale de Joe, la section ignorée, les banques et le dialogue de fin", () => {
    const cut = parseCutaway(sampleCut(), noPerson);
    expect(cut.states).toEqual([{ stateIndex: -34, stateValue: 1, object: 12, area: 0, areaSubIndex: 0, fromObject: 0 }]);
    expect(cut.joeFinal).toEqual({ room: 5, x: 120, y: 90 });
    expect(cut.extra).toEqual({ entries: [[7, 0, 100, 50, 21, 0, 0]], trailer: [0, 0] });
    expect(cut.bankNameCount).toBe(2);
    expect(cut.bankNames).toEqual(["CUTBANK.BBK"]);
    expect(cut.talkFile).toBe("dialog1.dog");
    expect(cut.talkTo).toBe(80);
  });

  it("garde les mots de fin de la section des objets, que ScummVM ne lit pas", () => {
    expect(parseCutaway(sampleCut({ trailer: [0xfffe, 0] }), noPerson).recordsTrailer).toEqual([-2, 0]);
  });

  it("décide la nature d'un objet sans animation d'après la réponse de isPerson, sans changer la structure", () => {
    const base = sampleCut();
    // Objet 77 avec animList = 0 et execute = 1 : personne si isPerson(77), animation sinon, mais seulement
    // si l'on sait lire la suite ; ici l'objet 3 (animList = 3) est toujours une animation.
    const person = parseCutaway(base, (n) => n === 80);
    const none = parseCutaway(base, noPerson);
    expect(person.objects.map((o) => o.kind)).toEqual(none.objects.map((o) => o.kind));
    expect(person.states).toEqual(none.states);
  });

  it("rend le fondu de pièce (-1) comme l'objet 0 avec roomFade", () => {
    const bytes = sampleCut();
    bytes[CUT_HEADER_SIZE + 12] = 0xff;
    bytes[CUT_HEADER_SIZE + 13] = 0xff;
    const first = parseCutaway(bytes, noPerson).objects[0];
    expect(first).toMatchObject({ objectNumber: 0, roomFade: true, kind: "person" });
  });

  it("refuse une section hors ordre, des octets non nuls en trop et une cinématique trop courte", () => {
    expect(() => parseCutaway(new Uint8Array(CUT_HEADER_SIZE + 4), noPerson)).toThrow(/trop court/);
    const swapped = sampleCut();
    swapped[CUT_HEADER_SIZE + 7] = 1;
    swapped[CUT_HEADER_SIZE + 6] = 0xff;
    expect(() => parseCutaway(swapped, noPerson)).toThrow(/hors ordre|débordent|déborde/);
    const tail = sampleCut();
    tail[tail.length - 1] = 3;
    expect(() => parseCutaway(tail, noPerson)).toThrow(/dernier champ/);
  });
});

describe.skipIf(!hasOriginalFiles)("cinématiques .CUT du jeu", () => {
  const jas = parseQueenJas(readOriginal("QUEEN.JAS"));
  const isPerson = (n: number) => jas.objects[n].image === -3 || jas.objects[n].image === -4;
  const names = dataFiles("CUT");
  const cuts = new Map(names.map((name) => [name, parseCutaway(readOriginal(name), isPerson)]));
  const files = new GameFiles(hasOriginalFiles ? readManifest() : []);

  it("lit les 302 fichiers jusqu'au dernier octet : chaque section tombe exactement sur la suivante", () => {
    expect(names).toHaveLength(302);
    expect(cuts.size).toBe(302);
    for (const [name, cut] of cuts) {
      expect(cut.objects, name).toHaveLength(cut.objectCount);
      expect(cut.bankNames.length, name).toBeLessThanOrEqual(cut.bankNameCount);
    }
  });

  it("ne dépend pas, pour sa structure, de la nature des objets (isPerson toujours faux ou toujours vrai)", () => {
    for (const name of names) {
      const reference = cuts.get(name)!;
      for (const answer of [false, true]) {
        const cut = parseCutaway(readOriginal(name), () => answer);
        expect(cut.states, name).toEqual(reference.states);
        expect(cut.extra, name).toEqual(reference.extra);
        expect(cut.objects.map((o) => o.sentence), name).toEqual(reference.objects.map((o) => o.sentence));
      }
    }
  });

  it("compte les natures d'objets et les animations", () => {
    const kinds = new Map<string, number>();
    let animations = 0;
    for (const cut of cuts.values()) {
      for (const object of cut.objects) {
        kinds.set(object.kind, (kinds.get(object.kind) ?? 0) + 1);
        animations += object.animations.length;
      }
    }
    expect(Object.fromEntries([...kinds].sort())).toEqual({ animation: 728, noAnimation: 88, person: 1781, textDisplay: 12, textDisplayAndSpeak: 41, textSpeak: 61 });
    expect(animations).toBe(4554);
  });

  it("répartit les drapeaux : 98 non sautables, 59 à pièce finale, 5 qui enchaînent une autre, panneaux 0 (247) et 2 (55)", () => {
    const all = [...cuts.values()];
    expect(all.filter((cut) => !cut.skippable)).toHaveLength(98);
    expect(all.filter((cut) => cut.finalRoom > 0)).toHaveLength(59);
    expect(all.filter((cut) => cut.anotherCutaway)).toHaveLength(5);
    expect(all.filter((cut) => cut.panel === 0)).toHaveLength(247);
    expect(all.filter((cut) => cut.panel === 2)).toHaveLength(55);
  });

  it("cite des banques et des dialogues de fin qui existent tous dans queen.1c", () => {
    const talkFiles = new Set<string>();
    for (const [name, cut] of cuts) {
      for (const bank of cut.bankNames) expect(files.has(bank), `${name} : ${bank}`).toBe(true);
      if (cut.talkFile !== "*") {
        expect(files.has(cut.talkFile), `${name} : ${cut.talkFile}`).toBe(true);
        talkFiles.add(cut.talkFile.toLowerCase());
      }
    }
    expect(talkFiles.size).toBe(14);
    expect([...cuts.values()].filter((cut) => cut.talkFile === "*")).toHaveLength(287);
  });

  it("cite des numéros d'objets, de pièces et d'états dans les bornes des données logiques", () => {
    for (const [name, cut] of cuts) {
      for (const object of cut.objects) {
        expect(object.objectNumber, name).toBeLessThanOrEqual(jas.objectCount);
        expect(object.room, name).toBeLessThanOrEqual(jas.roomCount);
        for (const animation of object.animations) expect(animation.object, name).toBeLessThanOrEqual(jas.objectCount);
      }
      expect(cut.joeFinal.room, name).toBeLessThanOrEqual(jas.roomCount);
      for (const state of cut.states) expect(Math.abs(state.stateIndex), name).toBeLessThanOrEqual(jas.commands.states.length);
    }
  });

  it("est uniforme dans chaque fichier pour l'encodage des phrases : 220 en CP850, 4 en Latin-1, 78 sans accent", () => {
    const groups = { cp850: 0, latin1: [] as string[], ascii: 0, mixed: [] as string[] };
    for (const [name, cut] of cuts) {
      const encodings = new Set(cut.objects.map((o) => o.sentenceEncoding).filter((e) => e !== "ascii"));
      if (encodings.size > 1) groups.mixed.push(name);
      else if (encodings.has("cp850")) groups.cp850++;
      else if (encodings.has("latin1")) groups.latin1.push(name);
      else groups.ascii++;
    }
    expect(groups).toEqual({ cp850: 220, latin1: ["C13B.CUT", "C69C.CUT", "C75B.CUT", "CDINT.CUT"], ascii: 78, mixed: [] });
  });

  it("lit C21A.CUT en français : « Je voudrais acheter ceci. », puis la réponse du vendeur", () => {
    const cut = cuts.get("C21A.CUT")!;
    expect(cut.objects.map((o) => o.sentence)).toEqual(["*FRJe voudrais acheter ceci.*07", "Désolé, fiston, mais ça n'est pas à vendre.*01"]);
    expect(cut.objects.map((o) => o.kind)).toEqual(["person", "person"]);
    expect(cut.objects[0].people).toEqual([-1, 161]);
  });

  it("lance les génériques par une phrase « # » : CRED.CUT (credit1.crd) et C69G.CUT (credit2.crd)", () => {
    const hashes: string[] = [];
    for (const [name, cut] of cuts) for (const object of cut.objects) if (object.sentence.startsWith("#")) hashes.push(`${name} ${object.sentence}`);
    expect(hashes.sort()).toEqual(["C69G.CUT #credit2.crd", "CRED.CUT #credit1.crd"]);
  });

  it("garde à zéro les mots finals des enregistrements sauf dans 10 fichiers", () => {
    const nonZero = [...cuts].filter(([, cut]) => cut.recordsTrailer.some((word) => word !== 0)).map(([name]) => name);
    expect(nonZero.sort()).toEqual(["C25B.CUT", "C25F.CUT", "C69Z.CUT", "C71C.CUT", "C73E.CUT", "C73F.CUT", "C74A.CUT", "CDINT.CUT", "CINTR.CUT", "PC73E.CUT"]);
  });
});
