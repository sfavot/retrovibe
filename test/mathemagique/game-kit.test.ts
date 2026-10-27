import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import type { Cell } from "../../src/games/mathemagique/game/puzz";
import {
  expectedShapeCount,
  firstShapeIndex,
  hiddenMenuShplId,
  hiddenPhotoShplId,
  hiddenPuzzId,
  hiddenRewardId,
  parseHiddenPuzz,
  parsePatternsPuzz,
  parseSticklersPuzz,
  patternsPuzzId,
  patternsRewardId,
  patternsThumbsShplId,
  puzzId,
  rewardId,
  shapeBases,
} from "../../src/games/mathemagique/game/puzz";
import {
  HIDDEN,
  HiddenBoard,
  HiddenSelection,
  PATTERNS,
  PatternsBoard,
  PuzzleSession,
  STICKLERS,
  SticklersBoard,
  THUMB_LAYOUTS,
  attachBoard,
  cornersInside,
  dealPatterns,
  edges,
  edgesIntersect,
  hiddenBounds,
  hiddenCellSize,
  makeHiddenPieces,
  nextRotation,
  patternsRect,
  patternsSolved,
  pieceRect,
  pushOutOfBand,
  pushOutOfBottomBand,
  pushOutOfToolbar,
  rotateHiddenCells,
  rotatePatternsPiece,
  rotateStick,
  scatterHidden,
  snapAxis,
  snapCorner,
  snapTarget,
  snapToTarget,
  stickBounds,
  thumbAt,
  thumbHoverFrame,
  thumbRect,
  trySnap,
  withinTolerance,
  type PatternsPiece,
  type ShapeSizer,
  type StickPiece,
} from "../../src/games/mathemagique/game/puzzle-kit";
import {
  BOWLING_POLY,
  HIDDEN_POLY,
  PATTERNS_POLY,
  PATTERN_WINDOWS_POLY,
  POLY_CONFIGS,
  POLY_ZONE,
  ROCKETS_POLY,
  STICKLERS_POLY,
  polyScriptIds,
  type PolyConfig,
} from "../../src/games/mathemagique/game/poly-config";
import { PolyHelper, createScrPolyPorts, rosterIntroFlag, type PolyAnimation, type PolyPorts } from "../../src/games/mathemagique/game/poly";
import { Surface } from "../../src/games/mathemagique/engine/graphics/surface";
import { Palette } from "../../src/games/mathemagique/engine/graphics/palette";
import { Input } from "../../src/games/mathemagique/engine/input";
import { PointerService } from "../../src/games/mathemagique/engine/pointer";
import { Archive } from "../../src/games/mathemagique/engine/resources";
import { MsvcRandom } from "../../src/games/mathemagique/engine/rng";
import { RosterState, RosterStore } from "../../src/games/mathemagique/engine/roster";
import { ScrPlayer } from "../../src/games/mathemagique/engine/scr-player";
import { SoundService } from "../../src/games/mathemagique/engine/sound";
import { MemoryStorage, TestHost } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

const real = describe.skipIf(!hasOriginalFiles);

