import { describe, expect, it } from "vitest";
import {
  GameObject,
  Grid,
  ObjectPool,
  POOL_SIZE,
  cellOf,
  radius2,
} from "../../../src/games/swiv3d/engine/objects";
import { collideCell } from "../../../src/games/swiv3d/engine/collisions";
import { CLASS, FLAG } from "../../../src/games/swiv3d/engine/objects";

describe("pool et grille (synthétiques)", () => {
  it("alloue en FIFO et recycle les emplacements libérés en queue", () => {
    const pool = new ObjectPool(4);
    const a = pool.alloc()!;
    const b = pool.alloc()!;
    expect([a.slot, b.slot]).toEqual([0, 1]);
    pool.release(a);
    expect(pool.alloc()!.slot).toBe(2);
    expect(pool.alloc()!.slot).toBe(3);
    expect(pool.alloc()!.slot).toBe(0); // le libéré est servi après les autres
    expect(pool.alloc()).toBeNull();
    expect(pool.liveCount).toBe(4);
  });

  it("a 3 000 emplacements par défaut", () => {
    expect(new ObjectPool().objects).toHaveLength(POOL_SIZE);
  });

  it("hache les positions Q8 en cellules de 512 unités sur 64×64", () => {
    expect(cellOf(0, 0)).toBe(0);
    expect(cellOf(512 * 256, 0)).toBe(1);
    expect(cellOf(0, 512 * 256)).toBe(64);
    expect(cellOf((1 << 23) - 1, (1 << 23) - 1)).toBe(63 + 63 * 64);
  });

  it("insère en tête (fin du tableau) et retire", () => {
    const g = new Grid();
    const a = new GameObject(0);
    const b = new GameObject(1);
    g.insert(a);
    g.insert(b);
    expect(g.cells[0]).toEqual([a, b]);
    g.remove(a);
    expect(g.cells[0]).toEqual([b]);
  });

  it("donne 100 de rayon² sans modèle", () => {
    expect(radius2(new Map(), 0)).toBe(100);
    expect(radius2(new Map(), 11000)).toBe(100);
    expect(radius2(new Map(), 500)).toBe(100);
  });
});

function obj(
  slot: number,
  classe: number,
  hp: number,
  x = 0,
  flags = 0,
): GameObject {
  const o = new GameObject(slot);
  o.classe = classe;
  o.hp = hp;
  o.x = x << 8;
  o.flags = flags;
  return o;
}

describe("collisions objet ↔ objet", () => {
  const models = new Map();

  it("retire min(pvA, pvB, 100) aux deux, éclair + touché, dégel, cible = propriétaire de l'autre", () => {
    const bullet = obj(0, 0x3b, 35);
    const tree = obj(1, 0x4081, 10, 5, FLAG.FROZEN);
    collideCell([tree, bullet], models); // tête = fin du tableau
    expect(bullet.hp).toBe(25);
    expect(tree.hp).toBe(0);
    expect(tree.flags & 0x102).toBe(0x102);
    expect(tree.flags & FLAG.FROZEN).toBe(0);
    expect(tree.target).toBe(bullet);
    expect(bullet.target).toBe(tree);
  });

  it("plafonne les dégâts à 100", () => {
    const a = obj(0, CLASS.SOLID | CLASS.DANGEROUS, 500);
    const b = obj(1, CLASS.SOLID | CLASS.DANGEROUS, 300, 2);
    collideCell([a, b], models);
    expect([a.hp, b.hp]).toEqual([400, 200]);
  });

  it("ne fait que pousser quand un seul est solide et aucun dangereux", () => {
    const player = obj(0, 0x217, 496);
    const tree = obj(1, 0x4001, 10, 4);
    collideCell([tree, player], models);
    expect([player.hp, tree.hp]).toEqual([496, 10]);
    expect(player.vx).toBeLessThan(0); // repoussé à l'opposé de l'arbre (x croissant)
    expect(tree.vx).toBe(0); // non solide : immobile
  });

  it("épargne les invulnérables, les fantômes et la même famille", () => {
    const a = obj(0, 0x3b, 35);
    const inv = obj(1, 0x0003, 50, 1, FLAG.INVULNERABLE);
    collideCell([inv, a], models);
    expect(inv.hp).toBe(50);
    expect(a.hp).toBe(0); // la balle paie quand même min(35, 50)
  });

  it("ignore les objets trop éloignés et ceux de classe fantôme", () => {
    const a = obj(0, 0x3b, 35);
    const far = obj(1, 0x0003, 50, 20); // d² = 400 > 100 + 100
    collideCell([far, a], models);
    expect([a.hp, far.hp]).toEqual([35, 50]);
    const ghost = obj(2, 0x0043, 50, 1);
    collideCell([ghost, a], models);
    expect(ghost.hp).toBe(50);
  });

  it("ignore un objet et son propriétaire (projectile du joueur)", () => {
    const shooter = obj(0, 0x217, 496);
    const bullet = obj(1, 0x3b, 35, 1);
    bullet.owner = shooter;
    collideCell([bullet, shooter], models);
    expect([shooter.hp, bullet.hp]).toEqual([496, 35]);
  });

  it("utilise le rayon² des modèles (somme des deux)", () => {
    const big = new Map([[500, { radiusSquared: 1000 }]]) as never;
    const a = obj(0, 0x3b, 35);
    a.model = 500;
    const b = obj(1, 0x0003, 50, 30); // d² = 900 <= 1000 + 100
    collideCell([b, a], big);
    expect(b.hp).toBe(15);
  });
});
