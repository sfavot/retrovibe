import { describe, expect, it } from "vitest";
import type { BehaviorContext } from "../../src/games/armaeth/engine/handlers";
import type { GameObject, GameRoom } from "../../src/games/armaeth/engine/state";
import { NpcKit } from "../../src/games/armaeth/game/npc-kit";

/**
 * `30d9:08c8` (désassemblage, table `30d9:0984` indexée par `Err`) : hors de la salle chargée, `Err 8` (contact bloquant) fait le pas que
 * le déplacement a refusé ; 0, 9, 0x0A et 0x11 laissent la position au déplacement ; tout autre `Err` rend 5 (bloqué).
 */

const loaded = { id: 309 } as unknown as GameRoom;
const other = { id: 8 } as unknown as GameRoom;
const ctx = { room: loaded, hero: null } as unknown as BehaviorContext;

function walker(err: number): GameObject {
  return {
    x: 157,
    y: 74,
    p: 44,
    dep: 0,
    err,
    stepX: 2,
    stepY: 0,
    speedX: -1,
    speedP: 1,
    speedY: 0,
    room: other,
    location: 1,
    holder: null,
    raw: new Uint8Array(0x100),
    path: { defined: true, target: { x: 60, y: 0, p: 120, plane: 0 } },
  } as unknown as GameObject;
}

describe("30d9:08c8 : marche hors de la salle chargée", () => {
  it("Err 8 : le pas refusé par le contact est fait (dpX en X, 1 en P), puis la direction est reprise", () => {
    const obj = walker(8);
    expect(new NpcKit().stepPath(ctx, obj)).toBe(0);
    expect([obj.x, obj.p]).toEqual([155, 45]);
    expect([obj.speedX, obj.speedP]).toEqual([-1, 1]);
    expect(obj.err).toBe(0);
  });

  it("Err 0 : pas de pas ici (le déplacement l'a fait), seulement la direction", () => {
    const obj = walker(0);
    expect(new NpcKit().stepPath(ctx, obj)).toBe(0);
    expect([obj.x, obj.p]).toEqual([157, 44]);
    expect([obj.speedX, obj.speedP]).toEqual([-1, 1]);
  });

  it("un autre Err (mur, 1) : bloqué (5), arrêté", () => {
    const obj = walker(1);
    expect(new NpcKit().stepPath(ctx, obj)).toBe(5);
    expect([obj.x, obj.p]).toEqual([157, 44]);
    expect([obj.speedX, obj.speedP]).toEqual([0, 0]);
  });
});
