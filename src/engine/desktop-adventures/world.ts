import type { Assets } from "./assets";
import { DIRECTION_VECTORS, Direction, type Point } from "./geometry";

export const WORLD_SIZE = 10;

export enum WorldSize {
  Small = 1,
  Medium = 2,
  Large = 3,
}

export enum SectorKind {
  Empty = "empty",
  Town = "town",
  Goal = "goal",
  Puzzle = "puzzle",
  Find = "find",
  Blockade = "blockade",
  Travel = "travel",
}

/** Case de la carte du monde et le rôle que la génération lui a donné. */
export interface Sector {
  zoneId: number;
  kind: SectorKind;
  /** Objet à apporter pour résoudre le secteur (-1 : aucun). */
  requiredItem: number;
  /** Yoda : second objet accepté par le secteur (objectifs à deux objets), -1 : aucun. Absent des anciennes sauvegardes. */
  additionalRequiredItem: number;
  /** Objet obtenu en résolvant le secteur (-1 : aucun). */
  findItem: number;
  /** PNJ placé par la génération (tuile), -1 : aucun. */
  npc: number;
  /** Puzzle dont le PNJ formule la demande (texte [0]) et remercie (texte [1]). */
  puzzle: number;
  /** Puzzle dont le texte d'offre [2] décrit l'objet donné en échange. */
  offerPuzzle: number;
  solved: boolean;
  visited: boolean;
}

export function emptySector(zoneId: number, kind: SectorKind): Sector {
  return { zoneId, kind, requiredItem: -1, additionalRequiredItem: -1, findItem: -1, npc: -1, puzzle: -1, offerPuzzle: -1, solved: false, visited: false };
}

/** Résultat de la génération : tout ce qu'il faut pour démarrer une partie. */
export interface Story {
  seed: number;
  size: WorldSize;
  /** 100 cases (x + 10·y), null = hors carte. */
  sectors: (Sector | null)[];
  /** Puzzle de mission (type GO). */
  goalPuzzle: number;
  /** Zones dont un hotspot a été préparé par la génération : zoneId → index → argument. */
  hotspotArguments: Map<number, Map<number, number>>;
  /** « W » de l'original, qui règle le temps de référence du score (voir `paceOf`). */
  pace: number;
  /** Objet remis par Marcus avec le briefing (début de la chaîne de puzzles), -1 : aucun. */
  startItem: number;
  /** Yoda : seconde carte (Dagobah, 100 cases comme `sectors`), reliée à la planète par le X-Wing. */
  dagobah?: (Sector | null)[];
}

/** Carte du monde : 0 = principale (`Story.sectors`), 1 = Dagobah (`Story.dagobah`). */
export type Grid = 0 | 1;

export class World {
  private readonly zoneToSector = new Map<number, { grid: Grid; index: number }>();
  private readonly grids: ReadonlyArray<(Sector | null)[]>;

  constructor(
    readonly story: Story,
    assets: Assets,
  ) {
    this.grids = story.dagobah ? [story.sectors, story.dagobah] : [story.sectors];
    this.grids.forEach((sectors, grid) => {
      sectors.forEach((sector, index) => {
        if (!sector) return;
        for (const room of assets.roomsOf(sector.zoneId)) {
          if (!this.zoneToSector.has(room.id)) this.zoneToSector.set(room.id, { grid: grid as Grid, index });
        }
      });
    });
  }

  at(x: number, y: number, grid: Grid = 0): Sector | null {
    if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return null;
    return this.grids[grid]?.[x + y * WORLD_SIZE] ?? null;
  }

  /** Coordonnées, sur sa carte, du secteur contenant la zone (pièces comprises). */
  locate(zoneId: number): Point | null {
    const found = this.zoneToSector.get(zoneId);
    return found ? { x: found.index % WORLD_SIZE, y: Math.floor(found.index / WORLD_SIZE) } : null;
  }

  /** Carte qui contient la zone, null si elle n'appartient à aucun secteur. */
  gridOf(zoneId: number): Grid | null {
    return this.zoneToSector.get(zoneId)?.grid ?? null;
  }

  sectorOf(zoneId: number): Sector | null {
    const found = this.zoneToSector.get(zoneId);
    return found ? (this.grids[found.grid][found.index] ?? null) : null;
  }

  /** Secteur voisin de celui de la zone, sur la même carte (null : bord de carte ou case vide). */
  neighbor(zoneId: number, dx: number, dy: number): Sector | null {
    const here = this.locate(zoneId);
    const grid = this.gridOf(zoneId);
    return here && grid !== null ? this.at(here.x + dx, here.y + dy, grid) : null;
  }

  /**
   * Directions dans lesquelles la carte du monde a un secteur voisin de la zone (celles où `Game.trySectorTransition` laisse passer
   * le héros au bord de l'écran) ; aucune depuis une pièce. Lecture seule : sert à la boussole.
   */
  exits(zoneId: number): Record<Direction, boolean> {
    const open = { [Direction.Up]: false, [Direction.Down]: false, [Direction.Left]: false, [Direction.Right]: false };
    if (!this.isOverworld(zoneId)) return open;
    for (const direction of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
      const { x, y } = DIRECTION_VECTORS[direction];
      open[direction] = this.neighbor(zoneId, x, y) !== null;
    }
    return open;
  }

  /** La zone est-elle la zone principale de sa case (et non une pièce) ? */
  isOverworld(zoneId: number): boolean {
    return this.sectorOf(zoneId)?.zoneId === zoneId;
  }
}
