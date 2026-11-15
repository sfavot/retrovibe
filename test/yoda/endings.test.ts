import { describe, expect, it } from "vitest";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { readPeStrings } from "../../src/engine/desktop-adventures/data/pe-resources";
import { Game, type Presenter } from "../../src/engine/desktop-adventures/game";
import { WorldSize } from "../../src/engine/desktop-adventures/world";
import { generateYodaStory } from "../../src/games/yoda/generation/world-generator";
import { ZoneIds } from "../../src/games/yoda/ids";
import { createYodaVariant } from "../../src/games/yoda/variant";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

/** Fournit des ticks tant que l'opération n'est pas terminée (scripts animés des scènes de fin). */
async function drive(game: Game, operation: Promise<unknown>): Promise<void> {
  let done = false;
  const finished = operation.finally(() => (done = true));
  for (let guard = 0; guard < 3000 && !done; guard++) {
    await new Promise((r) => setImmediate(r));
    if (!done) void game.step();
  }
  await finished;
}

describe.skipIf(!hasOriginalFiles)("scènes de fin de Yoda", () => {
  const setup = async () => {
    const assets = new Assets(loadGameData());
    const story = generateYodaStory(assets, 3, WorldSize.Small);
    const endings: Array<{ kind: string; zone: number; heroVisible: boolean; score: number }> = [];
    let game!: Game;
    const presenter: Presenter = {
      speak: async () => {},
      message: async () => {},
      pickup: async () => {},
      transition: async (_, apply) => apply(),
      playSound: () => {},
      ended: async (kind, score) => void endings.push({ kind, zone: game.zone.id, heroVisible: game.hero.visible, score }),
      chooseTeleport: async () => null,
    };
    game = new Game(createYodaVariant(readPeStrings(loadExe())), assets, story, presenter);
    await drive(game, game.start(story.startZone, story.startPosition));
    return { game, endings };
  };

  it("victoire : la zone de victoire se joue, héros caché, puis la partie reprend où elle était", async () => {
    const { game, endings } = await setup();
    const before = { zone: game.zone.id, x: game.hero.x, y: game.hero.y };
    await drive(game, (game as unknown as { win(): Promise<void> }).win());
    expect(endings).toEqual([{ kind: "win", zone: ZoneIds.Win, heroVisible: false, score: game.finalScore }]);
    expect(game.finalScore).toBeGreaterThan(0);
    expect({ zone: game.zone.id, x: game.hero.x, y: game.hero.y }).toEqual(before);
    expect(game.hero.visible).toBe(true);
  });

  it("défaite : la zone de défaite s'affiche avant la fenêtre de fin", async () => {
    const { game, endings } = await setup();
    game.setHealth(0);
    await drive(game, new Promise((r) => setTimeout(r, 50)));
    expect(endings.map((e) => [e.kind, e.zone])).toEqual([["lose", ZoneIds.Lose]]);
  });
});
