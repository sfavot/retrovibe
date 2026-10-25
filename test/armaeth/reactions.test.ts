import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { FAMILY, type HandlerContext, HandlerRegistry } from "../../src/games/armaeth/engine/handlers";
import { registerMagic } from "../../src/games/armaeth/game/magic";
import { REACTION_TABLE, registerReactions } from "../../src/games/armaeth/game/reactions";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { TestHost } from "./test-host";

/** Réactions « trop loin » : disponibilité du héros (famille 9) puis marche et rejeu, branchés ici sur le moteur par des enrobages. */

const messages = () => new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS"));
const text = (cls: string, n: number) => messages().messages(messageId(cls, n));

describe("réactions : famille 9", () => {
  it("8 gestionnaires pour 12 clés", () => {
    const registry = new HandlerRegistry();
    registerReactions(registry);
    registry.gates.fill(7);
    const keys = REACTION_TABLE.flatMap((r) => r.keys);
    expect(keys).toHaveLength(12);
    expect(new Set(keys.map((k) => registry.get(FAMILY.reaction, k))).size).toBe(8);
  });

  it("un héros indisponible reçoit V093 et la réaction n'est pas armée", () => {
    const registry = new HandlerRegistry();
    registerReactions(registry);
    registry.gates.fill(7);
    const said: string[] = [];
    const ctx = { messages: { say: (c: string, n: number) => said.push(`${c}${n}`) } } as unknown as HandlerContext;
    const killian = registry.get(FAMILY.reaction, 1)!;
    expect(killian({ ego: 0 } as never, ctx)).toBe(true);
    expect(killian({ ego: 8 } as never, ctx)).toBe(true);
    expect(killian({ ego: 6 } as never, ctx)).toBe(false);
    expect(said).toEqual(["V93"]);
    expect(registry.get(FAMILY.reaction, 302)!({ ego: 1 } as never, ctx)).toBe(false);
    expect(registry.get(FAMILY.reaction, 303)!({ ego: 7 } as never, ctx)).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("réactions : trop loin, le héros marche puis la commande est rejouée", () => {
  function game() {
    const host = new TestHost();
    const engine = new ArmaethEngine(host, { seed: 1, bare: true });
    registerReactions(engine.registry);
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
    // réaction du moteur (`ctx.react`, `2363:0154`, `2363:01ea`) : on compte les rejeux de la commande mémorisée
    const replays: number[] = [];
    const replay = engine.replayReaction.bind(engine);
    engine.replayReaction = () => (replays.push(engine.frames), replay());
    run(2000);
    for (let i = 0; i < 40 && engine.windows.active; i++) click();
    run(320);
    return { engine, host, run, click, replays };
  }

  /** Commande de l'armoire (famille 5) : si elle échoue, le moteur arme la réaction puis fait marcher le héros. */
  function ask(g: ReturnType<typeof game>, verb: number, preposition: number, indirect: number) {
    g.engine.execute({ status: "ok", normalized: "", verb, preposition, direct: [], indirect: [indirect] });
  }

  it("regarder dans une armoire lointaine : le héros marche vers elle, la commande est rejouée et dit que l'armoire est fermée", () => {
    const g = game();
    const state = g.engine.state!;
    const hero = state.hero!;
    const wardrobe = state.findByNum(113)!;
    state.moveToRoom(wardrobe, state.loadedRoom!);
    wardrobe.x = 40;
    wardrobe.y = hero.y;
    wardrobe.p = hero.p;
    wardrobe.plane = hero.plane;
    wardrobe.ego = 1;
    const startX = hero.x;
    expect(Math.abs(startX - wardrobe.x)).toBeGreaterThan(100);

    ask(g, 22005, 1, 15113);
    expect(g.engine.hasReactionArmed).toBe(false);
    expect(hero.path.defined).toBe(true);
    expect(g.replays).toHaveLength(0);
    for (let i = 0; i < 1500 && g.replays.length === 0; i++) g.run(1);
    expect(g.replays).toHaveLength(1);
    expect(Math.abs(hero.x - startX)).toBeGreaterThan(20); // le héros a bougé
    g.run(2);
    expect(g.engine.windows.text).toBe(text("V", 84)); // rejeu : à portée, armoire fermée
  });

  it("en présence de Prytwen : le héros reste en place, Prytwen marche vers lui et dit G119 (mesuré sous DOSBox-X)", () => {
    const g = game();
    const state = g.engine.state!;
    const hero = state.hero!;
    const room = state.loadedRoom!;
    const wardrobe = state.findByNum(113)!;
    const prytwen = state.findByNum(101)!;
    state.moveToRoom(wardrobe, room);
    wardrobe.x = 40;
    wardrobe.y = hero.y;
    wardrobe.p = hero.p;
    wardrobe.plane = hero.plane;
    wardrobe.ego = 1;
    state.moveToRoom(prytwen, room);
    prytwen.ego = 0;
    prytwen.x = hero.x - 50;
    prytwen.y = hero.y;
    prytwen.p = hero.p;
    prytwen.plane = hero.plane;
    const startX = hero.x;

    ask(g, 22005, 1, 15113);
    expect(g.engine.hasReactionArmed).toBe(false); // aucune marche du héros ni rejeu
    expect(hero.path.defined).toBe(false);
    expect(prytwen.path.target).toMatchObject({ x: hero.x, p: hero.p }); // Prytwen reçoit le héros pour cible (`walkTo`)
    g.run(2);
    expect(g.engine.windows.text).toBe(messages().messages(messageId("G", 119)));
    expect(g.engine.windows.text).toMatch(/^Prytwen n'aime pas que l'on fouine/);
    expect(hero.x).toBe(startX);
    expect(g.replays).toHaveLength(0);
  });

  it("un héros indisponible (Ego 6) ne marche pas : V093 immédiat", () => {
    const g = game();
    const state = g.engine.state!;
    const wardrobe = state.findByNum(113)!;
    state.moveToRoom(wardrobe, state.loadedRoom!);
    wardrobe.x = 40;
    state.hero!.ego = 6;
    ask(g, 22005, 1, 15113);
    g.run(1);
    expect(state.hero!.path.defined).toBe(false);
    expect(g.engine.windows.text).toBe(text("V", 93));
  });
});
