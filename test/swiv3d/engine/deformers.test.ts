import { describe, expect, it } from "vitest";
import {
  DEFORMER_DOME,
  DEFORMER_POOL_SIZE,
  DEFORMER_WAVE,
  Deformers,
} from "../../../src/games/swiv3d/engine/deformers";
import type { GameObject } from "../../../src/games/swiv3d/engine/objects";
import { hasOriginalFiles } from "./helpers";
import { scenario, type Scenario } from "./scenario";

describe("réserve des déformations du terrain (`00587714` / `00587704`)", () => {
  it("compte 5 nœuds, pris en tête de la liste libre jusqu'à épuisement", () => {
    const d = new Deformers();
    expect(DEFORMER_POOL_SIZE).toBe(5);
    expect(d.free).toHaveLength(5);
    expect(d.active).toHaveLength(0);
    const taken = [];
    for (let i = 0; i < 5; i++) {
      expect(d.available).toBe(true);
      taken.push(d.take(i, 0, 0, 10, DEFORMER_WAVE));
    }
    expect(taken.every((n) => n !== null)).toBe(true);
    expect(d.available).toBe(false);
    expect(d.take(9, 0, 0, 10, DEFORMER_WAVE)).toBeNull();
    // chaque prise passe en tête de la liste active
    expect(d.active.map((n) => n.x)).toEqual([4, 3, 2, 1, 0]);
  });

  it("décrémente la durée à chaque tick, rend les nœuds échus et inverse l'ordre des autres", () => {
    const d = new Deformers();
    const a = d.take(1, 0, 0, 1, DEFORMER_WAVE)!;
    d.take(2, 0, 0, 3, DEFORMER_WAVE);
    d.take(3, 0, 0, 3, DEFORMER_DOME);
    expect(d.active.map((n) => n.x)).toEqual([3, 2, 1]);
    d.tick();
    expect(d.active.map((n) => n.x)).toEqual([2, 3]);
    expect(d.active.map((n) => n.life)).toEqual([2, 2]);
    expect(d.free).toHaveLength(3);
    // le nœud échu est en tête de la liste libre : c'est lui qui resservira
    expect(d.free[0]).toBe(a);
    d.tick();
    expect(d.active.map((n) => n.x)).toEqual([3, 2]);
    d.tick();
    expect(d.active).toHaveLength(0);
    expect(d.free).toHaveLength(5);
    d.tick(); // liste vide : rien
    expect(d.free).toHaveLength(5);
  });
});

/** Munitions : `n` à `count`, le reste à 0. */
function ammo(n: number, count: number): number[] {
  const a = new Array<number>(20).fill(0);
  a[n] = count;
  return a;
}

function live(s: Scenario, update: string): GameObject[] {
  return [...s.world.liveObjects()].filter((o) => o.update === update);
}

/** Choisit l'arme `n` (touche `n % 10 + 1`), attend qu'elle soit armée et tire ; retourne le projectile. */
function fire(s: Scenario, n: number, update: string): GameObject {
  s.run(1, { weaponDirect: (n % 10) + 1 });
  expect(s.world.game.selected).toBe(n);
  for (let t = 0; t < 200 && s.world.game.weaponState !== 10; t++) s.run(1);
  s.run(1, { fireSpecial: true });
  const o = live(s, update)[0];
  expect(o).toBeDefined();
  return o!;
}

/** Occupe toute la réserve pendant `life` ticks. */
function exhaust(s: Scenario, life: number): void {
  while (s.world.deformers.available) s.world.deformers.take(0, 0, 0, life, 2);
}

describe.skipIf(!hasOriginalFiles)("déformations du terrain et armes spéciales", () => {
  it("bombe : prend une onde de choc de 40 ticks à sa position, rendue à la réserve 40 ticks plus tard", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(7, 2) });
    const b = fire(s, 7, "special_bomb");
    for (let t = 0; t < 60 && b.state === 0; t++) s.run(1);
    expect(b.state).toBe(1);
    const d = s.world.deformers;
    expect(d.active).toHaveLength(1);
    const node = d.active[0]!;
    expect(node.type).toBe(DEFORMER_WAVE);
    // pris pendant la mise à jour de la bombe puis décrémenté en fin de tick
    expect(node.life).toBe(0x28 - 1);
    // à la position de la bombe au moment de la prise (elle ne bouge presque plus : vitesse × 30/32 par tick)
    expect(Math.abs(node.x - b.x)).toBeLessThan(64 * 256);
    expect(Math.abs(node.z - b.z)).toBeLessThan(64 * 256);
    expect(node.y).toBe(s.world.terrain.height(node.x, node.z));
    expect(s.world.camera.wideShot).toBe(true);
    s.run(0x28 - 2);
    expect(d.active).toHaveLength(1);
    s.run(1);
    expect(d.active).toHaveLength(0);
    expect(d.free).toHaveLength(5);
    expect(s.world.camera.wideShot).toBe(false);
  });

  it("méga-bombe : dôme de 60 ticks à la hauteur de sol la plus basse entre la bombe et le joueur", () => {
    // l'arme 17 n'est choisie que parce que la banque basse (7) est vide
    const s = scenario("TERRAN00", () => [], { ammo: ammo(17, 2) });
    const b = fire(s, 17, "special_megabomb");
    let ownerGround = 0;
    for (let t = 0; t < 60 && b.state === 0; t++) {
      // sol sous le joueur au début du tick : la bombe est mise à jour avant la fonction pilote
      ownerGround = s.world.terrain.height(s.world.player.obj.x, s.world.player.obj.z);
      s.run(1);
    }
    expect(b.state).toBe(1);
    const node = s.world.deformers.active[0]!;
    expect(node.type).toBe(DEFORMER_DOME);
    expect(node.life).toBe(0x3c - 1);
    expect(node.y).toBe(Math.min(s.world.terrain.height(node.x, node.z), ownerGround));
  });

  it("bombe : sans nœud libre, elle continue son vol et n'explose qu'une fois la réserve rendue", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(7, 2) });
    const b = fire(s, 7, "special_bomb");
    exhaust(s, 60);
    s.run(50);
    expect(b.state).toBe(0);
    expect(b.classe).not.toBe(0);
    s.run(15);
    expect(b.state).toBe(1);
    expect(s.world.deformers.active.filter((n) => n.type === DEFORMER_WAVE)).toHaveLength(1);
  });

  it("mortier : attend un nœud libre pour éclater, sans le prendre", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(6, 2) });
    const m = fire(s, 6, "special_mortar");
    exhaust(s, 50);
    s.run(45);
    expect(m.classe).not.toBe(0);
    expect(live(s, "bullet_heavy")).toHaveLength(0);
    s.run(10);
    expect(m.classe).toBe(0);
    expect(live(s, "bullet_heavy").length).toBe(35);
    expect(s.world.deformers.active).toHaveLength(0);
  });
});
