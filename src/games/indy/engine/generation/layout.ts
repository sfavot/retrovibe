import type { Rng } from "../rng";
import { WORLD_SIZE, WorldSize } from "../world";

/**
 * Disposition de la carte 10×10 : où sont la ville, les barrages, les îles et les puzzles.
 * Portage de l'algorithme de génération reconstitué par WebFun (MIT) depuis le moteur original.
 */

export enum Cell {
  BlockEast,
  BlockNorth,
  BlockSouth,
  BlockWest,
  Candidate,
  Empty,
  Island,
  KeptFree,
  Puzzle,
  Town,
  TravelEnd,
  TravelStart,
  None,
}

const DISTANCES = [
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 4, 3, 3, 3, 3, 3, 3, 4, 5, 5, 4, 3, 2, 2, 2, 2, 3, 4, 5, 5,
  4, 3, 2, 1, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 5, 4, 3, 2, 2, 2, 2, 3, 4, 5, 5, 4, 3, 3, 3, 3, 3, 3, 4, 5, 5,
  4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
];

/** Anneau autour du centre (1 = centre, 5 = bord). */
export const distanceToCenter = (x: number, y: number): number => DISTANCES[x + WORLD_SIZE * y] ?? 5;

export interface Layout {
  cells: Cell[];
  /** Ordre des puzzles (-1 = aucun) ; le plus grand indice est l'objectif. */
  order: number[];
  puzzleCount: number;
}

class Grid {
  readonly cells: Cell[] = new Array(WORLD_SIZE * WORLD_SIZE).fill(Cell.None);
  get(x: number, y: number): Cell {
    if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return Cell.None;
    return this.cells[x + WORLD_SIZE * y];
  }
  set(x: number, y: number, v: Cell): void {
    if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return;
    this.cells[x + WORLD_SIZE * y] = v;
  }
}

const isFree = (c: Cell) => c === Cell.None || c === Cell.KeptFree;
const isBlockade = (c: Cell) => c === Cell.BlockEast || c === Cell.BlockNorth || c === Cell.BlockSouth || c === Cell.BlockWest;
const isLessThanCandidate = (c: Cell) =>
  c === Cell.None || c === Cell.Empty || c === Cell.TravelStart || c === Cell.TravelEnd || c === Cell.Island || c === Cell.Town;

function blockadeFor(xdif: number, ydif: number): Cell | null {
  if (xdif === 0 && ydif === 1) return Cell.BlockNorth;
  if (xdif === 0 && ydif === -1) return Cell.BlockSouth;
  if (xdif === -1 && ydif === 0) return Cell.BlockEast;
  if (xdif === 1 && ydif === 0) return Cell.BlockWest;
  return null;
}

type Range = [number, number];

const RANGES: Record<WorldSize, [Range, Range, Range, Range]> = {
  [WorldSize.Small]: [[5, 8], [4, 6], [1, 1], [1, 1]],
  [WorldSize.Medium]: [[5, 9], [5, 9], [4, 8], [3, 8]],
  [WorldSize.Large]: [[6, 12], [6, 12], [6, 11], [4, 11]],
};

export function generateLayout(rng: Rng, size: WorldSize): Layout {
  return new LayoutGenerator(rng).generate(size);
}

class LayoutGenerator {
  private grid = new Grid();
  private order: number[] = new Array(WORLD_SIZE * WORLD_SIZE).fill(-1);
  private travels = 0;
  private blockades = 0;
  private placedSectors = 0;
  private placedTravels = 0;
  private remaining = 0;
  private lastType: Cell = Cell.None;
  private probability = 0;
  private threshold = 0;
  private travelThreshold = 0;

  constructor(private readonly rng: Rng) {}

  private rand(): number {
    return this.rng.next();
  }

  private pick([min, max]: Range): number {
    return min + (this.rand() % (max - min + 1));
  }

