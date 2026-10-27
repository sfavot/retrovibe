import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { FAMILY } from "../../src/games/armaeth/engine/handlers";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { DGROUP_OFFSET, KEY_TABLE_OFFSET, keyTableWords } from "../../src/games/armaeth/game/helpers";
import { parseDictionary } from "../../src/games/armaeth/data/dictionary";
import { parseAccentTable, parsePlainMessages } from "../../src/games/armaeth/data/text";
import { parseCommand } from "../../src/games/armaeth/engine/parser";
import { registerObjectHandlers } from "../../src/games/armaeth/game/objects";
import { registerVerbs } from "../../src/games/armaeth/game/verbs";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/** Gestionnaires de la famille 1 d'*Armaeth* (objects.md § 4) joués de bout en bout par `submitLine` sur les vraies données. */

/** `V008`, `V015`... : identifiant lisible d'un message. */
function label(id: number): string {
  const cls = Math.floor(id / 1000);
  const n = String(id % 1000).padStart(3, "0");
  return cls >= 30 ? `${cls}:${n}` : `${String.fromCharCode(64 + cls)}${n}`;
}

class Session {
  readonly host = new TestHost();
  readonly engine = new ArmaethEngine(this.host, { seed: 1, bare: true });
  shown: string[] = [];
  private snapshot: Uint8Array | null = null;

  constructor() {
    this.run(2000);
    for (let i = 0; this.engine.windows.active && i < 40; i++) this.click();
    this.run(320);
    registerVerbs(this.engine.registry);
    registerObjectHandlers(this.engine.registry);
    (this.engine as unknown as { sayId: (id: number) => void }).sayId = (id) => void this.shown.push(label(id));
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.engine.tick();
  }

  click(): void {
    this.host.pointer(100, 100, 1);
    this.engine.tick();
    this.host.pointer(100, 100, 0);
    this.engine.tick();
  }

  /** Mémorise le monde au départ, puis y revient avant chaque test. */
  mark(): void {
    this.engine.saveGame("test");
    this.snapshot = this.host.storage.read("test");
  }

  reset(): void {
    this.host.storage.write("test", this.snapshot!);
    this.engine.loadGame("test");
    this.run(6);
    this.shown = [];
    vi.restoreAllMocks();
  }

  get state() {
    return this.engine.state!;
  }

  get hero(): GameObject {
    return this.state.hero!;
  }

  /** Objet neuf dans la salle chargée, à côté du héros. */
  put(num: number, fields: Partial<GameObject> = {}): GameObject {
    const obj = this.state.createObject({ typ: 2, num, pickable: 7, presence: 2, ...fields });
    this.state.moveToRoom(obj, this.state.loadedRoom!);
    obj.x = this.hero.x;
    obj.y = this.hero.y;
    obj.p = this.hero.p;
    obj.plane = this.hero.plane;
    return obj;
  }

  /** Objet neuf dans l'inventaire du héros. */
  give(num: number, fields: Partial<GameObject> = {}): GameObject {
    const obj = this.state.createObject({ typ: 2, num, pickable: 7, presence: 8, ...fields });
    this.state.moveToContainer(obj, this.hero);
    return obj;
  }

  say(line: string): string[] {
    this.shown = [];
    this.engine.submitLine(line);
    return this.shown;
  }
}


describe.skipIf(!hasOriginalFiles)("tables de clés, serrures et portes (DGROUP:0676)", () => {
  it("les constantes embarquées sont celles de l'EXE", () => {
    const exe = readOriginal("AM1.EXE");
    const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
    const words = keyTableWords();
    const read = words.map((_, i) => view.getUint16(DGROUP_OFFSET + KEY_TABLE_OFFSET + 2 * i, true));
    expect(read).toEqual(words);
  });
});

const dictionary = () => parseDictionary(readOriginal("A1FDIC.SYS"));
const accents = () => parseAccentTable(parsePlainMessages(readOriginal("MSGINT")));

