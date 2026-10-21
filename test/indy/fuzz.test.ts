import { describe, expect, it } from "vitest";
import { Assets, IndyIds } from "../../src/games/indy/engine/assets";
import { Game, type Presenter } from "../../src/games/indy/engine/game";
import { generateStory } from "../../src/games/indy/engine/generation/generator";
import { Rng } from "../../src/games/indy/engine/rng";
import { WorldSize } from "../../src/games/indy/engine/world";
import { hasOriginalFiles, loadGameData } from "./helpers";

const presenter: Presenter = {
  speak: async () => {},
  message: async () => {},
  pickup: async () => {},
  transition: async (_, apply) => apply(),
  playSound: () => {},
  ended: async () => {},
  chooseTeleport: async (d) => d[0] ?? null,
};

/** Attend une opération en fournissant des ticks tant qu'elle n'est pas terminée (scripts animés). */
async function drive(game: Game, operation: Promise<void>): Promise<void> {
  let done = false;
  const finished = operation.finally(() => (done = true));
  for (let guard = 0; guard < 3000 && !done; guard++) {
    await new Promise((r) => setImmediate(r));
    if (!done) void game.step();
  }
  if (!done) throw new Error(`zone ${game.zone.id} : le jeu reste bloqué`);
  await finished;
}

const tick = (game: Game) => drive(game, game.step());

// Long (plusieurs minutes) : activé avec FUZZ=1.
describe.skipIf(!hasOriginalFiles || !process.env.FUZZ)("robustesse", () => {
  it("chaque zone supporte entrée, déplacements, attaques et objets sans erreur", { timeout: 600_000 }, async () => {
    const assets = new Assets(loadGameData());
    const story = generateStory(assets, 99, WorldSize.Large);
    const rng = new Rng(5);
    const items = assets.data.tiles.filter((t) => assets.isItemTile(t.id) || assets.isWeaponTile(t.id)).map((t) => t.id);
    const failures: string[] = [];
    const from = Number(process.env.FUZZ_FROM ?? 0);
    const to = Number(process.env.FUZZ_TO ?? assets.data.zones.length);
    for (const zone of assets.data.zones.slice(from, to)) {
      if (process.env.FUZZ_LOG) console.log("zone", zone.id);
      const game = new Game(assets, story, presenter, { difficulty: 1 });
      try {
        await drive(game, game.start(IndyIds.townZone, { x: 11, y: 5 }));
        // Une case libre de la zone comme point d'arrivée.
        const z = game.zoneState(zone.id);
        let at = { x: 0, y: 0 };
        for (let i = 0; i < z.width * z.height; i++) {
          const x = i % z.width;
          const y = Math.floor(i / z.width);
          if (z.isFree(x, y)) {
            at = { x, y };
            break;
          }
        }
        await drive(game, game.debugTeleport(zone.id, at.x, at.y));
        for (let t = 0; t < 60 && !game.over; t++) {
          game.input.move = { x: rng.mod(3) - 1, y: rng.mod(3) - 1 };
          game.input.drag = rng.mod(5) === 0;
          if (rng.mod(6) === 0) game.requestAttack();
          if (rng.mod(8) === 0) {
            const item = rng.pick(items)!;
            game.addItem(item);
            game.requestPlacement(item, game.hero.x + rng.mod(3) - 1, game.hero.y + rng.mod(3) - 1);
          }
          await tick(game);
        }
      } catch (e) {
        failures.push(`zone ${zone.id} (${zone.name}) : ${e instanceof Error ? e.stack : e}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
