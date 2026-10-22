import { ZoneType } from "../../data/types";
import { type Assets, IndyIds } from "../assets";
import { type Sector, SectorKind, type Story, WORLD_SIZE } from "../world";

export interface SolveResult {
  solvable: boolean;
  reason: string;
  /** Ordre dans lequel les secteurs ont été résolus (index de case). */
  steps: number[];
}

const BLOCKED_DIRECTION: Partial<Record<ZoneType, [number, number]>> = {
  [ZoneType.BlockadeNorth]: [0, -1],
  [ZoneType.BlockadeSouth]: [0, 1],
  [ZoneType.BlockadeEast]: [1, 0],
  [ZoneType.BlockadeWest]: [-1, 0],
};

/**
 * Vérifie qu'une partie générée peut être terminée : exploration depuis la ville, en ne franchissant
 * un barrage ou un voyage qu'avec l'objet demandé, et en ramassant ce que chaque secteur accessible fournit.
 * Modèle volontairement simple : on suppose chaque zone praticable dans toutes les directions.
 */
export function solve(assets: Assets, story: Story): SolveResult {
  const sectors = story.sectors;
  // Le fouet est posé dans une maison de la ville, point de départ : il est toujours à portée.
  const inventory = new Set<number>([IndyIds.whipTile]);
  if (story.startItem >= 0) inventory.add(story.startItem);
  const solved = new Set<number>();
  const steps: number[] = [];
  const town = sectors.findIndex((s) => s?.kind === SectorKind.Town);
  if (town < 0) return { solvable: false, reason: "pas de ville", steps };
  const goal = sectors.findIndex((s) => s?.kind === SectorKind.Goal);
  if (goal < 0) return { solvable: false, reason: "pas d'objectif", steps };

  const travelTarget = (index: number): number => {
    const zone = assets.zone(sectors[index]!.zoneId);
    const vehicle = zone.hotspots.find((h) => h.type === 3);
    if (!vehicle) return -1;
    return sectors.findIndex((s) => s?.zoneId === vehicle.argument);
  };

  for (let guard = 0; guard < 200; guard++) {
    const reachable = explore(assets, sectors, town, solved, travelTarget);
    let progress = false;
    for (const index of reachable) {
      if (solved.has(index)) continue;
      const s = sectors[index]!;
      if (!canSolve(s, inventory)) continue;
      solved.add(index);
      steps.push(index);
      if (s.findItem >= 0) inventory.add(s.findItem);
      progress = true;
      if (index === goal) return { solvable: true, reason: "", steps };
    }
    if (!progress) break;
  }
  const blockedBy = sectors[goal]!.requiredItem;
  return { solvable: false, reason: `objectif inaccessible (objet requis ${assets.tileName(blockedBy)})`, steps };
}

function canSolve(s: Sector, inventory: Set<number>): boolean {
  switch (s.kind) {
    case SectorKind.Find:
      return true;
    case SectorKind.Puzzle:
    case SectorKind.Blockade:
    case SectorKind.Travel:
    case SectorKind.Goal:
      return s.requiredItem < 0 || inventory.has(s.requiredItem);
    default:
      return false;
  }
}

function explore(
  assets: Assets,
  sectors: readonly (Sector | null)[],
  start: number,
  solved: Set<number>,
  travelTarget: (index: number) => number,
): number[] {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const index = queue.shift()!;
    const s = sectors[index]!;
    const x = index % WORLD_SIZE;
    const y = Math.floor(index / WORLD_SIZE);
    const blocked = s.kind === SectorKind.Blockade && !solved.has(index) ? BLOCKED_DIRECTION[assets.zone(s.zoneId).type] : undefined;
    const next: number[] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= WORLD_SIZE || ny >= WORLD_SIZE) continue;
      if (blocked && blocked[0] === dx && blocked[1] === dy) continue;
      const n = nx + ny * WORLD_SIZE;
      const neighbor = sectors[n];
      if (!neighbor) continue;
      // On ne traverse pas un barrage non résolu en venant de derrière.
      const nb = neighbor.kind === SectorKind.Blockade && !solved.has(n) ? BLOCKED_DIRECTION[assets.zone(neighbor.zoneId).type] : undefined;
      if (nb && nb[0] === -dx && nb[1] === -dy) continue;
      next.push(n);
    }
    if (s.kind === SectorKind.Travel && solved.has(index)) {
      const target = travelTarget(index);
      if (target >= 0) next.push(target);
    }
    for (const n of next) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return [...seen];
}
