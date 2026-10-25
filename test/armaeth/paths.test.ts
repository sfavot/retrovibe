import { describe, expect, it } from "vitest";
import { readScene } from "../../src/games/armaeth/data/scene";
import { readSceneArchive } from "../../src/games/armaeth/data/vga-archive";
import { parseWorld } from "../../src/games/armaeth/data/world";
import { buildWalkGrid, cellIndex, createTerrain, groundHeight, terrainCollision, typeAt, type Terrain } from "../../src/games/armaeth/engine/ground";
import { moveObject, type MoverBody, type MoverEnv } from "../../src/games/armaeth/engine/mover";
import {
  FOLLOW_ARRIVED,
  FOLLOW_BLOCKED,
  FOLLOW_NO_PATH,
  FOLLOW_RECOMPUTE_FAILED,
  FOLLOW_WALKING,
  MAX_NEIGHBORS,
  buildGraph,
  clickDestination,
  computePath,
  createPathState,
  followPath,
  planClick,
  type PathBody,
} from "../../src/games/armaeth/engine/paths";
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

const rows = (from: number, to: number, c0: number, c1: number, lo = 100): Uint8Array[] =>
  Array.from({ length: to - from + 1 }, (_, i) => record(2, 0, from + i, c0, 179, lo, c1, 179, lo));

const walkerBody: PathBody = { x: 0, y: 0, p: 0, plane: 0, dep: 0, height: 40, width: 20, stepX: 2, stepY: 4, stepP: 1 };

function target(col: number, row: number, plane = 0, y = 100) {
  return { x: col * 4 + 2, y, p: row * 8 + 3, plane };
}

function at(col: number, row: number, plane = 0, y = 100): PathBody {
  return { ...walkerBody, x: col * 4 + 2, y, p: row * 8 + 3, plane };
}

