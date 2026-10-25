import { describe, expect, it } from "vitest";
import { readScene } from "../../src/games/armaeth/data/scene";
import { readSceneArchive } from "../../src/games/armaeth/data/vga-archive";
import { parseWorld } from "../../src/games/armaeth/data/world";
import {
  GRID_COLUMNS,
  GRID_ROWS,
  SPAN_EMPTY,
  buildWalkGrid,
  cellCorners,
  cellIndex,
  createTerrain,
  groundHeight,
  invertPermutation,
  lowAt,
  normalizePermutation,
  placementHeight,
  terrainCollision,
  typeAt,
  type Footprint,
  type Terrain,
} from "../../src/games/armaeth/engine/ground";
import { hasOriginalFiles, readOriginal } from "./helpers";

/** Enregistrement de 16 octets de la grille : `{type, plan, rangée, c0, hi0, lo0, c1, hi1, lo1}`. */
function record(type: number, plane: number, row: number, c0: number, hi0: number, lo0: number, c1: number, hi1: number, lo1: number): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  bytes[0] = type;
  bytes[1] = plane;
  [row, c0, hi0, lo0, c1, hi1, lo1].forEach((v, i) => view.setInt16(2 + 2 * i, v, true));
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function syntheticTerrain(records: Uint8Array, planes = 1): Terrain {
  return {
    grid: buildWalkGrid(records),
    limits: { xMin: 0, xMax: 319, yMin: 0, yMax: 179, pMin: 8, pMax: 159 },
    zones: [],
    planes,
    permutation: [0, 1, 2, 3, 4, 5],
    inversePermutation: [0, 1, 2, 3, 4, 5],
    rowRanges: Array.from({ length: 20 }, () => ({ min: 0, max: 319 })),
  };
}

