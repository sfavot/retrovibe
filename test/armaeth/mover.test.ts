import { describe, expect, it } from "vitest";
import { readScene } from "../../src/games/armaeth/data/scene";
import { readSceneArchive } from "../../src/games/armaeth/data/vga-archive";
import { parseWorld } from "../../src/games/armaeth/data/world";
import {
  GRID_COLUMNS,
  GRID_ROWS,
  buildWalkGrid,
  cellIndex,
  createTerrain,
  groundHeight,
  invertPermutation,
  typeAt,
  type Terrain,
} from "../../src/games/armaeth/engine/ground";
import {
  ERR_BARRIER,
  ERR_EDGE_IMMATERIAL,
  ERR_EXIT,
  ERR_GROUND_REFUSED,
  ERR_LANDED,
  ERR_NO_GROUND,
  ERR_STEP_TOO_HIGH,
  ERR_TOUCHED_EDGE,
  ERR_TOUCHED_OBJECT,
  ERR_VANISHED,
  ERR_WALL,
  moveObject,
  walkStep,
  type MoverBody,
  type MoverEnv,
} from "../../src/games/armaeth/engine/mover";
import { createPlacementMemory } from "../../src/games/armaeth/engine/placement";
import { hasOriginalFiles, readOriginal } from "./helpers";

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

function syntheticTerrain(records: Uint8Array, planes = 1, permutation = [0, 1, 2, 3, 4, 5]): Terrain {
  return {
    grid: buildWalkGrid(records),
    limits: { xMin: 0, xMax: 319, yMin: 0, yMax: 179, pMin: 8, pMax: 159 },
    zones: [],
    planes,
    permutation,
    inversePermutation: invertPermutation(permutation),
    rowRanges: Array.from({ length: 20 }, () => ({ min: 0, max: 319 })),
  };
}

/** Sol plat à Y 100 sur les rangées 2 à 10, colonnes 0 à 79. */
const flat = syntheticTerrain(concat(...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((row) => record(2, 0, row, 0, 179, 100, 79, 179, 100))));

function hero(extra: Partial<MoverBody> = {}): MoverBody {
  return {
    x: 100, y: 100, p: 40, plane: 0, ground: 2, presence: 2, err: 0, info: 0, dep: 0, txt: 0, height: 40, width: 20,
    typ: 2, speedX: 0, speedY: 0, speedP: 0, stepX: 2, stepY: 4, stepP: 1, col: 0, tim: 0, ...extra,
  };
}

function envOf(terrain: Terrain, extra: Partial<MoverEnv> = {}): MoverEnv {
  return { terrain, inRoom: true, memory: createPlacementMemory(), room: { exits: [0, 0, 0, 0, 0, 0], barriers: [0, 0, 0, 0, 0, 0] }, ...extra };
}

