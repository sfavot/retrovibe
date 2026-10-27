import { beforeAll, describe, expect, it } from "vitest";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { FAMILY, type BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { registerNpcs } from "../../src/games/armaeth/game/npc";
import { dwarfContact } from "../../src/games/armaeth/game/npc-dwarves";
import { NpcKit, instantAnimations } from "../../src/games/armaeth/game/npc-kit";
import { doorState, moveDoor } from "../../src/games/armaeth/game/objects";
import { hasOriginalFiles } from "./helpers";
import { TestHost } from "./test-host";

/**
 * Personnages et portes à serrure (`Mob 0`, tables `DGROUP:0694` : 111, 309, 329) : `20b5:0516` (`doorState`) et `20b5:055e`
 * (`moveDoor`), appelés par le contact de Minas Thyl (`2dd9:0d24`), des nains et soldats (`2a44:0d80`) et de Prytwen (`28b1:0a94`).
 * Appel direct des procédures sur le monde réel, comme `npc.test.ts`.
 */

const KEY_111 = 109;
const KEY_329 = 331;

describe.skipIf(!hasOriginalFiles)("portes à serrure : amener une porte à un état (20b5:055e) et contacts des personnages", () => {
  let engine: ArmaethEngine;
  let ctx: BehaviorContext;
  beforeAll(() => {
    const host = new TestHost();
    engine = new ArmaethEngine(host, { seed: 7, bare: true });
    registerNpcs(engine.registry, instantAnimations);
    for (let i = 0; i < 2000; i++) engine.tick();
    for (let clicks = 0; engine.windows.active && clicks < 40; clicks++) {
      host.pointer(100, 100, 1);
      engine.tick();
      host.pointer(100, 100, 0);
      engine.tick();
    }
    for (let i = 0; i < 320; i++) engine.tick();
    ctx = (engine as unknown as { services: BehaviorContext }).services;
  });

  const state = () => engine.state!;
  const run = (obj: GameObject) => engine.registry.get(FAMILY.character, obj.num)!(obj, ctx);

  /** Un porteur dans la salle chargée, sans rien dans les poches ; la porte `num` y est posée dans l'état `ego`. */
  function stage(num: number, doorNum: number, ego: number, keys: number[] = []): { who: GameObject; door: GameObject } {
    const s = state();
    const room = s.loadedRoom!;
    const who = s.findByNum(num)!;
    const door = s.findByNum(doorNum)!;
    for (const item of [...who.contents]) s.moveToRoom(item, s.roomById(1)!);
    for (const key of keys) s.moveToContainer(s.createObject({ typ: 2, num: key }), who);
    s.moveToRoom(who, room);
    s.moveToRoom(door, room);
    s.moveToRoom(s.hero!, s.roomById(1)!);
    who.gst = 7;
    who.ego = 0;
    who.path.defined = false;
    who.x = door.x = 100;
    who.y = door.y = 100;
    who.p = door.p = 60;
    door.ego = ego;
    return { who, door };
  }

  /** Contacts répétés (l'`Err` n'est pas remis à 0 par un refus : le contact est rejoué au tic suivant) ; rend le nombre d'essais. */
  function touchUntil(who: GameObject, door: GameObject, done: () => boolean, max = 60): number {
    for (let tries = 1; tries <= max; tries++) {
      who.col = door.serial;
      who.err = 9;
      run(who);
      if (done()) return tries;
    }
    return 0;
  }

  describe("moveDoor (20b5:055e) et doorState (20b5:0516)", () => {
    it("doorState : l'Ego de la porte, -1 pour tout autre objet", () => {
      stage(303, 329, 1);
      expect(doorState(ctx, 329)).toBe(1);
      expect(doorState(ctx, 111)).toBe(state().findByNum(111)!.ego);
      expect(doorState(ctx, 103)).toBe(-1);
      expect(doorState(ctx, 12)).toBe(-1);
    });

    it("ouvrir (2) : une porte verrouillée exige la clé dans les poches ; une porte fermée s'ouvre sans clé ; une porte ouverte reste telle", () => {
      let { who, door } = stage(303, 329, 0);
      expect([moveDoor(ctx, 329, 2, who), door.ego]).toEqual([false, 0]);
      ({ who, door } = stage(303, 329, 0, [KEY_329]));
      expect([moveDoor(ctx, 329, 2, who), door.ego]).toEqual([true, 2]);
      ({ who, door } = stage(303, 329, 1));
      expect([moveDoor(ctx, 329, 2, who), door.ego]).toEqual([true, 2]);
      ({ who, door } = stage(303, 329, 2));
      expect([moveDoor(ctx, 329, 2, who), door.ego]).toEqual([true, 2]);
      // la clé d'une autre porte ne sert pas
      ({ who, door } = stage(303, 329, 0, [KEY_111]));
      expect([moveDoor(ctx, 329, 2, who), door.ego]).toEqual([false, 0]);
    });

    it("verrouiller (0) : sans clé une porte fermée reste fermée, une porte ouverte est seulement refermée ; avec la clé elle est verrouillée ; verrouillée, rien", () => {
      let { who, door } = stage(301, 309, 1);
      expect([moveDoor(ctx, 309, 0, who), door.ego]).toEqual([false, 1]);
      ({ who, door } = stage(301, 309, 2));
      expect([moveDoor(ctx, 309, 0, who), door.ego]).toEqual([false, 1]);
      ({ who, door } = stage(301, 309, 2, [KEY_329]));
      expect([moveDoor(ctx, 309, 0, who), door.ego]).toEqual([true, 0]);
      ({ who, door } = stage(301, 309, 1, [KEY_329]));
      expect([moveDoor(ctx, 309, 0, who), door.ego]).toEqual([true, 0]);
      ({ who, door } = stage(301, 309, 0));
      expect([moveDoor(ctx, 309, 0, who), door.ego]).toEqual([true, 0]);
    });

    it("fermer (1) : une porte ouverte se ferme sans clé ; fermée ou verrouillée, la porte n'est pas touchée (ou exige la clé)", () => {
      let { who, door } = stage(303, 329, 2);
      expect([moveDoor(ctx, 329, 1, who), door.ego]).toEqual([true, 1]);
      ({ who, door } = stage(303, 329, 1));
      expect([moveDoor(ctx, 329, 1, who), door.ego]).toEqual([true, 1]);
      ({ who, door } = stage(303, 329, 0));
      expect([moveDoor(ctx, 329, 1, who), door.ego]).toEqual([false, 0]);
      ({ who, door } = stage(303, 329, 0, [KEY_329]));
      expect([moveDoor(ctx, 329, 1, who), door.ego]).toEqual([true, 1]);
    });

    it("un objet qui n'est pas une porte : faux", () => {
      const { who } = stage(303, 329, 1);
      expect(moveDoor(ctx, 103, 2, who)).toBe(false);
    });
  });

  describe("Minas Thyl (2dd9:0d24) : une chance sur deux d'ouvrir une porte fermée ou verrouillée dont elle a la clé", () => {
    it("porte fermée : elle finit par l'ouvrir (Err remis à 0), sans clé", () => {
      const { who, door } = stage(303, 111, 1);
      const tries = touchUntil(who, door, () => door.ego === 2);
      expect(tries).toBeGreaterThan(0);
      expect(who.err).toBe(0);
    });

    it("porte verrouillée : seulement avec la clé", () => {
      let { who, door } = stage(303, 329, 0);
      expect(touchUntil(who, door, () => door.ego !== 0)).toBe(0);
      ({ who, door } = stage(303, 329, 0, [KEY_329]));
      expect(touchUntil(who, door, () => door.ego === 2)).toBeGreaterThan(0);
    });

    it("le tirage est une fois sur deux : les essais d'ouverture réussissent environ la moitié du temps", () => {
      let opened = 0;
      const trials = 200;
      for (let i = 0; i < trials; i++) {
        const { who, door } = stage(303, 111, 1);
        who.col = door.serial;
        who.err = 9;
        run(who);
        if (door.ego === 2) opened++;
      }
      expect(opened).toBeGreaterThan(trials * 0.35);
      expect(opened).toBeLessThan(trials * 0.65);
    });

    it("porte déjà ouverte : rien", () => {
      const { who, door } = stage(303, 111, 2);
      who.col = door.serial;
      who.err = 9;
      run(who);
      expect(door.ego).toBe(2);
    });
  });

  describe("nains et soldats (2a44:0d80)", () => {
    it("un nain (Ego 0) ouvre une porte fermée une fois sur deux ; une porte verrouillée seulement s'il a la clé", () => {
      const { who, door } = stage(201, 111, 1);
      expect(touchUntil(who, door, () => door.ego === 2)).toBeGreaterThan(0);
      expect(who.err).toBe(0);
      let staged = stage(202, 329, 0);
      expect(touchUntil(staged.who, staged.door, () => staged.door.ego !== 0)).toBe(0);
      staged = stage(202, 329, 0, [KEY_329]);
      expect(touchUntil(staged.who, staged.door, () => staged.door.ego === 2)).toBeGreaterThan(0);
    });

    it("un nain en fuite (Ego 4) ouvre aussitôt, sans tirage", () => {
      // `Ego 4` n'arrive au contact qu'en fin de trajet suivi (`2a44:0020` l'exclut pour un `Err 8/9`)
      const { who, door } = stage(203, 111, 1);
      who.ego = 4;
      who.col = door.serial;
      who.err = 9;
      expect(dwarfContact(new NpcKit(instantAnimations), ctx, who)).toBe(true);
      expect([door.ego, who.err]).toEqual([2, 0]);
    });

    it("un soldat ne verrouille que les portes 309 et 329 qu'il peut verrouiller (clé 331) ; il n'ouvre rien", () => {
      let { who, door } = stage(301, 329, 2, [KEY_329]);
      who.col = door.serial;
      who.err = 9;
      run(who);
      expect([door.ego, who.err]).toEqual([0, 0]);
      // sans clé la porte ouverte est seulement refermée, le contact n'a pas abouti
      ({ who, door } = stage(301, 309, 2));
      who.col = door.serial;
      who.err = 9;
      run(who);
      expect(door.ego).toBe(1);
      // déjà verrouillée : rien ; la porte 111 n'est pas de son ressort
      ({ who, door } = stage(301, 329, 0, [KEY_329]));
      who.col = door.serial;
      who.err = 9;
      run(who);
      expect(door.ego).toBe(0);
      ({ who, door } = stage(301, 111, 1, [KEY_329, KEY_111]));
      who.col = door.serial;
      who.err = 9;
      run(who);
      expect(door.ego).toBe(1);
    });
  });

  describe("Prytwen (28b1:0a94)", () => {
    it("Ego 0 : une fois sur deux ; Ego 4 : toujours ; la porte 111 s'ouvre sans clé", () => {
      let { who, door } = stage(101, 111, 1);
      expect(touchUntil(who, door, () => door.ego === 2)).toBeGreaterThan(0);
      expect(who.err).toBe(0);
      ({ who, door } = stage(101, 111, 1));
      who.ego = 4;
      who.col = door.serial;
      who.err = 9;
      run(who);
      expect([door.ego, who.err]).toEqual([2, 0]);
    });
  });
});
