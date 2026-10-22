import { describe, expect, it } from "vitest";
import { Assets, IndyIds } from "../../src/games/indy/engine/assets";
import { type GenerateOptions, generateStory } from "../../src/games/indy/engine/generation/generator";
import { MYSTERY_GOAL } from "../../src/games/indy/engine/history";
import { canReachHotspot } from "../../src/games/indy/engine/generation/reachability";
import { solve } from "../../src/games/indy/engine/generation/solver";
import { HotspotType, Layer, PuzzleType } from "../../src/games/indy/data/types";
import { SectorKind, WorldSize } from "../../src/games/indy/engine/world";
import { hasOriginalFiles, loadGameData } from "./helpers";

describe.skipIf(!hasOriginalFiles)("génération du monde", () => {
  const assets = hasOriginalFiles ? new Assets(loadGameData()) : (null as unknown as Assets);

  it("est déterministe pour une graine donnée", () => {
    const a = generateStory(assets, 1234, WorldSize.Medium);
    const b = generateStory(assets, 1234, WorldSize.Medium);
    expect(a.sectors.map((s) => s?.zoneId ?? -1)).toEqual(b.sectors.map((s) => s?.zoneId ?? -1));
    expect(a.goalPuzzle).toBe(b.goalPuzzle);
  });

  it("exclut les objectifs récents et ne tire MysteryGO qu'après 10 victoires", () => {
    const goals = (options: GenerateOptions) =>
      new Set(Array.from({ length: 40 }, (_, i) => generateStory(assets, 500 + i * 31, WorldSize.Medium, options).goalPuzzle));
    const missions = assets.data.puzzles.filter((p) => p.type === PuzzleType.Mission).map((p) => p.id);
    const recent = missions.slice(0, 10).filter((id) => id !== MYSTERY_GOAL);
    expect(goals({ history: [] })).not.toContain(MYSTERY_GOAL);
    for (const id of goals({ history: recent })) expect(recent).not.toContain(id);
    expect(goals({ history: [15], victories: 9 })).not.toContain(MYSTERY_GOAL);
    expect(goals({ history: [15], victories: 10 })).toContain(MYSTERY_GOAL);
  });

  it("reste reproductible à historique égal, et impose l'objectif d'un replay", () => {
    const options = { history: [15, 16], victories: 3 };
    const a = generateStory(assets, 4321, WorldSize.Medium, options);
    const b = generateStory(assets, 4321, WorldSize.Medium, options);
    expect(a.sectors).toEqual(b.sectors);
    expect(a.goalPuzzle).toBe(b.goalPuzzle);
    // Objectif imposé, même s'il est dans l'historique ; une autre graine donne un autre monde.
    const replay = generateStory(assets, 8765, WorldSize.Medium, { history: [15, 16], goal: 16 });
    expect(replay.goalPuzzle).toBe(16);
    expect(replay.sectors).not.toEqual(a.sectors);
  });

  it("calcule W (cadence du score) depuis la disposition de la carte", () => {
    const story = generateStory(assets, 99, WorldSize.Large);
    const cells = story.sectors.filter((s) => s !== null);
    // Au moins les puzzles de la chaîne et l'objectif, plus l'entrée de départ.
    expect(story.pace).toBeGreaterThanOrEqual(cells.filter((s) => s.kind === SectorKind.Puzzle).length + 2);
  });

  for (const size of [WorldSize.Small, WorldSize.Medium, WorldSize.Large]) {
    it(`produit des parties terminables (taille ${WorldSize[size]})`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const story = generateStory(assets, seed * 7919, size);
        const sectors = story.sectors.filter((s) => s !== null);
        expect(sectors.filter((s) => s.kind === SectorKind.Town)).toHaveLength(1);
        expect(sectors.filter((s) => s.kind === SectorKind.Goal)).toHaveLength(1);
        expect(story.sectors.find((s) => s?.kind === SectorKind.Town)?.zoneId).toBe(IndyIds.townZone);
        // Chaque zone n'apparaît qu'une fois sur la carte.
        const zones = sectors.map((s) => s.zoneId);
        expect(new Set(zones).size).toBe(zones.length);
        expect(solve(assets, story).solvable).toBe(true);
      }
    });
  }

  it("juge atteignables les PNJ qui ne tiennent qu'à un coin entre deux obstacles", () => {
    // Zones 206 (Puzzle50) et 144 : « fermées » seulement si le coin est interdit, ce que l'original n'interdit pas.
    expect(canReachHotspot(assets, 206, [HotspotType.SpawnLocation])).toBe(true);
    expect(canReachHotspot(assets, 144, [HotspotType.SpawnLocation])).toBe(true);
    expect(canReachHotspot(assets, 353, [HotspotType.SpawnLocation])).toBe(true); // îlot, accès en diagonale
    expect(canReachHotspot(assets, 0, [HotspotType.DropQuestItem])).toBe(true); // labyrinthe scripté
    // Ces zones ne sont donc plus exclues de la génération.
    const used = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const s of generateStory(assets, seed * 101, WorldSize.Large).sectors) if (s?.kind === SectorKind.Puzzle) used.add(s.zoneId);
    }
    expect(used.has(206)).toBe(true);
  });

  it("écarte un PNJ muré (aucun passage, même en coin)", () => {
    const tiles = new Array<number>(5 * 5 * 3).fill(-1);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (x === 0 || y === 0 || x === 4 || y === 4 || (x === 2 && y === 2)) tiles[3 * (y * 5 + x) + Layer.Object] = 0;
    // Mur plein autour ; le PNJ (2,2) est lui-même un obstacle au centre d'un vide fermé.
    const zone = { id: 0, width: 5, height: 5, tiles, actions: [], hotspots: [{ type: HotspotType.SpawnLocation, x: 2, y: 2, argument: -1, enabled: true }] };
    const fake = new Assets({ zones: [zone], tiles: [{ attributes: 0 }] } as never);
    expect(canReachHotspot(fake, 0, [HotspotType.SpawnLocation])).toBe(false);
  });

  it("le solveur franchit un coin entre deux obstacles, comme le moteur", () => {
    // Obstacles partout sauf la diagonale (0,0) (1,1) (2,2) ; le hotspot est contre (2,2).
    const obstacle = 0;
    const tiles = new Array<number>(4 * 4 * 3).fill(-1);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (x !== y || x === 3) tiles[3 * (y * 4 + x) + Layer.Object] = obstacle;
    const zone = {
      id: 0,
      width: 4,
      height: 4,
      tiles,
      actions: [],
      hotspots: [{ type: HotspotType.SpawnLocation, x: 3, y: 3, argument: -1, enabled: true }],
    };
    const fake = new Assets({ zones: [zone], tiles: [{ attributes: 0 }] } as never);
    expect(canReachHotspot(fake, 0, [HotspotType.SpawnLocation])).toBe(true);
  });
});