  generate(size: WorldSize): Layout {
    this.travels = this.rand() % 3;
    this.blockades = this.rand() % 4;
    this.rand();
    const townX = (this.rand() % 2) + 4;
    const townY = (this.rand() % 2) + 4;
    for (const [x, y] of [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ]) {
      this.grid.set(x, y, Cell.Empty);
    }
    this.grid.set(townX, townY, Cell.Town);

    const ranges = RANGES[size];
    const first = this.travels + this.blockades + this.pick(ranges[0]);
    this.ring(2, Math.min(first, 12));
    this.ring(3, this.pick(ranges[1]));
    this.ring(4, this.pick(ranges[2]));
    this.borders(this.pick(ranges[3]));
    for (let i = 0; i < this.placedTravels; i++) this.placeIsland();
    this.choosePuzzles();
    const puzzleCount = Math.max(-1, ...this.order) + 1;
    return { cells: this.grid.cells, order: this.order, puzzleCount };
  }

  // ------------------------------------------------------------ anneaux

  private ring(iteration: number, count: number): void {
    this.remaining = count;
    let min: number;
    let alternate: number;
    let variance: number;
    if (iteration === 2) {
      [min, alternate, variance, this.probability, this.threshold, this.travelThreshold] = [3, 6, 4, 9, 2, 1];
    } else if (iteration === 3) {
      [min, alternate, variance, this.probability, this.threshold, this.travelThreshold] = [2, 7, 6, 4, 2, 3];
    } else {
      [min, alternate, variance, this.probability, this.threshold, this.travelThreshold] = [1, 8, 8, 5, 1, 6];
    }
    for (let i = 0; i <= 144 && this.remaining > 0; i++) {
      let x: number;
      let y: number;
      if (this.rand() % 2) {
        x = this.rand() % 2 ? min : alternate;
        y = (this.rand() % variance) + min;
      } else {
        y = this.rand() % 2 ? min : alternate;
        x = (this.rand() % variance) + min;
      }
      if (this.grid.get(x, y) !== Cell.None) continue;
      // L'ordre des essais (gauche, droite, haut, bas) fait partie de l'algorithme d'origine.
      void (
        this.neighbor(x, y, iteration, -1, 0) ||
        this.neighbor(x, y, iteration, 1, 0) ||
        this.neighbor(x, y, iteration, 0, -1) ||
        this.neighbor(x, y, iteration, 0, 1)
      );
      this.tryTravel(x, y, iteration);
    }
  }

  private neighbor(x: number, y: number, iteration: number, xdif: number, ydif: number): boolean {
    const g = this.grid;
    const neighbor = g.get(x + xdif, y + ydif);
    const sideA = g.get(x + ydif, y + xdif);
    const sideB = g.get(x - ydif, y - xdif);
    if (isFree(neighbor)) return false;
    this.lastType = neighbor;
    const blockade = blockadeFor(xdif, ydif);
    const canPlaceBlockade = isFree(sideA) && isFree(sideB);
    if ((canPlaceBlockade && neighbor === Cell.Candidate) || neighbor === blockade) {
      g.set(x, y, Cell.Candidate);
      g.set(x - ydif, y - xdif, Cell.KeptFree);
      g.set(x + ydif, y + xdif, Cell.KeptFree);
      this.placedSectors++;
      this.remaining--;
    }
    if (neighbor === Cell.Candidate || isBlockade(neighbor)) return true;
    const shouldPlaceBlockade = this.blockades > 0 && this.rand() % this.probability < this.threshold;
    const withinRange = distanceToCenter(x + xdif, y + ydif) < iteration;
    const surroundingsFree = [g.get(x - 1, y), g.get(x + 1, y), g.get(x, y - 1), g.get(x, y + 1)].every(isLessThanCandidate);
    if (shouldPlaceBlockade && canPlaceBlockade && withinRange && blockade !== null) {
      g.set(x, y, blockade);
      g.set(x - ydif, y - xdif, Cell.KeptFree);
      g.set(x + ydif, y + xdif, Cell.KeptFree);
      g.set(x - xdif, y - ydif, Cell.Candidate);
      g.set(x - ydif - xdif, y - ydif - xdif, Cell.KeptFree);
      g.set(x + ydif - xdif, y - ydif + xdif, Cell.KeptFree);
      this.remaining--;
      this.placedSectors += 2;
      this.blockades--;
      return true;
    }
    if (!surroundingsFree) return true;
    if (!shouldPlaceBlockade || (ydif && !canPlaceBlockade) || (xdif && withinRange)) {
      g.set(x, y, Cell.Empty);
      this.placedSectors++;
      this.remaining--;
    }
    return true;
  }

