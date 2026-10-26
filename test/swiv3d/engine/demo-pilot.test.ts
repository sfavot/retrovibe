import { describe, expect, it } from "vitest";
import { emptyInput } from "../../../src/games/swiv3d/engine/input";
import { NodeNet } from "../../../src/games/swiv3d/engine/nodes";
import { GameObject } from "../../../src/games/swiv3d/engine/objects";
import { World } from "../../../src/games/swiv3d/engine/world";
import type { Waypoint } from "../../../src/games/swiv3d/data/level";
import { hasOriginalFiles, loadLevel } from "./helpers";

function net(links: number[][]): NodeNet {
  const waypoints: Waypoint[] = links.map((l, i) => ({
    links: l as Waypoint["links"],
    x: i * 100,
    z: 0,
    capacity: { ships: 0, aircraft: 1, ground: 1 },
  }));
  return new NodeNet({ waypoints });
}

describe("NodeNet.advanceAir (FUN_00442c90)", () => {
  it("prend le dernier lien du nœud et efface le lien de retour, sans jamais revenir en arrière", () => {
    const n = net([
      [1, -1, -1, -1],
      [0, 2, -1, -1],
      [1, -1, -1, -1],
    ]);
    const o = new GameObject(0);
    n.claim("air", o);
    expect(o.node).toBe(0);
    n.advanceAir(o);
    expect(o.node).toBe(1);
    expect(n.links[1 * 4 + 0]).toBe(-1); // 1 → 0 effacé
    expect(n.capacity("air", 0)).toBe(1);
    expect(n.capacity("air", 1)).toBe(0);
    n.advanceAir(o);
    expect(o.node).toBe(2); // le dernier lien de 1 est 2
    n.advanceAir(o);
    expect(o.node).toBe(2); // cul-de-sac : on reste (le lien 2 → 1 a été effacé)
  });

  it("choisit le dernier lien valide, pas le premier", () => {
    const n = net([
      [1, 2, 3, -1],
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
      [0, -1, -1, -1],
    ]);
    const o = new GameObject(0);
    n.claim("air", o);
    n.advanceAir(o);
    expect(o.node).toBe(3);
  });
});

describe.skipIf(!hasOriginalFiles)("pilote de démonstration (forme 0x2a, DEMO.SLV)", () => {
  const demo = () => {
    const { level, models } = loadLevel("DEMO");
    return World.load(level, models);
  };

  it("réserve un nœud aérien au premier tick et suit le chemin à 80 unités du relief, sans dégât", () => {
    const w = demo();
    const o = w.player.obj;
    expect(o.node).toBe(-1);
    const nodes = new Set<number>();
    let far = 0;
    const x0 = o.x;
    const z0 = o.z;
    for (let t = 0; t < 1500; t++) {
      w.tick(emptyInput());
      if (t === 0) expect(o.node).toBeGreaterThanOrEqual(0);
      nodes.add(o.node);
      far = Math.max(far, Math.hypot(o.x - x0, o.z - z0) / 256);
    }
    expect(nodes.size).toBeGreaterThanOrEqual(10); // parcourt le circuit
    expect(far).toBeGreaterThan(1500);
    expect(o.hp).toBe(496);
    // l'asservissement garde le relief à ≥ 30 unités sous l'appareil
    expect((o.y - w.terrain.height(o.x, o.z)) >> 8).toBeGreaterThan(30);
  });

  it("se déplace à la vitesse de croisière de l'hélicoptère en virage (tangage ≈ -25, ≈ 2 900 Q8/tick)", () => {
    const w = demo();
    for (let t = 0; t < 400; t++) w.tick(emptyInput());
    expect(w.player.speed).toBeGreaterThan(2000);
    expect(w.player.speed).toBeLessThan(3500);
    expect(w.player.pitch).toBeLessThan(-15);
  });

  it("est déterministe", () => {
    const hash = () => {
      const w = demo();
      for (let t = 0; t < 500; t++) w.tick(emptyInput());
      return w.stateHash();
    };
    expect(hash()).toBe(hash());
  });
});