describe("graphe de navigation (305e:0002)", () => {
  it("un nœud par segment praticable maximal de chaque rangée, voisins des rangées adjacentes", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 4, 10, 20), record(2, 0, 3, 30, 179, 100, 35, 179, 100)));
    const graph = buildGraph(terrain, walkerBody)!;
    expect(graph.map((n) => [n.row, n.plane, n.c0, n.c1])).toEqual([
      [2, 0, 10, 20],
      [3, 0, 10, 20],
      [3, 0, 30, 35],
      [4, 0, 10, 20],
    ]);
    expect(graph[0]!.neighbors).toEqual([1]);
    expect(graph[1]!.neighbors).toEqual([0, 3]);
    expect(graph[2]!.neighbors).toEqual([]); // ne partage aucune colonne avec ses voisines
  });

  it("une pente trop raide coupe le segment (|Δlo| * dpX > dpY * 4) et les deux segments ne sont pas voisins", () => {
    const terrain = syntheticTerrain(concat(record(2, 0, 3, 0, 179, 100, 9, 179, 100), record(2, 0, 3, 10, 179, 109, 19, 179, 109)));
    const graph = buildGraph(terrain, walkerBody)!;
    expect(graph.map((n) => [n.c0, n.c1])).toEqual([[0, 9], [10, 19]]);
    expect(graph[0]!.neighbors).toEqual([]); // 9 * 2 > 16
    // avec un pas de 1 en X, la même marche (9 * 1 <= 16) ne coupe plus le segment
    expect(buildGraph(terrain, { ...walkerBody, stepX: 1 })!.map((n) => [n.c0, n.c1])).toEqual([[0, 19]]);
  });

  it("types : un type refusé coupe le segment, les types peuvent changer à l'intérieur d'un segment", () => {
    const terrain = syntheticTerrain(concat(record(2, 0, 3, 0, 179, 100, 4, 179, 100), record(35, 0, 3, 5, 179, 100, 9, 179, 100), record(1, 0, 3, 10, 179, 100, 12, 179, 100)));
    expect(buildGraph(terrain, walkerBody)!.map((n) => [n.c0, n.c1])).toEqual([[0, 9]]);
    const refusing = buildGraph(terrain, walkerBody, { acceptsGround: (type) => type !== 35 })!;
    expect(refusing.map((n) => [n.c0, n.c1])).toEqual([[0, 4]]);
  });

  it("deux plans : un nœud par plan, voisins entre plans de la même rangée par colonnes contiguës", () => {
    const terrain = syntheticTerrain(concat(record(2, 0, 3, 0, 179, 100, 9, 179, 100), record(2, 1, 3, 10, 179, 100, 19, 179, 100)), 2);
    const graph = buildGraph(terrain, walkerBody)!;
    expect(graph.map((n) => [n.plane, n.c0, n.c1])).toEqual([[0, 0, 9], [1, 10, 19]]);
    expect(graph[0]!.neighbors).toEqual([1]);
  });

  it("deux plans, rangées voisines : une case occupée au-dessus du nœud le plus bas coupe la colonne (305e:0572..05c4)", () => {
    const base = [record(2, 0, 2, 5, 179, 100, 10, 179, 100), record(2, 1, 3, 5, 179, 100, 10, 179, 100)];
    const open = buildGraph(syntheticTerrain(concat(...base), 2), walkerBody)!;
    expect(open.map((n) => [n.row, n.plane])).toEqual([[2, 0], [3, 1]]);
    expect(open[0]!.neighbors).toEqual([1]);
    // une case du plan 1 à la rangée du nœud du plan 0 (un obstacle plein) : aucune colonne commune ne compte, plus de lien
    const covered = buildGraph(syntheticTerrain(concat(...base, record(1, 1, 2, 5, 179, 40, 10, 179, 40)), 2), walkerBody)!;
    expect(covered.map((n) => [n.row, n.plane])).toEqual([[2, 0], [3, 1]]);
    expect(covered[0]!.neighbors).toEqual([]);
  });

  it("abandon : plus de 250 nœuds, ou salle trop grande", () => {
    const comb = concat(...Array.from({ length: 20 }, (_, row) => concat(...Array.from({ length: 13 }, (__, k) => record(2, 0, row, k * 6, 179, 100, k * 6 + 2, 179, 100)))));
    expect(buildGraph(syntheticTerrain(comb), walkerBody)).toBeNull();
    const big = syntheticTerrain(new Uint8Array(0));
    big.limits = { ...big.limits, pMax: 200 };
    expect(buildGraph(big, walkerBody)).toBeNull();
  });

  it("volant : une case compte si le vide sous le plafond d'un plan supérieur atteint Hau + 6 (hypothèse)", () => {
    const terrain = syntheticTerrain(concat(record(2, 0, 3, 0, 179, 100, 9, 179, 100), record(2, 1, 3, 4, 70, 70, 9, 70, 70)), 2);
    const bird: PathBody = { ...walkerBody, dep: 1, height: 20 };
    const graph = buildGraph(terrain, bird)!;
    // sous le plan 1 (hi 70) le vide est 100 - 70 = 30 >= 26 : praticable ; les colonnes sans plan 1 aussi
    expect(graph.some((n) => n.plane === 0 && n.c0 === 0 && n.c1 === 9)).toBe(true);
    const tall = buildGraph(terrain, { ...bird, height: 40 })!;
    expect(tall.some((n) => n.plane === 0 && n.c0 === 0 && n.c1 === 9)).toBe(false);
  });
});

