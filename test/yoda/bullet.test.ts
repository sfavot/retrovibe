import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { Layer, TileFlag } from "../../src/engine/desktop-adventures/data/types";
import { readPeStrings } from "../../src/engine/desktop-adventures/data/pe-resources";
import { Direction } from "../../src/engine/desktop-adventures/geometry";
import { Game } from "../../src/engine/desktop-adventures/game";
import { WorldSize } from "../../src/engine/desktop-adventures/world";
import { generateYodaStory } from "../../src/games/yoda/generation/world-generator";
import { createYodaVariant } from "../../src/games/yoda/variant";
import { drive, silentPresenter } from "../support/desktop-bot";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

/** Zone 526 (épave gardée par un champ de force) : le générateur se coupe avec la Force tirée sur la case (10, 5). */
const FORCE_FIELD_ZONE = 526;
const THE_FORCE = 511;

async function shootTheForceFrom(prepare?: (game: Game) => void): Promise<Game> {
  const assets = new Assets(loadGameData());
  const story = generateYodaStory(assets, 6, WorldSize.Small);
  const game = new Game(createYodaVariant(readPeStrings(loadExe())), assets, story, silentPresenter);
  await drive(game, game.start(story.startZone, story.startPosition));
  // Le héros se tient en (13, 5), à trois cases de la cible : le générateur (12, 5) et (11, 5) sont des objets opaques.
  await drive(game, game.debugTeleport(FORCE_FIELD_ZONE, 13, 5));
  prepare?.(game);
  game.addItem(THE_FORCE);
  expect(game.equip(THE_FORCE)).toBe(true);
  game.hero.facing = Direction.Left;
  game.requestAttack();
  for (let t = 0; t < 8; t++) await drive(game, game.step());
  return game;
}

describe.skipIf(!hasOriginalFiles)("tir à distance de Yoda (bullet-move.ts de WebFun)", () => {
  it("le tir traverse les objets opaques et déclenche les scripts « objet posé » sur son chemin", async () => {
    const game = await shootTheForceFrom();
    // Script de la zone : le générateur saute, le passage (8, 3) s'ouvre et le compteur passe à 10 (puis 11 quand
    // les gardes arrivent).
    expect(game.zone.id).toBe(FORCE_FIELD_ZONE);
    expect(game.zone.getTile(8, 3, Layer.Object)).toBe(-1);
    expect([10, 11]).toContain(game.zone.counter);
  });

  it("un objet transparent (sprite) arrête le tir", async () => {
    let sprite = -1;
    const game = await shootTheForceFrom((g) => {
      sprite = g.assets.data.tiles.findIndex((t, id) => id > 0 && t && (t.attributes & (TileFlag.Transparent | TileFlag.Object)) === (TileFlag.Transparent | TileFlag.Object) && !g.assets.isDraggable(id));
      g.zone.setTile(11, 5, Layer.Object, sprite);
    });
    expect(sprite).toBeGreaterThan(0);
    expect(game.zone.getTile(8, 3, Layer.Object)).not.toBe(-1);
    expect([10, 11]).not.toContain(game.zone.counter);
  });
});