  private tryTravel(x: number, y: number, iteration: number): void {
    if (this.grid.get(x, y) !== Cell.Empty) return;
    if (this.travels <= this.placedTravels) return;
    if ((this.rand() & 7) >= this.travelThreshold) return;
    if (this.lastType === Cell.TravelStart || iteration <= 2) return;
    this.grid.set(x, y, Cell.TravelStart);
    this.placedTravels++;
  }

  /** Prolonge les régions jusqu'aux bords de la carte. */
  private borders(count: number): void {
    const g = this.grid;
    for (let i = 0; i <= 400 && count > 0; i++) {
      const vertical = this.rand() % 2;
      let x: number;
      let y: number;
      if (vertical) {
        x = this.rand() % 2 ? 0 : 9;
        y = this.rand() % WORLD_SIZE;
      } else {
        y = this.rand() % 2 ? 0 : 9;
        x = this.rand() % WORLD_SIZE;
      }
      if (g.get(x, y) !== Cell.None) continue;
      const before = g.get(x - 1, y);
      const after = g.get(x + 1, y);
      const above = g.get(x, y - 1);
      const below = g.get(x, y + 1);
      let xd = 0;
      let yd = 0;
      if (vertical && x === 9 && before !== Cell.KeptFree) xd = 1;
      else if (vertical && x === 0 && after !== Cell.KeptFree) xd = -1;
      else if (!vertical && y === 9 && above !== Cell.KeptFree) yd = 1;
      else if (!vertical && y === 0 && below !== Cell.KeptFree) yd = -1;
      if (xd === 0 && yd === 0) continue;
      const inner = g.get(x - xd, y - yd);
      const isEarlyBlockade = (c: Cell) => c <= Cell.BlockNorth;
      switch (inner) {
        case Cell.Empty:
        case Cell.TravelStart:
        case Cell.Town:
          g.set(x, y, Cell.Empty);
          break;
        case Cell.Candidate:
          g.set(x, y, Cell.Candidate);
          if (!xd) {
            g.set(x - 1, y, Cell.KeptFree);
            g.set(x + 1, y, Cell.KeptFree);
          } else {
            g.set(x, y - 1, Cell.KeptFree);
            g.set(x, y + 1, Cell.KeptFree);
          }
          continue;
        case Cell.BlockEast:
        case Cell.BlockWest:
          if ((inner === Cell.BlockEast && xd !== 1) || (inner === Cell.BlockWest && xd !== -1)) continue;
          if (isEarlyBlockade(below) || isEarlyBlockade(above)) continue;
          g.set(x, y, Cell.Candidate);
          g.set(x, y - 1, Cell.KeptFree);
          g.set(x, y + 1, Cell.KeptFree);
          break;
        case Cell.BlockNorth:
        case Cell.BlockSouth:
          if ((inner === Cell.BlockNorth && yd !== -1) || (inner === Cell.BlockSouth && yd !== 1)) continue;
          if (isEarlyBlockade(before) || isEarlyBlockade(after)) continue;
          g.set(x, y, Cell.Candidate);
          g.set(x - 1, y, Cell.KeptFree);
          g.set(x + 1, y, Cell.KeptFree);
          break;
        default:
          continue;
      }
      this.placedSectors++;
      count--;
    }
  }

  // ------------------------------------------------------------ îles

  private placeIsland(): void {
    for (let i = 0; i <= 200; i++) {
      const side = this.rand() % 4;
      if (this.island(side)) return;
    }
  }