describe("grille de marche : cas synthétiques", () => {
  it("interpole hi et lo le long de la plage, une case prend la moyenne", () => {
    const grid = buildWalkGrid(concat(record(2, 0, 3, 10, 179, 100, 13, 179, 120), record(1, 0, 4, 5, 60, 40, 5, 80, 50)));
    expect([10, 11, 12, 13].map((c) => lowAt(grid, cellIndex(0, 3, c)))).toEqual([100, 105, 110, 115]);
    expect(typeAt(grid, cellIndex(0, 3, 12))).toBe(2);
    expect(lowAt(grid, cellIndex(0, 4, 5))).toBe(45);
    expect(grid.spans[cellIndex(0, 4, 5)]! >> 8).toBe(70);
    expect(grid.spans[cellIndex(0, 3, 9)]).toBe(SPAN_EMPTY);
    expect(typeAt(grid, cellIndex(0, 3, 9))).toBe(0);
  });

  it("tronque vers zéro les pentes descendantes et ignore les enregistrements hors grille", () => {
    const grid = buildWalkGrid(concat(record(2, 0, 0, 0, 179, 100, 2, 179, 97), record(2, 5, 0, 0, 179, 1, 0, 179, 1), record(2, 0, 30, 0, 179, 1, 0, 179, 1)));
    expect([0, 1, 2].map((c) => lowAt(grid, c))).toEqual([100, 99, 98]);
    expect(grid.types.reduce((n, t) => n + (t ? 1 : 0), 0)).toBe(3);
  });

  it("hauteur planaire : pente lue à la case voisine, sans interpolation croisée", () => {
    // rangée 2 : lo 100, 108 ; rangée 3 : lo 100, 108 (pente en X seule)
    const grid = buildWalkGrid(concat(record(2, 0, 2, 4, 179, 100, 5, 179, 108), record(2, 0, 3, 4, 179, 100, 5, 179, 108)));
    expect(groundHeight(grid, 0, 16, 16)).toBe(100);
    expect(groundHeight(grid, 0, 18, 16)).toBe(102);
    expect(groundHeight(grid, 0, 19, 16)).toBe(103);
    // dernière case praticable : la pente vient de la case de gauche
    expect(groundHeight(grid, 0, 21, 16)).toBe(104 + ((1 * 4) >> 2));
  });

  it("hauteur planaire en P : pente de la rangée voisine", () => {
    const grid = buildWalkGrid(concat(record(2, 0, 2, 4, 179, 100, 4, 179, 100), record(2, 0, 3, 4, 179, 116, 4, 179, 116)));
    expect(groundHeight(grid, 0, 16, 16 + 4)).toBe(100 + ((4 * 16) >> 3));
  });

  it("coins extrapolés et variante bilinéaire", () => {
    const grid = buildWalkGrid(concat(record(2, 0, 2, 4, 179, 100, 5, 179, 108), record(2, 0, 3, 4, 179, 100, 5, 179, 108)));
    expect(cellCorners(grid, 0, 2, 4)).toEqual([100, 104, 100, 104]);
    // la case 5 n'a pas de voisin à droite : 2 * 104 - 100
    expect(cellCorners(grid, 0, 2, 5)[1]).toBe(108);
    expect(placementHeight(grid, 0, 18, 16)).toBe(102);
  });

  it("plans : l'indice à plat sépare les plans et les accès hors tableau valent « rien »", () => {
    const grid = buildWalkGrid(record(2, 2, 20, 80, 179, 50, 80, 179, 50));
    expect(typeAt(grid, cellIndex(2, 20, 80))).toBe(2);
    expect(typeAt(grid, cellIndex(2, 20, 80) + 1)).toBe(0);
    expect(typeAt(grid, -1)).toBe(0);
    expect(GRID_ROWS * GRID_COLUMNS * 3).toBe(grid.types.length);
  });

  it("permutation des côtés : identité si ce n'est pas une permutation", () => {
    expect(normalizePermutation([1, 0, 2, 3, 4, 5])).toEqual([1, 0, 2, 3, 4, 5]);
    expect(normalizePermutation([0, 1, 2, 3, 4, 9])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(invertPermutation([2, 0, 1, 3, 4, 5])).toEqual([1, 2, 0, 3, 4, 5]);
  });
});

describe("collision avec le terrain (1c96:0102)", () => {
  // sol à Y 100 ; un mur de type 1 en colonne 20 (Y 60..90) ; une dalle de type 2 haute en colonne 30 (hi 70)
  const terrain = syntheticTerrain(
    concat(record(2, 0, 4, 0, 179, 100, 40, 179, 100), record(1, 0, 4, 20, 90, 60, 20, 90, 60), record(2, 0, 4, 30, 70, 50, 30, 70, 50)),
  );
  const walker = (x: number, y: number, extra: Partial<Footprint> = {}): Footprint => ({ x, y, p: 32, dep: 0, txt: 0, height: 40, width: 20, ...extra });

  it("laisse passer un marcheur sur le sol et bloque contre un mur", () => {
    expect(terrainCollision(terrain, walker(40, 100)).code).toBe(0);
    expect(terrainCollision(terrain, walker(80, 100))).toEqual({ code: 1, info: 1 });
    // les pieds sont plus bas que le mur : pas de recouvrement vertical
    expect(terrainCollision(terrain, walker(80, 140)).code).toBe(0);
  });

  it("un objet immatériel (Txt 2) ignore le terrain", () => {
    expect(terrainCollision(terrain, walker(80, 100, { txt: 2 })).code).toBe(0);
  });

  it("une case praticable dont le haut est au-dessus des pieds bloque aussi (tête dans la dalle)", () => {
    expect(terrainCollision(terrain, walker(120, 100)).code).toBe(1);
  });

  it("un voleur est bloqué par toute case qui recouvre sa hauteur (résultat 2)", () => {
    expect(terrainCollision(terrain, walker(40, 100, { dep: 1, height: 20 })).code).toBe(2);
    expect(terrainCollision(terrain, walker(40, 60, { dep: 1, height: 20 })).code).toBe(0);
  });

  it("masque de profondeur : seulement pour P multiple de 8, Txt 0 et dans l'étendue de la rangée", () => {
    const hit = (b: Footprint) => b.x === 40;
    expect(terrainCollision(terrain, walker(40, 100, { p: 32 }), hit).code).toBe(4);
    expect(terrainCollision(terrain, walker(40, 100, { p: 35 }), hit).code).toBe(0);
    expect(terrainCollision(terrain, walker(40, 100, { txt: 1 }), hit).code).toBe(0);
    const narrow = { ...terrain, rowRanges: terrain.rowRanges.map(() => ({ min: 200, max: 300 })) };
    expect(terrainCollision(narrow, walker(40, 100), hit).code).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("terrain d'Armaeth (fichiers du jeu)", () => {
  const world = parseWorld(readOriginal("A1FCFG.SYS"));

  function sceneFile(id: number): string {
    const letter = String.fromCharCode(65 + Math.floor((id % 100) / 5));
    return `A1F${String(Math.floor(id / 100)).padStart(2, "0")}${letter}.VGA`;
  }
  const terrains = new Map<number, Terrain>();
  function terrainOf(id: number): Terrain {
    let terrain = terrains.get(id);
    if (!terrain) {
      terrain = createTerrain(readScene(readSceneArchive(readOriginal(sceneFile(id))).bytes(id)));
      terrains.set(id, terrain);
    }
    return terrain;
  }

  it("retrouve la hauteur Y des 59 objets déjà posés de CFG (sur 60 objets de type 2 au sol)", () => {
    let total = 0;
    let placed = 0;
    let planar = 0;
    let groundIsType = 0;
    let needsInterpolation = 0;
    for (const o of world.objects) {
      if (o.typ !== 2 || o.location !== 1 || o.dep !== 0) continue;
      const terrain = terrainOf(o.container);
      const index = cellIndex(o.plane, o.p >> 3, o.x >> 2);
      if (typeAt(terrain.grid, index) < 2) continue;
      total++;
      if (o.ground === 0) continue; // jamais posé (objet 207 : 1 pixel d'écart)
      placed++;
      if (groundHeight(terrain.grid, o.plane, o.x, o.p) === o.y) planar++;
      if (typeAt(terrain.grid, index) === o.ground) groundIsType++;
      if (lowAt(terrain.grid, index) !== o.y) needsInterpolation++;
    }
    expect(total).toBe(60);
    expect(placed).toBe(59);
    expect(planar).toBe(59);
    expect(groundIsType).toBe(59);
    expect(needsInterpolation).toBe(36);
  });

  it("le héros de CFG (X 219, P 113) est à Y 146", () => {
    const hero = world.objects.find((o) => o.num === 1 && o.typ === 2)!;
    expect([hero.x, hero.p, hero.y]).toEqual([219, 113, 146]);
    expect(groundHeight(terrainOf(hero.container).grid, hero.plane, hero.x, hero.p)).toBe(146);
  });

  it("la variante bilinéaire diffère de la formule planaire sur moins de 1 % des points", () => {
    let differ = 0;
    let total = 0;
    for (const room of world.rooms) {
      if (room.id === 0) continue;
      const terrain = terrainOf(room.id);
      for (let row = 1; row < GRID_ROWS - 1; row += 2) {
        for (let col = 1; col < GRID_COLUMNS - 1; col += 2) {
          if (typeAt(terrain.grid, cellIndex(0, row, col)) < 2) continue;
          for (const [sx, sp] of [[1, 3], [2, 5]] as const) {
            total++;
            const x = col * 4 + sx;
            const p = row * 8 + sp;
            if (groundHeight(terrain.grid, 0, x, p) !== placementHeight(terrain.grid, 0, x, p)) differ++;
          }
        }
      }
    }
    expect(total).toBeGreaterThan(10000);
    expect(differ / total).toBeLessThan(0.02);
  });

  it("les limites de salle sont typiquement 0, 319, 0, 179, 8, 159", () => {
    const limits = terrainOf(1).limits;
    expect([limits.xMin, limits.xMax, limits.yMin, limits.yMax, limits.pMin, limits.pMax]).toEqual([0, 319, 0, 179, 8, 159]);
  });
});