describe("calcul du trajet (gm_compute_path)", () => {
  it("même nœud : Nbc 0 ; sinon Chm va de l'arrivée (indice 0) au premier saut, le coût compte les changements de rangée", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 6, 10, 40)));
    const state = createPathState();
    expect(computePath(terrain, at(12, 4), target(30, 4), state)).toBe(true);
    expect(state.remaining).toBe(0);
    expect(computePath(terrain, at(12, 2), target(30, 5), state)).toBe(true);
    expect(state.remaining).toBe(3);
    expect(state.nodes.map((n) => n.row)).toEqual([5, 4, 3]);
    expect([state.x1, state.x2]).toEqual([10, 40]);
    expect(state.here).toMatchObject({ row: 2 });
    expect(state.mode).toBe(0);
  });

  it("choisit un détour qui change moins de rangées et minimise la marche horizontale parmi les trajets de même coût", () => {
    // rangées 2 et 4 reliées par la rangée 3 sur deux passages : colonnes 10..14 (gauche) et 36..40 (droite)
    const terrain = syntheticTerrain(
      concat(
        record(2, 0, 2, 10, 179, 100, 40, 179, 100),
        record(2, 0, 3, 10, 179, 100, 14, 179, 100),
        record(2, 0, 3, 36, 179, 100, 40, 179, 100),
        record(2, 0, 4, 10, 179, 100, 40, 179, 100),
      ),
    );
    const state = createPathState();
    expect(computePath(terrain, at(12, 2), target(12, 4), state)).toBe(true);
    expect(state.nodes[1]).toMatchObject({ row: 3, c0: 10, c1: 14 });
    const right = createPathState();
    expect(computePath(terrain, at(38, 2), target(38, 4), right)).toBe(true);
    expect(right.nodes[1]).toMatchObject({ row: 3, c0: 36, c1: 40 });
  });

  it("destination injoignable : repli sur le nœud atteignable le plus proche, colonne cible ramenée hors du nœud", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 3, 10, 20), ...rows(6, 7, 10, 20)));
    const state = createPathState();
    expect(computePath(terrain, at(12, 2), target(14, 7), state)).toBe(true);
    expect(state.nodes.map((n) => n.row)).toEqual([3]); // la rangée 3 est la plus proche de la rangée 7 (3 rangées d'écart)
    expect(state.x1).toBe(10);
    // métrique P seul : même choix ; métrique X seul : la colonne gagne, pas la rangée
    const sideways = syntheticTerrain(concat(record(2, 0, 3, 10, 179, 100, 20, 179, 100), record(2, 0, 3, 40, 179, 100, 50, 179, 100)));
    const sideState = createPathState();
    expect(computePath(sideways, at(12, 3), target(45, 3), sideState, { metric: 1 })).toBe(true);
    expect(sideState.remaining).toBe(0);
  });

  it("pas de nœud de départ, ou pas nul : aucun trajet (Nbc -1)", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 4, 10, 40)));
    const state = createPathState();
    expect(computePath(terrain, at(2, 3), target(12, 3), state)).toBe(false);
    expect(state.remaining).toBe(-1);
    expect(state.defined).toBe(false);
    expect(computePath(terrain, { ...at(12, 3), stepY: 0 }, target(14, 3), state)).toBe(false);
  });

  it("recalcul AX = 7 : garde la destination et coupe le lien vers le premier saut courant", () => {
    // deux passages entre les rangées 2 et 4 (par la rangée 3) à gauche et à droite
    const terrain = syntheticTerrain(
      concat(
        record(2, 0, 2, 10, 179, 100, 40, 179, 100),
        record(2, 0, 3, 10, 179, 100, 14, 179, 100),
        record(2, 0, 3, 36, 179, 100, 40, 179, 100),
        record(2, 0, 4, 10, 179, 100, 40, 179, 100),
      ),
    );
    const state = createPathState();
    expect(computePath(terrain, at(12, 2), target(30, 4), state)).toBe(true);
    const first = { ...state.nodes[state.remaining - 1]! };
    expect(first).toMatchObject({ row: 3, c0: 10, c1: 14 });
    expect(computePath(terrain, at(12, 2), target(0, 0), state, { resume: true })).toBe(true);
    expect(state.target).toMatchObject(target(30, 4));
    expect(state.nodes[state.remaining - 1]).toMatchObject({ row: 3, c0: 36, c1: 40 });
  });
});

describe("destination d'un clic (1504:0002)", () => {
  // sol qui descend avec la profondeur : Y = 40 + 10 * rangée (la hauteur cliquée sélectionne la profondeur)
  const slope = syntheticTerrain(concat(...Array.from({ length: 9 }, (_, i) => record(2, 0, 2 + i, 10, 179, 40 + 10 * (2 + i), 60, 179, 40 + 10 * (2 + i)))));
  const hero = { x: 100, y: 100, p: 40, plane: 0, ground: 2, presence: 2, err: 0, info: 0, dep: 0, txt: 0, height: 40, width: 20 };
  const env = () => ({ terrain: slope, inRoom: true, memory: createPlacementMemory() });

  it("la hauteur du clic fixe la rangée : Y du sol à ±1 de la hauteur cliquée, X à ±4", () => {
    const result = clickDestination(hero, 100, 80, env())!;
    expect(result.p >> 3).toBe(4);
    expect(Math.abs(result.y - 80)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.x - 100)).toBeLessThanOrEqual(4);
    expect(clickDestination(hero, 100, 120, env())!.p >> 3).toBe(8);
  });

  it("clic hors du sol, hors de la scène ou sans hauteur correspondante : pas de destination", () => {
    expect(clickDestination(hero, 100, 20, env())).toBeNull(); // aucune rangée à cette hauteur
    expect(clickDestination(hero, 300, 80, env())).toBeNull(); // hors du sol en X (tolérance 4)
    expect(clickDestination(hero, 400, 80, env())).toBeNull();
    expect(clickDestination(hero, 100, 250, env())).toBeNull();
  });

  it("planClick enchaîne destination et trajet", () => {
    const state = createPathState();
    const walker = { ...hero, ...walkerBody, x: 100, y: 100, p: 63 };
    expect(planClick(walker, 100, 130, env(), state)).toBe(true);
    expect(state.target!.p >> 3).toBe(9);
    expect(state.defined).toBe(true);
    expect(planClick(walker, 100, 20, env(), state)).toBe(false);
  });
});