describe("walkStep : marche sur la grille", () => {
  // marche de 4 en colonne 10 (Y 100 -> 96), de 5 en colonne 20 (-> 91), falaise en colonne 30 (-> 106 puis 112)
  const steps = syntheticTerrain(
    concat(
      record(2, 0, 4, 0, 179, 100, 9, 179, 100),
      record(2, 0, 4, 10, 179, 96, 19, 179, 96),
      record(2, 0, 4, 20, 179, 91, 29, 179, 91),
      record(2, 0, 4, 30, 179, 96, 39, 179, 96),
      record(2, 0, 4, 40, 179, 120, 45, 179, 120),
      record(1, 0, 4, 50, 100, 60, 52, 100, 60),
    ),
  );
  const at = (x: number, y: number) => ({ x, y, p: 35, plane: 0, ground: 2 });

  it("reste sur la même case avec la hauteur interpolée", () => {
    expect(walkStep(steps, at(2, 100), 3, 35, 4)).toEqual({ err: 0, y: 100, plane: 0, ground: 2 });
  });

  it("accepte une marche de dpY, refuse une de dpY + 1 (Err 6) et un sol trop bas (Err 5)", () => {
    expect(walkStep(steps, at(38, 100), 40, 35, 4).err).toBe(0); // 100 -> 96
    expect(walkStep(steps, at(78, 96), 80, 35, 4).err).toBe(ERR_STEP_TOO_HIGH); // 96 -> 91 : 5
    expect(walkStep(steps, at(118, 91), 120, 35, 4).err).toBe(ERR_NO_GROUND); // 91 -> 96 : sol plus bas de 5
    expect(walkStep(steps, at(158, 96), 160, 35, 4).err).toBe(ERR_NO_GROUND); // 96 -> 120
  });

  it("sans case praticable : Err 5 ; mur plein couvrant les pieds : Err 1 ; Txt 2 traverse", () => {
    expect(walkStep(steps, at(180, 96), 184, 35, 4).err).toBe(ERR_NO_GROUND);
    const wall = (txt: number) => walkStep(steps, { x: 198, y: 80, p: 35, plane: 0, ground: 2 }, 200, 35, 4, txt);
    expect(wall(0).err).toBe(ERR_WALL);
    expect(wall(2).err).toBe(ERR_NO_GROUND); // le mur est ignoré, il ne reste aucun sol à portée
  });

  it("deux plans : la boucle s'arrête au premier plan (du dernier au premier) qui contient les pieds", () => {
    const stairs = syntheticTerrain(
      concat(
        record(2, 0, 4, 0, 179, 100, 9, 179, 100),
        record(2, 0, 4, 10, 179, 100, 19, 179, 100),
        record(2, 1, 4, 10, 179, 98, 19, 179, 98),
      ),
      2,
    );
    // le plan 1 (sol à 98) est vu d'abord : ses pieds sont dans l'intervalle, la boucle s'arrête avant le plan 0
    expect(walkStep(stairs, at(38, 100), 40, 35, 4).plane).toBe(1);
    expect(walkStep(stairs, { x: 38, y: 98, p: 35, plane: 1, ground: 2 }, 40, 35, 4)).toMatchObject({ err: 0, plane: 1, y: 98 });
  });

  it("deux plans : priorité à la marche à niveau, sol plus bas seulement si rien n'est au niveau", () => {
    const lower = syntheticTerrain(
      concat(
        record(2, 0, 4, 0, 179, 100, 9, 179, 100),
        record(2, 0, 4, 10, 179, 100, 12, 179, 100),
        record(2, 1, 4, 10, 179, 104, 19, 179, 104),
      ),
      2,
    );
    expect(walkStep(lower, at(38, 100), 40, 35, 4)).toMatchObject({ err: 0, plane: 0 }); // niveau (0) contre dessous (4)
    expect(walkStep(lower, at(66, 100), 68, 35, 4)).toMatchObject({ err: 0, plane: 1, y: 104 }); // seul le plan 1 existe
  });
});

