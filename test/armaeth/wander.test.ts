import { describe, expect, it } from "vitest";
import { Lcg } from "../../src/engine/rng";
import type { RoomLimits } from "../../src/games/armaeth/data/scene";
import type { BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import type { GameObject, GameRoom } from "../../src/games/armaeth/engine/state";
import { wander } from "../../src/games/armaeth/game/helpers";
import { NpcKit } from "../../src/games/armaeth/game/npc-kit";

/**
 * Errance `2151:0006` (`helpers.wander`) et face-à-face `2273:000c` (`NpcKit.faceOff`), relus dans le désassemblage : fenêtre de
 * tirage = limites de la salle chargée (`4ac8`..`4ad6`) élargies de 20, bornes -1 d'un intervalle imposé, Y tiré pour les seuls
 * volants ; au contact, l'objet mobile s'écarte de l'autre sur le premier axe où ils diffèrent.
 */

const LIMITS: RoomLimits = { xMin: 0, xMax: 239, yMin: 0, yMax: 139, pMin: 8, pMax: 151 }; // salle 309

interface Target {
  x: number;
  y: number;
  p: number;
}

function rig(seed = 3): { ctx: BehaviorContext; loaded: GameRoom; other: GameRoom; targets: Target[] } {
  const loaded = { id: 309, exits: [12, 0, 0, 0, 0, 0] } as unknown as GameRoom;
  const other = { id: 310, exits: [0, 0, 0, 0, 0, 0] } as unknown as GameRoom;
  const targets: Target[] = [];
  const ctx = {
    rng: new Lcg(seed),
    room: loaded,
    hero: null,
    rooms: { limits: () => LIMITS },
    motion: {
      pathTo: (_obj: GameObject, x: number, y: number, p: number) => (targets.push({ x, y, p }), true),
      reset: () => {},
    },
  } as unknown as BehaviorContext;
  return { ctx, loaded, other, targets };
}

function body(room: GameRoom, fields: Partial<GameObject> = {}): GameObject {
  const target: { value: Target | null } = { value: null };
  return {
    x: 100,
    y: 90,
    p: 80,
    dep: 0,
    mob: 2,
    height: 30,
    room,
    holder: null,
    raw: new Uint8Array(0x100),
    path: {
      defined: false,
      get target() {
        return target.value;
      },
      set target(v: Target | null) {
        target.value = v;
      },
    },
    ...fields,
  } as unknown as GameObject;
}

describe("2151:0006 : cible d'errance", () => {
  it("dans la salle chargée : X et P dans les limites de la salle élargies de 20, Y = 0 pour un marcheur", () => {
    const { ctx, loaded, targets } = rig();
    const walker = body(loaded);
    for (let i = 0; i < 400; i++) wander(ctx, walker);
    const xs = targets.map((t) => t.x);
    const ps = targets.map((t) => t.p);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(LIMITS.xMin - 20);
    expect(Math.max(...xs)).toBeLessThan(LIMITS.xMax + 20);
    expect(Math.max(...xs)).toBeGreaterThan(LIMITS.xMax); // la fenêtre déborde de la salle, comme dans l'original
    expect(Math.min(...ps)).toBeGreaterThanOrEqual(LIMITS.pMin - 20);
    expect(Math.max(...ps)).toBeLessThan(LIMITS.pMax + 20);
    expect(targets.every((t) => t.y === 0)).toBe(true);
  });

  it("hors de la salle chargée : fenêtres [0, 319] et [0, 255] (`4acc`, `4ad8`), cible posée sans trajet", () => {
    const { ctx, other } = rig();
    const walker = body(other);
    const ps: number[] = [];
    for (let i = 0; i < 400; i++) {
      wander(ctx, walker);
      expect(walker.path.defined).toBe(true);
      ps.push(walker.path.target!.p);
      expect(walker.path.target!.x).toBeLessThan(339);
    }
    expect(Math.max(...ps)).toBeGreaterThan(200);
    expect(Math.max(...ps)).toBeLessThan(275);
  });

  it("intervalle imposé : une borne -1 vaut la borne élargie de la salle (`2151:01b4`)", () => {
    const { ctx, loaded, targets } = rig();
    const walker = body(loaded);
    for (let i = 0; i < 200; i++) wander(ctx, walker, { p: [-1, 60] });
    expect(Math.min(...targets.map((t) => t.p))).toBeLessThan(LIMITS.pMin);
    expect(targets.every((t) => t.p >= LIMITS.pMin - 20 && t.p < 60)).toBe(true);
    targets.length = 0;
    for (let i = 0; i < 200; i++) wander(ctx, walker, { x: [180, -1] });
    expect(targets.every((t) => t.x >= 180 && t.x < LIMITS.xMax + 20)).toBe(true);
  });

  it("volant (`Dep 1`) : Y tiré, ramené à 30 sous la hauteur de l'objet quand la salle n'a pas de sortie haute", () => {
    const { ctx, loaded, targets } = rig();
    const flyer = body(loaded, { dep: 1, height: 40 });
    for (let i = 0; i < 300; i++) wander(ctx, flyer);
    expect(targets.every((t) => t.y === 30 || t.y >= 40)).toBe(true);
    expect(targets.some((t) => t.y === 30)).toBe(true);
  });
});

describe("2273:000c : face-à-face", () => {
  const kit = new NpcKit();

  it("l'objet mobile s'écarte de l'autre en profondeur quand leurs P diffèrent", () => {
    const { ctx, loaded, targets } = rig();
    for (let i = 0; i < 100; i++) {
      const other = body(loaded, { p: 90 });
      const self = body(loaded, { p: 70 });
      kit.faceOff(ctx, other, self);
    }
    expect(targets.every((t) => t.p < 70)).toBe(true);
    targets.length = 0;
    for (let i = 0; i < 100; i++) kit.faceOff(ctx, body(loaded, { p: 50 }), body(loaded, { p: 70 }));
    expect(targets.every((t) => t.p >= 70)).toBe(true);
  });

  it("à même profondeur, il s'écarte en X ; immobile (`Mob` != 2), il s'arrête seulement", () => {
    const { ctx, loaded, targets } = rig();
    for (let i = 0; i < 100; i++) kit.faceOff(ctx, body(loaded, { x: 140 }), body(loaded, { x: 120 }));
    expect(targets.every((t) => t.x < 120)).toBe(true);
    targets.length = 0;
    const still = body(loaded, { mob: 1, speedX: 1 } as Partial<GameObject>);
    kit.faceOff(ctx, body(loaded, { x: 140 }), still);
    expect(targets).toHaveLength(0);
    expect(still.speedX).toBe(0);
  });
});
