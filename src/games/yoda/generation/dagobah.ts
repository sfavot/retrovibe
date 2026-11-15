import type { Assets } from "../../../engine/desktop-adventures/assets";
import { HotspotType } from "../../../engine/desktop-adventures/data/types";
import type { Rng } from "../../../engine/desktop-adventures/rng";
import { type Sector, SectorKind, WORLD_SIZE, emptySector } from "../../../engine/desktop-adventures/world";
import { DAGOBAH_CELLS, GoalIds, TileIds, ZoneIds } from "../ids";

/** Où Yoda attend le héros (`YodaSpawn` de WebFun). */
enum YodaSpawn {
  NorthWest = 0,
  Hut = 1,
  SouthEast = 2,
  SouthWest = 3,
  /** Mission « Sauver Yoda » : seul son siège est dans la cabane. */
  None = 4,
}

export interface DagobahResult {
  /** 100 cases ; seules les quatre de Dagobah sont remplies. */
  sectors: (Sector | null)[];
  /** zoneId → index de hotspot → argument (PNJ posé), à fusionner avec ceux du monde. */
  hotspotArguments: Map<number, Map<number, number>>;
}

/** Cases (x, y) des secteurs extérieurs selon `YodaSpawn` (la cabane et « aucun » n'y figurent pas). */
const OUTDOOR_CELLS: Partial<Record<YodaSpawn, number>> = {
  [YodaSpawn.NorthWest]: DAGOBAH_CELLS.northWest,
  [YodaSpawn.SouthEast]: DAGOBAH_CELLS.southEast,
  [YodaSpawn.SouthWest]: DAGOBAH_CELLS.southWest,
};

/**
 * Dagobah : quatre secteurs fixes, où Yoda remet l'objet de départ de la chaîne de puzzles.
 * Portage de `DagobahGenerator` de WebFun ; tire dans `rng` à la suite de la génération du monde (même suite que l'original).
 *
 * @param goalPuzzle puzzle de mission (détermine où se tient Yoda)
 * @param startItem premier objet de la chaîne (tuile), remis par Yoda
 */
export function generateDagobah(assets: Assets, rng: Rng, goalPuzzle: number, startItem: number): DagobahResult {
  const sectors: (Sector | null)[] = new Array(WORLD_SIZE * WORLD_SIZE).fill(null);
  const hotspotArguments = new Map<number, Map<number, number>>();
  const zones: Record<number, number> = {
    [DAGOBAH_CELLS.northWest]: ZoneIds.DagobahNorthWest,
    [DAGOBAH_CELLS.northEast]: ZoneIds.DagobahNorthEast,
    [DAGOBAH_CELLS.southWest]: ZoneIds.DagobahSouthWest,
    [DAGOBAH_CELLS.southEast]: ZoneIds.DagobahSouthEast,
  };
  for (const [cell, zoneId] of Object.entries(zones)) sectors[Number(cell)] = emptySector(zoneId, SectorKind.Empty);

  const setHotspot = (zoneId: number, index: number, argument: number): void => {
    let map = hotspotArguments.get(zoneId);
    if (!map) hotspotArguments.set(zoneId, (map = new Map()));
    map.set(index, argument);
  };

  /** Tire toujours, même quand l'objectif impose l'emplacement : la suite des tirages reste celle de l'original. */
  let spawn: YodaSpawn = rng.mod(4);
  if (goalPuzzle === GoalIds.ImperialBattleCode) spawn = YodaSpawn.SouthWest;
  else if (goalPuzzle === GoalIds.RescueYoda) spawn = YodaSpawn.None;

  const outdoor = OUTDOOR_CELLS[spawn];
  if (outdoor !== undefined) {
    // Yoda à l'extérieur : sur l'unique emplacement d'apparition du secteur.
    const sector = sectors[outdoor]!;
    sector.npc = TileIds.Yoda;
    sector.findItem = startItem;
    sector.puzzle = goalPuzzle;
    sector.kind = SectorKind.Puzzle;
    const candidates = assets
      .zone(sector.zoneId)
      .hotspots.flatMap((h, index) => (h.type === HotspotType.SpawnLocation ? [index] : []));
    const chosen = candidates[rng.mod(candidates.length)];
    if (chosen !== undefined) setHotspot(sector.zoneId, chosen, TileIds.Yoda);
    return { sectors, hotspotArguments };
  }

  // Dans la cabane (secteur nord-est) : Yoda lui-même, ou seulement son siège.
  const npc = spawn === YodaSpawn.Hut ? TileIds.Yoda : TileIds.YodasSeat;
  const sector = sectors[DAGOBAH_CELLS.northEast]!;
  sector.npc = npc;
  sector.findItem = startItem;
  sector.puzzle = goalPuzzle;
  sector.kind = SectorKind.Puzzle;
  const spot = spawn === YodaSpawn.Hut ? { x: 3, y: 3 } : { x: 3, y: 2 };
  const index = assets.zone(ZoneIds.YodasHut).hotspots.findIndex((h) => h.x === spot.x && h.y === spot.y);
  if (index >= 0) setHotspot(ZoneIds.YodasHut, index, npc);
  return { sectors, hotspotArguments };
}