function heroBody(x: number, y: number, p: number, plane: number, ground: number): MoverBody {
  return {
    x, y, p, plane, ground, presence: 2, err: 0, info: 0, dep: 0, txt: 0, height: 40, width: 20,
    typ: 2, speedX: 0, speedY: 0, speedP: 0, stepX: 2, stepY: 4, stepP: 1, col: 0, tim: 0,
  };
}

function walkEnv(terrain: Terrain): MoverEnv {
  return { terrain, inRoom: true, clipWalls: true, memory: createPlacementMemory(), room: { exits: [0, 0, 0, 0, 0, 0], barriers: [0, 0, 0, 0, 0, 0] } };
}

/** Fait marcher le corps vers sa destination ; rend le dernier code de `followPath` et le nombre de tics. */
function walk(terrain: Terrain, body: MoverBody, state = createPathState(), limit = 1500): { result: number; ticks: number } {
  const env = walkEnv(terrain);
  let result = FOLLOW_WALKING;
  let ticks = 0;
  for (; ticks < limit; ticks++) {
    result = followPath(state, body, { recompute: (s, resume) => computePath(terrain, body, s.target!, s, { resume }) });
    if (result !== FOLLOW_WALKING) break;
    moveObject(body, env);
  }
  return { result, ticks };
}

