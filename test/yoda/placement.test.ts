import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { HotspotType, Layer, PuzzleType } from "../../src/engine/desktop-adventures/data/types";
import { readPeStrings } from "../../src/engine/desktop-adventures/data/pe-resources";
import { Game } from "../../src/engine/desktop-adventures/game";
import { SectorKind, WorldSize } from "../../src/engine/desktop-adventures/world";
import { generateYodaStory } from "../../src/games/yoda/generation/world-generator";
import { createYodaVariant } from "../../src/games/yoda/variant";
import { drive, silentPresenter } from "../support/desktop-bot";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

async function newGame(seed: number) {
  const assets = new Assets(loadGameData());
  const story = generateYodaStory(assets, seed, WorldSize.Small);
  const game = new Game(createYodaVariant(readPeStrings(loadExe())), assets, story, silentPresenter);
  await drive(game, game.start(story.startZone, story.startPosition));
  return { assets, story, game };
}

/** Zone 358 (graine 4, petit monde) : puzzle « Offer » ; son script ouvre la porte (8, 11) quand on y pose l'objet demandé. */
const OFFER_SEED = 4;
const OFFER_ZONE = 358;

describe.skipIf(!hasOriginalFiles)("Yoda : objet posé sur un verrou", () => {
  it("offre : l'objet ouvre le verrou, résout le secteur, et les scripts « objet posé » de la zone s'exécutent", async () => {
    const { story, game, assets } = await newGame(OFFER_SEED);
    const sector = story.sectors.find((s) => s?.zoneId === OFFER_ZONE)!;
    expect(sector.kind).toBe(SectorKind.Puzzle);
    expect(assets.puzzle(sector.puzzle)?.type).toBe(PuzzleType.Offer);
    await drive(game, game.debugTeleport(OFFER_ZONE, 7, 12));
    const lock = game.zone.hotspots.find((h) => h.type === HotspotType.Lock && h.enabled)!;
    expect(lock.argument).toBe(sector.requiredItem);
    const door = game.zone.getTile(lock.x, lock.y, Layer.Object);
    game.addItem(sector.requiredItem);
    game.requestPlacement(sector.requiredItem, lock.x, lock.y);
    await drive(game, game.step());
    // Règle de l'offre (WebFun `executePlacedTileHotspots`) : objet pris, secteur résolu…
    expect(game.inventory).not.toContain(sector.requiredItem);
    expect(sector.solved).toBe(true);
    // … puis le script de la zone (PlacedItemIs sur la porte) : la porte s'ouvre et le PNJ s'avance.
    expect(game.zone.getTile(lock.x, lock.y, Layer.Object)).not.toBe(door);
    expect(game.zone.getTile(8, 12, Layer.Object)).toBe(1056);
  });

  it("barrage : le verrou prend l'objet demandé et résout le secteur (règle commune)", async () => {
    let checked = false;
    for (let seed = 1; seed <= 20 && !checked; seed++) {
      const { story, game } = await newGame(seed);
      for (const sector of story.sectors) {
        if (sector?.kind !== SectorKind.Blockade || sector.requiredItem < 0) continue;
        await drive(game, game.debugTeleport(sector.zoneId, 0, 0));
        const lock = game.zone.hotspots.find((h) => h.type === HotspotType.Lock && h.enabled);
        if (!lock) continue;
        game.hero.x = lock.x;
        game.hero.y = lock.y === 0 ? 1 : lock.y - 1;
        game.addItem(sector.requiredItem);
        game.requestPlacement(sector.requiredItem, lock.x, lock.y);
        await drive(game, game.step());
        expect(game.inventory).not.toContain(sector.requiredItem);
        expect(sector.solved).toBe(true);
        checked = true;
        break;
      }
    }
    expect(checked).toBe(true);
  });
});
