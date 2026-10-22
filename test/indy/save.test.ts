import { describe, expect, it } from "vitest";
import { type GameSnapshot, SAVE_VERSION, migrateSnapshot } from "../../src/games/indy/engine/game";

/** Sauvegarde au format v1 : `puzzleCount` dans l'histoire, ni `difficultySum` ni `difficultyCount`. */
const v1 = () => ({
  version: 1,
  story: { seed: 7, size: 1, sectors: [], goalPuzzle: 3, hotspotArguments: [], puzzleCount: 9, startItem: -1 },
  settings: { difficulty: 70 },
  zones: [],
  zoneId: 120,
  hero: { x: 1, y: 2, health: 300 },
  inventory: [],
  weapon: -1,
  gameWon: false,
  playedMs: 1234,
});

describe("migration des sauvegardes", () => {
  it("passe une v1 à la version courante : pace = puzzles + 1, difficulté de la partie comptée une fois", () => {
    const migrated = migrateSnapshot(v1())!;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.story.pace).toBe(10);
    expect("puzzleCount" in migrated.story).toBe(false);
    expect(migrated.difficultySum).toBe(70);
    expect(migrated.difficultyCount).toBe(1);
    expect(migrated.playedMs).toBe(1234);
    expect(migrated.story.goalPuzzle).toBe(3);
  });

  it("laisse une sauvegarde courante intacte", () => {
    const current = { ...v1(), version: SAVE_VERSION, difficultySum: 5, difficultyCount: 2 } as unknown as GameSnapshot;
    expect(migrateSnapshot(current)).toBe(current);
  });

  it("refuse une version inconnue ou une valeur invalide", () => {
    expect(migrateSnapshot({ ...v1(), version: 99 })).toBeNull();
    expect(migrateSnapshot(null)).toBeNull();
    expect(migrateSnapshot("x")).toBeNull();
  });
});
