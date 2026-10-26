import { describe, expect, it } from "vitest";
import { Terrain, applyCrater, applyPointCrater, craterSiteClear } from "../../../src/games/swiv3d/engine/terrain";
import { loadGlobal } from "../screens/support";
import { hasOriginalFiles, loadLevel } from "./helpers";
import { rec, scenario } from "./scenario";

describe("terrain (synthétique)", () => {
  const map = new Uint8Array(512 * 512);
  map[0] = 10; // (0,0)
  map[1] = 20; // (1,0)
  map[512] = 30; // (0,1)
  map[513] = 50; // (1,1)
  const t = new Terrain(map);

  it("renvoie octet × 0x400 aux coins", () => {
    expect(t.height(0, 0)).toBe(10 * 0x400);
    expect(t.height(1 << 14, 0)).toBe(20 * 0x400);
  });

  it("interpole bilinéairement sur 8 bits", () => {
    // mi-chemin en x (fraction 128 = 0x80 << 6 = 0x2000) puis en z
    expect(t.height(0x2000, 0)).toBe(15 * 0x400);
    expect(t.height(0, 0x2000)).toBe(20 * 0x400);
    expect(t.height(0x2000, 0x2000)).toBe(((15 + 40) / 2) * 0x400);
  });

  it("replie les cellules modulo 512 (tore)", () => {
    expect(t.height(512 << 14, 0)).toBe(t.height(0, 0));
    expect(t.height(-1 << 14, 0)).toBe(map[511]! * 0x400);
    expect(t.height(0, 512 << 14)).toBe(t.height(0, 0));
  });
});

describe.skipIf(!hasOriginalFiles)("terrain (TERRAN00)", () => {
  const { level } = loadLevel("TERRAN00");
  const t = Terrain.fromLevel(level);

  it("lit la carte du bloc 100 aux cellules connues", () => {
    for (const [cx, cz] of [
      [0, 0],
      [100, 200],
      [511, 511],
      [256, 3],
      [12159 >> 6, 29373 >> 6],
    ] as const) {
      expect(t.height(cx << 14, cz << 14)).toBe(
        level.heightmap[cz * 512 + cx]! * 0x400,
      );
      expect(t.cell(cx, cz)).toBe(level.heightmap[cz * 512 + cx]);
    }
  });

  it("est périodique de 2^23 en Q8 (32 768 unités)", () => {
    for (const [x, z] of [
      [123456, 654321],
      [7_000_000, 100],
      [5, 8_000_000],
    ] as const)
      expect(t.height(x + (1 << 23), z)).toBe(t.height(x, z));
    expect(t.height(100, 200 + (1 << 23))).toBe(t.height(100, 200));
    expect(t.height(-5_000, -9_000)).toBe(
      t.height((1 << 23) - 5_000, (1 << 23) - 9_000),
    );
  });

  it("reste entre les hauteurs extrêmes de la carte", () => {
    for (let i = 0; i < 200; i++) {
      const h = t.height(i * 41_113, i * 97_241);
      expect(h).toBeGreaterThanOrEqual(28 * 0x400);
      expect(h).toBeLessThanOrEqual(255 * 0x400);
    }
  });
});

