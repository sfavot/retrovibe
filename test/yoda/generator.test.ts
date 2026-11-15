import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { parseDaw } from "../../src/engine/desktop-adventures/data/daw";
import { HotspotType, PuzzleType } from "../../src/engine/desktop-adventures/data/types";
import { SectorKind, WORLD_SIZE, WorldSize } from "../../src/engine/desktop-adventures/world";
import { DAGOBAH_CELLS, GoalIds, MISSION_PLANETS, Planet, START, TileIds, ZoneIds } from "../../src/games/yoda/ids";
import { generateYodaStory } from "../../src/games/yoda/generation/world-generator";
import { originalFiles } from "../support/original";

const original = originalFiles("yoda", "YODESK.DTA");
const SIZES = [WorldSize.Small, WorldSize.Medium, WorldSize.Large];
const SEEDS = [1, 7, 42, 1234, 4321, 8765, 31337, 99999, 123456789, 0x7fffffff];

describe.skipIf(!original.has)("génération du monde de Yoda Stories", () => {
  const assets = original.has ? new Assets(parseDaw(original.read("YODESK.DTA"), "yoda")) : (null as unknown as Assets);

  /** Une dizaine de graines pour chacune des trois tailles. */
  const cases = SIZES.flatMap((size) => SEEDS.map((seed) => ({ size, seed })));
  const generated = new Map<string, ReturnType<typeof generateYodaStory>>();
  const story = (seed: number, size: WorldSize) => {
    const key = `${seed}/${size}`;
    let value = generated.get(key);
    if (!value) generated.set(key, (value = generateYodaStory(assets, seed, size)));
    return value;
  };

  it("est déterministe pour une graine donnée", () => {
    for (const { size, seed } of cases) {
      const a = story(seed, size);
      const b = generateYodaStory(assets, seed, size);
      expect(b.sectors).toEqual(a.sectors);
      expect(b.dagobah).toEqual(a.dagobah);
      expect(b.hotspotArguments).toEqual(a.hotspotArguments);
      expect(b.planet).toBe(a.planet);
      expect(b.goalPuzzle).toBe(a.goalPuzzle);
      expect(b.puzzleChains).toEqual(a.puzzleChains);
    }
  });

  it("choisit une planète de mission autre que la précédente", () => {
    for (const lastPlanet of MISSION_PLANETS) {
      for (const seed of SEEDS) {
        const planet = generateYodaStory(assets, seed, WorldSize.Small, { lastPlanet }).planet;
        expect(MISSION_PLANETS).toContain(planet);
        expect(planet).not.toBe(lastPlanet);
      }
    }
    expect(generateYodaStory(assets, 5, WorldSize.Small, { planet: Planet.Hoth }).planet).toBe(Planet.Hoth);
  });

  it("ne place que des zones de la planète, une seule fois, avec une ville et un objectif", () => {
    for (const { size, seed } of cases) {
      const s = story(seed, size);
      const placed = s.sectors.filter((x) => x !== null);
      const ids = placed.map((x) => x!.zoneId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(assets.zone(id).planet).toBe(s.planet);
      expect(placed.filter((x) => x!.kind === SectorKind.Town)).toHaveLength(1);
      expect(placed.filter((x) => x!.kind === SectorKind.Goal)).toHaveLength(1);
      expect(s.size).toBe(size);
      expect(s.seed).toBe(seed);
      expect(s.sectors).toHaveLength(WORLD_SIZE * WORLD_SIZE);
    }
  });

  it("remplit Dagobah avec Yoda (ou son siège) et l'objet de départ", () => {
    for (const { size, seed } of cases) {
      const s = story(seed, size);
      const filled = s.dagobah.flatMap((x, i) => (x ? [i] : []));
      expect(filled).toEqual([DAGOBAH_CELLS.northWest, DAGOBAH_CELLS.northEast, DAGOBAH_CELLS.southWest, DAGOBAH_CELLS.southEast]);
      expect(s.dagobah[DAGOBAH_CELLS.northWest]!.zoneId).toBe(ZoneIds.DagobahNorthWest);
      expect(s.dagobah[DAGOBAH_CELLS.southWest]!.zoneId).toBe(ZoneIds.DagobahSouthWest);
      const yoda = s.dagobah.filter((x) => x && x.npc >= 0);
      expect(yoda).toHaveLength(1);
      expect([TileIds.Yoda, TileIds.YodasSeat]).toContain(yoda[0]!.npc);
      expect(yoda[0]!.findItem).toBe(s.startItem);
      expect(s.startItem).toBeGreaterThanOrEqual(0);
      expect(s.startZone).toBe(START.zone);
      // Le PNJ est posé sur un hotspot de la zone du secteur (ou de la cabane).
      const zoneIds = [...assets.roomsOf(yoda[0]!.zoneId)].map((z) => z.id);
      const placedNpc = [...s.hotspotArguments].filter(([zoneId, map]) => zoneIds.includes(zoneId) && [...map.values()].includes(yoda[0]!.npc));
      expect(placedNpc.length).toBeGreaterThan(0);
    }
  });

  it("garde un objectif cohérent avec le secteur Goal et les chaînes de puzzles", () => {
    for (const { size, seed } of cases) {
      const s = story(seed, size);
      const puzzle = assets.puzzle(s.goalPuzzle)!;
      expect(puzzle.type).toBe(PuzzleType.Mission);
      // Les missions « Sauver Yoda » et « Car » exigent des victoires.
      expect([GoalIds.RescueYoda, GoalIds.Car]).not.toContain(s.goalPuzzle);

      const goal = s.sectors.find((x) => x?.kind === SectorKind.Goal)!;
      const provided = [...assets.roomsOf(goal.zoneId)].flatMap((z) => z.providedItems);
      expect(provided).toContain(puzzle.item);
      expect(provided).toContain(puzzle.item2);

      const [strain1, strain2] = s.puzzleChains;
      expect(strain1.at(-1)).toBe(s.goalPuzzle);
      expect(strain2.at(-1)).toBe(s.goalPuzzle);
      expect(s.startItem).toBe(assets.puzzle(strain2[0])!.item);
      expect(s.pace).toBeGreaterThan(strain1.length + strain2.length - 1);
      for (const sector of s.sectors) {
        if (!sector || sector.puzzle < 0) continue;
        expect(assets.puzzle(sector.puzzle)).toBeDefined();
      }
    }
  });

  it("n'active que des hotspots existants du bon type et pose un PNJ pour chaque échange", () => {
    for (const { size, seed } of cases) {
      const s = story(seed, size);
      for (const [zoneId, map] of s.hotspotArguments) {
        const zone = assets.zone(zoneId);
        for (const [index, argument] of map) {
          const hotspot = zone.hotspots[index];
          expect(hotspot).toBeDefined();
          expect([HotspotType.DropQuestItem, HotspotType.SpawnLocation, HotspotType.DropUniqueWeapon, HotspotType.DropMap, HotspotType.Lock]).toContain(hotspot.type);
          expect(argument).toBeGreaterThanOrEqual(0);
        }
      }
      for (const sector of s.sectors) {
        if (sector?.kind === SectorKind.Puzzle && sector.npc >= 0) expect(sector.puzzle).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("impose l'objectif et débloque les missions réservées avec les victoires", () => {
    expect(generateYodaStory(assets, 77, WorldSize.Small, { goal: GoalIds.Han, planet: Planet.Tatooine }).goalPuzzle).toBe(GoalIds.Han);
    const goals = new Set(SEEDS.flatMap((seed) => [seed, seed + 1].map((n) => generateYodaStory(assets, n, WorldSize.Small, { gamesWon: 20 }).goalPuzzle)));
    for (const goal of goals) expect(assets.puzzle(goal)!.type).toBe(PuzzleType.Mission);
  });
});