  /** side : 0 ouest, 1 nord, 2 sud, 3 est. */
  private island(side: number): boolean {
    const g = this.grid;
    const vertical = side === 0 || side === 3;
    const fixed = side === 0 || side === 1 ? 0 : 9;
    const inward = side === 0 || side === 1 ? 1 : -1;
    const at = (i: number): [number, number] => (vertical ? [fixed, i] : [i, fixed]);
    // Plus longue suite de cases libres le long du bord, sans terre juste à l'intérieur.
    let start = 0;
    let length = 0;
    let run = 0;
    for (let i = 0; i < WORLD_SIZE; i++) {
      const [x, y] = at(i);
      const inner = vertical ? g.get(x + inward, y) : g.get(x, y + inward);
      if (g.get(x, y) !== Cell.None || (inner !== Cell.None && inner !== Cell.KeptFree)) {
        if (length < run) {
          length = run;
          start = i - run;
        }
        run = 0;
      } else run++;
    }
    if (length < run) {
      length = run;
      start = WORLD_SIZE - run;
    }
    const short = side === 0 || side === 1;
    if (short) {
      if (length < 3) return false;
      if (length === 3) {
        if (start > 0 && start < 7) return false;
        length = 2;
      } else length = Math.min(length - 2, 4);
    } else {
      if (length < 4) return false;
      length = Math.min(length - 2, 4);
    }
    if (start > 0 && start + length < WORLD_SIZE) start++;
    for (let i = start; i < start + length; i++) g.set(...at(i), Cell.Island);
    g.set(...at(this.rand() % 2 ? start : start + length - 1), Cell.TravelEnd);
    return true;
  }

  // ------------------------------------------------------------ puzzles

  private choosePuzzles(): void {
    const g = this.grid;
    let puzzles = 0;
    let travels = 0;
    let blockades = 0;
    for (const c of g.cells) {
      if (c === Cell.Empty || c === Cell.Island || c === Cell.Candidate) puzzles++;
      else if (isBlockade(c)) blockades++;
      else if (c === Cell.TravelStart) travels++;
    }
    let total = Math.floor(puzzles / 4) + (this.rand() % (Math.floor(puzzles / 5) + 1)) - blockades - travels - 2;
    if (total < 4) total = 4;
    this.placedSectors = 0;
    const mark = (x: number, y: number) => {
      g.set(x, y, Cell.Puzzle);
      this.order[x + WORLD_SIZE * y] = this.placedSectors++;
    };

    // Derrière chaque barrage.
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        const c = g.get(x, y);
        const step =
          c === Cell.BlockWest ? [-1, 0] : c === Cell.BlockEast ? [1, 0] : c === Cell.BlockNorth ? [0, -1] : c === Cell.BlockSouth ? [0, 1] : null;
        if (!step) continue;
        const [sx, sy] = step;
        if (g.get(x + sx, y + sy) !== Cell.Candidate) continue;
        if (g.get(x + 2 * sx, y + 2 * sy) === Cell.Candidate) mark(x + 2 * sx, y + 2 * sy);
        else mark(x + sx, y + sy);
      }
    }
    // Au bout de chaque île.
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        if (g.get(x, y) !== Cell.TravelEnd) continue;
        const dirs: Array<[number, number]> = [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ];
        const dir = dirs.find(([dx, dy]) => g.get(x + dx, y + dy) === Cell.Island);
        if (!dir) continue;
        let px = x;
        let py = y;
        while (g.get(px + dir[0], py + dir[1]) === Cell.Island) {
          px += dir[0];
          py += dir[1];
        }
        mark(px, py);
      }
    }
    // Puzzles supplémentaires, plutôt loin du centre et jamais côte à côte.
    for (let i = 0, guard = 5000; i <= 200 && guard > 0 && this.placedSectors < total; i++, guard--) {
      const x = this.rand() % 10;
      const y = i >= 50 || x === 0 || x === 9 ? this.rand() % 10 : (this.rand() & 1) < 1 ? 9 : 0;
      const d = distanceToCenter(x, y);
      if (d >= 3 || i >= 150) {
        const c = g.get(x, y);
        const near = [g.get(x - 1, y), g.get(x + 1, y), g.get(x, y - 1), g.get(x, y + 1)];
        if ((c === Cell.Empty || c === Cell.Candidate) && !near.includes(Cell.Puzzle)) mark(x, y);
      } else i--;
    }
    // L'objectif ne doit pas être trop près de la ville.
    const lastIndex = this.order.indexOf(this.placedSectors - 1);
    if (lastIndex >= 0 && distanceToCenter(lastIndex % 10, Math.floor(lastIndex / 10)) < 3) {
      const swap = this.order.findIndex(
        (o, idx) => o >= 0 && idx !== lastIndex && distanceToCenter(idx % 10, Math.floor(idx / 10)) >= 3,
      );
      if (swap >= 0) {
        this.order[lastIndex] = this.order[swap];
        this.order[swap] = this.placedSectors - 1;
      }
    }
  }
}