describe("suivi d'un trajet (30d9:0006 / 30d9:0184)", () => {
  it("sans trajet : retour 6 ; arrivé : retour 2 sans vitesse", () => {
    const body = heroBody(50, 100, 35, 0, 2);
    expect(followPath(createPathState(), body)).toBe(FOLLOW_NO_PATH);
  });

  it("traverse plusieurs rangées : alignement (Mod 0), changement de rangée (Mod 1), arrivée dans la case de la destination", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 9, 5, 60)));
    const body = heroBody(50, 100, 19, 0, 2);
    const state = createPathState();
    expect(computePath(terrain, body, target(40, 8), state)).toBe(true);
    const { result, ticks } = walk(terrain, body, state);
    expect(result).toBe(FOLLOW_ARRIVED);
    // l'arrivée se juge à la case (colonne et rangée), pas au pixel
    expect(body.x >> 2).toBe(state.target!.x >> 2);
    expect(body.p >> 3).toBe(state.target!.p >> 3);
    expect(ticks).toBeLessThan(200);
    expect(body.speedX).toBe(0);
    expect(body.speedP).toBe(0);
  });

  it("dernier nœud : la destination est un nœud d'une colonne tant qu'elle est à 4 en X ou 8 en P ou plus", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 9, 5, 60)));
    const body = heroBody(120, 100, 35, 0, 2);
    const state = createPathState();
    expect(computePath(terrain, body, target(20, 5), state)).toBe(true);
    state.remaining = 0; // plus de nœud : la destination (colonne 5, rangée 5) est rejointe directement
    expect(followPath(state, body)).toBe(FOLLOW_WALKING);
    expect(body.speedX).toBe(-1);
    expect(body.speedP).toBe(0); // d'abord l'alignement en colonne, comme dans l'original (Mod 0 avant Mod 1)
    // à moins de 4 en X et de 8 en P : arrivée
    const near = heroBody(80, 100, 43, 0, 2);
    expect(followPath(state, near)).toBe(FOLLOW_ARRIVED);
    expect(state.target!.x >> 2).toBe(near.x >> 2);
  });

  it("bloqué en changeant de rangée (Mod 1), il marche sur le côté (Mod 2), borné par le nœud, jusqu'à pouvoir avancer en P", () => {
    // un mur plein en colonnes 20 à 22 de la rangée 4 : le sprite de 20 px ne peut pas entrer dans la rangée au-dessus
    const terrain = syntheticTerrain(
      concat(...rows(2, 3, 5, 40), record(2, 0, 4, 5, 179, 100, 19, 179, 100), record(1, 0, 4, 20, 140, 40, 22, 140, 40), record(2, 0, 4, 23, 179, 100, 40, 179, 100)),
    );
    const body = heroBody(86, 100, 27, 0, 2);
    const state = createPathState();
    expect(computePath(terrain, body, target(30, 4), state)).toBe(true);
    state.mode = 1;
    body.speedP = 1; // le dernier pas allait vers la rangée 4...
    body.err = 1; // ... et a échoué
    const modes = new Set<number>();
    let result = FOLLOW_WALKING;
    for (let tick = 0; tick < 400 && result === FOLLOW_WALKING; tick++) {
      result = followPath(state, body, { recompute: (s, resume) => computePath(terrain, body, s.target!, s, { resume }) });
      modes.add(state.mode);
      if (result === FOLLOW_WALKING) moveObject(body, walkEnv(terrain));
    }
    expect(modes.has(2)).toBe(true);
    expect(result).toBe(FOLLOW_ARRIVED);
    expect(terrainCollision(terrain, body).code).toBe(0);
  });

  it("Mod 2 : un pas de côté bloqué inverse le sens une fois, le deuxième échec est un blocage (recalcul)", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 6, 5, 60)));
    const body = heroBody(50, 100, 27, 0, 2);
    const state = createPathState();
    computePath(terrain, body, target(40, 5), state);
    state.mode = 2;
    state.lateral = 1;
    state.memo = -1;
    body.speedP = 0; // le dernier pas était latéral
    body.err = 1;
    let recomputed = 0;
    const context = { recompute: () => (recomputed++, false) };
    expect(followPath(state, body, context)).toBe(FOLLOW_WALKING);
    expect(state.lateral).toBe(-1);
    expect(body.speedX).toBe(-1);
    body.err = 1;
    body.speedP = 0;
    expect(followPath(state, body, context)).toBe(FOLLOW_RECOMPUTE_FAILED);
    expect(recomputed).toBe(1);
  });

  it("un blocage inattendu déclenche le recalcul ; échec du recalcul : retour 4 ; sans changement de décision : retour 5", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 6, 5, 60)));
    const body = heroBody(50, 100, 19, 0, 2);
    const state = createPathState();
    computePath(terrain, body, target(40, 5), state);
    let calls = 0;
    // alignement dans la rangée du nœud : un blocage hors du nœud sans esquive possible est « bloqué »
    state.remaining = 2;
    state.nodes = [
      { row: 5, plane: 0, c0: 30, c1: 40 },
      { row: 2, plane: 0, c0: 30, c1: 40 },
    ];
    body.err = 1;
    expect(followPath(state, body, { recompute: () => (calls++, false) })).toBe(FOLLOW_RECOMPUTE_FAILED);
    expect(calls).toBe(1);
    body.err = 0x11; // un succès acquitté
    followPath(state, body);
    expect(body.err).toBe(0);
  });

  it("esquive : Err 4 (masque de profondeur) en dehors du nœud décale P de 1, mais la décision n'a pas changé : retour 5", () => {
    const terrain = syntheticTerrain(concat(...rows(2, 6, 5, 60)));
    const body = heroBody(50, 100, 19, 0, 2);
    const state = createPathState();
    computePath(terrain, body, target(40, 5), state);
    state.remaining = 2;
    state.nodes = [
      { row: 5, plane: 0, c0: 30, c1: 40 },
      { row: 2, plane: 0, c0: 30, c1: 40 },
    ];
    body.speedX = 1; // le pas précédent allait déjà vers la droite
    body.err = 4;
    const before = body.p;
    expect(followPath(state, body)).toBe(FOLLOW_BLOCKED);
    expect(body.p).toBe(before + 1);
    expect([body.speedX, body.speedP, body.speedY]).toEqual([0, 0, 0]); // 30d9:0006 arrête l'objet
  });
});

