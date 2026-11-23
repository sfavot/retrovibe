import { beforeEach, describe, expect, it, vi } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import type { GameData } from "../../src/engine/desktop-adventures/data/types";
import { type GameSnapshot, SAVE_VERSION } from "../../src/engine/desktop-adventures/game";
import { parseSnapshot } from "../../src/engine/desktop-adventures/snapshot";
import { SectorKind } from "../../src/engine/desktop-adventures/world";

const files = new Map<string, string>();
vi.mock("../../src/ui/desktop-adventures/storage", () => ({
  storage: {
    get: (k: string) => files.get(k) ?? null,
    set: (k: string, v: string) => void files.set(k, v),
    remove: (k: string) => void files.delete(k),
  },
}));
const { createSaveSlot } = await import("../../src/ui/desktop-adventures/save");

/** Données minimales : 2 zones de 3x3, 10 tuiles, 2 personnages, 2 puzzles. */
const zone = (id: number) => ({
  id,
  width: 3,
  height: 3,
  tiles: new Int16Array(27).fill(-1),
  hotspots: [{ type: 0, x: 1, y: 1, enabled: true, argument: -1 }],
  monsters: [{ character: 1, x: 2, y: 2 }],
  actions: [{}],
});
const assets = new Assets({
  tiles: Array.from({ length: 10 }, () => ({ name: "", attributes: 0 })),
  zones: [zone(0), zone(1)],
  puzzles: [{}, {}],
  characters: [{}, {}],
} as unknown as GameData);

const sector = (zoneId: number) => ({
  zoneId,
  kind: SectorKind.Puzzle,
  requiredItem: 3,
  additionalRequiredItem: -1,
  findItem: -1,
  npc: -1,
  puzzle: 0,
  offerPuzzle: -1,
  solved: false,
  visited: true,
});

const valid = (): GameSnapshot => ({
  version: SAVE_VERSION,
  story: {
    seed: 42,
    size: 2,
    sectors: [sector(0), null, sector(1)],
    goalPuzzle: 1,
    hotspotArguments: [[0, [[0, 5]]]],
    pace: 10,
    startItem: -1,
  },
  settings: { difficulty: 50, gamesWon: 1 },
  zones: [
    {
      id: 0,
      tiles: Array.from({ length: 27 }, (_, i) => (i % 3 === 0 ? 4 : -1)),
      hotspots: [{ type: 0, x: 1, y: 1, enabled: true, argument: 5 }],
      monsters: [
        {
          index: 0,
          character: 1,
          x: 2,
          y: 2,
          enabled: true,
          damageTaken: 0,
          facing: 1,
          cooldown: 0,
          preferredDirection: 1,
          phase: 0,
          phaseFrames: 0,
          bullet: { x: 1, y: 2, dx: 1, dy: 0, travelled: 1 },
        },
      ],
      actionEnabled: [true],
      counter: 2,
      sectorCounter: 1,
      random: 123456,
      initialized: true,
      visited: true,
      doorInLocation: { x: 0, y: 1 },
    },
  ],
  zoneId: 0,
  hero: { x: 1, y: 2, facing: 2, visible: true, health: 250, walkFrame: 1 },
  inventory: [3, 7],
  weapon: 1,
  gameWon: false,
  playedMs: 5000,
  difficultySum: 100,
  difficultyCount: 2,
});

/** Une copie de `valid()` modifiée à un chemin donné. */
const forged = (edit: (s: any) => void): GameSnapshot => {
  const s = valid();
  edit(s);
  return s;
};

describe("validation d'une sauvegarde contre les données du jeu", () => {
  it("relit à l'identique une sauvegarde valide (via JSON)", () => {
    const snapshot = JSON.parse(JSON.stringify(valid())) as GameSnapshot;
    expect(parseSnapshot(snapshot, assets)).toEqual(snapshot);
  });

  it("n'en retient que les champs connus", () => {
    const s = forged((s) => {
      s.hero.__proto__x = 1;
      s.hero.extra = "<script>";
      s.extra = 1;
    });
    const parsed = parseSnapshot(s, assets)!;
    expect(Object.keys(parsed.hero).sort()).toEqual(["facing", "health", "visible", "walkFrame", "x", "y"]);
    expect("extra" in parsed).toBe(false);
  });

  it.each<[string, (s: any) => void]>([
    ["zone du héros inexistante", (s) => (s.zoneId = 99)],
    ["héros hors de la zone", (s) => (s.hero.x = 3)],
    ["coordonnée non entière", (s) => (s.hero.y = 1.5)],
    ["vie hors bornes", (s) => (s.hero.health = 1e9)],
    ["vie non numérique", (s) => (s.hero.health = "300")],
    ["direction inconnue", (s) => (s.hero.facing = 9)],
    ["objet d'inventaire inexistant", (s) => (s.inventory = [3, 500])],
    ["inventaire non tableau", (s) => (s.inventory = "x")],
    ["arme inexistante", (s) => (s.weapon = 7)],
    ["temps négatif", (s) => (s.playedMs = -1)],
    ["difficulté infinie", (s) => (s.settings.difficulty = null)],
    ["tuiles de zone en nombre erroné", (s) => (s.zones[0].tiles = [1, 2, 3])],
    ["tuile inexistante", (s) => (s.zones[0].tiles[0] = 9999)],
    ["zone dupliquée", (s) => s.zones.push(structuredClone(s.zones[0]))],
    ["zone de sauvegarde inexistante", (s) => (s.zones[0].id = 5)],
    ["hotspots en nombre erroné", (s) => (s.zones[0].hotspots = [])],
    ["type de hotspot inconnu", (s) => (s.zones[0].hotspots[0].type = 99)],
    ["monstre de personnage inexistant", (s) => (s.zones[0].monsters[0].character = 9)],
    ["trop de monstres", (s) => s.zones[0].monsters.push(s.zones[0].monsters[0])],
    ["actions en nombre erroné", (s) => (s.zones[0].actionEnabled = [true, true])],
    ["secteur de zone inexistante", (s) => (s.story.sectors[0].zoneId = 50)],
    ["type de secteur inconnu", (s) => (s.story.sectors[0].kind = "boss")],
    ["trop de secteurs", (s) => (s.story.sectors = Array(101).fill(null))],
    ["taille de monde inconnue", (s) => (s.story.size = 7)],
    ["argument de hotspot hors zone", (s) => (s.story.hotspotArguments = [[0, [[4, 1]]]])],
    ["argument de zone inexistante", (s) => (s.story.hotspotArguments = [[9, []]])],
    ["puzzle inexistant", (s) => (s.story.goalPuzzle = 8)],
    ["histoire absente", (s) => delete s.story],
  ])("refuse : %s", (_name, edit) => {
    expect(parseSnapshot(forged(edit), assets)).toBeNull();
  });
});

describe("emplacement de sauvegarde", () => {
  beforeEach(() => files.clear());

  it("relit ce qu'il a écrit", () => {
    const slot = createSaveSlot("test", assets);
    slot.write(valid());
    expect(slot.read()).toEqual(valid());
  });

  it("traite une sauvegarde forgée comme une absence de sauvegarde", () => {
    const slot = createSaveSlot("test", assets);
    files.set("test", JSON.stringify(forged((s) => (s.zoneId = 99))));
    expect(slot.read()).toBeNull();
    files.set("test", "{\"version\":2,\"story\":null}");
    expect(slot.read()).toBeNull();
  });
});
