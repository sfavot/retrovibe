import { describe, expect, it } from "vitest";
import { Assets, IndyIds } from "../../src/games/indy/engine/assets";
import { generateStory } from "../../src/games/indy/engine/generation/generator";
import { canReachHotspot } from "../../src/games/indy/engine/generation/reachability";
import { solve } from "../../src/games/indy/engine/generation/solver";
import { HotspotType } from "../../src/games/indy/data/types";
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

  it("écarte les zones dont le PNJ est inaccessible à pied", () => {
    expect(canReachHotspot(assets, 206, [HotspotType.SpawnLocation])).toBe(false); // canyon fermé
    expect(canReachHotspot(assets, 144, [HotspotType.SpawnLocation])).toBe(false);
    expect(canReachHotspot(assets, 353, [HotspotType.SpawnLocation])).toBe(true); // îlot, accès en diagonale
    expect(canReachHotspot(assets, 0, [HotspotType.DropQuestItem])).toBe(true); // labyrinthe scripté
    for (let seed = 1; seed <= 40; seed++) {
      const story = generateStory(assets, seed * 101, WorldSize.Large);
      const used = story.sectors.filter((s) => s?.kind === SectorKind.Puzzle).map((s) => s!.zoneId);
      expect(used).not.toContain(206);
      expect(used).not.toContain(144);
    }
  });
});
