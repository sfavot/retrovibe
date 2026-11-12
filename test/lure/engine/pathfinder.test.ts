import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Direction } from "../../../src/games/lure/data/ids";
import { ROOM_PATHS_SIZE } from "../../../src/games/lure/data/lure-dat";
import {
  ORIGINAL_PATHFIND_COUNTDOWN,
  PathResult,
  type PathFinderState,
  type PathWalker,
  createPathFinder,
  numSteps,
  processPath,
  resetPath,
} from "../../../src/games/lure/engine/pathfinder";
import { lureData } from "../data/catalog-helper";
import { hasOriginalFiles } from "./test-host";

/**
 * Chemins rendus par le `PathFinder` de ScummVM sur les vraies grilles : `PathFinder::process`, `initVars`, `processCell`, `scanLine` et
 * `RoomPathsData::decompress` extraits tels quels de `engines/lure/` (hotspots.cpp, res_struct.cpp) dans un petit programme C++ compilé
 * dans le scratchpad (`pfref.cpp`, hors dépôt), avec `PATHFIND_COUNTDOWN 0` comme ScummVM. Une ligne par trajet : pièce, x, y, largeur,
 * hauteur du personnage (Diermot), destination x, y, résultat (`PathFinderResult`), tronçons `[direction, pas bruts]` dans l'ordre.
 * Trajets : de chaque point d'arrivée de chaque pièce (sorties des autres pièces qui y mènent) vers chacune de ses sorties
 * (`0x3F14`) et vers le centre de sa zone de marche.
 */
type Row = [number, number, number, number, number, number, number, number, Array<[number, number]>];
const FIXTURE = new URL("./fixtures/pathfinder-scummvm.json", import.meta.url);

function walker(x: number, y: number, w: number, h: number, destX: number, destY: number): PathWalker {
  return { x, y, widthCopy: w, heightCopy: h, destX, destY };
}

/** Recherche complète (au plus `max` appels). */
function search(pf: PathFinderState, w: PathWalker, budget: number, max = 1000): { result: number; calls: number } {
  for (let calls = 1; calls <= max; calls++) {
    const result = processPath(pf, w, budget);
    if (result !== PathResult.UNFINISHED) return { result, calls };
  }
  throw new Error("recherche sans fin");
}

describe("PathFinder sur une grille synthétique", () => {
  const empty = new Uint8Array(ROOM_PATHS_SIZE);

  it("déplacement dans la même case : un seul tronçon", () => {
    const pf = createPathFinder();
    resetPath(pf, empty, 32, 0);
    // Pied en (101, 116) : case (12, 14) ; destination (101, 121) : même case, 5 pixels plus bas.
    expect(processPath(pf, walker(101, 80, 32, 48, 101, 121), 0)).toBe(PathResult.OK);
    expect(pf.list).toEqual([{ direction: Direction.DOWN, rawSteps: 5 }]);
  });

  it("ligne droite : 8 pas bruts par case, 2 images par case en largeur, 4 en hauteur", () => {
    const pf = createPathFinder();
    resetPath(pf, empty, 32, 0);
    expect(processPath(pf, walker(101, 80, 32, 48, 165, 121), 0)).toBe(PathResult.OK);
    expect(pf.list).toEqual([{ direction: Direction.RIGHT, rawSteps: 64 }]);
    expect(numSteps(pf.list[0]!)).toBe(16);
    expect(numSteps({ direction: Direction.UP, rawSteps: 64 })).toBe(32);
  });

  it("destination derrière un mur : chemin partiel (vide ici) ou aucun chemin, comme ScummVM", () => {
    const paths = new Uint8Array(ROOM_PATHS_SIZE);
    // Un mur vertical plein en colonne 20 ; valeurs relevées sur l'extrait compilé de ScummVM.
    for (let y = 0; y < 24; y++) paths[y * 5 + 2] = 0x08;
    const pf = createPathFinder();
    resetPath(pf, paths, 8, 0);
    expect(processPath(pf, walker(37, 80, 8, 48, 250, 121), 0)).toBe(PathResult.PART_PATH);
    expect(pf.list).toEqual([]);
    resetPath(pf, paths, 8, 0);
    expect(processPath(pf, walker(37, 80, 8, 48, 250, 128), 0)).toBe(PathResult.NO_WALK);
  });

  it("l'état est un objet simple, sérialisable en JSON", () => {
    const pf = createPathFinder();
    resetPath(pf, empty, 32, 0);
    processPath(pf, walker(101, 80, 32, 48, 280, 160), 0);
    expect(JSON.parse(JSON.stringify(pf))).toEqual(pf);
  });
});

