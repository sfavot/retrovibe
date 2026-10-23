import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import { MINIGAMES } from "../../../src/games/teleportaschtroumpf/game/tables";
import {
  MINIGAME_IDS,
  MinigameStub,
  STUB_POINTS,
  createMinigame,
  createMinigameAftermath,
  forceMinigameStubs,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame } from "./harness";

const oneGame = () => newGame({ players: [{ character: 0 }] }, new BorlandRandom(7));

/** Les 20 fichiers attendus dans `scenes/minigames/` (un par mini-jeu, noms figés pour le travail en parallèle). */
const FILES: Readonly<Record<number, string>> = {
  22: "s22-dragon",
  23: "s23-musician",
  24: "s24-puzzle",
  25: "s25-observation",
  26: "s26-sound-game",
  27: "s27-sled",
  28: "s28-black-smurfs",
  29: "s29-birthday",
  30: "s30-bridge",
  31: "s31-turtles",
  32: "s32-gargamel",
  33: "s33-magic-formula",
  34: "s34-stork",
  35: "s35-coloring",
  36: "s36-mine",
  38: "s38-glasses",
  39: "s39-bird",
  40: "s40-quiz",
  41: "s41-magician",
  51: "s51-gifts",
};

describe("registre des mini-jeux", () => {
  it("couvre exactement les codes de la table de portes, sauf le puits (S13, events.ts)", () => {
    expect([...MINIGAME_IDS].sort((a, b) => a - b)).toEqual(MINIGAMES.map((m) => m.scene).filter((scene) => scene !== 14).sort((a, b) => a - b));
    expect(MINIGAME_IDS).toHaveLength(20);
    expect(() => createMinigame(14, oneGame(), () => undefined)).toThrow(RangeError);
    expect(() => createMinigame(37, oneGame(), () => undefined)).toThrow(RangeError);
  });

  it.each(MINIGAME_IDS.map((id) => [id, FILES[id]]))("scène %i : le fichier %s est inscrit et rend une scène", async (id, file) => {
    const module = (await import(`../../../src/games/teleportaschtroumpf/scenes/minigames/${file}.ts`)) as Record<string, unknown>;
    expect(Object.values(module).some((value) => typeof value === "function")).toBe(true);
    const game = oneGame();
    game.openMinigame(id as number);
    const scene = createMinigame(id as number, game, () => undefined);
    // Les 20 mini-jeux sont écrits : aucun ne rend plus la souche commune (réservée aux tests de parcours, `forceMinigameStubs`).
    expect(scene).not.toBeInstanceOf(MinigameStub);
    expect(typeof scene.enter).toBe("function");
    expect(typeof scene.update).toBe("function");
    expect(typeof scene.render).toBe("function");
  });

  it("la présentation de l'issue (S38, S39) est vide sans événement à montrer et sous souches forcées ; les autres numéros n'en ont pas", () => {
    for (const id of [22, 27, 32, 38, 39]) expect(createMinigameAftermath(id, oneGame(), [], () => undefined)).toBeNull();
    forceMinigameStubs();
    try {
      expect(createMinigameAftermath(38, oneGame(), [], () => undefined)).toBeNull();
      expect(createMinigameAftermath(39, oneGame(), [], () => undefined)).toBeNull();
    } finally {
      forceMinigameStubs(false);
    }
  });
});

describe.skipIf(!hasOriginalFiles)("souches (forceMinigameStubs) : Espace = réussi, Entrée = échoué", () => {
  // `forceMinigameStubs()` ne sert plus qu'aux tests de parcours du plateau et de la partie (voir `engine-ts.md`) : la souche reste
  // vérifiée ici pour qu'ils restent valables. Le module est propre à ce fichier de test.
  beforeAll(() => forceMinigameStubs());
  afterAll(() => forceMinigameStubs(false));

  it.each(MINIGAME_IDS.map((id) => [id]))("scène %i : une souche rend une issue du type attendu par Game.resolveMinigame", async (id) => {
    const probe = oneGame();
    probe.openMinigame(id);
    expect(createMinigame(id, probe, () => undefined)).toBeInstanceOf(MinigameStub);
    for (const [key, success] of [["Space", true], ["Enter", false]] as const) {
      const run = await launchMinigame(id);
      await run.run(300);
      await run.tap(key);
      const outcome = await run.finish();
      run.game.resolveMinigame(outcome);
      const info = MINIGAMES.find((m) => m.scene === id)!;
      const player = run.game.state.players[0];
      if (info.kind === "points") expect(player.points).toBe(success ? STUB_POINTS : 0);
      if (info.kind === "ingredient") expect(((player.ingredients >> info.ingredient!) & 1) === 1).toBe(success);
    }
  }, 60_000);

  it("le magicien (S41, souche) échange 3 points contre le premier ingrédient manquant", async () => {
    const probe = oneGame();
    probe.openMinigame(41);
    expect(createMinigame(41, probe, () => undefined)).toBeInstanceOf(MinigameStub);
    const run = await launchMinigame(41, { setup: (game) => (game.player.points = 5) });
    await run.run(300);
    await run.tap("Space");
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "magician", choice: 0 });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(2);
    expect(run.game.player.ingredients & 1).toBe(1);
  }, 60_000);
});
