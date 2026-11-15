import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { readPeStrings } from "../../src/engine/desktop-adventures/data/pe-resources";
import { Game, MAX_HEALTH, type Presenter } from "../../src/engine/desktop-adventures/game";
import { WorldSize } from "../../src/engine/desktop-adventures/world";
import { generateYodaStory } from "../../src/games/yoda/generation/world-generator";
import { TileIds } from "../../src/games/yoda/ids";
import { YodaSounds } from "../../src/games/yoda/sounds";
import { createYodaVariant } from "../../src/games/yoda/variant";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

/** Sons joués en dur par YODESK.EXE (adresses dans src/games/yoda/variant.ts). */
describe.skipIf(!hasOriginalFiles)("sons et règles vérifiés dans YODESK.EXE", () => {
  const setup = () => {
    const assets = new Assets(loadGameData());
    const story = generateYodaStory(assets, 3, WorldSize.Small);
    const sounds: number[] = [];
    const endings: string[] = [];
    const presenter: Presenter = {
      speak: async () => {},
      message: async () => {},
      pickup: async () => {},
      transition: async (_, apply) => apply(),
      playSound: (id) => void sounds.push(id),
      ended: async (kind) => void endings.push(kind),
      chooseTeleport: async () => null,
    };
    const game = new Game(createYodaVariant(readPeStrings(loadExe())), assets, story, presenter);
    game.zone = game.zoneState(story.startZone);
    return { game, sounds, endings };
  };

  it("un objet ajouté fait « shpoonk », sauf un second localisateur", () => {
    const { game, sounds } = setup();
    game.addItem(TileIds.Locator);
    game.addItem(TileIds.Locator);
    game.addItem(TileIds.R2D2);
    expect(sounds.filter((s) => s === YodaSounds.Shpoonk)).toHaveLength(2);
  });

  it("un soin fait « schwing »", async () => {
    const { game, sounds } = setup();
    game.hero.health = 100;
    game.addItem(507);
    sounds.length = 0;
    expect(await game.consume(507)).toBe(true);
    expect(game.hero.health).toBe(125);
    expect(sounds).toEqual([YodaSounds.Schwing]);
  });

  it("le Spirit Heart sauve Luke une fois, avec FLOURISH.WAV", () => {
    const { game, sounds, endings } = setup();
    game.addItem(TileIds.SpiritHeart);
    sounds.length = 0;
    game.setHealth(0);
    expect(game.hero.health).toBe(MAX_HEALTH);
    expect(game.inventory).not.toContain(TileIds.SpiritHeart);
    expect(sounds).toEqual([YodaSounds.Flourish]);
    expect(game.over).toBe(false);
    game.setHealth(0);
    expect(game.over).toBe(true);
    expect(endings).toEqual([]); // la fenêtre arrive après la scène de fin, de façon asynchrone
  });
});
