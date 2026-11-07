import { describe, expect, it, vi } from "vitest";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { originalFiles } from "../support/original";
import { boot, MIDDLE_STAGE, nameOf, PATH_SCREENS, playAdventure, tick } from "./full-game-robot";

/**
 * Robot de partie sur plusieurs graines : chaque graine change les tirages des 12 épreuves (règles, plateaux, ordre des essais), et
 * l'ordre dans lequel le groupe est choisi change l'ordre des membres. Chaque partie va de la partie neuve à Zoombiniville par le
 * chemin A ou B, avec le groupe entier. Une partie complète coûte une vingtaine de secondes : par défaut 2 graines × 2 chemins ; la liste
 * se règle par `ZB_SEEDS` (ex. `ZB_SEEDS=1,2,3,5,7 npx vitest run test/zoombinis/full-game-seeds.test.ts`, 5 graines, environ 2 minutes ;
 * `ZB_SEEDS=` vide désactive le test).
 */
vi.setConfig({ testTimeout: 60_000 });

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;

const SEEDS = (process.env.ZB_SEEDS ?? "2,5")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s !== "")
  .map(Number)
  .filter((n) => Number.isInteger(n));

/** Permutation de 0 à 15 tirée de la graine (LCG, déterministe). */
function orderFor(seed: number): number[] {
  const order = Array.from({ length: 16 }, (_, i) => i);
  let x = (seed * 2654435761) >>> 0;
  for (let i = order.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

describe.skipIf(!original.has || SEEDS.length === 0)("robot de partie : plusieurs graines", () => {
  const cases = SEEDS.flatMap((seed) => (["A", "B"] as const).map((path) => [seed, path] as const));
  it.each(cases)("graine %i, chemin %s : de la partie neuve à Zoombiniville avec les 16 Zoombinis", async (seed, path) => {
    const r = await boot(undefined, seed);
    await playAdventure(r, path, {}, orderFor(seed));
    const { game } = r.zb;
    expect(r.visited.map(nameOf)).toEqual(PATH_SCREENS[path].map(nameOf));
    expect(r.arrivals.map(([, n]) => n)).toEqual(new Array(r.arrivals.length).fill(16));
    expect(game.counters).toMatchObject({ created: 16, camp1: 0, camp2: 0, town: 16 });
    expect(game.population.count).toBe(16);
    const middle = MIDDLE_STAGE[path];
    expect(game.monuments.filter((m) => m !== null).map((m) => m!.stage)).toEqual([1, middle, 4]);
    await tick(r, 100);
    expect(r.zb.session.screen).toBe(S.town);
    expect(r.engine.error).toBeNull();
  }, 120_000);
});