describe.skipIf(!hasOriginalFiles)("trajets sur les données d'Armaeth", () => {
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

  it("graphe du héros : 59 salles de 0 à 64 nœuds (médiane 20, maximum 64), aucun nœud à 8 voisins ; la scène 0 est abandonnée", () => {
    const sizes: number[] = [];
    let saturated = 0;
    for (const room of world.rooms) {
      const graph = buildGraph(terrainOf(room.id), walkerBody);
      if (room.id === 0) {
        expect(graph).toBeNull();
        continue;
      }
      expect(graph).not.toBeNull();
      sizes.push(graph!.length);
      saturated += graph!.filter((n) => n.neighbors.length >= MAX_NEIGHBORS).length;
    }
    sizes.sort((a, b) => a - b);
    expect(sizes).toHaveLength(59);
    expect(sizes[0]).toBe(0);
    expect(sizes[sizes.length >> 1]).toBe(20);
    expect(sizes[sizes.length - 1]).toBe(64);
    expect(saturated).toBe(0);
  });

  it("le nœud d'arrivée contient la destination et le trajet est un chemin de voisins (échantillon de clics)", () => {
    let seed = 99;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let planned = 0;
    for (const room of world.rooms) {
      if (room.id === 0) continue;
      const terrain = terrainOf(room.id);
      const graph = buildGraph(terrain, walkerBody)!;
      const cells: { plane: number; row: number; col: number }[] = [];
      for (let plane = 0; plane < terrain.planes; plane++) {
        for (let row = 2; row < 19; row++) for (let col = 2; col < 78; col++) if (typeAt(terrain.grid, cellIndex(plane, row, col)) >= 2) cells.push({ plane, row, col });
      }
      if (cells.length < 2) continue;
      const a = cells[Math.floor(random() * cells.length)]!;
      const b = cells[Math.floor(random() * cells.length)]!;
      const state = createPathState();
      const x = a.col * 4 + 2;
      const p = a.row * 8 + 3;
      const goalX = b.col * 4 + 2;
      const goalP = b.row * 8 + 3;
      const ok = computePath(terrain, { ...walkerBody, x, p, y: groundHeight(terrain.grid, a.plane, x, p), plane: a.plane }, { x: goalX, y: groundHeight(terrain.grid, b.plane, goalX, goalP), p: goalP, plane: b.plane }, state);
      if (!ok) continue;
      planned++;
      expect(state.remaining).toBeLessThan(graph.length);
      // chaque saut est une paire de nœuds voisins du graphe
      let previous = state.here!;
      for (let i = state.nodes.length - 1; i >= 0; i--) {
        const node = state.nodes[i]!;
        const from = graph.findIndex((n) => n.row === previous.row && n.plane === previous.plane && n.c0 === previous.c0 && n.c1 === previous.c1);
        const to = graph.findIndex((n) => n.row === node.row && n.plane === node.plane && n.c0 === node.c0 && n.c1 === node.c1);
        expect(graph[from]!.neighbors).toContain(to);
        previous = node;
      }
    }
    expect(planned).toBeGreaterThan(40);
  });

  it("le héros suit son trajet jusqu'à la destination dans la plupart des cas (échantillon de 120 trajets)", () => {
    let seed = 4242;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let trials = 0;
    let arrived = 0;
    for (const room of world.rooms) {
      if (room.id === 0) continue;
      const terrain = terrainOf(room.id);
      const cells: { plane: number; row: number; col: number }[] = [];
      for (let plane = 0; plane < terrain.planes; plane++) {
        for (let row = 2; row < 19; row++) for (let col = 2; col < 78; col++) if (typeAt(terrain.grid, cellIndex(plane, row, col)) >= 2) cells.push({ plane, row, col });
      }
      if (cells.length < 2) continue;
      for (let k = 0; k < 3; k++) {
        const a = cells[Math.floor(random() * cells.length)]!;
        const b = cells[Math.floor(random() * cells.length)]!;
        const x = a.col * 4 + 2;
        const p = a.row * 8 + 3;
        const hero = heroBody(x, groundHeight(terrain.grid, a.plane, x, p), p, a.plane, typeAt(terrain.grid, cellIndex(a.plane, a.row, a.col)));
        if (terrainCollision(terrain, hero).code !== 0) continue; // départ dans un mur
        const goalX = b.col * 4 + 2;
        const goalP = b.row * 8 + 3;
        const state = createPathState();
        if (!planClick(hero, goalX, groundHeight(terrain.grid, b.plane, goalX, goalP), walkEnv(terrain), state)) continue;
        trials++;
        if (walk(terrain, hero, state, 1200).result === FOLLOW_ARRIVED) arrived++;
      }
    }
    expect(trials).toBeGreaterThan(100);
    expect(arrived / trials).toBeGreaterThan(0.6);
  });
});