function open(name: string): Archive {
  return new Archive(name, MohawkArchive.parse(readOriginal(name)));
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

// =====================================================================================================================================
// Outils : pavage exact par rotations (pour vérifier les PUZZ de Hidden et construire une solution)
// =====================================================================================================================================

interface Placement {
  piece: number;
  turns: number;
  ox: number;
  oy: number;
}

/** Pavage exact de la grille `n × n` par les pièces (rotations seules). */
function solve(pieces: readonly Cell[][], n: number): Placement[] | null {
  const variants = pieces.map((cells) => {
    const list: Cell[][] = [];
    let current = cells.map((c) => ({ ...c }));
    for (let turns = 0; turns < 4; turns++) {
      const h = Math.max(...current.map((c) => c.y)) + 1;
      list.push(current);
      current = current.map((c) => ({ x: h - 1 - c.y, y: c.x }));
    }
    return list;
  });
  const grid = Array.from({ length: n * n }, () => false);
  const used = pieces.map(() => false);
  const placements: Placement[] = [];
  const first = (cells: Cell[]) => cells.reduce((best, c) => (c.y < best.y || (c.y === best.y && c.x < best.x) ? c : best));
  const search = (): boolean => {
    const at = grid.indexOf(false);
    if (at < 0) return true;
    const gx = at % n;
    const gy = Math.floor(at / n);
    for (let p = 0; p < pieces.length; p++) {
      if (used[p]) continue;
      for (let turns = 0; turns < 4; turns++) {
        const cells = variants[p]![turns]!;
        const anchor = first(cells);
        const ox = gx - anchor.x;
        const oy = gy - anchor.y;
        if (!cells.every((c) => ox + c.x >= 0 && ox + c.x < n && oy + c.y >= 0 && oy + c.y < n && !grid[(oy + c.y) * n + ox + c.x])) continue;
        for (const c of cells) grid[(oy + c.y) * n + ox + c.x] = true;
        used[p] = true;
        placements.push({ piece: p, turns, ox, oy });
        if (search()) return true;
        placements.pop();
        used[p] = false;
        for (const c of cells) grid[(oy + c.y) * n + ox + c.x] = false;
      }
    }
    return false;
  };
  return search() ? placements : null;
}

// =====================================================================================================================================
// puzz.ts : formules et analyseurs
// =====================================================================================================================================

describe("identifiants des puzzles", () => {
  it("Hidden : 1000 + 32·niveau + tirage, photo 5070 + 9·niveau + k, fin 5100 + 900·niveau + 100·k, menu 7800 + 10·niveau", () => {
    expect(hiddenPuzzId(0, 0)).toBe(1000);
    expect(hiddenPuzzId(1, 0)).toBe(1032);
    expect(hiddenPuzzId(2, 8)).toBe(1072);
    expect(hiddenPhotoShplId(0, 0)).toBe(5070);
    expect(hiddenPhotoShplId(2, 8)).toBe(5096);
    expect(hiddenRewardId(0, 0)).toBe(5100);
    expect(hiddenRewardId(0, 8)).toBe(5900);
    expect(hiddenRewardId(1, 0)).toBe(6000);
    expect(hiddenRewardId(2, 0)).toBe(6900);
    expect(hiddenRewardId(2, 8)).toBe(7700);
    expect([0, 1, 2].map(hiddenMenuShplId)).toEqual([7800, 7810, 7820]);
  });

  it("Patterns : 6600 + 450·L + 50·k, victoire 20000 + 900·L + 100·k, vignettes 6520 + 10·L", () => {
    expect(patternsPuzzId(0, 0)).toBe(6600);
    expect(patternsPuzzId(2, 8)).toBe(7900);
    expect(patternsRewardId(1, 2)).toBe(21100);
    expect(patternsRewardId(1, 7)).toBe(21600);
    expect(patternsRewardId(2, 1)).toBe(21900);
    expect(patternsRewardId(2, 8)).toBe(22600);
    expect(patternsThumbsShplId(2)).toBe(6540);
  });

  it("Sticklers : puzzId 2100 + 900·niveau + 100·k, rewardId 8000 + 50·(9·niveau + k)", () => {
    expect(puzzId(0, 0)).toBe(2100);
    expect(puzzId(1, 2)).toBe(3200);
    expect(puzzId(2, 8)).toBe(4700);
    expect(rewardId(0, 0)).toBe(8000);
    expect(rewardId(1, 0)).toBe(8450);
    expect(rewardId(2, 8)).toBe(9300);
  });

  it("refuse les indices hors plage", () => {
    expect(() => puzzId(3, 0)).toThrow(RangeError);
    expect(() => hiddenPuzzId(0, 9)).toThrow(RangeError);
    expect(() => patternsPuzzId(-1, 0)).toThrow(RangeError);
  });
});

real("PUZZ de Hidden (HIDDEN.DAT)", () => {
  const mohawk = MohawkArchive.parse(readOriginal("HIDDEN.DAT"));
  const ids = range(3).flatMap((level) => range(9).map((k) => ({ level, id: hiddenPuzzId(level, k) })));

  it("27 ressources de 1 + 15·n octets, les cellules totalisent 16 / 25 / 36", () => {
    expect(ids).toHaveLength(27);
    for (const { level, id } of ids) {
      const bytes = mohawk.get("PUZZ", id);
      const puzz = parseHiddenPuzz(bytes);
      expect(bytes.length, `PUZZ ${id}`).toBe(1 + 15 * puzz.pieces.length);
      const cells = puzz.pieces.reduce((sum, p) => sum + p.cells.length, 0);
      expect(cells, `PUZZ ${id}`).toBe((4 + level) ** 2);
    }
  });

  it("nombre de pièces : 8, sauf 7 (1036) et 9 (1068, 1069, 1071, 1072)", () => {
    const counts = new Map(ids.map(({ id }) => [id, parseHiddenPuzz(mohawk.get("PUZZ", id)).pieces.length]));
    for (const [id, n] of counts) expect(n, `PUZZ ${id}`).toBe(id === 1036 ? 7 : [1068, 1069, 1071, 1072].includes(id) ? 9 : 8);
  });

  it("1000 : trois monominos, deux dominos, deux trominos en L et un I de 3", () => {
    const puzz = parseHiddenPuzz(mohawk.get("PUZZ", 1000));
    expect(puzz.pieces.map((p) => p.cells)).toEqual([
      [{ x: 0, y: 0 }],
      [{ x: 0, y: 0 }],
      [{ x: 0, y: 0 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
    ]);
  });

  it("les octets de bourrage après les k premières cellules sont ignorés (1001, 6e pièce)", () => {
    const puzz = parseHiddenPuzz(mohawk.get("PUZZ", 1001));
    expect(puzz.pieces[5]!.cells).toHaveLength(2);
  });

  it("les 27 découpages pavent la grille (rotations seules)", () => {
    for (const { level, id } of ids) {
      const puzz = parseHiddenPuzz(mohawk.get("PUZZ", id));
      expect(solve(puzz.pieces.map((p) => p.cells), 4 + level), `PUZZ ${id}`).not.toBeNull();
    }
  });
});

real("PUZZ de Puzzle Patterns (PATTERNS.DAT)", () => {
  const mohawk = MohawkArchive.parse(readOriginal("PATTERNS.DAT"));
  const all = range(3).flatMap((level) => range(9).map((k) => patternsPuzzId(level, k)));

  it("6600 : huit pièces verticales en quatre colonnes de deux", () => {
    const puzz = parsePatternsPuzz(mohawk.get("PUZZ", 6600));
    expect(puzz.orient).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(puzz.col.map((c, i) => [c, puzz.row[i]])).toEqual([[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2], [3, 0], [3, 2]]);
  });

  it("6650 (papillon) : orientations 0,0,1,1,1,1,0,0", () => {
    const puzz = parsePatternsPuzz(mohawk.get("PUZZ", 6650));
    expect(puzz.orient).toEqual([0, 0, 1, 1, 1, 1, 0, 0]);
    expect(puzz.col.map((c, i) => [c, puzz.row[i]])).toEqual([[0, 0], [1, 0], [2, 0], [2, 1], [0, 2], [0, 3], [2, 2], [3, 2]]);
  });

  it("les 27 puzzles (40 octets) pavent la grille 4×4", () => {
    expect(all.every((id) => mohawk.has("PUZZ", id))).toBe(true);
    for (const id of all) {
      const bytes = mohawk.get("PUZZ", id);
      expect(bytes.length).toBe(40);
      const puzz = parsePatternsPuzz(bytes);
      const covered = new Set<number>();
      for (let i = 0; i < 8; i++) {
        const w = puzz.orient[i] === 1 ? 2 : 1;
        const h = puzz.orient[i] === 1 ? 1 : 2;
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) covered.add((puzz.row[i]! + dy) * 4 + puzz.col[i]! + dx);
      }
      expect(covered.size, `PUZZ ${id}`).toBe(16);
      expect([...covered].every((v) => v >= 0 && v < 16)).toBe(true);
    }
  });

  it("SCR et SHPL de victoire / vignettes existent", () => {
    for (let level = 0; level < 3; level++) {
      expect(mohawk.has("SHPL", patternsThumbsShplId(level))).toBe(true);
      for (let k = 0; k < 9; k++) {
        expect(mohawk.has("\0SCR", patternsRewardId(level, k)), `SCR ${patternsRewardId(level, k)}`).toBe(true);
        expect(mohawk.has("SHPL", patternsPuzzId(level, k))).toBe(true);
      }
    }
  });
});

real("PUZZ de Super Sticklers (STICKLER.DAT)", () => {
  const archive = open("STICKLER.DAT");
  const mohawk = archive.mohawk;

  it("2100 : 8 fragments, gabarit en (40, 29), premiers fragments décodés", () => {
    const puzz = parseSticklersPuzz(mohawk.get("PUZZ", 2100));
    expect(puzz.count).toBe(8);
    expect([puzz.templateX, puzz.templateY]).toEqual([40, 29]);
    expect(puzz.pieces.slice(0, 3).map((p) => [p.orientations, p.x, p.y])).toEqual([[1, 49, 41], [4, 59, 109], [4, 122, 52]]);
    expect(puzz.pieces.slice(3, 8).map((p) => [p.orientations, p.x, p.y])).toEqual([[4, 188, 49], [4, 66, 88], [4, 136, 131], [4, 178, 115], [4, 200, 106]]);
  });

  it("4700 : 15 fragments sur 98 octets, début (2,110,74) (2,160,53) (2,212,67) (4,104,46)", () => {
    const bytes = mohawk.get("PUZZ", 4700);
    expect(bytes.length).toBe(98);
    const puzz = parseSticklersPuzz(bytes);
    expect(puzz.count).toBe(15);
    expect(puzz.pieces.slice(0, 4).map((p) => [p.orientations, p.x, p.y])).toEqual([[2, 110, 74], [2, 160, 53], [2, 212, 67], [4, 104, 46]]);
  });

  it("les 27 PUZZ font 8 + 6·n octets ; n : 7 (3400), 8 (11), 9 (7), 10 (4), 12 (2), 13 (1), 15 (1)", () => {
    const counts = new Map<number, number>();
    for (let level = 0; level < 3; level++) {
      for (let k = 0; k < 9; k++) {
        const bytes = mohawk.get("PUZZ", puzzId(level, k));
        const puzz = parseSticklersPuzz(bytes);
        expect(bytes.length, `PUZZ ${puzzId(level, k)}`).toBe(8 + 6 * puzz.count);
        counts.set(puzz.count, (counts.get(puzz.count) ?? 0) + 1);
      }
    }
    expect(parseSticklersPuzz(mohawk.get("PUZZ", 3400)).count).toBe(7);
    // sticklers.md §2.1 annonce 8 (12) et 10 (3) : les données donnent 8 (11) et 10 (4) (3500 est le quatrième puzzle à 10 fragments).
    expect([...counts].sort((a, b) => a[0] - b[0])).toEqual([[7, 1], [8, 11], [9, 7], [10, 4], [12, 2], [13, 1], [15, 1]]);
  });

  it("firstShapeIndex + somme des orientations = nombre de formes de la SHPL (27 puzzles)", () => {
    for (let level = 0; level < 3; level++) {
      for (let k = 0; k < 9; k++) {
        const puzz = parseSticklersPuzz(mohawk.get("PUZZ", puzzId(level, k)));
        expect(expectedShapeCount(puzz, level), `SHPL ${puzzId(level, k)}`).toBe(archive.shpl(puzzId(level, k)).shapeCount);
      }
    }
    expect([0, 1, 2].map(firstShapeIndex)).toEqual([1, 1, 2]);
  });

  it("shapeBases : cumul des orientations (2100 : 1, 2, 6, 10, …)", () => {
    const puzz = parseSticklersPuzz(mohawk.get("PUZZ", 2100));
    expect(shapeBases(puzz, 0).slice(0, 4)).toEqual([1, 2, 6, 10]);
  });

  it("les 27 SCR de récompense 8000…9300 existent", () => {
    for (let level = 0; level < 3; level++) for (let k = 0; k < 9; k++) expect(mohawk.has("\0SCR", rewardId(level, k)), `SCR ${rewardId(level, k)}`).toBe(true);
  });
});

// =====================================================================================================================================
// puzzle-kit : géométrie et règles communes
// =====================================================================================================================================

describe("géométrie commune", () => {
  it("rectangles semi-ouverts : un bord partagé ne coupe pas", () => {
    expect(edgesIntersect(edges(0, 0, 10, 10), edges(10, 0, 20, 10))).toBe(false);
    expect(edgesIntersect(edges(0, 0, 10, 10), edges(9, 9, 20, 20))).toBe(true);
    expect(cornersInside(edges(0, 0, 10, 10), edges(0, 0, 9, 9))).toBe(true);
    expect(cornersInside(edges(0, 0, 10, 10), edges(0, 0, 10, 9))).toBe(false); // x = droite exclu
  });

  it("pushOutOfBand : plus faible pénétration, à égalité vers le haut", () => {
    const band = edges(0, 100, 50, 200);
    expect(pushOutOfBand(edges(40, 90, 80, 110), band)).toEqual({ dx: 0, dy: -10 }); // dx = 10, dy = 10 : égalité -> haut
    expect(pushOutOfBand(edges(41, 90, 80, 110), band)).toEqual({ dx: 9, dy: 0 }); // dx = 9 < dy = 10 -> droite
    expect(pushOutOfBand(edges(40, 90, 80, 109), band)).toEqual({ dx: 0, dy: -9 });
    expect(pushOutOfBand(edges(50, 90, 80, 110), band)).toEqual({ dx: 0, dy: 0 }); // contact par le bord
  });

  it("nextRotation : (r + 1) & (a − 1)", () => {
    expect(range(5).reduce((acc: number[]) => [...acc, nextRotation(acc[acc.length - 1]!, 4)], [0])).toEqual([0, 1, 2, 3, 0, 1]);
    expect([0, 1, 0].map((r) => nextRotation(r, 2))).toEqual([1, 0, 1]);
    expect(nextRotation(0, 1)).toBe(0);
  });

  it("tolérance de 10 px inclusive", () => {
    expect(withinTolerance(10, 10, 10)).toBe(true);
    expect(withinTolerance(-10, 10, 10)).toBe(true);
    expect(withinTolerance(11, 0, 10)).toBe(false);
    expect(withinTolerance(0, -11, 10)).toBe(false);
    expect(snapToTarget(110, 90, { x: 100, y: 100 }, 10)).toEqual({ x: 100, y: 100 });
    expect(snapToTarget(111, 100, { x: 100, y: 100 }, 10)).toBeNull();
  });

  it("menu 3×9 : 9 vignettes 72×72, positions des trois activités", () => {
    expect(thumbRect(THUMB_LAYOUTS.hidden, 0)).toEqual({ x: 59, y: 56, w: 72, h: 72 });
    expect(thumbRect(THUMB_LAYOUTS.hidden, 8)).toEqual({ x: 59 + 156, y: 56 + 156, w: 72, h: 72 });
    expect(thumbRect(THUMB_LAYOUTS.patterns, 4)).toEqual({ x: 84 + 78, y: 82 + 78, w: 72, h: 72 });
    expect([0, 1, 2].map((k) => thumbRect(THUMB_LAYOUTS.sticklers, k).x)).toEqual([50, 130, 210]);
    expect([0, 3, 6].map((k) => thumbRect(THUMB_LAYOUTS.sticklers, k).y)).toEqual([38, 118, 198]);
    expect(thumbAt(THUMB_LAYOUTS.hidden, 60, 57)).toBe(0);
    expect(thumbAt(THUMB_LAYOUTS.hidden, 59 + 72, 57)).toBe(-1); // entre deux vignettes
    expect(thumbAt(THUMB_LAYOUTS.sticklers, 211, 199)).toBe(8);
    expect(thumbHoverFrame(THUMB_LAYOUTS.hidden, 0)).toEqual({ x: 55, y: 52, w: 80, h: 80 });
    expect(() => thumbRect(THUMB_LAYOUTS.hidden, 9)).toThrow(RangeError);
  });

  it("PuzzleSession : boutons de niveau, choix, fin, Reset", () => {
    const s = new PuzzleSession();
    expect(s.pressLevel(0)).toBe(false); // menu vert déjà affiché
    expect(s.pressLevel(1)).toBe(true);
    expect([s.level, s.mode]).toEqual([1, "menu"]);
    expect(s.reset()).toBe(false); // pas de puzzle
    expect(s.select(4)).toBe(true);
    expect([s.puzzle, s.mode, s.piecesEnabled]).toEqual([4, "playing", true]);
    expect(s.select(2)).toBe(false); // hors menu
    expect(s.pressLevel(1)).toBe(true); // puzzle affiché : retour au menu même niveau
    expect(s.mode).toBe("menu");
    s.select(0);
    s.markSolved();
    expect([s.mode, s.piecesEnabled, s.replayEnabled]).toEqual([ "solved", false, true]);
    expect(s.reset()).toBe(true);
    expect([s.mode, s.replayEnabled]).toEqual(["playing", false]);
  });
});

// =====================================================================================================================================
// Hidden
// =====================================================================================================================================

describe("Hidden : règles", () => {
  it("cellules de 60, 48, 40 px", () => {
    expect([0, 1, 2].map(hiddenCellSize)).toEqual([60, 48, 40]);
  });

  it("snapCorner : 54 → 53, 82 → 53, 83 → 113, 84 → 113 (c = 60)", () => {
    expect(snapCorner(54, 51, 60)).toEqual({ x: 53, y: 50 });
    expect(snapCorner(54 + 28, 51 + 28, 60)).toEqual({ x: 53, y: 50 });
    expect(snapCorner(54 + 29, 51 + 29, 60)).toEqual({ x: 113, y: 110 });
    expect(snapCorner(84, 81, 60)).toEqual({ x: 113, y: 110 });
    expect(snapCorner(54 + 29 + 60, 51, 60).x).toBe(173);
  });

  it("snapCorner pour les cellules de 48 et 40 px", () => {
    expect(snapAxis(54, 54, 48)).toBe(53);
    expect(snapAxis(54 + 22, 54, 48)).toBe(53);
    expect(snapAxis(54 + 23, 54, 48)).toBe(101);
    expect(snapAxis(54 + 19, 54, 40)).toBe(93);
    expect(snapAxis(54 + 18, 54, 40)).toBe(53);
  });

  it("rotation : le L [(0,0),(1,0),(0,1)] (H = 2) donne [(1,0),(1,1),(0,0)], largeur et hauteur échangées", () => {
    const [piece] = makeHiddenPieces({ pieces: [{ cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] });
    expect([piece!.w, piece!.h]).toEqual([2, 2]);
    rotateHiddenCells(piece!);
    expect(piece!.cells).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }]);
    const [bar] = makeHiddenPieces({ pieces: [{ cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }] }] });
    expect([bar!.w, bar!.h]).toEqual([1, 3]);
    rotateHiddenCells(bar!);
    expect([bar!.w, bar!.h]).toEqual([3, 1]);
    expect(bar!.cells).toEqual([{ x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }]);
    for (let i = 0; i < 3; i++) rotateHiddenCells(bar!);
    expect(bar!.cells).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]);
  });

  it("bande du bas : poussée vers la droite ou vers le haut selon la plus faible pénétration", () => {
    const [domino] = makeHiddenPieces({ pieces: [{ cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] });
    const c = 60;
    // bbox 120×60 : à gauche 250, haut 280 -> bas 340 ; dx = 298 − 250 = 48, dy = 340 − 304 = 36 -> haut de 36
    domino!.cx = 250 + 60;
    domino!.cy = 280 + 30;
    expect(pushOutOfBottomBand(domino!, c)).toEqual({ dx: 0, dy: -36 });
    // gauche 280 : dx = 18 < dy = 36 -> droite de 18
    domino!.cx = 280 + 60;
    expect(pushOutOfBottomBand(domino!, c)).toEqual({ dx: 18, dy: 0 });
    // ne touche pas la bande
    domino!.cy = 100;
    expect(pushOutOfBottomBand(domino!, c)).toEqual({ dx: 0, dy: 0 });
    // test aux cellules : bbox qui coupe la bande mais aucune cellule (L renversé)
    const [l] = makeHiddenPieces({ pieces: [{ cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] });
    l!.cx = 100 + 60;
    l!.cy = 245 + 60; // bbox (100,245,220,365) ; la cellule (1,1) manquante est en (160..220, 305..365)
    expect(pushOutOfBottomBand(l!, c)).not.toEqual({ dx: 0, dy: 0 }); // les cellules (0,1) touchent la bande
    l!.cx = 250 + 60; // cellules de x 250..370 : (0,1) en 250..310 dans la bande (x < 298) ; décalons pour que seule la case absente soit dans la bande
    l!.cx = 238 + 60; // bbox x 238..358 ; case (1,1) manquante en x 298..358 hors bande de toute façon
    expect(pushOutOfBottomBand(l!, c)).not.toEqual({ dx: 0, dy: 0 });
  });

  it("dispersion : déterministe à graine fixe, orientations et centres dans la pile, tirages dans l'ordre", () => {
    const puzz = { pieces: [[{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]].map((cells) => ({ cells })) };
    const run = (seed: number) => {
      const pieces = makeHiddenPieces(puzz);
      const rng = new MsvcRandom(seed);
      scatterHidden(pieces, 0, rng);
      return { pieces, state: rng.current };
    };
    const a = run(7);
    const b = run(7);
    expect(a.pieces.map((p) => [p.cx, p.cy, p.w, p.h])).toEqual(b.pieces.map((p) => [p.cx, p.cy, p.w, p.h]));
    expect(a.state).toBe(b.state);
    for (const p of a.pieces) {
      const bounds = hiddenBounds(p, 60);
      expect(bounds.left).toBeGreaterThanOrEqual(HIDDEN.pile.left);
      expect(bounds.right).toBeLessThanOrEqual(HIDDEN.pile.right + 1);
      expect(bounds.top).toBeGreaterThanOrEqual(HIDDEN.pile.top);
      expect(bounds.bottom).toBeLessThanOrEqual(HIDDEN.pile.bottom + 1);
      expect(p.placed).toBe(false);
    }
    // Premier tirage = rand1(4) de la dernière pièce (de n − 1 à 0) : on le recoupe avec un générateur parallèle.
    const mirror = new MsvcRandom(7);
    const turns = mirror.rand1(4);
    const probe = makeHiddenPieces(puzz);
    const bar = probe[2]!; // I de 3, vertical au départ (1×3)
    for (let t = 0; t < turns; t++) rotateHiddenCells(bar);
    if (bar.w * 60 > HIDDEN.pileWidth) rotateHiddenCells(bar); // jamais ici : 180 < 212
    expect([a.pieces[2]!.w, a.pieces[2]!.h]).toEqual([bar.w, bar.h]);
  });

  it("tirage du découpage : sans remise par niveau, id 1000 + 32·niveau + tirage", () => {
    const selection = new HiddenSelection();
    const rng = new MsvcRandom(0);
    const draws = range(9).map(() => selection.draw(1, rng));
    expect(new Set(draws.map((d) => d.draw)).size).toBe(9);
    expect(draws.every((d) => d.puzzId === 1032 + d.draw)).toBe(true);
    expect(selection.draw(1, rng).draw).toBeGreaterThanOrEqual(0); // tout tiré : remise à zéro
    expect(selection.pools[0]!.state).toBe(0); // un historique par niveau
  });
});

real("Hidden : plateau complet sur HIDDEN.DAT", () => {
  const mohawk = MohawkArchive.parse(readOriginal("HIDDEN.DAT"));
  /** Les pièces d'un plateau neuf sont toutes en (0, 0) : on les range dans la pile, étalées, pour qu'elles ne gênent pas. */
  const park = (board: HiddenBoard) => board.pieces.forEach((p, i) => { p.cx = 450; p.cy = 60 + 45 * i; });

  it("pose toutes les pièces de 1000 à leur place par prise / dépose : la fin est détectée à la dernière", () => {
    const puzz = parseHiddenPuzz(mohawk.get("PUZZ", 1000));
    const solution = solve(puzz.pieces.map((p) => p.cells), 4)!;
    const board = new HiddenBoard(0, puzz);
    board.scatter(new MsvcRandom(3));
    const c = board.cell;
    solution.forEach((placement, index) => {
      const piece = board.pieces.find((p) => p.id === placement.piece)!;
      // L'orientation vient de la dispersion : on la ramène à celle de la solution.
      const target = makeHiddenPieces(puzz)[placement.piece]!;
      for (let t = 0; t < placement.turns; t++) rotateHiddenCells(target);
      while (JSON.stringify(piece.cells) !== JSON.stringify(target.cells)) rotateHiddenCells(piece);
      board.lift(piece);
      const left = 53 + placement.ox * c;
      const top = 50 + placement.oy * c;
      board.moveTo(piece, left + 9, top - 12); // à quelques pixels près
      const outcome = board.drop(piece);
      expect(outcome.placed, `pièce ${placement.piece}`).toBe(true);
      expect(hiddenBounds(piece, c).left).toBe(left);
      expect(hiddenBounds(piece, c).top).toBe(top);
      expect(outcome.complete).toBe(index === solution.length - 1);
    });
    expect(board.complete).toBe(true);
  });

  it("deux pièces ne se chevauchent pas : la seconde reste libre, un contact par le bord est permis", () => {
    const puzz = parseHiddenPuzz(mohawk.get("PUZZ", 1000));
    const board = new HiddenBoard(0, puzz);
    park(board);
    const [a, b] = [board.pieces[0]!, board.pieces[1]!]; // deux monominos
    board.lift(a);
    board.moveTo(a, 53, 50);
    expect(board.drop(a).placed).toBe(true);
    board.lift(b);
    board.moveTo(b, 58, 55); // même case -> chevauchement
    expect(board.drop(b).placed).toBe(false);
    board.lift(b);
    board.moveTo(b, 53 + 60 + 5, 50 + 3); // case voisine : contact par un bord
    expect(board.drop(b).placed).toBe(true);
    // reprendre la pièce posée la désaimante
    board.lift(a);
    expect(a.placed).toBe(false);
    expect(board.pieces[0]).toBe(a);
  });

  it("une pièce flottante qui tient sur la télé s'aimante quand on en prend une autre", () => {
    const puzz = parseHiddenPuzz(mohawk.get("PUZZ", 1000));
    const board = new HiddenBoard(0, puzz);
    park(board);
    const floating = board.pieces[2]!;
    floating.cx = 54 + 30 + 7;
    floating.cy = 51 + 30 + 9;
    expect(floating.placed).toBe(false);
    board.lift(board.pieces[0]!);
    expect(floating.placed).toBe(true);
    expect(hiddenBounds(floating, 60).left).toBe(53);
    expect(hiddenBounds(floating, 60).top).toBe(50);
  });

  it("rotateLast : sans tenir la pièce, elle est reprise, tournée, redéposée (et alignée si elle tient)", () => {
    const puzz = parseHiddenPuzz(mohawk.get("PUZZ", 1000));
    const board = new HiddenBoard(0, puzz);
    park(board);
    const bar = board.pieces[7]!; // I de 3 vertical
    board.lift(bar);
    board.moveTo(bar, 113, 50); // colonne 1 : une fois couchée (3×1), la barre tient encore dans la télé
    expect(board.drop(bar).placed).toBe(true);
    expect([bar.w, bar.h]).toEqual([1, 3]);
    const outcome = board.rotateLast(false);
    expect([bar.w, bar.h]).toEqual([3, 1]);
    expect(outcome?.placed).toBe(true);
    expect([hiddenBounds(bar, 60).left, hiddenBounds(bar, 60).top]).toEqual([53, 110]);
    expect(board.rotateLast(true)).toBeNull(); // tenue : pas de dépose
    expect([bar.w, bar.h]).toEqual([1, 3]);
  });

  it("attachBoard : cliquer-poser sur le PointerService prend, suit et pose une pièce", () => {
    const puzz = parseHiddenPuzz(mohawk.get("PUZZ", 1000));
    const board = new HiddenBoard(0, puzz);
    park(board);
    const piece = board.pieces[0]!; // monomino
    piece.cx = 400;
    piece.cy = 200;
    const pointer = new PointerService({ mode: () => "clickAndStick" });
    const log: string[] = [];
    attachBoard(pointer, board, { picked: () => log.push("pick"), moved: () => log.push("move"), dropped: (_p, o) => log.push(`drop:${o.placed}`) });
    expect(pointer.handleButton({ button: "left", down: true, x: 200, y: 100, ctrl: false, shift: false, alt: false })).toBe(false); // vide
    expect(pointer.handleButton({ button: "left", down: true, x: 401, y: 201, ctrl: false, shift: false, alt: false })).toBe(true);
    expect(board.pieces[0]).toBe(piece);
    const input = new Input();
    input.moveMouse(54 + 30, 51 + 30);
    pointer.tick(input);
    expect(pointer.handleButton({ button: "left", down: true, x: 84, y: 81, ctrl: false, shift: false, alt: false })).toBe(true);
    expect(piece.placed).toBe(true);
    expect(log).toEqual(["pick", "move", "drop:true"]);
  });
});

// =====================================================================================================================================
// Patterns
// =====================================================================================================================================

describe("Patterns : règles", () => {
  const piece = (over: Partial<PatternsPiece>): PatternsPiece => ({ id: 0, placed: false, rot: 0, col: -1, row: -1, w: 1, h: 2, cx: 198, cy: 196, ...over });

  it("pieceRect : centre (198, 196), 1×2 -> (168, 136, 229, 257) ; 61×121 vertical, 121×61 horizontal", () => {
    expect(pieceRect(198, 196, 1, 2)).toEqual({ left: 168, top: 136, right: 229, bottom: 257 });
    const h = pieceRect(300, 200, 2, 1);
    expect([h.right - h.left, h.bottom - h.top]).toEqual([121, 61]);
  });

  it("trySnap : l'exemple de la fiche -> centre (228, 196), colonne 2, ligne 1", () => {
    expect(trySnap(piece({}), [piece({})])).toEqual({ cx: 228, cy: 196, col: 2, row: 1 });
  });

  it("trySnap : centre (138, 136) vertical -> décalage +30, colonne 1", () => {
    const snap = trySnap(piece({ cx: 138, cy: 136 }), [piece({})]);
    expect(snap).toMatchObject({ cx: 168, col: 1 });
    expect(patternsRect(piece({ cx: 138, cy: 136 })).left).toBe(108);
    expect(108 + 30).toBe(138); // gauche' = 138 = 78 + 60
  });

  it("trySnap : coin hors de (58, 56, 338, 336) -> null ; déjà posée -> null", () => {
    expect(trySnap(piece({ cx: 40, cy: 196 }), [piece({})])).toBeNull();
    expect(trySnap(piece({ cx: 330, cy: 196 }), [piece({})])).toBeNull();
    expect(trySnap(piece({ placed: true }), [piece({})])).toBeNull();
  });

  it("trySnap : collision à ≥ 1 px (rectangles rétrécis de 1 px) -> null ; contact exact par un bord -> permis", () => {
    const held = piece({ id: 0, cx: 198, cy: 196 }); // aimantée en x : 228 (colonne 2)
    const top = held;
    // voisine exactement contre la colonne 2 : rectangle de 61 px dont le bord droit touche le bord gauche de la pièce aimantée (228−30 = 198)
    const touching = piece({ id: 1, cx: 228 - 60, cy: 196, placed: true, col: 1, row: 1 });
    expect(trySnap(held, [top, touching])).not.toBeNull();
    const overlapping = piece({ id: 2, cx: 228 - 58, cy: 196, placed: true });
    expect(trySnap(held, [top, overlapping])).toBeNull();
    // une pièce libre compte aussi comme obstacle ; le rang 0 n'est jamais testé
    expect(trySnap(held, [overlapping, top])).not.toBeNull(); // `overlapping` est ici le rang 0
  });

  it("pushOutOfToolbar : bas 380 / gauche 300 -> haut de 26 ; gauche 340 -> droite de 11", () => {
    // pièce horizontale 121×61 : gauche 300, bas 380
    const a = { left: 300, top: 319, right: 421, bottom: 380 };
    expect(pushOutOfToolbar(a)).toEqual({ dx: 0, dy: -26 });
    const b = { left: 340, top: 319, right: 461, bottom: 380 };
    expect(pushOutOfToolbar(b)).toEqual({ dx: 11, dy: 0 });
    expect(pushOutOfToolbar({ left: 340, top: 200, right: 400, bottom: 300 })).toEqual({ dx: 0, dy: 0 });
    // égalité : vers le haut
    expect(pushOutOfToolbar({ left: 340, top: 300, right: 400, bottom: 365 })).toEqual({ dx: 0, dy: -11 });
  });

  it("rotation : 4 quarts de tour ramènent l'état, w/h échangés à chaque fois, rot modulo 4", () => {
    const p = piece({});
    const seen: number[][] = [];
    for (let i = 0; i < 4; i++) {
      rotatePatternsPiece(p);
      seen.push([p.rot, p.w, p.h]);
    }
    expect(seen).toEqual([[1, 2, 1], [2, 1, 2], [3, 2, 1], [0, 1, 2]]);
  });

  it("mélange : permutation des 8 pièces, centres des piles, rot ∈ {orient, orient + 2}", () => {
    const puzzle = { orient: [0, 0, 1, 1, 1, 1, 0, 0], col: [], row: [] };
    for (const seed of [0, 1, 2, 3, 4, 99]) {
      const pieces = dealPatterns(puzzle, new MsvcRandom(seed));
      expect(pieces.map((p) => p.id).sort()).toEqual(range(8));
      pieces.forEach((p, s) => {
        expect([p.cx, p.cy]).toEqual([513 - 29 * (s % 4), [315, 156][Math.floor(s / 4)]! - 17 * (s % 4)]);
        expect([p.w, p.h, p.placed, p.col, p.row]).toEqual([1, 2, false, -1, -1]);
        expect([puzzle.orient[p.id], (puzzle.orient[p.id]! + 2) % 4]).toContain(p.rot);
      });
    }
  });

  it("mélange : consomme 8 tirages rand1(8) puis un rand1(2) par pièce (du slot 7 au slot 0), non uniforme", () => {
    const rng = new MsvcRandom(5);
    const mirror = new MsvcRandom(5);
    const a = range(8);
    for (let i = 0; i < 8; i++) {
      const j = mirror.rand1(8);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    const pieces = dealPatterns({ orient: [0, 0, 0, 0, 0, 0, 0, 0], col: [], row: [] }, rng);
    expect(pieces.map((p) => p.id)).toEqual(a);
    for (let s = 7; s >= 0; s--) expect(pieces[s]!.rot).toBe(mirror.rand1(2) !== 0 ? 2 : 0);
    expect(rng.current).toBe(mirror.current);
  });

  it("victoire : tout posé à la bonne case avec rot = 0 ; faux si rot ≠ 0 ou une pièce libre", () => {
    const puzzle = { orient: [0, 0, 0, 0, 0, 0, 0, 0], col: [0, 0, 1, 1, 2, 2, 3, 3], row: [0, 2, 0, 2, 0, 2, 0, 2] };
    const solved = puzzle.col.map((col, id) => piece({ id, placed: true, col, row: puzzle.row[id]! }));
    expect(patternsSolved(solved, puzzle)).toBe(true);
    expect(patternsSolved(solved.map((p, i) => (i === 3 ? { ...p, rot: 2 } : p)), puzzle)).toBe(false);
    expect(patternsSolved(solved.map((p, i) => (i === 3 ? { ...p, placed: false } : p)), puzzle)).toBe(false);
    expect(patternsSolved(solved.map((p, i) => (i === 3 ? { ...p, col: 0 } : p)), puzzle)).toBe(false);
  });
});

real("Patterns : plateau complet sur PATTERNS.DAT", () => {
  const mohawk = MohawkArchive.parse(readOriginal("PATTERNS.DAT"));

  it("6650 : mélange, rotation jusqu'à rot 0, pose de chaque pièce à quelques pixels -> victoire à la dernière", () => {
    const puzzle = parsePatternsPuzz(mohawk.get("PUZZ", 6650));
    const board = new PatternsBoard(puzzle);
    board.deal(new MsvcRandom(11));
    expect(board.solved).toBe(false);
    puzzle.col.forEach((col, id) => {
      const piece = board.pieces.find((p) => p.id === id)!;
      board.lift(piece);
      while (piece.rot !== 0) rotatePatternsPiece(piece);
      expect([piece.w, piece.h]).toEqual(puzzle.orient[id] === 1 ? [2, 1] : [1, 2]);
      const left = PATTERNS.grid.x + col * 60;
      const top = PATTERNS.grid.y + puzzle.row[id]! * 60;
      board.moveTo(piece, left + 13, top - 11);
      const outcome = board.drop(piece);
      expect(outcome.placed, `pièce ${id}`).toBe(true);
      expect([piece.col, piece.row]).toEqual([col, puzzle.row[id]]);
      expect(outcome.complete).toBe(id === 7);
    });
    expect(board.solved).toBe(true);
  });

  it("une pièce déposée sur le cartouche est repoussée, hors grille elle reste libre", () => {
    const puzzle = parsePatternsPuzz(mohawk.get("PUZZ", 6600));
    const board = new PatternsBoard(puzzle);
    board.deal(new MsvcRandom(2));
    const piece = board.pieces[0]!;
    board.lift(piece);
    piece.rot = 0;
    piece.w = 1;
    piece.h = 2;
    board.moveTo(piece, 300, 330); // bas 451 > 432 : coupe le cartouche (y ≥ 354) ; gauche 300 -> dx = 51, dy = 97 -> droite de 51
    const rect0 = patternsRect(piece);
    board.drop(piece);
    expect(patternsRect(piece).left).toBe(rect0.left + (351 - rect0.left));
    expect(piece.placed).toBe(false);
    expect(edgesIntersect(patternsRect(piece), PATTERNS.toolbar)).toBe(false);
  });

  it("rotateLast : reprend la dernière pièce posée, la tourne et la redépose (désaimantée si elle ne tient plus)", () => {
    const puzzle = parsePatternsPuzz(mohawk.get("PUZZ", 6600));
    const board = new PatternsBoard(puzzle);
    board.deal(new MsvcRandom(2));
    const piece = board.pieces[0]!;
    board.lift(piece);
    while (piece.rot !== 0) rotatePatternsPiece(piece);
    board.moveTo(piece, 138, 136); // colonne 1, ligne 1
    expect(board.drop(piece).placed).toBe(true);
    const outcome = board.rotateLast(false);
    expect(piece.rot).toBe(1);
    expect([piece.w, piece.h]).toEqual([2, 1]);
    // Le centre est conservé : la pièce couchée est à cheval sur deux colonnes, elle est ré-aimantée sur la case la plus proche.
    expect(outcome?.placed).toBe(true);
    expect(piece.col).toBeGreaterThanOrEqual(0);
  });
});

// =====================================================================================================================================
// Sticklers
// =====================================================================================================================================

describe("Sticklers : règles de collage", () => {
  const sizer: ShapeSizer = () => ({ w: 40, h: 20 });
  const piece = (over: Partial<StickPiece> = {}): StickPiece => ({
    id: 0,
    orientations: 4,
    rotation: 0,
    placed: false,
    shapeBase: 1,
    targetCx: 100,
    targetCy: 100,
    cx: 100,
    cy: 100,
    w: 40,
    h: 20,
    ...over,
  });

  it("snapTarget : tolérance 10 incluse en x et y, 11 refusé", () => {
    expect(snapTarget(piece({ cx: 110, cy: 110 }))).toEqual({ cx: 100, cy: 100 });
    expect(snapTarget(piece({ cx: 90, cy: 90 }))).toEqual({ cx: 100, cy: 100 });
    expect(snapTarget(piece({ cx: 111, cy: 100 }))).toBeNull();
    expect(snapTarget(piece({ cx: 100, cy: 89 }))).toBeNull();
  });

  it("snapTarget : orientation ≠ 0, déjà collé, coins hors du chevalet élargi (17, 6, 313, 302) -> null", () => {
    expect(snapTarget(piece({ rotation: 1 }))).toBeNull();
    expect(snapTarget(piece({ placed: true }))).toBeNull();
    const near = piece({ targetCx: 30, targetCy: 100, cx: 30, cy: 100 }); // gauche 10 < 17
    expect(snapTarget(near)).toBeNull();
    const edge = piece({ targetCx: 37, targetCy: 100, cx: 37, cy: 100 }); // gauche 17 : dedans
    expect(snapTarget(edge)).toEqual({ cx: 37, cy: 100 });
    expect(snapTarget(piece({ targetCx: 295, cx: 295 }))).toBeNull(); // droite 315 >= 313
  });

  it("rotation : a = 4 : 0,1,2,3 ; a = 2 : 0,1,0 ; a = 1 : 0 ; la forme suit", () => {
    const sizes: ShapeSizer = (i) => (i % 2 === 0 ? { w: 40, h: 20 } : { w: 20, h: 40 });
    const p = piece({ shapeBase: 2 });
    const seen = range(5).map(() => {
      const r = [p.rotation, p.w, p.h];
      rotateStick(p, sizes);
      return r;
    });
    expect(seen.map((s) => s[0])).toEqual([0, 1, 2, 3, 0]);
    expect(seen.map((s) => s[1])).toEqual([40, 20, 40, 20, 40].map((v, i) => (i === 0 ? 40 : v)));
    const two = piece({ orientations: 2 });
    rotateStick(two, sizer);
    rotateStick(two, sizer);
    expect(two.rotation).toBe(0);
    const one = piece({ orientations: 1 });
    rotateStick(one, sizer);
    expect(one.rotation).toBe(0);
  });

  it("collage au lâcher : repoussé hors du bandeau des boutons, puis collé si à ≤ 10 px", () => {
    const board = new SticklersBoard(0, { count: 1, templateX: 40, templateY: 29, pieces: [{ orientations: 1, x: 80, y: 90 }] }, () => ({ w: 40, h: 20 }));
    const p = board.pieces[0]!;
    expect([p.targetCx, p.targetCy]).toEqual([100, 100]);
    board.lift(p);
    board.moveTo(p, 100 - 20 + 8, 100 - 10 - 7); // (+8, −7)
    const outcome = board.drop(p);
    expect(outcome).toEqual({ placed: true, complete: true });
    expect([p.cx, p.cy]).toEqual([100, 100]);
    // bandeau (37, 282, 293, 368) : un fragment lâché dessus est repoussé
    const q = new SticklersBoard(0, { count: 1, templateX: 40, templateY: 29, pieces: [{ orientations: 1, x: 80, y: 90 }] }, () => ({ w: 40, h: 20 })).pieces[0]!;
    q.cx = 280;
    q.cy = 290; // bbox (260, 280, 300, 300) ; dx = 293 − 260 = 33, dy = 300 − 282 = 18 -> haut
    const moved = pushOutOfBand(stickBounds(q), STICKLERS.buttons);
    expect(moved).toEqual({ dx: 0, dy: -18 });
  });
});

real("Sticklers : plateau sur STICKLER.DAT", () => {
  const archive = open("STICKLER.DAT");

  const sizerFor = (shplId: number): ShapeSizer => {
    const first = archive.shpl(shplId).firstShapeId;
    return (index) => {
      const shape = archive.shap(first + index);
      return { w: shape.width, h: shape.height };
    };
  };

  it("éparpillement : orientations valides, centres dans (295, 2, 575, 379), déterministe ; niveau rouge hors miniature", () => {
    for (const [level, k] of [[0, 0], [1, 4], [2, 8], [2, 3]] as const) {
      const id = puzzId(level, k);
      const puzz = parseSticklersPuzz(archive.mohawk.get("PUZZ", id));
      const sizeOf = sizerFor(id);
      const run = (seed: number) => {
        const board = new SticklersBoard(level, puzz, sizeOf);
        board.scatter(new MsvcRandom(seed));
        return board.pieces.map((p) => ({ ...p }));
      };
      const first = run(5);
      expect(run(5)).toEqual(first);
      expect(run(6)).not.toEqual(first);
      for (const p of first) {
        expect(p.rotation).toBeLessThan(p.orientations);
        expect(p.placed).toBe(false);
        const size = sizeOf(p.shapeBase + p.rotation);
        expect([p.w, p.h]).toEqual([size.w, size.h]);
        const b = stickBounds(p);
        expect(b.left).toBeGreaterThanOrEqual(STICKLERS.scatter.left);
        expect(b.top).toBeGreaterThanOrEqual(STICKLERS.scatter.top);
        if (level === 2) expect(edgesIntersect(b, STICKLERS.miniature), `puzzle ${id} fragment ${p.id}`).toBe(false);
      }
    }
  });

  it("2100 : cibles = coin + moitié de la forme d'orientation 0 ; poser chaque fragment à ≤ 10 px résout, 11 px refuse", () => {
    const id = puzzId(0, 0);
    const puzz = parseSticklersPuzz(archive.mohawk.get("PUZZ", id));
    const sizeOf = sizerFor(id);
    const board = new SticklersBoard(0, puzz, sizeOf);
    const first = sizeOf(1);
    expect(board.pieces[0]).toMatchObject({ targetCx: 49 + (first.w >> 1), targetCy: 41 + (first.h >> 1) });
    board.scatter(new MsvcRandom(9));
    // Un fragment hors tolérance ne se colle pas.
    const probe = board.pieces[0]!;
    board.lift(probe);
    while (probe.rotation !== 0) rotateStick(probe, sizeOf);
    board.moveTo(probe, probe.targetCx + 11 - (probe.w >> 1), probe.targetCy - (probe.h >> 1));
    expect(board.drop(probe).placed).toBe(false);
    puzz.pieces.forEach((_, id2) => {
      const p = board.pieces.find((q) => q.id === id2)!;
      board.lift(p);
      while (p.rotation !== 0) rotateStick(p, sizeOf);
      board.moveTo(p, p.targetCx + 10 - (p.w >> 1), p.targetCy - 10 - (p.h >> 1));
      expect(board.drop(p).placed, `fragment ${id2}`).toBe(true);
      expect([p.cx, p.cy]).toEqual([p.targetCx, p.targetCy]);
    });
    expect(board.solved).toBe(true);
  });

  it("Reset : réparpille et décolle tout", () => {
    const id = puzzId(1, 0);
    const puzz = parseSticklersPuzz(archive.mohawk.get("PUZZ", id));
    const board = new SticklersBoard(1, puzz, sizerFor(id));
    board.pieces.forEach((p) => (p.placed = true));
    expect(board.solved).toBe(true);
    board.scatter(new MsvcRandom(1));
    expect(board.solved).toBe(false);
  });
});

// =====================================================================================================================================
// Poly : configuration
// =====================================================================================================================================

real("Poly : les identifiants des configurations existent dans l'archive d'aide", () => {
  const archives = { "POLLY.DAT": open("POLLY.DAT"), "PATFILL.DAT": open("PATFILL.DAT"), "NIM.DAT": open("NIM.DAT") };

  it.each(Object.values(POLY_CONFIGS).map((config) => [config.id, config] as const))("%s : tous les SCR sont présents", (_id, config: PolyConfig) => {
    const archive = archives[config.archive];
    const ids = polyScriptIds(config);
    expect(ids.length).toBeGreaterThan(8);
    for (const id of ids) {
      expect(archive.has("\0SCR", id), `${config.archive} SCR ${id}`).toBe(true);
      expect(archive.has("SHPL", id), `${config.archive} SHPL ${id}`).toBe(true);
    }
  });

  it("les familles de POLLY.DAT n'ont pas d'id commun", () => {
    const seen = new Map<number, string>();
    for (const config of [HIDDEN_POLY, PATTERNS_POLY, STICKLERS_POLY, BOWLING_POLY]) {
      for (const id of polyScriptIds(config)) {
        expect(seen.get(id), `SCR ${id}`).toBeUndefined();
        seen.set(id, config.id);
      }
    }
  });

  it("Hidden : 12 répliques 27000…27550 ; Sticklers et Patterns : 13 ; décalage y 0 (zones déjà à bas = 432), 40 pour Rockets", () => {
    const polly = archives["POLLY.DAT"];
    expect(range(12).every((r) => polly.has("\0SCR", 27000 + 50 * r))).toBe(true);
    expect(polly.has("\0SCR", 27600)).toBe(false);
    expect(range(13).every((r) => polly.has("\0SCR", 32000 + 50 * r) && polly.has("\0SCR", 37000 + 50 * r))).toBe(true);
    for (const config of [HIDDEN_POLY, PATTERNS_POLY, STICKLERS_POLY]) expect(polly.scr(config.introLong).clip.bottom).toBe(432);
    expect(archives["NIM.DAT"].scr(1100).clip.bottom + ROCKETS_POLY.offsetY).toBe(431);
    expect(HIDDEN_POLY.offsetY).toBe(0);
  });

  it("tables : exceptions d'encadrement des fiches", () => {
    expect(STICKLERS_POLY.topics.exit).toMatchObject({ before: false, after: false });
    expect(STICKLERS_POLY.topics.piece).toMatchObject({ before: false });
    expect(STICKLERS_POLY.topics.help).toMatchObject({ after: false });
    expect(PATTERN_WINDOWS_POLY.topics.help).toMatchObject({ before: false });
    expect(PATTERN_WINDOWS_POLY.topics.exit).toMatchObject({ before: false });
    expect(PATTERN_WINDOWS_POLY.before).toBe(2300);
  });
});

// =====================================================================================================================================
// Poly : machine d'états
// =====================================================================================================================================

class FakeAnimation implements PolyAnimation {
  done = false;
  interrupted = false;
  interrupt(): void {
    if (this.done) return;
    this.done = true;
    this.interrupted = true;
  }
  finish(): void {
    this.done = true;
  }
}

class FakePorts implements PolyPorts {
  readonly plays: { scr: number; interruptible: boolean; animation: FakeAnimation }[] = [];
  begun = 0;
  ended = 0;
  hover: boolean[] = [];
  play(scr: number, options: { interruptible: boolean }): PolyAnimation {
    const animation = new FakeAnimation();
    this.plays.push({ scr, interruptible: options.interruptible, animation });
    return animation;
  }
  begin(): void {
    this.begun++;
  }
  end(): void {
    this.ended++;
  }
  setHelpHover(on: boolean): void {
    this.hover.push(on);
  }
  get ids(): number[] {
    return this.plays.map((p) => p.scr);
  }
  get last(): FakeAnimation {
    return this.plays[this.plays.length - 1]!.animation;
  }
}

function setupPoly(config: PolyConfig, options: { seen?: boolean; rng?: MsvcRandom } = {}) {
  const ports = new FakePorts();
  const flag = { value: options.seen ?? false };
  const events = { firstIntro: 0, closed: 0 };
  const poly = new PolyHelper(config, {
    ports,
    rng: options.rng ?? new MsvcRandom(1),
    introFlag: { get: () => flag.value, set: (v) => (flag.value = v) },
    onFirstIntro: () => events.firstIntro++,
    onClosed: () => events.closed++,
  });
  /** Termine l'animation en cours et passe un tick. */
  const next = () => {
    ports.last.finish();
    poly.tick();
  };
  /** Mène toute la séquence en cours jusqu'à l'écoute (ou la fermeture). */
  const drain = () => {
    for (let guard = 0; guard < 20 && poly.currentScr !== null; guard++) next();
  };
  return { ports, flag, events, poly, next, drain };
}

describe("PolyHelper : ouverture et présentation", () => {
  it("première fois : arrivée non interruptible, puis la grande présentation (Hidden 25000 puis 25100), drapeau posé tout de suite", () => {
    const { ports, flag, events, poly, next } = setupPoly(HIDDEN_POLY);
    poly.open();
    expect(poly.phase).toBe("arriving");
    expect(poly.active).toBe(true);
    expect(ports.begun).toBe(1);
    expect(ports.plays[0]).toMatchObject({ scr: 25000, interruptible: false });
    expect(flag.value).toBe(true);
    expect(poly.firstIntroThisVisit).toBe(true);
    expect(events.firstIntro).toBe(1);
    next();
    expect(poly.phase).toBe("intro");
    expect(ports.plays[1]).toMatchObject({ scr: 25100, interruptible: true });
    next();
    expect(poly.phase).toBe("listening");
    expect(poly.idleArmed).toBe(false); // grande présentation : pas de minuterie
  });

  it("déjà vue : présentation courte (Patterns 35250 ; Sticklers 30250) et minuterie armée", () => {
    for (const [config, arrival, short] of [[PATTERNS_POLY, 35000, 35250], [STICKLERS_POLY, 30000, 30250]] as const) {
      const { ports, events, poly, next } = setupPoly(config, { seen: true });
      poly.open();
      next();
      expect(ports.ids).toEqual([arrival, short]);
      next();
      expect(poly.phase).toBe("listening");
      expect(poly.idleArmed).toBe(true);
      expect(events.firstIntro).toBe(0);
      expect(poly.firstIntroThisVisit).toBe(false);
    }
  });

  it("open est sans effet si l'aide est déjà ouverte", () => {
    const { ports, poly } = setupPoly(HIDDEN_POLY);
    poly.open();
    poly.open();
    expect(ports.plays).toHaveLength(1);
  });

  it("un clic pendant l'arrivée est avalé sans l'interrompre ; pendant la présentation il l'interrompt", () => {
    const { ports, poly, next } = setupPoly(HIDDEN_POLY, { seen: true });
    poly.open();
    expect(poly.click("piece")).toBe(true);
    expect(ports.plays[0]!.animation.interrupted).toBe(false);
    next();
    expect(poly.click("piece")).toBe(true); // coupe la présentation (le clic est consommé)
    expect(ports.last.interrupted).toBe(true);
    poly.tick();
    expect(poly.phase).toBe("listening");
    expect(ports.ids).toEqual([25000, 25250]); // le clic qui interrompt ne lance pas d'explication
  });
});

describe("PolyHelper : minuterie d'inactivité", () => {
  it("300 ticks sans survol ni clic après la courte -> la longue est rejouée une seule fois", () => {
    const { ports, poly, next } = setupPoly(HIDDEN_POLY, { seen: true });
    poly.open();
    next();
    next();
    for (let i = 0; i < 299; i++) poly.tick();
    expect(ports.ids).toEqual([25000, 25250]);
    poly.tick();
    expect(ports.ids).toEqual([25000, 25250, 25100]);
    expect(poly.phase).toBe("intro");
    next();
    expect(poly.phase).toBe("listening");
    expect(poly.idleArmed).toBe(false);
    for (let i = 0; i < 400; i++) poly.tick();
    expect(ports.ids).toHaveLength(3);
  });

  it("un survol d'un élément ou un clic désarme la minuterie", () => {
    const a = setupPoly(STICKLERS_POLY, { seen: true });
    a.poly.open();
    a.next();
    a.next();
    for (let i = 0; i < 100; i++) a.poly.tick();
    a.poly.hover("reset");
    expect(a.poly.idleArmed).toBe(false);
    for (let i = 0; i < 500; i++) a.poly.tick();
    expect(a.ports.ids).toEqual([30000, 30250]);
    const b = setupPoly(STICKLERS_POLY, { seen: true });
    b.poly.open();
    b.next();
    b.next();
    b.poly.hover(POLY_ZONE); // Poly elle-même ne montre pas le « ? » et ne désarme pas
    expect(b.poly.idleArmed).toBe(true);
    b.poly.click("reset");
    expect(b.poly.idleArmed).toBe(false);
  });

  it("curseur « ? » au survol des éléments seulement, pas de Poly ni hors de l'aide", () => {
    const { ports, poly, next } = setupPoly(HIDDEN_POLY, { seen: true });
    poly.hover("reset");
    expect(ports.hover).toEqual([]);
    poly.open();
    next();
    next();
    poly.hover("reset");
    poly.hover("reset");
    poly.hover(POLY_ZONE);
    poly.hover(null);
    expect(ports.hover).toEqual([true, false]);
  });
});

describe("PolyHelper : explications", () => {
  function listening(config: PolyConfig) {
    const s = setupPoly(config, { seen: true });
    s.poly.open();
    s.next();
    s.next();
    s.ports.plays.length = 0;
    return s;
  }

  it("Sticklers : avant (30150), explication, après (30200), sauf exceptions", () => {
    const expected: [string, number[]][] = [
      ["level", [30150, 30650, 30200]],
      ["reset", [30150, 30750, 30200]],
      ["rotate", [30150, 30800, 30200]],
      ["help", [30150, 30600]],
      ["piece", [30900, 30200]],
      ["exit", [30500]],
    ];
    for (const [zone, ids] of expected) {
      const { ports, poly, drain } = listening(STICKLERS_POLY);
      expect(poly.click(zone)).toBe(true);
      expect(poly.phase).toBe("explaining");
      drain();
      expect(ports.ids, zone).toEqual(ids);
      expect(poly.phase).toBe("listening");
    }
  });

  it("la télé / le chevalet : 25850 si le menu est affiché, sinon 25650 (Hidden) ; 35850 / 35700 (Patterns) ; 30850 / 30550 (Sticklers)", () => {
    const cases: [PolyConfig, number, number][] = [[HIDDEN_POLY, 25850, 25650], [PATTERNS_POLY, 35850, 35700], [STICKLERS_POLY, 30850, 30550]];
    for (const [config, menu, play] of cases) {
      for (const [menuShown, id] of [[true, menu], [false, play]] as const) {
        const { ports, poly, drain } = listening(config);
        poly.click("screen", { menuShown });
        drain();
        expect(ports.ids[1]).toBe(id);
      }
    }
  });

  it("Hidden et Patterns : pièces 25700 / 35650, niveaux 25600 / 35600, Help, Reset, Rotate, Exit", () => {
    for (const [config, base, piece] of [[HIDDEN_POLY, 25000, 25700], [PATTERNS_POLY, 35000, 35650]] as const) {
      const got: Record<string, number> = {};
      for (const zone of ["piece", "level", "help", "reset", "rotate", "exit"]) {
        const { ports, poly, drain } = listening(config);
        poly.click(zone);
        drain();
        got[zone] = ports.ids.find((id) => id !== base + 150 && id !== base + 200)!;
      }
      expect(got).toEqual({ piece, level: base + 600, help: base + 550, reset: base + 750, rotate: base + 800, exit: base + 500 });
    }
  });

  it("un clic qui interrompt une explication abandonne la suite", () => {
    const { ports, poly } = listening(STICKLERS_POLY);
    poly.click("level");
    expect(ports.ids).toEqual([30150]);
    poly.click("level"); // coupe la couche « avant »
    poly.tick();
    expect(ports.ids).toEqual([30150]);
    expect(poly.phase).toBe("listening");
  });

  it("zone sans explication : refusée ; aide fermée : refusée", () => {
    const { poly } = listening(HIDDEN_POLY);
    expect(poly.click("nimporte-quoi")).toBe(false);
    const closed = setupPoly(HIDDEN_POLY);
    expect(closed.poly.click("reset")).toBe(false);
  });

  it("Rockets : « puis » seulement si le précédent est allé au bout ; pas de couche avant / après", () => {
    const { ports, poly, next } = setupPoly(ROCKETS_POLY, { seen: true });
    poly.open({ polyPresent: true });
    expect(ports.ids).toEqual([4500]); // pas d'arrivée : Poly est déjà là
    next();
    ports.plays.length = 0;
    poly.click("help");
    next();
    next();
    expect(ports.ids).toEqual([4600, 4700]);
    ports.plays.length = 0;
    poly.click("pad");
    poly.click("pad"); // coupe 3400
    poly.tick();
    expect(ports.ids).toEqual([3400]);
  });

  it("Rockets : arrivée 2000 si Poly est absente ; 1100 la première fois", () => {
    const { ports, poly } = setupPoly(ROCKETS_POLY);
    poly.open({});
    expect(ports.ids).toEqual([2000]);
    expect(ROCKETS_POLY.introLong).toBe(1100);
  });
});

describe("PolyHelper : sortie", () => {
  it("clic sur Poly : réplique 27000 + 50·rand(12) puis départ 25050 (non interruptible) ; l'aide se referme", () => {
    const rng = new MsvcRandom(4);
    const mirror = new MsvcRandom(4);
    const { ports, poly, events, next } = setupPoly(HIDDEN_POLY, { seen: true, rng });
    poly.open();
    next();
    next();
    ports.plays.length = 0;
    const r = mirror.rand1(12);
    expect(poly.click(POLY_ZONE)).toBe(true);
    expect(poly.phase).toBe("leaving");
    expect(ports.plays[0]).toMatchObject({ scr: 27000 + 50 * r, interruptible: true });
    next();
    expect(ports.plays[1]).toMatchObject({ scr: 25050, interruptible: false });
    expect(events.closed).toBe(0);
    next();
    expect(poly.phase).toBe("closed");
    expect(poly.active).toBe(false);
    expect(events.closed).toBe(1);
    expect(ports.ended).toBe(1);
  });

  it("une réplique interrompue n'empêche pas Poly de partir", () => {
    const { ports, poly, events, next } = setupPoly(STICKLERS_POLY, { seen: true });
    poly.open();
    next();
    next();
    poly.click(POLY_ZONE);
    poly.click(POLY_ZONE); // coupe la réplique
    poly.tick();
    expect(ports.last.interrupted).toBe(false);
    expect(ports.ids[ports.ids.length - 1]).toBe(30050);
    next();
    expect(poly.phase).toBe("closed");
    expect(events.closed).toBe(1);
  });

  it("répliques : Sticklers 32000 + 50r (13), Patterns 37000 + 50r (13)", () => {
    for (const [config, base] of [[STICKLERS_POLY, 32000], [PATTERNS_POLY, 37000]] as const) {
      const seen = new Set<number>();
      for (let seed = 0; seed < 200; seed++) {
        const { ports, poly, next } = setupPoly(config, { seen: true, rng: new MsvcRandom(seed * 40503 + 17) });
        poly.open();
        next();
        next();
        ports.plays.length = 0;
        poly.click(POLY_ZONE);
        const id = ports.ids[0]!;
        expect((id - base) % 50).toBe(0);
        expect(id).toBeGreaterThanOrEqual(base);
        expect(id).toBeLessThanOrEqual(base + 600);
        seen.add(id);
      }
      expect(seen.size).toBeGreaterThan(8);
    }
  });

  it("Pattern Windows : répliques sans remise (11) ; compliment 1800 si image variée et rand(100) < 20 ; départ 1300", () => {
    const { ports, poly, next } = setupPoly(PATTERN_WINDOWS_POLY, { seen: true, rng: new MsvcRandom(3) });
    const tips: number[] = [];
    for (let i = 0; i < 11; i++) {
      poly.open();
      while (poly.phase === "arriving" || poly.phase === "intro") next();
      ports.plays.length = 0;
      poly.click(POLY_ZONE);
      tips.push(ports.ids[0]!);
      next();
      expect(ports.ids[1]).toBe(1300);
      next();
      expect(poly.phase).toBe("closed");
    }
    expect([...tips].sort((a, b) => a - b)).toEqual([1900, 2500, 2600, 2700, 2800, 2900, 3000, 3100, 3200, 3300, 3400]);
    // compliment
    const forced = { range: () => 5, rand1: () => 0 } as unknown as MsvcRandom;
    const c = setupPoly(PATTERN_WINDOWS_POLY, { seen: true, rng: forced });
    c.poly.open();
    while (c.poly.phase === "arriving" || c.poly.phase === "intro") c.next();
    c.ports.plays.length = 0;
    c.poly.click(POLY_ZONE, { variedImage: true });
    expect(c.ports.ids).toEqual([1800]);
    const d = setupPoly(PATTERN_WINDOWS_POLY, { seen: true, rng: forced });
    d.poly.open();
    while (d.poly.phase === "arriving" || d.poly.phase === "intro") d.next();
    d.ports.plays.length = 0;
    d.poly.click(POLY_ZONE, { variedImage: false });
    expect(d.ports.ids[0]).not.toBe(1800);
  });

  it("Rockets : mode Poly 4300 puis 4400 (l'aide se ferme) ; mode ami : au revoir {2200, 2300, 2400} puis 9700", () => {
    const poly1 = setupPoly(ROCKETS_POLY, { seen: true });
    poly1.poly.open({ polyPresent: true });
    poly1.next();
    poly1.ports.plays.length = 0;
    poly1.poly.click(POLY_ZONE, { friendMode: false });
    poly1.next();
    poly1.next();
    expect(poly1.ports.ids).toEqual([4300, 4400]);
    expect(poly1.poly.phase).toBe("closed");
    const friend = setupPoly(ROCKETS_POLY, { seen: true });
    friend.poly.open({});
    friend.next();
    friend.next();
    friend.ports.plays.length = 0;
    friend.poly.click(POLY_ZONE, { friendMode: true });
    friend.next();
    friend.next();
    expect([2200, 2300, 2400]).toContain(friend.ports.ids[0]);
    expect(friend.ports.ids[1]).toBe(9700);
  });

  it("abort : coupe l'animation et ferme sans rappel", () => {
    const { ports, poly, events } = setupPoly(HIDDEN_POLY);
    poly.open();
    poly.abort();
    expect(poly.phase).toBe("closed");
    expect(ports.ended).toBe(1);
    expect(events.closed).toBe(0);
    expect(ports.plays[0]!.animation.done).toBe(true);
  });
});

describe("rosterIntroFlag", () => {
  it("lit et écrit la variable du joueur courant", () => {
    const state = new RosterState(new RosterStore(new MemoryStorage()));
    const flag = rosterIntroFlag(state, "hiddenPolyIntroSeen");
    expect(flag.get()).toBe(false); // personne de connecté
    flag.set(true);
    expect(flag.get()).toBe(false);
    const added = state.roster.addPlayer("Zoe");
    if (!added.ok) throw new Error("addPlayer");
    state.currentPlayerId = added.id;
    expect(flag.get()).toBe(false);
    flag.set(true);
    expect(flag.get()).toBe(true);
    expect(state.roster.getVar(added.id, "hiddenPolyIntroSeen")).toBe(1);
    expect(rosterIntroFlag(state, "patternsPolyIntroSeen").get()).toBe(false);
  });
});

// =====================================================================================================================================
// Poly : intégration avec le vrai lecteur de scripts et les vraies données
// =====================================================================================================================================

real("Poly : ports réels (ScrPlayer, POLLY.DAT)", () => {
  function setup() {
    const archive = open("POLLY.DAT");
    const host = new TestHost();
    host.audio.unlock();
    const sound = new SoundService(host.audio);
    const surface = new Surface();
    surface.fill(7);
    const dirty = { count: 0 };
    const scr = new ScrPlayer({ surface, sound, onDirty: () => dirty.count++ });
    const ports = createScrPolyPorts({ config: HIDDEN_POLY, scr, archive, surface, onDirty: () => dirty.count++ });
    const poly = new PolyHelper(HIDDEN_POLY, { ports, rng: new MsvcRandom(1), introFlag: { get: () => false, set: () => {} } });
    const input = new Input();
    const tick = () => {
      host.time += 17;
      input.beginTick();
      scr.tick(input);
      poly.tick();
    };
    const click = () => {
      input.moveMouse(300, 300);
      input.mouseDown("left");
      input.mouseUp("left");
    };
    return { archive, host, sound, surface, scr, poly, input, tick, click };
  }

  it("arrivée 25000 (147 ticks, non interruptible) puis 25100 ; un clic coupe la grande présentation", () => {
    const { archive, scr, poly, tick, click, surface } = setup();
    const before = surface.pixels.slice();
    poly.open();
    expect(poly.phase).toBe("arriving");
    expect(scr.blocking).toBe(true);
    click();
    tick(); // le clic ne coupe pas l'arrivée
    expect(poly.phase).toBe("arriving");
    for (let i = 0; i < 200 && poly.phase === "arriving"; i++) tick();
    expect(poly.phase).toBe("intro");
    expect(poly.currentScr).toBe(25100);
    expect(archive.scr(25000).duration).toBeLessThan(200);
    for (let i = 0; i < 100; i++) tick();
    expect(poly.phase).toBe("intro");
    click();
    tick();
    tick();
    expect(poly.phase).toBe("listening");
    expect(scr.blocking).toBe(false);
    expect(surface.pixels).not.toEqual(before); // Poly est dessinée dans la zone d'aide
  });

  it("chaque animation rétablit le fond d'avant l'arrivée : la dernière image de la précédente ne reste pas derrière (pas deux Poly)", () => {
    const { scr, poly, tick, click, surface } = setup();
    const [left, top, right, bottom] = HIDDEN_POLY.backgroundZone!;
    const backgrounds = new Map<number, Surface | undefined>();
    const start = scr.start.bind(scr);
    scr.start = (archive, id, options) => {
      backgrounds.set(id, options?.background);
      return start(archive, id, options);
    };
    poly.open();
    for (let i = 0; i < 200 && poly.phase === "arriving"; i++) tick();
    // L'arrivée a laissé Poly dans la zone ; la présentation, elle, part d'un fond sans Poly.
    let drawn = 0;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) if (surface.pixels[y * surface.width + x] !== 7) drawn++;
    expect(drawn).toBeGreaterThan(2000);
    const background = backgrounds.get(25100);
    expect(background).toBeDefined();
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) expect(background!.pixels[y * surface.width + x]).toBe(7);
    click();
    tick();
    tick();
    expect(poly.phase).toBe("listening");
  });

  it("à l'ouverture, ses couleurs (SHPL 25000, entrées 226–241) sont chargées : elle n'emprunte pas les gris de la scène", () => {
    const { archive, scr, surface } = setup();
    const palette = new Palette();
    for (let i = 226; i < 242; i++) palette.setColor(i, 90, 90, 90);
    const ports = createScrPolyPorts({ config: HIDDEN_POLY, scr, archive, palette, surface });
    const expected = new Palette();
    expected.loadShpl(archive.shpl(25000));
    ports.begin?.();
    expect(palette.snapshot(226, 16)).toEqual(expected.snapshot(226, 16));
    expect(palette.snapshot(226, 16)).not.toEqual(new Uint8Array(48).fill(90));
  });

  it("sa voix est jouée sur le canal voix pendant la présentation", () => {
    const { host, sound, poly, tick } = setup();
    poly.open();
    for (let i = 0; i < 400; i++) tick();
    expect(host.audio.waves.length).toBeGreaterThan(0);
    expect(sound.voicePlaying).toBe(true);
  });

  it("explication complète jusqu'au bout puis sortie : le fond sous Poly est rétabli", () => {
    const { poly, tick, click, surface, scr } = setup();
    surface.fill(7);
    poly.open();
    for (let i = 0; i < 200 && poly.phase === "arriving"; i++) tick();
    click();
    tick();
    tick();
    expect(poly.phase).toBe("listening");
    expect(poly.click("exit")).toBe(true); // 25500, sans couche avant ni après
    expect(poly.currentScr).toBe(25500);
    for (let i = 0; i < 2000 && poly.currentScr !== null; i++) tick();
    expect(poly.phase).toBe("listening");
    poly.click(POLY_ZONE);
    for (let i = 0; i < 3000 && poly.active; i++) tick();
    expect(poly.active).toBe(false);
    expect(scr.running).toHaveLength(0);
    expect(surface.pixels.every((v) => v === 7)).toBe(true);
  });
});
