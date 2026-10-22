import { describe, expect, it } from "vitest";
import { Game } from "../../src/games/lost-in-time/engine/game";
import { HeadlessHost, NullSubsystems } from "../../src/games/lost-in-time/engine/host";
import { Script } from "../../src/games/lost-in-time/engine/script";

/**
 * Script synthétique : while (cond) { o1_animate(); }.
 * Bloc extérieur (1 commande) = o1_whileDo(cond = [imm8 1, fin]) + bloc corps (1 commande, o1_animate = 0xf6).
 */
const WHILE_SCRIPT = [1, 1, 11, 0, 0x70, 21, 1, 99, 1, 1, 3, 0, 0xf6];

function makeGame(iterations: number, bytes: number[] = WHILE_SCRIPT) {
  const host = new HeadlessHost({ readFile: () => undefined });
  const game = new Game(host, new NullSubsystems(), { maxSteps: 1_000_000 });
  const data = new Uint8Array(128 + bytes.length);
  data.set(bytes, 128);
  const script = new Script("TEST.TOT", data);
  script.pos = 128;
  script.finished = false;
  game.script = script;
  let n = 0;
  // la condition ne dépend que du nombre de tours : les corps de boucle n'ont pas à la modifier
  game.inter.bool = () => {
    if (++n > iterations + 1) throw new Error("boucle infinie : le corps ne s'exécute plus");
    return n <= iterations;
  };
  // une instruction pour le while, puis une par tour de corps
  const animates = () => game.inter.steps - 1;
  return { host, game, animates };
}

describe("progression des boucles de script", () => {
  it("while : le corps s'exécute à chaque tour (finished relevé par le saut)", async () => {
    const { game, animates } = makeGame(5);
    await game.inter.funcBlock(0);
    expect(animates()).toBe(5);
  });

  it("le budget synchrone rend la main à l'hôte au lieu de bloquer le fil principal", async () => {
    const { host, game, animates } = makeGame(5000);
    game.inter.syncBudgetSteps = 500;
    await game.inter.funcBlock(0);
    expect(animates()).toBe(5000);
    expect(host.frames).toBeGreaterThanOrEqual(5000 / 500 - 1);
  });

  it("sans budget, aucune image n'est attendue (contre-épreuve)", async () => {
    const { host, game } = makeGame(5000);
    game.inter.syncBudgetSteps = Infinity;
    game.inter.syncBudgetMs = Infinity;
    await game.inter.funcBlock(0);
    expect(host.frames).toBe(0);
  });

  it("une boucle terminée relance l'exécution (finished levé) pour la suite de l'appelant", async () => {
    // repeat { animate } until (cond) ; animate : la boucle laisse `finished` à faux, comme le seek de ScummVM
    const { game } = makeGame(1, [1, 2, 14, 0, 0x60, 1, 1, 3, 0, 0xf6, 21, 1, 99, 0xf6]);
    const seen: boolean[] = [];
    const inter = game.inter as unknown as { yieldIfBusy: () => Promise<void> };
    const original = inter.yieldIfBusy.bind(game.inter);
    inter.yieldIfBusy = () => {
      seen.push(game.script.finished);
      return original();
    };
    await game.inter.funcBlock(0);
    // avant-dernière instruction exécutée : la boucle elle-même
    expect(seen[seen.length - 2]).toBe(false);
  });
});
