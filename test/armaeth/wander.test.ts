import { describe, expect, it } from "vitest";
import { Lcg } from "../../src/engine/rng";
import type { BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import type { GameObject, GameRoom } from "../../src/games/armaeth/engine/state";
import { wander } from "../../src/games/armaeth/game/helpers";
import { NpcKit } from "../../src/games/armaeth/game/npc-kit";

/**
 * Errance `2151:0006` (`helpers.wander`) et face-à-face `2273:000c` (`NpcKit.faceOff`), relus dans le désassemblage : bornes -1 d'un
 * intervalle imposé ; au contact, l'objet mobile s'écarte de l'autre sur le premier axe où ils diffèrent.
 */

interface Target {
  x: number;
  y: number;
  p: number;
}

function rig(seed = 3): { ctx: BehaviorContext; loaded: GameRoom; targets: Target[] } {
  const loaded = { id: 309, exits: [12, 0, 0, 0, 0, 0] } as unknown as GameRoom;
  const targets: Target[] = [];
  const ctx = {
    rng: new Lcg(seed),
    room: loaded,
    hero: null,
    motion: {
      pathTo: (_obj: GameObject, x: number, y: number, p: number) => (targets.push({ x, y, p }), true),
      reset: () => {},
    },
  } as unknown as BehaviorContext;
  return { ctx, loaded, targets };
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
  it("intervalle imposé : une borne -1 vaut la borne élargie de la fenêtre (`2151:01b4`)", () => {
    const { ctx, loaded, targets } = rig();
    const walker = body(loaded);
    for (let i = 0; i < 200; i++) wander(ctx, walker, { p: [-1, 60] });
    expect(Math.min(...targets.map((t) => t.p))).toBeLessThan(0);
    expect(targets.every((t) => t.p >= 8 - 20 && t.p < 60)).toBe(true);
    targets.length = 0;
    for (let i = 0; i < 200; i++) wander(ctx, walker, { x: [180, -1] });
    expect(targets.every((t) => t.x >= 180 && t.x < 319 + 20)).toBe(true);
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