describe.skipIf(!hasOriginalFiles)("gestionnaires d'objet (famille 1)", () => {
  let s: Session;
  beforeAll(() => {
    s = new Session();
    s.mark();
  });
  beforeEach(() => s.reset());

  it("registerObjectHandlers : 36 adresses, 46 clés moins le défaut", () => {
    const keys = [3, 4, 9, 12, 16, 17, 18, 20, 21, 27, 101, 102, 103, 105, 108, 110, 111, 113, 114, 115, 201, 202, 203, 204, 210, 212, 301, 302, 303, 304, 305, 308, 309, 310, 311, 315, 316, 317, 319, 324, 327, 328, 329, 332, 334];
    expect(keys).toHaveLength(45);
    const handlers = new Set<unknown>();
    for (const key of keys) {
      const handler = s.engine.registry.get(FAMILY.direct, key);
      expect(handler, `clé ${key}`).toBeDefined();
      handlers.add(handler);
    }
    expect(handlers.size).toBe(36);
  });

  it("coffre fermé à clef : sans clef V014, mauvaise clef V047, bonne clef ouvre (Ego 2, Fig 1)", () => {
    const chest = s.put(21, { ego: 0, canContain: 7, pickable: 0 });
    expect(s.say("ouvrir le coffre")).toEqual(["V014"]);
    s.give(6);
    expect(s.say("ouvrir le coffre avec la clef")).toEqual(["V047"]);
    s.give(22);
    expect(s.say("ouvrir le coffre avec la clef")).toEqual(["V015"]);
    expect([chest.ego, chest.fig]).toEqual([2, 1]);
    expect(s.say("ouvrir le coffre")).toEqual(["V045"]);
  });

  it("coffre : fermer puis fermer à clef ; fouiller un coffre fermé V051", () => {
    const chest = s.put(21, { ego: 2, canContain: 7, pickable: 0 });
    s.give(22);
    expect(s.say("fermer le coffre")).toEqual(["V015"]);
    expect(chest.ego).toBe(1);
    expect(s.say("fouiller le coffre")).toEqual(["V051"]);
    expect(s.say("fermer le coffre avec la clef")).toEqual(["V049"]);
    expect(chest.ego).toBe(0);
  });

  it("coffre loin : réaction armée et V008", () => {
    const chest = s.put(21, { ego: 1, canContain: 7, pickable: 0 });
    chest.x += 150;
    let armed: GameObject | null = null;
    vi.spyOn(s.engine, "armReaction").mockImplementation((_c, t) => ((armed = t), false));
    expect(s.say("ouvrir le coffre")).toEqual(["V008"]);
    expect(armed).toBe(chest);
    expect(chest.ego).toBe(1);
  });

  it("torche : allumer au feu rapporte 5 points une seule fois (score 0/1)", () => {
    const torch = s.give(12, { ego: 8, fig: 8, weight: 5 });
    s.put(18, { ego: 5, pickable: 0 });
    const before = s.state.score;
    expect(s.say("allumer la torche avec le feu")).toEqual(["V015"]);
    expect(s.state.score).toBe(before + 5);
    expect(torch.ego).toBe(3);
    expect(torch.tim).toBe(36000);
    expect(s.say("allumer la torche avec le feu")).toEqual(["V012"]);
    expect(s.state.score).toBe(before + 5);
  });

  it("torche : éteindre, puis V018 si déjà éteinte", () => {
    // `2420:0398` lit `Fig` (égal à `Ego` pour une torche allumée) : `Ego` et `Fig` passent à 6
    const torch = s.give(12, { ego: 2, fig: 2 });
    expect(s.say("eteindre la torche")).toEqual(["V015"]);
    expect([torch.ego, torch.fig]).toEqual([6, 6]);
    expect(s.say("eteindre la torche")).toEqual(["V018"]);
  });

  it("feu mort : allumer V011 ; éteindre un feu vivant V019", () => {
    const fire = s.put(18, { ego: 0, pickable: 0 });
    expect(s.say("allumer le feu")).toEqual(["V011"]);
    fire.ego = 4;
    expect(s.say("eteindre le feu")).toEqual(["V019"]);
  });

  /** Le héros se tient devant le battant (la porte se replace à la position de la table quand elle bouge). */
  const standAt = (door: GameObject) => {
    s.hero.x = door.x;
    s.hero.p = door.p + 2;
  };

  it("porte à serrure : mauvaise clef V082, bonne clef ouvre à la position de la table", () => {
    const door = s.put(111, { ego: 0, pickable: 0 });
    s.give(22);
    // `V082` (clé reconnue, priorité 3) puis `V013` (les autres sens de « clef », sans objet : `4dca == 0`, `20b5:0171`), jamais `V014`
    expect(s.say("ouvrir la porte avec la clef")).toEqual(["V082", "V013"]);
    s.give(109);
    expect(s.say("ouvrir la porte avec la clef")).toEqual(["V015"]);
    expect(door.ego).toBe(2);
    expect([door.x, door.p, door.fig]).toEqual([96, 24, 1]) // `Y` est recalculé par `placer`;
    standAt(door);
    expect(s.say("ouvrir la porte")).toEqual(["V083"]);
    expect(s.say("fermer la porte avec la clef")).toEqual(["V085"]);
    expect(door.ego).toBe(0);
  });

  it("porte à serrure : sans clef en main V013 (priorité 3, `20b5:0171`) et non V014 ; fermer une porte ouverte avec la mauvaise clef la referme d'abord (`20b5:01b8`)", () => {
    const door = s.put(111, { ego: 0, pickable: 0 });
    expect(s.say("ouvrir la porte avec la clef")).toEqual(["V013"]);
    door.ego = 2;
    [door.x, door.p] = [112, 24]; // position du battant fermé côté A : il y reste après avoir été refermé
    s.hero.x = 112;
    s.hero.p = 26;
    s.give(22);
    expect(s.say("fermer la porte avec la clef")).toEqual(["V082", "V013"]);
    expect(door.ego).toBe(1); // refermée, non verrouillée
  });

  it("porte à serrure, candidats de « clef » dans l'ordre de `gm_dic_lookup` (108, 22, 6, 109, 331) : V082 puis V013, comme sous DOSBox-X", () => {
    s.put(111, { ego: 0, pickable: 0 });
    s.give(6);
    const parsed = parseCommand("ouvrir la porte avec la clef", dictionary(), accents(), s.state.dictionaryLetters);
    expect(parsed.indirect).toEqual([15108, 15022, 15006, 15109, 15331]); // `lookupWord` rend l'ordre de l'original
    s.shown = [];
    s.engine.execute(parsed);
    expect(s.shown).toEqual(["V082", "V013"]);
  });

  it("stèle : ouverture à la clef en or devant la serrure ; ailleurs V057", () => {
    const slab = s.put(16, { ego: 0, pickable: 0 });
    s.give(6);
    s.hero.ground = 1;
    expect(s.say("ouvrir la stele avec la clef")).toEqual(["V057"]);
    s.hero.ground = 0x24;
    expect(s.say("ouvrir la stele avec la clef")).toEqual(["V061"]);
    expect(slab.ego).toBe(2);
    expect(s.say("ouvrir la stele avec la clef")).toEqual(["V029"]);
  });

  it("stèle : redémarrage après les ronces (Ego 5) puis déblocage : 20 points (score 0/2)", () => {
    const slab = s.put(16, { ego: 5, pickable: 0 });
    s.give(6);
    s.hero.ground = 0x24;
    const before = s.state.score;
    expect(s.say("ouvrir la stele avec la clef")).toEqual(["V060"]);
    expect(slab.ego).toBe(1);
    expect(s.state.score).toBe(before + 20);
  });

  it("inscription : nettoyer (5 points) puis lire (5 points)", () => {
    const text = s.put(115, { ego: 0, pickable: 0 });
    const before = s.state.score;
    expect(s.say("lire l'inscription")).toEqual(["V131"]);
    expect(s.say("nettoyer l'inscription")).toEqual(["V138"]);
    expect([text.ego, text.fig]).toEqual([1, 1]);
    expect(s.state.score).toBe(before + 5);
    expect(s.say("lire l'inscription")).toEqual(["V130"]);
    expect(s.state.score).toBe(before + 10);
  });

  it("Prytwen assommé : le prendre (10 points), le jeter", () => {
    const thief = s.put(101, { ego: 2, weight: 450, canContain: 7, pickable: 7 });
    for (const c of [...s.hero.contents]) s.state.deleteObject(c);
    const before = s.state.score;
    expect(s.say("prendre prytwen")).toEqual(["V101"]);
    expect(thief.holder).toBe(s.hero);
    expect(s.state.score).toBe(before + 10);
    expect(s.say("jeter prytwen")).toEqual(["V105"]);
    expect(thief.holder).toBeNull();
  });

  it("Prytwen éveillé : prendre refusé V076", () => {
    s.put(101, { ego: 0, weight: 450, canContain: 7 });
    expect(s.say("prendre prytwen")).toEqual(["V076"]);
  });

  it("grille du cachot : le trousseau déclenche l'événement 15 et suspend le héros", () => {
    const bars = s.put(103, { ego: 0, pickable: 0 });
    s.give(108);
    bars.x = s.hero.x;
    bars.p = s.hero.p;
    expect(s.say("ouvrir la grille avec le trousseau")).toEqual([]);
    expect(s.state.moveEnabled).toBe(false);
    const entry = s.state.events.entries.find((e) => e.event === 15);
    expect(entry).toMatchObject({ num: 103, counter: 2, procedure: 103 });
  });

  it("ours : le fouet est exigé ; avec lui, V077 puis V078 ou V079", () => {
    s.put(4, { ego: 0, canContain: 7, pickable: 0 });
    expect(s.say("fouetter l'ours")).toEqual(["V080"]);
    s.give(10);
    const out = s.say("fouetter l'ours");
    expect(out[0]).toBe("V077");
    expect(["V078", "V079"]).toContain(out[1]);
  });

  it("jambon : le manger donne l'os (Num 330)", () => {
    const ham = s.give(311);
    expect(s.say("manger le jambon")).toEqual(["V369"]);
    expect(ham.holder).toBeNull();
    expect(s.hero.contents.map((o) => o.num)).toContain(330);
  });

  it("fiole d'élixir : invisibilité et événement 1002 ; fiole vide V365", () => {
    const vial = s.give(304, { ego: 1 });
    expect(s.say("boire la fiole")).toEqual(["V331"]);
    expect(s.hero.hidden).not.toBe(0);
    expect(s.state.events.entries.find((e) => e.procedure === 1002)?.counter).toBe(2500);
    expect(vial.ego).toBe(2);
    expect(s.say("boire la fiole")).toEqual(["V365"]);
  });

  it("bouteille d'hydromel : vidée en une gorgée ; potion nauséeuse : protection contre la lave (événement 1001)", () => {
    const bottle = s.give(332, { ego: 0 });
    expect(s.say("boire la bouteille")).toEqual(["V377"]);
    expect(bottle.ego).toBe(3);
    expect(s.say("boire la bouteille")).toEqual(["V378"]);
    bottle.ego = 1;
    expect(s.say("boire la bouteille")).toEqual(["V354"]);
    expect(s.state.events.entries.find((e) => e.procedure === 1001)?.counter).toBe(400);
  });

  it("nain endormi : tuer sans arme V208 ; avec la hache V207 et il meurt", () => {
    const dwarf = s.put(201, { ego: 7, canContain: 7, pickable: 0 });
    expect(s.say("tuer le nain")).toEqual(["V208"]);
    s.give(206);
    expect(s.say("tuer le nain")).toEqual(["V207"]);
    expect(dwarf.ego).toBe(3);
  });

  it("couronne : porter la couronne lance le couronnement", () => {
    s.give(328);
    s.say("porter la couronne");
    // `2c83:0004` : le héros est remplacé par l'acteur du couronnement (`Num 333`), le joueur perd la main
    expect(s.state.hero?.num).toBe(333);
    expect(s.state.moveEnabled).toBe(false);
    expect(s.say("regarder la couronne").includes("V385")).toBe(false);
  });

  it("grimoire : verbes immédiats V332 (allumer) et V333 (prendre)", () => {
    s.put(305, { ego: 0, pickable: 0 });
    expect(s.say("allumer le grimoire")).toEqual(["V332"]);
    expect(s.say("prendre le grimoire")).toEqual(["V333"]);
  });

  it("vanne : ouvrir déplace l'auxiliaire 215, déjà ouverte V091", () => {
    const pipe = s.put(215, { pickable: 0 });
    const valve = s.put(310, { ego: 0, pickable: 0 });
    expect(s.say("ouvrir la vanne")).toEqual(["V301"]);
    expect([valve.ego, pipe.fig]).toEqual([1, 1]);
    expect(s.say("ouvrir la vanne")).toEqual(["V091"]);
  });

  it("armoire : ouvrir (Ego 2), déjà ouverte V083, fouiller fermée V084", () => {
    const wardrobe = s.put(113, { ego: 1, canContain: 7, pickable: 0 });
    expect(s.say("fouiller l'armoire")).toEqual(["V084"]);
    expect(s.say("ouvrir l'armoire")).toEqual(["V015"]);
    expect(wardrobe.ego).toBe(2);
    expect(s.say("ouvrir l'armoire")).toEqual(["V083"]);
  });
});
