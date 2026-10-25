import { describe, expect, it } from "vitest";
import { ArmaethEngine } from "../../src/games/armaeth/engine/engine";
import { type BehaviorContext, FAMILY } from "../../src/games/armaeth/engine/handlers";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { UPDATE_OK } from "../../src/games/armaeth/engine/update";
import { DECOR_KEYS, registerDecor } from "../../src/games/armaeth/game/decor";
import { hasOriginalFiles } from "./helpers";
import { TestHost } from "./test-host";

/** Procédures des décors (famille 3) : appelées sur le monde réel avec un contexte espion. */

interface Spy {
  ctx: BehaviorContext;
  said: string[];
  tracks: string[];
  engine: ArmaethEngine;
}

function setup(): Spy {
  const host = new TestHost();
  const engine = new ArmaethEngine(host, { seed: 1, bare: true });
  registerDecor(engine.registry);
  for (let i = 0; i < 2000; i++) engine.tick();
  for (let i = 0; i < 40 && engine.windows.active; i++) {
    host.pointer(100, 100, 1);
    engine.tick();
    host.pointer(100, 100, 0);
    engine.tick();
  }
  for (let i = 0; i < 320; i++) engine.tick();
  const services = (engine as unknown as { services: BehaviorContext }).services;
  const said: string[] = [];
  const tracks: string[] = [];
  const ctx = Object.create(services, {
    messages: { value: { enqueue: () => undefined, say: (c: string | number, n: number) => void said.push(`${c}${n}`) } },
    sound: { value: { play: () => true, stop: () => undefined, stopEffect: () => undefined, effect: (c: string | number, n: number) => (tracks.push(`${c}${n}`), 2) } },
  }) as BehaviorContext;
  return { ctx, said, tracks, engine };
}

const decor = (spy: Spy, key: number) => spy.engine.registry.get(FAMILY.decor, key)!;
const make = (spy: Spy, num: number): GameObject => {
  const obj = spy.engine.state!.createObject({ typ: 1, num });
  spy.engine.state!.moveToRoom(obj, spy.engine.state!.loadedRoom!);
  return obj;
};

describe.skipIf(!hasOriginalFiles)("décors : famille 3", () => {
  it("8 procédures pour 9 clés, 101 et 102 partagées", () => {
    const spy = setup();
    for (const key of DECOR_KEYS) expect(decor(spy, key)).toBeDefined();
    expect(decor(spy, 101)).toBe(decor(spy, 102));
    expect(new Set(DECOR_KEYS.map((k) => decor(spy, k))).size).toBe(8);
  });

  it("jour et nuit (3) : image 0 le jour avec la piste B2, image 1 la nuit", () => {
    const spy = setup();
    const sun = make(spy, 3);
    spy.engine.state!.darkRoom = false;
    expect(decor(spy, 3)(sun, spy.ctx)).toBe(UPDATE_OK);
    expect(sun.fig).toBe(0);
    expect(spy.tracks).toContain("B2");
    spy.engine.state!.darkRoom = true;
    decor(spy, 3)(sun, spy.ctx);
    expect(sun.fig).toBe(1);
  });

  it("clignotement (101) : initialisé une fois, minuterie de 100 décomptée quand l'image 1 est tirée", () => {
    const spy = setup();
    let blinked = 0;
    for (let i = 0; i < 40; i++) {
      const lamp = make(spy, 101);
      Object.assign(lamp.anim, { total: 5, index: 1, remaining: 5 }); // animation en cours : l'image 0 reste
      decor(spy, 101)(lamp, spy.ctx);
      expect(lamp.raw[0x2c]).not.toBe(0);
      expect(lamp.speedY).toBe(1);
      if (lamp.fig === 1) {
        blinked++;
        expect(lamp.tim).toBe(99); // 100 posé puis décompté dans le même passage, comme `341b:0048`
        decor(spy, 101)(lamp, spy.ctx);
        expect(lamp.tim).toBe(98);
      }
    }
    expect(blinked).toBeGreaterThan(0);
    expect(blinked).toBeLessThan(40);
  });

  it("image au hasard (104) : image 0 à 5, minuterie de 30 à 59 hors image 0", () => {
    const spy = setup();
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const o = make(spy, 104);
      decor(spy, 104)(o, spy.ctx);
      seen.add(o.fig);
      expect(o.fig).toBeLessThan(6);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("piste de l'image 5 (105) : B104 à l'image 5 seulement", () => {
    const spy = setup();
    const o = make(spy, 105);
    o.anim.index = 3;
    decor(spy, 105)(o, spy.ctx);
    expect(spy.tracks).toEqual([]);
    o.anim.index = 5;
    decor(spy, 105)(o, spy.ctx);
    expect(spy.tracks).toEqual(["B104"]);
  });

  it("état au hasard (301, 302) : rien tant que la minuterie court, puis Ego 0, image et minuterie < 60", () => {
    const spy = setup();
    for (const [key, figures] of [[301, 4], [302, 5]] as const) {
      const o = make(spy, key);
      o.tim = 2;
      decor(spy, key)(o, spy.ctx);
      expect(o.tim).toBe(1);
      o.tim = 0;
      decor(spy, key)(o, spy.ctx);
      expect(o.ego).toBe(0);
      expect(o.fig).toBeLessThan(figures);
      expect(o.tim).toBeLessThan(60);
      expect(o.speedY).toBe(1);
    }
  });

  it("oiseau (5) : un quart disparaît à la création, les autres reçoivent une image Ego * 5 + n", () => {
    const spy = setup();
    let gone = 0;
    for (let i = 0; i < 60; i++) {
      const o = make(spy, 5);
      spy.engine.state!.darkRoom = false;
      decor(spy, 5)(o, spy.ctx);
      if (!spy.engine.state!.decors.includes(o)) gone++;
      else {
        expect(o.fig).toBeGreaterThanOrEqual(o.ego * 5);
        expect(o.fig).toBeLessThan(o.ego * 5 + 5);
      }
    }
    expect(gone).toBeGreaterThan(5);
    expect(gone).toBeLessThan(40);
  });

  it("geyser (304) : le jet à son sommet tue le héros proche (V376), pas le héros éloigné", () => {
    const spy = setup();
    const hero = spy.engine.state!.hero!;
    const geyser = make(spy, 304);
    const run = () => {
      geyser.raw[0x2c] = 7;
      geyser.ego = 1;
      geyser.fig = 1;
      geyser.anim.index = 9;
      geyser.anim.total = 9;
      geyser.anim.remaining = 1;
      decor(spy, 304)(geyser, spy.ctx);
    };
    geyser.x = hero.x;
    geyser.p = hero.p;
    hero.ego = 0;
    run();
    expect(spy.said).toContain("V376");
    expect(geyser.ego).toBe(2);
    spy.said.length = 0;
    geyser.x = hero.x + 100;
    run();
    expect(spy.said).toEqual([]);
    expect(geyser.ego).toBe(2);
  });
});
