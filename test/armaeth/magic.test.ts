import { describe, expect, it } from "vitest";
import { parseDictionary } from "../../src/games/armaeth/data/dictionary";
import { MessageTable, messageId, parseAccentTable, parsePlainMessages } from "../../src/games/armaeth/data/text";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { FAMILY } from "../../src/games/armaeth/engine/handlers";
import { parseCommand } from "../../src/games/armaeth/engine/parser";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { INDIRECT_KEYS, MAGIC_WORDS, registerMagic } from "../../src/games/armaeth/game/magic";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/** Gestionnaires d'indirect (famille 5) et mots magiques (famille 6), joués sur le monde réel. */

const messages = () => new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));
const text = (cls: string, n: number) => messages().messages(messageId(cls, n));

describe("magie : enregistrement", () => {
  it("13 gestionnaires d'indirect (19 clés) et 6 mots magiques", () => {
    if (!hasOriginalFiles) return;
    const engine = new ArmaethEngine(new TestHost(), { seed: 1, bare: true });
    registerMagic(engine.registry);
    const keys = Object.values(INDIRECT_KEYS).flat();
    expect(keys).toHaveLength(19);
    expect(new Set(keys.map((k) => engine.registry.get(FAMILY.indirect, k))).size).toBe(13);
    for (const key of Object.values(MAGIC_WORDS)) expect(engine.registry.get(FAMILY.name, key)).toBeDefined();
  });
});

