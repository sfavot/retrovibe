import type { Assets } from "./assets";
import type { Point } from "./geometry";

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
  return { zoneId, kind, requiredItem: -1, findItem: -1, npc: -1, puzzle: -1, offerPuzzle: -1, solved: false, visited: false };
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
}

export class World {
  private readonly zoneToSector = new Map<number, number>();

  constructor(
    readonly story: Story,
    assets: Assets,
  ) {
    story.sectors.forEach((sector, index) => {
      if (!sector) return;
      for (const room of assets.roomsOf(sector.zoneId)) {
        if (!this.zoneToSector.has(room.id)) this.zoneToSector.set(room.id, index);
      }
    });
  }

  at(x: number, y: number): Sector | null {
    if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) return null;
    return this.story.sectors[x + y * WORLD_SIZE];
  }

  /** Coordonnées sur la carte du secteur contenant la zone (pièces comprises). */
  locate(zoneId: number): Point | null {
    const index = this.zoneToSector.get(zoneId);
    return index === undefined ? null : { x: index % WORLD_SIZE, y: Math.floor(index / WORLD_SIZE) };
  }

  sectorOf(zoneId: number): Sector | null {
    const index = this.zoneToSector.get(zoneId);
    return index === undefined ? null : this.story.sectors[index];
  }

  /** La zone est-elle la zone principale de sa case (et non une pièce) ? */
  isOverworld(zoneId: number): boolean {
    return this.sectorOf(zoneId)?.zoneId === zoneId;
  }
}