describe.skipIf(!hasOriginalFiles)("PathFinder sur les grilles du jeu", () => {
  const rows: Row[] = hasOriginalFiles ? JSON.parse(readFileSync(FIXTURE, "utf8")) : [];
  const paths = (room: number) => lureData().rooms.find((r) => r.roomNumber === room)!.paths;

  it("même résultat et mêmes tronçons que le PathFinder de ScummVM (373 trajets, toutes les pièces)", () => {
    expect(rows.length).toBe(373);
    expect(new Set(rows.map((r) => r[0])).size).toBe(45);
    const mismatches: string[] = [];
    for (const [room, x, y, w, h, dx, dy, result, list] of rows) {
      const pf = createPathFinder();
      resetPath(pf, paths(room), w, 0);
      const got = processPath(pf, walker(x, y, w, h, dx, dy), 0);
      const gotList = pf.list.map((e) => [e.direction, e.rawSteps]);
      if (got !== result || JSON.stringify(gotList) !== JSON.stringify(list)) {
        const route = `pièce ${room} (${x}, ${y}) → (${dx}, ${dy})`;
        mismatches.push(`${route} : ${got} ${JSON.stringify(gotList)} au lieu de ${result} ${JSON.stringify(list)}`);
      }
    }
    expect(mismatches).toEqual([]);
    // Les quatre issues de ScummVM sont couvertes.
    expect(new Set(rows.map((r) => r[7]))).toEqual(new Set([PathResult.OK, PathResult.DEST_OCCUPIED, PathResult.PART_PATH, PathResult.NO_WALK]));
  });

  it("recherche découpée (budget de l'original, 4 000) reprise sur plusieurs appels = même chemin qu'en une fois", () => {
    let multi = 0;
    for (const [room, x, y, w, h, dx, dy] of rows) {
      const whole = createPathFinder();
      resetPath(whole, paths(room), w, 0);
      const once = processPath(whole, walker(x, y, w, h, dx, dy), 0);

      const sliced = createPathFinder();
      resetPath(sliced, paths(room), w, ORIGINAL_PATHFIND_COUNTDOWN);
      const { result, calls } = search(sliced, walker(x, y, w, h, dx, dy), ORIGINAL_PATHFIND_COUNTDOWN);
      if (calls > 1) multi++;
      expect(result, `pièce ${room} (${x}, ${y}) → (${dx}, ${dy})`).toBe(once);
      expect(sliced.list).toEqual(whole.list);
    }
    // 70 recherches sur 373 demandent plusieurs appels (une passe coûte jusqu'à 2 880, le premier appel 700 de plus).
    expect(multi).toBe(70);
  });

  it("reprise après un aller-retour JSON de l'état au milieu d'une recherche", () => {
    let interrupted = 0;
    for (const [room, x, y, w, h, dx, dy] of rows.filter((_, i) => i % 7 === 0)) {
      const ref = createPathFinder();
      resetPath(ref, paths(room), w, 0);
      const once = processPath(ref, walker(x, y, w, h, dx, dy), 0);

      let pf = createPathFinder();
      resetPath(pf, paths(room), w, ORIGINAL_PATHFIND_COUNTDOWN);
      let result: number = PathResult.UNFINISHED;
      while (result === PathResult.UNFINISHED) {
        result = processPath(pf, walker(x, y, w, h, dx, dy), ORIGINAL_PATHFIND_COUNTDOWN);
        if (result === PathResult.UNFINISHED) {
          expect(pf.inProgress).toBe(true);
          interrupted++;
          pf = JSON.parse(JSON.stringify(pf)) as PathFinderState;
        }
      }
      expect(result).toBe(once);
      expect(pf.list).toEqual(ref.list);
    }
    expect(interrupted).toBeGreaterThan(0);
  });
});