describe("moveObject : Dep 0", () => {
  it("avance de dpX par appel, Y suit le sol, rien ne change tant que Err n'est pas traité", () => {
    const body = hero({ speedX: 1 });
    const result = moveObject(body, envOf(flat));
    expect(result).toEqual({ err: 0, info: 0, moved: true, exit: null });
    expect([body.x, body.y, body.p]).toEqual([102, 100, 40]);
    body.speedX = -1;
    body.err = 5;
    expect(moveObject(body, envOf(flat))).toMatchObject({ err: 5, moved: false });
    expect(body.x).toBe(102);
  });

  it("P avance de 1 par appel (dpP != 0), Ver est ignoré pour Dep 0", () => {
    const body = hero({ speedP: -1, speedY: 1 });
    moveObject(body, envOf(flat));
    expect([body.p, body.y]).toEqual([39, 100]);
  });

  it("restaure l'objet quand le pas échoue, en conservant Inf et Col", () => {
    const blocked = syntheticTerrain(concat(record(2, 0, 4, 0, 179, 100, 30, 179, 100)));
    const body = hero({ x: 122, p: 33, speedX: 1, info: 7 });
    const result = moveObject(body, envOf(blocked));
    expect(result.err).toBe(ERR_NO_GROUND);
    expect(result.moved).toBe(false);
    expect([body.x, body.y, body.p, body.err, body.info]).toEqual([122, 100, 33, ERR_NO_GROUND, 7]);
  });

  it("type de case qui change : Err 0x11 et le pas est fait ; refusé par 13a8 : Err 2 et le pas est annulé", () => {
    const mixed = syntheticTerrain(concat(record(2, 0, 4, 0, 179, 100, 9, 179, 100), record(35, 0, 4, 10, 179, 100, 20, 179, 100)));
    const body = hero({ x: 38, p: 35, speedX: 1 });
    const result = moveObject(body, envOf(mixed));
    expect([result.err, result.moved, body.ground]).toEqual([0x11, true, 35]);
    const refused = hero({ x: 38, p: 35, speedX: 1 });
    const outcome = moveObject(refused, envOf(mixed, { acceptsGround: (type) => type !== 35 }));
    expect([outcome.err, outcome.info, outcome.moved, refused.ground]).toEqual([ERR_GROUND_REFUSED, 35, false, 2]);
  });

  it("contact avec un objet : 8 bloque et note Col, 9 ne bloque pas", () => {
    const block = hero({ speedX: 1 });
    const r8 = moveObject(block, envOf(flat, { contact: () => ({ err: 8, col: 77 }) }));
    expect([r8.err, r8.moved, block.col, block.x]).toEqual([8, false, 77, 100]);
    const soft = hero({ speedX: 1 });
    const r9 = moveObject(soft, envOf(flat, { contact: () => ({ err: 9, col: 5 }) }));
    expect([r9.err, r9.moved, soft.x, soft.col]).toEqual([ERR_TOUCHED_OBJECT, true, 102, 5]);
  });

  it("masque de profondeur : Err 4 pour P multiple de 8", () => {
    const body = hero({ p: 39, speedP: 1 });
    const result = moveObject(body, envOf(flat, { depthBlocked: () => true }));
    expect([result.err, result.moved, body.p]).toEqual([4, false, 39]);
  });

  it("l'objet qui vient d'entrer (Xyp 1) est d'abord placé sur une case du même type", () => {
    const body = hero({ x: 400, presence: 1, speedX: 0 });
    moveObject(body, envOf(flat));
    expect(body.presence).toBe(2);
    expect(body.x).toBeLessThanOrEqual(319);
    const off = hero({ presence: 2, speedX: 1 });
    moveObject(off, envOf(flat, { inRoom: false }));
    expect(off.presence).toBe(1);
  });
});

describe("moveObject : bords et sorties", () => {
  const room = { exits: [0, 0, 0, 3, 0, 0], barriers: [0, 0, 0, 0, 0, 0] };

  it("sprite qui touche le bord sans sortir : Err 0x0A, pas fait, Inf = côté", () => {
    const body = hero({ x: 11, speedX: -1, p: 40 });
    const result = moveObject(body, envOf(flat, { room }));
    expect([result.err, result.info, result.moved, body.x]).toEqual([ERR_TOUCHED_EDGE, 3, true, 9]);
  });

  it("centre hors de la salle : 0x0B avec l'emplacement de sortie, l'objet ne bouge pas", () => {
    const body = hero({ x: 1, speedX: -1 });
    const result = moveObject(body, envOf(flat, { room }));
    expect([result.err, result.info, result.exit, result.moved, body.x]).toEqual([ERR_EXIT, 3, 3, false, 1]);
  });

  it("la permutation des côtés traduit le côté géométrique en emplacement", () => {
    const permuted = syntheticTerrain(flat.grid.types.length ? concat(record(2, 0, 4, 0, 179, 100, 79, 179, 100)) : new Uint8Array(0), 1, [1, 0, 2, 3, 4, 5]);
    const body = hero({ x: 1, p: 33, speedX: -1 });
    const result = moveObject(body, envOf(permuted, { room: { exits: [0, 0, 0, 0, 0, 0], barriers: [0, 0, 0, 0, 0, 0] } }));
    expect(result.info).toBe(permuted.inversePermutation[3]);
  });

  it("barrage non nul et bloquant : 0x0F ; libre : la sortie reste 0x0B", () => {
    const withBarrier = { exits: [0, 0, 0, 3, 0, 0], barriers: [0, 0, 0, 101, 0, 0] };
    const body = hero({ x: 1, speedX: -1 });
    const asked: number[][] = [];
    const blocked = moveObject(body, envOf(flat, { room: withBarrier, barrier: (code, mode) => (asked.push([code, mode]), 7) }));
    expect([blocked.err, blocked.exit]).toEqual([ERR_BARRIER, null]);
    expect(asked).toEqual([[101, 1]]);
    const free = moveObject(hero({ x: 1, speedX: -1 }), envOf(flat, { room: withBarrier, barrier: () => 0 }));
    expect(free.err).toBe(ERR_EXIT);
  });

  it("bord sans sortie : 0x0E pour un objet normal, 0x0C pour un objet Txt 2, 1 hors salle", () => {
    expect(moveObject(hero({ x: 1, speedX: -1 }), envOf(flat)).err).toBe(ERR_VANISHED);
    expect(moveObject(hero({ x: 1, speedX: -1, txt: 2 }), envOf(flat)).err).toBe(ERR_EDGE_IMMATERIAL);
    expect(moveObject(hero({ x: 1, speedX: -1, presence: 1 }), envOf(flat, { inRoom: false })).err).toBe(ERR_WALL);
  });

  it("P hors de la boîte : sortie par le fond ou par l'avant", () => {
    const back = moveObject(hero({ p: 8, speedP: -1 }), envOf(flat, { room: { exits: [4, 0, 0, 0, 0, 0], barriers: [0, 0, 0, 0, 0, 0] } }));
    expect([back.err, back.info]).toEqual([ERR_EXIT, 0]);
  });

  it("hors salle la boîte maximale 320 x 200 x 256 s'applique", () => {
    const touching = hero({ x: 316, presence: 1, speedX: 1 });
    const touch = moveObject(touching, envOf(flat, { inRoom: false }));
    expect([touch.err, touch.moved, touching.x]).toEqual([ERR_TOUCHED_EDGE, true, 318]);
    const leaving = hero({ x: 318, presence: 1, speedX: 1 });
    const leave = moveObject(leaving, envOf(flat, { inRoom: false }));
    expect([leave.err, leave.moved, leaving.x]).toEqual([ERR_WALL, false, 318]);
  });
});

