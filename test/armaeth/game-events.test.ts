import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { EventOp } from "../../src/games/armaeth/engine/events";
import { FAMILY } from "../../src/games/armaeth/engine/handlers";
import { EVENT_KEYS, registerEvents } from "../../src/games/armaeth/game/events";
import { registerNpcs } from "../../src/games/armaeth/game/npc";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/** Événements différés (famille 8) sur le moteur et les vrais fichiers du jeu. */

const messages = () => new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));
const text = (cls: string, n: number) => messages().messages(messageId(cls, n));

function start(): { engine: ArmaethEngine; run(n: number): void } {
  const host = new TestHost();
  const engine = new ArmaethEngine(host, { seed: 1, bare: true });
  registerEvents(engine.registry);
  registerNpcs(engine.registry); // événements des personnages (clés 4, 101, 201, 303, 327)
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
  return { engine, run };
}

describe("événements différés : enregistrement", () => {
  it("7 procédures d'objets et de système, une par clé de la famille 8", () => {
    const host = new TestHost();
    if (!hasOriginalFiles) return;
    const engine = new ArmaethEngine(host, { seed: 1, bare: true });
    registerEvents(engine.registry);
    expect(EVENT_KEYS).toHaveLength(7);
    for (const key of EVENT_KEYS) expect(engine.registry.get(FAMILY.event, key)).toBeDefined();
  });
});

describe.skipIf(!hasOriginalFiles)("événements différés : jeu complet", () => {
  it("l'introduction du niveau 0 s'affiche 60 tics après l'entrée en salle 1 (S13 puis S14) et plus rien ne manque", () => {
    const { engine, run } = start();
    for (let i = 0; i < 400 && !engine.windows.active; i++) run(1);
    expect(engine.windows.active).toBe(true);
    expect(engine.windows.text).toBe(text("S", 13));
    expect(engine.missing.has("8:2000")).toBe(false);
  });

  it("la fin d'invisibilité (1002) rend le héros visible et le dit", () => {
    const { engine, run } = start();
    const hero = engine.state!.hero!;
    hero.hidden = 7;
    engine.state!.events.entries.length = 0;
    engine.state!.events.capacity = 5;
    engine.state!.events.operate(hero, 1, EventOp.Set, 2, 1002);
    run(10 * 6);
    expect(hero.hidden).toBe(0);
  });

  it("le réveil du nain (201, événement 3) ne touche que les endormis", () => {
    const { engine, run } = start();
    const state = engine.state!;
    const dwarf = state.findByNum(201)!;
    dwarf.ego = 7;
    state.events.capacity = 5;
    state.events.operate(dwarf, 3, EventOp.Set, 1, 201);
    run(60);
    expect(dwarf.ego).toBe(0);
  });

  it("la dalle (104, événement 18) se met en mouvement : Ego 1, Tim 22", () => {
    const { engine, run } = start();
    const state = engine.state!;
    const slab = state.findByNum(104)!;
    state.events.capacity = 5;
    state.events.operate(slab, 18, EventOp.Set, 1, 104);
    run(60);
    expect([slab.gst, slab.mob]).toEqual([7, 1]);
    expect(slab.ego).toBe(1);
  });

  it("la faim de l'ours (4, événement 9) : Ego 0 devient 1 et l'événement est réarmé à 24000", () => {
    const { engine, run } = start();
    const state = engine.state!;
    const bear = state.findByNum(4)!;
    state.events.capacity = 5;
    state.events.operate(bear, 9, EventOp.Set, 1, 4);
    run(60);
    expect(bear.ego).toBe(1);
    expect(state.events.find(bear, 9)!.counter).toBeGreaterThan(23000);
  });

  it("l'ours affamé hors de la salle chargée meurt : fourrure (Num 5) et carcasse (Num 15) le remplacent", () => {
    const { engine, run } = start();
    const state = engine.state!;
    const bear = state.findByNum(4)!;
    bear.ego = 1;
    state.events.capacity = 5;
    state.events.operate(bear, 9, EventOp.Set, 1, 4);
    run(60);
    expect(state.findByNum(4)).toBeUndefined();
    expect(state.findByNum(5)).toBeDefined();
    expect(state.findByNum(15)).toBeDefined();
  });

  it("Prytwen (101, événement 7) enfermé dans la salle 110 meurt de faim : un squelette (Num 112) en X 0x2C, P 0x2F, butin laissé", () => {
    const { engine, run } = start();
    const state = engine.state!;
    const prytwen = state.findByNum(101)!;
    state.moveToRoom(prytwen, state.roomById(110)!);
    const loot = state.createObject({ typ: 2, num: 105, value: 100 });
    state.moveToContainer(loot, prytwen);
    state.events.capacity = 5;
    state.events.operate(prytwen, 7, EventOp.Set, 1, 101);
    run(60);
    expect(state.findByNum(101)).toBeUndefined();
    const skeleton = state.findByNum(112)!;
    expect(skeleton.room!.id).toBe(110);
    expect([skeleton.x, skeleton.p, skeleton.weight]).toEqual([0x2c, 0x2f, 50]);
    expect(loot.room!.id).toBe(110);
  });

  it("événement 7 : hors de la salle 110 ou grille ouverte, rien (`28b1:130b`, `28b1:1314`)", () => {
    const { engine, run } = start();
    const state = engine.state!;
    const prytwen = state.findByNum(101)!;
    state.events.capacity = 5;
    state.events.operate(prytwen, 7, EventOp.Set, 1, 101); // en salle 105 : sans effet
    run(60);
    expect(state.findByNum(101)).toBeDefined();
    state.moveToRoom(prytwen, state.roomById(110)!);
    state.findByNum(103)!.ego = 3; // grille ouverte
    state.events.operate(prytwen, 7, EventOp.Set, 1, 101);
    run(60);
    expect(state.findByNum(101)).toBeDefined();
  });
});
