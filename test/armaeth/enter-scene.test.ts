import { describe, expect, it } from "vitest";
import { MessageTable, messageId } from "../../src/games/armaeth/data/text";
import type { BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import { loadWorldState } from "../../src/games/armaeth/engine/save";
import type { GameObject, WorldState } from "../../src/games/armaeth/engine/state";
import { onEnterScene } from "../../src/games/armaeth/game/room-entry";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { Player } from "./player";

/**
 * Effets d'entrée propres à une salle (`147f:0352`, `docs/armaeth/characters.md` § 11 et `walkthrough.md` bug 25) : salle 110 (la musique
 * dit de quel côté de la grille 103 se trouvent le héros et Prytwen, `147f:03a6..04e5`) et salle 304 (l'événement d'asphyxie du héros
 * et les torches éteintes par le courant d'air, `147f:0470..04e5`). Les introductions de niveau (salles 1, 101, 202, 305) restent
 * dans `room.test.ts`.
 */

const table = hasOriginalFiles ? new MessageTable(readOriginal("A1FTMS.SYS"), readOriginal("A1FMSG.SYS")) : null;
const g = (n: number): string => table!.messages(messageId("G", n));

/** Contexte minimal : sons et messages notés, file d'événements et monde réels. */
function context(state: WorldState, log: string[]): BehaviorContext {
  return {
    state,
    get hero() {
      return state.hero;
    },
    sound: { play: (id: number, cls: string | number, num: number) => log.push(`${cls}${num}#${id}`) },
    messages: { say: (cls: string | number, n: number) => log.push(`${cls}${n}`) },
    events: { operate: (...args: Parameters<BehaviorContext["events"]["operate"]>) => state.events.operate(...args) },
    refreshObject: () => {},
  } as unknown as BehaviorContext;
}

function world(roomId: number): WorldState {
  const state = loadWorldState(readOriginal("A1FCFG.SYS"));
  state.loadedRoom = state.roomById(roomId)!;
  state.events.capacity = 5; // la file de `CFG` est vide (capacité 0) : le moteur la fait grandir avant d'y écrire
  return state;
}

const torch = (state: WorldState, holder: GameObject, ego: number): GameObject => {
  const lamp = state.createObject({ typ: 2, num: 12, pickable: 7, presence: 8, ego, fig: ego, gst: ego < 4 ? 7 : 0, mob: ego < 4 ? 1 : 0, light: ego < 4 ? 32 : 0 });
  state.moveToContainer(lamp, holder);
  return lamp;
};

describe.skipIf(!hasOriginalFiles)("salle 110 : la musique selon les positions du héros et de Prytwen (147f:03a6)", () => {
  /** Héros et Prytwen dans la salle 110, grille à `P 30` ; `hero.p` / `prytwen.p` donnés. */
  function setup(heroP: number | null, prytwenP: number | null, barsEgo = 0) {
    const state = world(110);
    const room = state.loadedRoom!;
    const bars = state.findByNum(103)!;
    bars.ego = barsEgo;
    const hero = state.hero!;
    const prytwen = state.findByNum(101)!;
    if (heroP === null) state.moveToRoom(hero, state.roomById(1)!);
    else {
      state.moveToRoom(hero, room);
      hero.p = heroP;
    }
    if (prytwenP === null) state.moveToRoom(prytwen, state.roomById(105)!);
    else {
      state.moveToRoom(prytwen, room);
      prytwen.p = prytwenP;
    }
    const log: string[] = [];
    onEnterScene(context(state, log));
    return log;
  }

  it("le héros est devant la grille (P plus grand) : M108", () => {
    expect(setup(50, null)).toEqual(["M108#108"]);
    // il l'emporte sur Prytwen, qui n'est pas testé
    expect(setup(50, 80)).toEqual(["M108#108"]);
  });

  it("sinon, Prytwen est derrière elle (son P est plus grand que celui de la grille) : M109", () => {
    expect(setup(10, 40)).toEqual(["M109#109"]);
    expect(setup(30, 40)).toEqual(["M109#109"]); // P égal : le héros n'est pas « devant »
    expect(setup(null, 31)).toEqual(["M109#109"]); // héros absent de la salle
  });

  it("ni l'un ni l'autre : rien", () => {
    expect(setup(10, 20)).toEqual([]);
    expect(setup(null, null)).toEqual([]);
    expect(setup(10, 30)).toEqual([]);
  });

  it("grille ouverte (Ego 3) : la musique de la salle reprend (identifiant +0x08, classe +0x05, numéro +0x06), sans autre test", () => {
    expect(setup(50, 80, 3)).toEqual(["M105#105"]);
    expect(setup(null, null, 3)).toEqual(["M105#105"]);
  });
});

describe.skipIf(!hasOriginalFiles)("salle 304 : l'asphyxie du héros et les torches éteintes (147f:0470)", () => {
  it("le héros reçoit l'événement différé 2 (1000 tics, procédure 1) ; les torches allumées de ses poches s'éteignent (Ego et Fig + 4, Lum 0) et G373 s'affiche une fois", () => {
    const state = world(304);
    const hero = state.hero!;
    const lit = [torch(state, hero, 3), torch(state, hero, 1)];
    const out = torch(state, hero, 6);
    const log: string[] = [];
    onEnterScene(context(state, log));

    expect(log).toEqual(["G373"]);
    expect(lit.map((o) => [o.ego, o.fig, o.light, o.gst, o.mob])).toEqual([
      [7, 7, 0, 0, 0],
      [5, 5, 0, 0, 0],
    ]);
    expect([out.ego, out.fig]).toEqual([6, 6]);
    const entry = state.events.entries.find((e) => e.num === 1 && e.event === 2);
    expect(entry).toMatchObject({ typ: hero.typ, serial: hero.serial, counter: 1000, procedure: 1 });
  });

  it("sans torche allumée : l'événement est armé, aucun message", () => {
    const state = world(304);
    torch(state, state.hero!, 5);
    const log: string[] = [];
    onEnterScene(context(state, log));
    expect(log).toEqual([]);
    expect(state.events.entries.some((e) => e.num === 1 && e.event === 2)).toBe(true);
  });

  it("une torche posée à terre ou dans le sac d'un autre n'est pas concernée", () => {
    const state = world(304);
    const lamp = torch(state, state.hero!, 2);
    state.moveToRoom(lamp, state.loadedRoom!);
    const log: string[] = [];
    onEnterScene(context(state, log));
    expect([lamp.ego, log]).toEqual([2, []]);
  });

  it("les autres salles : rien", () => {
    const state = world(302);
    const lamp = torch(state, state.hero!, 3);
    const log: string[] = [];
    onEnterScene(context(state, log));
    expect([lamp.ego, log, state.events.entries.some((e) => e.event === 2)]).toEqual([3, [], false]);
  });

  it("moteur complet : à la première image de la salle 304, les torches s'éteignent et G373 est lu", () => {
    const p = new Player();
    p.skipIntro();
    const lamp = torch(p.state, p.hero, 3);
    p.engine.sendToRoom(304, true);
    const read: string[] = [];
    for (let i = 0; i < 80 && p.state.loadedRoom?.id !== 304; i++) {
      p.run(2);
      read.push(...p.drain(3));
    }
    expect(p.state.loadedRoom?.id).toBe(304);
    read.push(...p.drain());
    expect(read).toContain(g(373));
    expect([lamp.ego, lamp.fig]).toEqual([7, 7]);
    expect(p.state.events.entries.some((e) => e.num === 1 && e.event === 2)).toBe(true);
  });
});