describe("moveObject : Dep 1, 2, 3 et 4", () => {
  it("Dep 1 : vol libre avec Sol 0 ; une case qui recouvre la hauteur bloque (Err 2)", () => {
    const bird = hero({ dep: 1, ground: 0, y: 60, height: 20, width: 16, speedX: 1, speedY: -1, stepY: 3 });
    const result = moveObject(bird, envOf(flat));
    expect([result.err, result.moved, bird.x, bird.y]).toEqual([0, true, 102, 57]);
    const low = hero({ dep: 1, ground: 0, y: 112, height: 20, speedY: -1, stepY: 3 });
    // 109 : pieds sous le sol (Y 100) et tête à 90 : recouvre la case
    expect(moveObject(low, envOf(flat)).err).toBe(ERR_GROUND_REFUSED);
  });

  it("Dep 2 et 4 : hors salle Err 0x15, en salle zone de même rangée, colonne et hauteur, sinon Err 5", () => {
    const terrain: Terrain = { ...flat, zones: [{ type: 15, plane: 0xff, row: 4, colStart: 20, colEnd: 25, high: 90, low: 70, spare: new Uint8Array(4) }] };
    const swimmer = hero({ dep: 2, ground: 0, x: 80, p: 34, y: 80, speedX: 1 });
    const inside = moveObject(swimmer, envOf(terrain));
    expect([inside.err, swimmer.ground, swimmer.plane, swimmer.x]).toEqual([0x11, 15, 0, 82]);
    const out = hero({ dep: 4, ground: 0, x: 120, p: 34, y: 80, speedX: 1 });
    expect(moveObject(out, envOf(terrain)).err).toBe(ERR_NO_GROUND);
    expect(moveObject(hero({ dep: 4, ground: 0 }), envOf(terrain, { inRoom: false })).err).toBe(0x15);
  });

  it("Dep 3 : la chute avance de dpY - 1 par tic puis Err 7 en touchant un sol", () => {
    const body = hero({ dep: 3, ground: 0, x: 100, p: 36, y: 60, height: 10, width: 8, stepY: 4, speedY: 1 });
    const first = moveObject(body, envOf(flat));
    expect(first.err).toBe(0);
    expect(body.y).toBe(63);
    body.y = 96;
    const landed = moveObject(body, envOf(flat));
    expect([landed.err, landed.info, landed.moved]).toEqual([ERR_LANDED, 2, false]);
    expect(body.y).toBe(96);
  });
});