describe("cratères (bloc 700)", () => {
  const profiles = (): Int32Array[][] =>
    Array.from({ length: 3 }, (_, size) =>
      Array.from({ length: 16 }, () => Int32Array.from({ length: 16 }, (_, i) => (i === 5 ? 10 + size : i === 6 ? 4 : 0))),
    );
  const flat = (h: number, ground: number): { heights: Uint8Array; ground: Uint8Array } => ({
    heights: new Uint8Array(512 * 512).fill(h),
    ground: new Uint8Array(512 * 512).fill(ground),
  });
  const q8 = (cell: number, quarter = 0): number => (cell << 14) + (quarter << 12);

  it("abaisse la carte de hauteur de la profondeur du profil (plancher 0) et assombrit le sol", () => {
    const m = flat(100, 40);
    expect(applyCrater(m.heights, m.ground, profiles(), q8(10), q8(20), 1)).toBe(true);
    // profil indice 5 = ligne 1, colonne 1 : cellule (cx - 1 + 1, cz - 1 + 1) = (10, 20)
    expect(m.heights[20 * 512 + 10]).toBe(100 - 11);
    expect(m.heights[20 * 512 + 11]).toBe(100 - 4);
    expect(m.ground[20 * 512 + 10]).toBe(40 + 22);
    expect(m.heights[20 * 512 + 12]).toBe(100);
    const low = flat(5, 40);
    applyCrater(low.heights, low.ground, profiles(), q8(10), q8(20), 2);
    expect(low.heights[20 * 512 + 10]).toBe(0);
  });

  it("choisit le profil selon la sous-position de l'impact et replie le tore", () => {
    const m = flat(100, 40);
    const p = profiles();
    p[0]![(2 << 2) | 3]![0] = 9; // z sous-cellule 2, x sous-cellule 3
    expect(applyCrater(m.heights, m.ground, p, q8(0, 3) + 5, q8(0, 2), 0)).toBe(true);
    expect(m.heights[511 * 512 + 511]).toBe(91); // (cx - 1, cz - 1) replié
  });

  it("refuse un site à moins de 3 cellules de l'eau (carte 102 nulle)", () => {
    const m = flat(100, 40);
    m.ground[22 * 512 + 14] = 0;
    expect(applyCrater(m.heights, m.ground, profiles(), q8(10), q8(20), 1)).toBe(true); // (14, 22) hors des 6 × 6
    expect(applyCrater(m.heights, m.ground, profiles(), q8(11), q8(21), 1)).toBe(false);
    expect(m.heights[21 * 512 + 11]).toBe(100);
  });

  it("ne brunit pas les cellules à 0 et plafonne à 240", () => {
    const m = flat(100, 235);
    applyCrater(m.heights, m.ground, profiles(), q8(10), q8(20), 0);
    expect(m.ground[20 * 512 + 10]).toBe(240);
  });

  it.skipIf(!hasOriginalFiles)("avec les vrais profils : centre le plus profond, symétrique à mi-cellule", () => {
    const { craters } = loadGlobal();
    const m = flat(200, 40);
    applyCrater(m.heights, m.ground, craters, q8(10, 2), q8(20, 2), 2);
    const at = (x: number, z: number): number => 200 - m.heights[z * 512 + x]!;
    expect(at(10, 20)).toBe(at(11, 20));
    expect(at(10, 20)).toBe(at(10, 21));
    expect(at(10, 20)).toBeGreaterThan(10);
    expect(at(9, 19)).toBeLessThan(at(10, 20));
  });
});

describe.skipIf(!hasOriginalFiles)("World.crater", () => {
  it("creuse la carte partagée avec le rendu, seulement avec les profils", async () => {
    const { World } = await import("../../../src/games/swiv3d/engine/world");
    const { level, models } = loadLevel("TERRAN00");
    const fresh = { ...level, heightmap: Uint8Array.from(level.heightmap), groundMap: Uint8Array.from(level.groundMap) };
    const without = World.load(fresh, models);
    expect(without.crater(5 << 14, 5 << 14, 1)).toBe(false);
    const world = World.load(fresh, models, { craters: loadGlobal().craters });
    // un site sec : on cherche une cellule dont les 6 × 6 voisines sont non nulles
    let site = -1;
    for (let c = 40; c < 480 && site < 0; c++) {
      let ok = true;
      for (let dz = -2; dz <= 3 && ok; dz++) for (let dx = -2; dx <= 3; dx++) if (fresh.groundMap[(100 + dz) * 512 + c + dx] === 0) ok = false;
      if (ok) site = c;
    }
    expect(site).toBeGreaterThan(0);
    const before = fresh.heightmap[100 * 512 + site]!;
    expect(world.crater((site << 14) + 0x2000, (100 << 14) + 0x2000, 2)).toBe(true);
    expect(world.terrain.heightmap).toBe(fresh.heightmap);
    expect(fresh.heightmap[100 * 512 + site]!).toBeLessThanOrEqual(before);
    expect([...fresh.heightmap].some((v, i) => v !== level.heightmap[i])).toBe(true);
  });
});