describe.skipIf(!hasOriginalFiles)("magie : parties jouées", () => {
  const dictionary = parseDictionary(readOriginal("A1FDIC.SYS"));
  const accents = parseAccentTable(parsePlainMessages(readOriginal("MSGINT")));
  const parse = (line: string) => parseCommand(line, dictionary, accents);

  function game() {
    const host = new TestHost();
    const engine = new ArmaethEngine(host, { seed: 1, bare: true });
    registerMagic(engine.registry);
    const run = (n: number) => {
      for (let i = 0; i < n; i++) engine.tick();
    };
    const click = () => {
      host.pointer(100, 100, 1);
      engine.tick();
      host.pointer(100, 100, 0);
      engine.tick();
    };
    run(2000);
    for (let i = 0; i < 40 && engine.windows.active; i++) click();
    run(320);
    const state = engine.state!;
    const hero = state.hero!;
    /** Affiche les fenêtres en attente et rend leurs textes. */
    const said = (): string[] => {
      const out: string[] = [];
      run(1);
      for (let i = 0; i < 10 && engine.windows.active; i++) {
        out.push(engine.windows.text ?? "");
        click();
        run(1);
      }
      return out;
    };
    const give = (num: number): GameObject => {
      const obj = state.findByNum(num)!;
      state.moveToContainer(obj, hero);
      return obj;
    };
    const goTo = (id: number) => {
      const room = state.roomById(id)!;
      state.moveToRoom(hero, room);
      state.wantedRoom = room;
      hero.info = 6;
      for (let i = 0; i < 200 && state.loadedRoom !== room; i++) run(1);
      run(5);
      return room;
    };
    return { engine, state, hero, run, click, said, give, goTo, say: (line: string) => (engine.execute(parse(line)), said()) };
  }

  it("erin <lieu> avec le talisman : le héros est téléporté dans la salle du lieu (V087)", () => {
    const g = game();
    const place = dictionary.find((e) => Math.floor(e.code / 1000) === 19 && g.state.roomById(e.code % 1000) && e.code % 1000 !== 1);
    expect(place).toBeDefined();
    g.give(321);
    expect(g.say(`erin ${place!.word}`)).toEqual([text("V", 87)]);
    expect(g.state.wantedRoom!.id).toBe(place!.code % 1000);
    expect(g.hero.room!.id).toBe(place!.code % 1000);
    for (let i = 0; i < 100 && g.state.loadedRoom!.id !== place!.code % 1000; i++) g.run(1);
    expect(g.state.loadedRoom!.id).toBe(place!.code % 1000);
  });

  it("erin sans le talisman : V386 ; sans lieu : V023", () => {
    const g = game();
    const place = dictionary.find((e) => Math.floor(e.code / 1000) === 19 && g.state.roomById(e.code % 1000))!;
    expect(g.say(`erin ${place.word}`)).toEqual([text("V", 386)]);
    g.give(321);
    expect(g.say("erin")).toEqual([text("V", 23)]);
    expect(g.hero.room!.id).toBe(1);
  });

  it("tinhuel puis armaeth dans la salle 202 : la herse monte (V214) puis redescend (V212)", () => {
    const g = game();
    const portcullis = g.state.findByNum(207)!;
    g.goTo(202);
    expect(g.state.loadedRoom!.id).toBe(202);
    expect(g.say("tinhuel")).toEqual([text("V", 214)]); // premier essai : 1 chance sur 1
    expect(portcullis.ego).toBe(1);
    expect(portcullis.tim).toBe(0x22);
    expect(g.say("tinhuel")).toEqual([text("V", 29)]); // en mouvement
    portcullis.ego = 3;
    expect(g.say("tinhuel")).toEqual([text("V", 216)]);
    expect(g.say("armaeth")).toEqual([text("V", 212)]);
    expect(portcullis.ego).toBe(2);
    portcullis.ego = 0;
    expect(g.say("armaeth")).toEqual([text("V", 211)]);
    portcullis.ego = 4;
    expect(g.say("armaeth")).toEqual([text("V", 213)]);
  });

  it("armaeth ailleurs qu'en salle 202 ou 305 : « Rien ne se produit »", () => {
    const g = game();
    expect(g.say("armaeth")).toEqual([text("V", 217)]);
    expect(g.state.findByNum(207)!.ego).toBe(0);
  });

  it("tehrehanan : baguette et bouteille donnent la potion (V380, 30 points) ; refus selon l'état", () => {
    const g = game();
    expect(g.say("tehrehanan")).toEqual([text("V", 353)]);
    g.give(320);
    expect(g.say("tehrehanan")).toEqual([text("V", 379)]);
    const bottle = g.give(332);
    const before = g.state.score;
    expect(g.say("tehrehanan")).toEqual([text("V", 380)]);
    expect(bottle.ego).toBe(1);
    expect(g.state.score).toBe(before + 30);
    expect(g.say("tehrehanan")).toEqual([text("V", 381)]);
    bottle.ego = 3;
    expect(g.say("tehrehanan")).toEqual([text("V", 382)]);
  });

  it("ezhrimanoth : baguette et fiole donnent l'élixir (V350, 30 points), une seule fois", () => {
    const g = game();
    g.give(320);
    expect(g.say("ezhrimanoth")).toEqual([text("V", 351)]);
    const fiole = g.give(304);
    const before = g.state.score;
    expect(g.say("ezhrimanoth")).toEqual([text("V", 350)]);
    expect(fiole.ego).toBe(1);
    expect(g.state.score).toBe(before + 30);
    expect(g.say("ezhrimanoth")).toEqual([text("V", 352)]);
  });

  it("sillerynn : le seau devient la couronne dans l'inventaire (V355, 30 points) ; ensuite V356", () => {
    const g = game();
    expect(g.say("sillerynn")).toEqual([text("V", 384)]);
    g.give(321);
    expect(g.say("sillerynn")).toEqual([text("V", 357)]);
    g.give(25);
    const before = g.state.score;
    expect(g.say("sillerynn")).toEqual([text("V", 355)]);
    expect(g.state.findByNum(25)).toBeUndefined();
    expect(g.state.findByNum(328)!.holder).toBe(g.hero);
    expect(g.state.score).toBe(before + 30);
    expect(g.say("sillerynn")).toEqual([text("V", 356)]);
  });

  it("coffre fermé comme indirect : on ne peut rien mettre dedans (V051) ; coffret : seules les valeurs de 50 et plus (V040, puis 5 points)", () => {
    const g = game();
    g.goTo(3);
    const chest = g.state.findByNum(21)!;
    g.give(7); // doublons, valeur 10
    expect(g.say("mettre les doublons dans le coffre")).toEqual([text("V", 51)]);
    chest.ego = 2;
    expect(chest.ego).toBe(2);

    g.goTo(8);
    const casket = g.state.findByNum(9)!;
    const nugget = g.give(105);
    Object.assign(g.hero, { x: casket.x, y: casket.y, p: casket.p, plane: casket.plane });
    expect(g.say("mettre la pepite dans le coffret")).toEqual([text("V", 65)]);
    casket.ego = 2;
    expect(g.say("mettre les doublons dans le coffret")).toEqual([text("V", 40)]);
    const before = g.state.score;
    g.engine.execute(parse("mettre la pepite dans le coffret"));
    g.run(1);
    expect(nugget.holder).toBe(casket);
    expect(g.state.score).toBe(before + 5);
  });

  it("Minas Thyl : on lui rend la baguette, elle donne le talisman (V321, V323, 20 points)", () => {
    const g = game();
    const minas = g.state.findByNum(303)!;
    g.state.moveToRoom(minas, g.hero.room!);
    Object.assign(minas, { x: g.hero.x, y: g.hero.y, p: g.hero.p, plane: g.hero.plane });
    const wand = g.give(320);
    const before = g.state.score;
    expect(g.say("donner la baguette a minas")).toEqual([text("V", 321), text("V", 323)]);
    expect(wand.holder).toBe(minas);
    expect(g.state.findByNum(321)!.holder).toBe(g.hero);
    expect(g.state.score).toBe(before + 20);
    expect(minas.ego).toBe(6);
  });

  it("Minas Thyl : un objet sans valeur est refusé (V327), un trésor accepté (V326 puis V319)", () => {
    const g = game();
    const minas = g.state.findByNum(303)!;
    g.state.moveToRoom(minas, g.hero.room!);
    Object.assign(minas, { x: g.hero.x, y: g.hero.y, p: g.hero.p, plane: g.hero.plane });
    g.give(26); // pelle, valeur 1
    expect(g.say("donner la pelle a minas")).toEqual([text("V", 327)]);
    const gold = g.give(7);
    gold.value = 60;
    expect(g.say("donner les doublons a minas")).toEqual([text("V", 326), text("V", 319)]);
    expect(gold.holder).toBe(minas);
  });

  it("le nain endormi se réveille quand on lui parle : V210 et il marche vers le héros (Ego 0)", () => {
    const g = game();
    const dwarf = g.state.findByNum(201)!;
    g.state.moveToRoom(dwarf, g.hero.room!);
    Object.assign(dwarf, { x: g.hero.x, y: g.hero.y, p: g.hero.p, plane: g.hero.plane, ego: 7 });
    expect(g.say("parler au nain")).toEqual([text("V", 210)]);
    expect(dwarf.ego).toBe(0);
    dwarf.ego = 3;
    expect(g.say("parler au nain")).toEqual([text("V", 226)]);
  });

  it("crapaud : lui parler le réveille (V346) ; Sarhûl : V308", () => {
    const g = game();
    const toad = g.state.createObject({ typ: 2, num: 327, ego: 1 });
    g.state.moveToRoom(toad, g.hero.room!);
    Object.assign(toad, { x: g.hero.x, y: g.hero.y, p: g.hero.p, plane: g.hero.plane });
    expect(g.say("parler au crapaud")).toEqual([text("V", 346)]);
    expect(toad.ego).toBe(0);
  });
});
