import { describe, expect, it } from "vitest";
import { TileFlag } from "../../src/games/indy/data/types";
import { copy } from "../../src/games/indy/copy";
import { type ItemCategory, itemCategory, mapClue, mapClueText } from "../../src/games/indy/engine/map-clues";
import { SectorKind, emptySector } from "../../src/games/indy/engine/world";
import { hasOriginalFiles, loadGameData } from "./helpers";

const categoryOf = (tile: number): ItemCategory => (tile === 1 ? "tool" : tile === 2 ? "key" : "unknown");
const sector = (kind: SectorKind, extra: object = {}) => ({ ...emptySector(0, kind), visited: true, ...extra });

describe("indices de la carte", () => {
  it("ne révèle rien d'un secteur non visité", () => {
    expect(mapClue({ ...sector(SectorKind.Blockade, { requiredItem: 1 }), visited: false }, categoryOf)).toBeNull();
  });

  it("barrage : nécessite une catégorie, puis ouvert", () => {
    const s = sector(SectorKind.Blockade, { requiredItem: 1 });
    expect(mapClueText(mapClue(s, categoryOf)!)).toBe(copy.clueRequires(copy.clueItem.tool));
    expect(mapClueText(mapClue({ ...s, solved: true }, categoryOf)!)).toBe(copy.clueOpen);
  });

  it("passage : même logique que le barrage", () => {
    expect(mapClue(sector(SectorKind.Travel, { requiredItem: 2 }), categoryOf)).toEqual({ type: "requires", category: "key" });
    expect(mapClue(sector(SectorKind.Travel, { requiredItem: 2, solved: true }), categoryOf)).toEqual({ type: "open" });
  });

  it("puzzle et objectif : nécessite puis résolu", () => {
    expect(mapClue(sector(SectorKind.Puzzle, { requiredItem: 9 }), categoryOf)).toEqual({ type: "requires", category: "unknown" });
    expect(mapClue(sector(SectorKind.Goal, { requiredItem: 1, solved: true }), categoryOf)).toEqual({ type: "solved" });
  });

  it("objet à trouver : indice sur l'objet, puis résolu", () => {
    expect(mapClue(sector(SectorKind.Find, { findItem: 2 }), categoryOf)).toEqual({ type: "find", category: "key" });
    expect(mapClue(sector(SectorKind.Find, { findItem: 2, solved: true }), categoryOf)).toEqual({ type: "solved" });
  });

  it("pas d'indice pour la ville, les cases vides ou sans objet défini", () => {
    expect(mapClue(sector(SectorKind.Town), categoryOf)).toBeNull();
    expect(mapClue(sector(SectorKind.Empty), categoryOf)).toBeNull();
    expect(mapClue(sector(SectorKind.Blockade), categoryOf)).toBeNull();
    expect(mapClue(sector(SectorKind.Find), categoryOf)).toBeNull();
  });
});

describe("catégorie d'objet", () => {
  it("se déduit des attributs de tuile", () => {
    expect(itemCategory({ attributes: TileFlag.Item | TileFlag.Tool })).toBe("tool");
    expect(itemCategory({ attributes: TileFlag.Item | TileFlag.Key })).toBe("key");
    expect(itemCategory({ attributes: TileFlag.Item | TileFlag.Part })).toBe("part");
    expect(itemCategory({ attributes: TileFlag.Item | TileFlag.Valuable })).toBe("valuable");
    expect(itemCategory({ attributes: TileFlag.Item | TileFlag.Map })).toBe("map");
    expect(itemCategory({ attributes: TileFlag.Weapon | TileFlag.Whip })).toBe("weapon");
    expect(itemCategory({ attributes: TileFlag.Item | TileFlag.Drink })).toBe("useful");
    expect(itemCategory(undefined)).toBe("unknown");
  });

  it.skipIf(!hasOriginalFiles)("correspond aux noms des objets du jeu", () => {
    const data = loadGameData();
    const byName = (name: string) => itemCategory(data.tiles.find((t) => t.name === name));
    expect(byName("Shovel")).toBe("tool");
    expect(byName("Spark Plug")).toBe("part");
    expect(byName("Jade Statue")).toBe("valuable");
    expect(byName("Brass Key")).toBe("key");
    expect(byName("Map")).toBe("map");
    expect(byName("Tequila")).toBe("useful");
  });
});