describe.skipIf(!hasOriginalFiles)("déplacement sur les données d'Armaeth", () => {
  const world = parseWorld(readOriginal("A1FCFG.SYS"));

  function sceneFile(id: number): string {
    const letter = String.fromCharCode(65 + Math.floor((id % 100) / 5));
    return `A1F${String(Math.floor(id / 100)).padStart(2, "0")}${letter}.VGA`;
  }

  it("Dep 0 : statistiques de 269 000 pas simulés pour le héros (dpX 2, dpY 4, dpP 1)", () => {
    const totals = { xSteps: 0, xOk: 0, xWall: 0, pSteps: 0, pOk: 0, pWall: 0, planeChanges: 0 };
    for (const room of world.rooms) {
      if (room.id === 0) continue;
      const terrain = createTerrain(readScene(readSceneArchive(readOriginal(sceneFile(room.id))).bytes(room.id)));
      const { xMin, xMax, pMin, pMax } = terrain.limits;
      for (let plane = 0; plane < terrain.planes; plane++) {
        for (let row = 1; row < GRID_ROWS - 1; row++) {
          for (let x = 2; x < 318; x += 2) {
            const ground = typeAt(terrain.grid, cellIndex(plane, row, x >> 2));
            if (ground < 2) continue;
            const tests: [number, number, number, number][] = [
              [x, row * 8 + 3, 1, 0],
              [x, row * 8 + 3, -1, 0],
              [x, row * 8 + 7, 0, 1],
              [x, row * 8, 0, -1],
            ];
            for (const [px, p, hor, prf] of tests) {
              const nx = px + hor * 2;
              const np = p + prf;
              const outside = nx < xMin || nx > xMax || np < pMin || np > pMax;
              const step = outside ? null : walkStep(terrain, { x: px, y: groundHeight(terrain.grid, plane, px, p), p, plane, ground }, nx, np, 4);
              const isX = hor !== 0;
              if (isX) totals.xSteps++;
              else totals.pSteps++;
              if (step?.err === 0) {
                if (isX) totals.xOk++;
                else totals.pOk++;
                if (step.plane !== plane) totals.planeChanges++;
              } else if (step?.err === ERR_WALL) {
                if (isX) totals.xWall++;
                else totals.pWall++;
              }
            }
          }
        }
      }
    }
    expect(totals.xSteps + totals.pSteps).toBe(268932);
    expect(totals.xOk / totals.xSteps).toBeCloseTo(0.976, 3); // 97,6 % des pas en X
    expect(totals.pOk / totals.pSteps).toBeCloseTo(0.863, 3); // 86,3 % des pas qui franchissent une rangée
    expect(totals.xWall / totals.xSteps).toBeCloseTo(0.014, 3); // Err 1 : 1,4 % des pas en X
    expect(totals.pWall / totals.pSteps).toBeCloseTo(0.089, 3); // 8,9 % des franchissements de rangée
    expect(totals.planeChanges).toBe(322);
  });

  it("le héros de CFG marche vers la droite : chaque pas garde Y sur le sol", () => {
    const heroRecord = world.objects.find((o) => o.num === 1 && o.typ === 2)!;
    const terrain = createTerrain(readScene(readSceneArchive(readOriginal(sceneFile(heroRecord.container))).bytes(heroRecord.container)));
    const body = hero({ x: heroRecord.x, y: heroRecord.y, p: heroRecord.p, plane: heroRecord.plane, ground: heroRecord.ground, speedX: 1 });
    let steps = 0;
    for (; steps < 40; steps++) {
      const result = moveObject(body, envOf(terrain, { room: { exits: [0, 0, 0, 0, 0, 0], barriers: [0, 0, 0, 0, 0, 0] } }));
      if (!result.moved) break;
      expect(body.y).toBe(groundHeight(terrain.grid, body.plane, body.x, body.p));
      body.err = 0;
    }
    expect(steps).toBeGreaterThan(0);
    expect(GRID_COLUMNS).toBe(81);
  });
});
