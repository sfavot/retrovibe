import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { parseDaw } from "../../src/engine/desktop-adventures/data/daw";
import { type Character, type MonsterPlacement, type Zone, Layer, ZoneType } from "../../src/engine/desktop-adventures/data/types";
import { type MonsterHost, moveMonsters } from "../../src/engine/desktop-adventures/monsters";
import { Rng } from "../../src/engine/desktop-adventures/rng";
import { ZoneState } from "../../src/engine/desktop-adventures/zone-state";
import { Movement, moveYodaMonster } from "../../src/games/yoda/monster-moves";
import { originalFiles } from "../support/original";

const SIZE = 9;
const MONSTER_TILE = 100;

function character(movementType: number, over: Partial<Character> = {}): Character {
  const frame = () => new Int16Array(8).fill(MONSTER_TILE);
  return {
    id: 0,
    name: "test",
    type: 0,
    movementType,
    frames: [frame(), frame(), frame()],
    reference: -1,
    health: 10,
    damage: 2,
    ...over,
  } as Character;
}

function build(movementType: number, at = { x: 4, y: 4 }, hero = { x: 0, y: 0 }, waypoints: number[] = [], over: Partial<Character> = {}) {
  const placement: MonsterPlacement = { character: 0, x: at.x, y: at.y, loot: -1, dropsLoot: false, waypoints: Int32Array.from(waypoints) };
  const zone = {
    id: 0,
    name: "z",
    width: SIZE,
    height: SIZE,
    type: ZoneType.None,
    planet: 0,
    tiles: new Int16Array(SIZE * SIZE * 3).fill(-1),
    hotspots: [],
    monsters: [placement],
    actions: [],
  } as unknown as Zone;
  const assets = { character: () => character(movementType, over), hasFlag: () => false } as unknown as Assets;
  const state = new ZoneState(zone, assets);
  const hurts: number[] = [];
  const host = {
    zone: state,
    assets,
    rng: new Rng(1),
    tick: 1,
    hero: { ...hero },
    hurtHero: (d: number) => hurts.push(d),
    playSound: () => {},
  } as MonsterHost & { tick: number; hero: { x: number; y: number } };
  const m = state.monsters[0];
  state.setTile(m.x, m.y, Layer.Object, MONSTER_TILE);
  /** Un tick complet : IA puis redessin, comme le moteur. */
  const tick = () => {
    host.tick++;
    moveMonsters(host, moveYodaMonster);
  };
  return { state, host, m, hurts, tick };
}

describe("IA des monstres de Yoda", () => {
  it("un monstre « sit » ne bouge pas et se tourne vers le héros", () => {
    const { m, host, tick } = build(Movement.Sit, { x: 4, y: 4 }, { x: 4, y: 1 });
    for (let i = 0; i < 50; i++) tick();
    expect(m).toMatchObject({ x: 4, y: 4 });
    expect(m.facing).toBe(0); // Direction.Up
    expect(host.hero).toEqual({ x: 4, y: 1 });
  });

  it("un patrouilleur suit ses points de passage en boucle", () => {
    const { m, tick } = build(Movement.Patrol, { x: 1, y: 1 }, { x: 8, y: 8 }, [1, 1, 3, 1, 3, 3, 1, 3]);
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      tick();
      seen.add(`${m.x},${m.y}`);
    }
    for (const p of ["3,1", "3,3", "1,3", "1,1"]) expect(seen.has(p)).toBe(true);
  });

  it("un ennemi agressif s'approche du héros et le frappe", () => {
    const { m, hurts, tick } = build(Movement.Charger, { x: 6, y: 4 }, { x: 2, y: 4 });
    let minDistance = 99;
    for (let i = 0; i < 200; i++) {
      tick();
      minDistance = Math.min(minDistance, Math.max(Math.abs(m.x - 2), Math.abs(m.y - 4)));
    }
    expect(minDistance).toBe(1);
    expect(hurts.length).toBeGreaterThan(0);
    expect(hurts.every((d) => d === 2)).toBe(true);
  });

  it("un monstre armé ne frappe pas au corps à corps (type 3)", () => {
    const { m, host, hurts } = build(Movement.Wanderer, { x: 3, y: 4 }, { x: 4, y: 4 }, [], { reference: 5 });
    // IA seule : le tir (géré par le moteur) est hors sujet.
    for (let i = 0; i < 100; i++) {
      host.tick++;
      moveYodaMonster(m, host);
    }
    expect(hurts).toHaveLength(0);
  });

  it("un monstre qui fuit s'éloigne du héros", () => {
    const { m, tick } = build(Movement.Scaredy, { x: 4, y: 4 }, { x: 3, y: 4 });
    for (let i = 0; i < 6; i++) tick();
    expect(m.x).toBeGreaterThan(4);
  });

  it.each([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12])("type %i : reste dans la zone et ne traverse aucun objet", (type) => {
    const { state, m, host, tick } = build(type as number, { x: 4, y: 4 }, { x: 0, y: 0 }, [0, 0, 8, 0, 8, 8, 0, 8]);
    // Quelques obstacles dans la couche objets.
    for (const [x, y] of [[2, 2], [5, 4], [4, 6], [6, 6], [3, 4]]) state.setTile(x, y, Layer.Object, 7);
    const obstacles = [...state.tiles].filter((t) => t === 7).length;
    for (let i = 0; i < 400; i++) {
      host.hero = { x: i % SIZE, y: (i >> 3) % SIZE };
      const before = { x: m.x, y: m.y };
      tick();
      expect(state.inBounds(m.x, m.y)).toBe(true);
      expect(Math.max(Math.abs(m.x - before.x), Math.abs(m.y - before.y))).toBeLessThanOrEqual(1);
      expect(state.getTile(m.x, m.y, Layer.Object)).toBe(MONSTER_TILE);
    }
    expect([...state.tiles].filter((t) => t === 7).length).toBe(obstacles);
  });
});

const yoda = originalFiles("yoda", "YODESK.DTA");

describe.skipIf(!yoda.has)("IA des monstres sur les zones d'origine", () => {
  it("500 ticks sur toutes les zones avec monstres, sans exception ni sortie de zone", () => {
    const assets = new Assets(parseDaw(yoda.read("YODESK.DTA"), "yoda"));
    const rng = new Rng(42);
    let zones = 0;
    for (const zone of assets.data.zones) {
      if (zone.monsters.length === 0) continue;
      const state = new ZoneState(zone, assets);
      for (const m of state.monsters) {
        if (state.getTile(m.x, m.y, Layer.Object) === -1) state.setTile(m.x, m.y, Layer.Object, m.character.frames[0][1]);
      }
      const host: MonsterHost = {
        zone: state,
        assets,
        rng,
        tick: 0,
        hero: { x: Math.floor(zone.width / 2), y: Math.floor(zone.height / 2) },
        hurtHero: () => {},
        playSound: () => {},
      };
      for (let t = 0; t < 500; t++) {
        (host as { tick: number }).tick = t;
        moveMonsters(host, moveYodaMonster);
        if (t % 50 === 0) (host as { hero: unknown }).hero = { x: rng.mod(zone.width), y: rng.mod(zone.height) };
      }
      for (const m of state.monsters) expect(state.inBounds(m.x, m.y)).toBe(true);
      zones++;
    }
    expect(zones).toBeGreaterThan(0);
  });
});