describe("cratères : lissage, site libre, cratère ponctuel", () => {
  const MAP = 512;
  const at = (x: number, z: number): number => z * MAP + x;
  const q8 = (cell: number): number => cell << 14;
  const deep = (): Int32Array[][] =>
    Array.from({ length: 3 }, () => Array.from({ length: 16 }, () => Int32Array.from({ length: 16 }, (_, i) => (i === 5 ? 30 : 0))));

  it("lisse en place les cellules dont un voisin diffère de plus de 19 (moyenne entière des 9 cellules)", () => {
    const heights = new Uint8Array(MAP * MAP).fill(100);
    const ground = new Uint8Array(MAP * MAP).fill(40);
    expect(applyCrater(heights, ground, deep(), q8(10), q8(20), 1)).toBe(true);
    // centre du profil (10, 20) : 100 - 30 = 70 ; ses voisins sont à 100 (écart 30 > 19), les cellules déjà lissées comptent
    // lignes 19..22, colonnes 9..12 : (9, 19) est la première : voisins (8..10, 18..20), dont (10, 20) à 70 mais écart de 30 → moyenne
    expect(heights[at(9, 19)]).toBe(Math.trunc((100 * 8 + 70) / 9));
    // la cellule creusée est lissée à son tour, avec les cellules voisines déjà moyennées
    const center = heights[at(10, 20)]!;
    expect(center).toBeGreaterThan(70);
    expect(center).toBeLessThan(100);
    // hors des 4 × 4 cellules : intact
    expect(heights[at(13, 20)]).toBe(100);
    expect(heights[at(8, 20)]).toBe(100);
    // le lissage ne touche pas le sol dans le test de ressaut : un creux de 10 (≤ 19) n'est pas lissé
    const h2 = new Uint8Array(MAP * MAP).fill(100);
    const profile = Array.from({ length: 3 }, () => Array.from({ length: 16 }, () => Int32Array.from({ length: 16 }, (_, i) => (i === 5 ? 10 : 0))));
    applyCrater(h2, new Uint8Array(MAP * MAP).fill(40), profile, q8(10), q8(20), 0);
    expect(h2[at(10, 20)]).toBe(90);
  });

  it("ramène à 240 une carte 102 déjà au-dessus, même sous une profondeur nulle ; laisse les 0 (eau) hors de la zone de refus", () => {
    const heights = new Uint8Array(MAP * MAP).fill(100);
    const ground = new Uint8Array(MAP * MAP).fill(250);
    expect(applyCrater(heights, ground, deep(), q8(10), q8(20), 0)).toBe(true);
    expect(ground[at(12, 22)]).toBe(240);
    expect(ground[at(13, 20)]).toBe(250);
  });

  it("applyPointCrater creuse les 4 cellules du point (plancher 0), sans lissage", () => {
    const heights = new Uint8Array(MAP * MAP).fill(10);
    applyPointCrater(heights, q8(5) + 100, q8(6) + 100, 15);
    for (const [x, z] of [[5, 6], [6, 6], [5, 7], [6, 7]] as const) expect(heights[at(x, z)]).toBe(0);
    expect(heights[at(7, 6)]).toBe(10);
    applyPointCrater(heights, q8(20), q8(20), 4);
    expect(heights[at(20, 20)]).toBe(6);
  });
});

describe.skipIf(!hasOriginalFiles)("cratères : site libre de décor (`00424db4`)", () => {
  it("refuse un site à moins de 100 / 141 / 173 unités d'un décor (ni solide ni en vol), selon la taille", () => {
    const s = scenario("TERRAN00", (sx, sz) => [rec(2002, sx + 120, sz, { model: 560, hitPoints: 10 })]);
    const self = s.world.player.obj;
    expect(craterSiteClear(s.world, self, 0)).toBe(true); // 120² + 1 ≥ 10 000
    expect(craterSiteClear(s.world, self, 1)).toBe(false); // 14 401 < 20 000
    expect(craterSiteClear(s.world, self, 2)).toBe(false); // < 30 000
  });

  it("un décor proche refuse le site, un objet solide ou en vol non", () => {
    const near = scenario("TERRAN00", (sx, sz) => [rec(2002, sx + 50, sz, { model: 560, hitPoints: 10 })]);
    expect(craterSiteClear(near.world, near.world.player.obj, 0)).toBe(false);
    const solid = scenario("TERRAN00", (sx, sz) => [rec(5000, sx + 50, sz, { model: 500, childModel: 501, hitPoints: 10 })]);
    expect(craterSiteClear(solid.world, solid.world.player.obj, 0)).toBe(true);
  });
});
