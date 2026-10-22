import { TileFlag, type Tile } from "../data/types";
import { copy } from "../copy";
import { type Sector, SectorKind } from "./world";

/** Famille d'un objet, telle que l'original l'évoque dans ses indices (« a tool... », « a key... »). */
export type ItemCategory = "weapon" | "map" | "tool" | "part" | "valuable" | "key" | "useful" | "unknown";

/**
 * Catégorie déduite des attributs de la tuile (vérifié sur DESKTOP.DAW : Dynamite/Pelle/Pioche/Corde = outil,
 * Engrenage/Bougie d'allumage = pièce, Masques/Statuettes = valeur, Clés/Planche = clé, « Map » = carte).
 * Les bits hauts de la famille Item (Key…Map) sont exclusifs ; Weapon est une famille à part (1 << 6) ;
 * boissons, nourriture et tout autre objet sont « quelque chose d'utile » ; tuile absente : « inconnu ».
 */
export function itemCategory(tile: Pick<Tile, "attributes"> | undefined): ItemCategory {
  if (!tile) return "unknown";
  const a = tile.attributes;
  if (a & TileFlag.Weapon) return "weapon";
  if (a & TileFlag.Item) {
    if (a & TileFlag.Map) return "map";
    if (a & TileFlag.Tool) return "tool";
    if (a & TileFlag.Part) return "part";
    if (a & TileFlag.Valuable) return "valuable";
    if (a & TileFlag.Key) return "key";
  }
  return "useful";
}

export type MapClue =
  | { type: "requires" | "find"; category: ItemCategory }
  | { type: "open" | "solved" };

/**
 * Indice affiché en touchant le symbole d'un secteur sur la carte, ou null s'il n'y en a pas
 * (secteur inconnu, ville, case vide, ou objet non défini). Ne dépend que de l'état du secteur.
 */
export function mapClue(sector: Sector, categoryOf: (tile: number) => ItemCategory): MapClue | null {
  if (!sector.visited) return null;
  const requires = (): MapClue | null =>
    sector.requiredItem >= 0 ? { type: "requires", category: categoryOf(sector.requiredItem) } : null;
  switch (sector.kind) {
    case SectorKind.Blockade:
    case SectorKind.Travel:
      return sector.solved ? { type: "open" } : requires();
    case SectorKind.Puzzle:
    case SectorKind.Goal:
      return sector.solved ? { type: "solved" } : requires();
    case SectorKind.Find:
      if (sector.solved) return { type: "solved" };
      return sector.findItem >= 0 ? { type: "find", category: categoryOf(sector.findItem) } : null;
    default:
      return null;
  }
}

export function mapClueText(clue: MapClue): string {
  switch (clue.type) {
    case "requires":
      return copy.clueRequires(copy.clueItem[clue.category]);
    case "find":
      return copy.clueFind(copy.clueItem[clue.category]);
    case "open":
      return copy.clueOpen;
    case "solved":
      return copy.clueSolved;
  }
}
