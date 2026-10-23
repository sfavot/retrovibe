import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import { GargamelScene, createGargamel, gargamelClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s32-gargamel";
import { hasOriginalFiles } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame } from "./harness";

const INGREDIENT = 4;

/** Objectif avec (ou sans) l'ingrédient 4 : la vidéo de fin en dépend. */
const goalWith = (required: boolean) => (game: ReturnType<typeof newGame>) => {
  if (required) game.state.goal.ingredients |= 1 << INGREDIENT;
  else game.state.goal.ingredients &= ~(1 << INGREDIENT);
};

describe("S32 : choix de la vidéo (pur)", () => {
  const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));

  it("échec : s32b ; réussite : s32cd2 si l'ingrédient 4 est dans l'objectif, s32cd1 sinon", () => {
    expect(gargamelClip(game, false)).toBe("s32b.mux");
    goalWith(true)(game);
    expect(gargamelClip(game, true)).toBe("s32cd2.mux");
    goalWith(false)(game);
    expect(gargamelClip(game, true)).toBe("s32cd1.mux");
  });

  it("la requête est exigée : sans Game.openMinigame(32) la scène ne se construit pas", () => {
    expect(() => createGargamel(game, () => undefined)).toThrow(/openMinigame\(32\)/);
    game.openMinigame(22);
    expect(() => createGargamel(game, () => undefined)).toThrow(/openMinigame\(32\)/);
  });
});

describe.skipIf(!hasOriginalFiles)("S32 Chez Gargamel : hasard pur, puis une vidéo", () => {
  /** Premier numéro de graine (1, 2, …) dont le tirage a le résultat voulu, sur la scène lancée. */
  async function findSeed(success: boolean, options: { level?: number; bonus?: boolean; required?: boolean } = {}) {
    for (let seed = 1; seed < 200; seed++) {
      const run = await launchMinigame(32, { seed, level: options.level ?? 0, bonus: options.bonus, setup: goalWith(options.required ?? false) });
      if ((run.scene as GargamelScene).success === success) return run;
    }
    throw new Error("aucune graine ne donne ce résultat");
  }

  it("réussite : vidéo s32cd1 (hors objectif), issue ingrédient réussi, l'ingrédient 4 est donné", async () => {
    const run = await findSeed(true);
    const scene = run.scene as GargamelScene;
    expect(scene.file).toBe("s32cd1.mux");
    expect(run.game.state.pending).toMatchObject({ scene: 32, level: 0, successChance: 0.5 });
    // La vidéo (90 images à 11 images/s) tient l'écran ; l'issue n'est rendue qu'à sa fin.
    await run.run(3000);
    expect(run.outcome).toBeUndefined();
    run.shot("s32-succes-milieu");
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "ingredient", success: true });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients & (1 << INGREDIENT)).not.toBe(0);
    expect(run.game.player.ingredientCount).toBe(1);
  }, 60_000);

  it("réussite avec l'ingrédient dans l'objectif : s32cd2", async () => {
    const run = await findSeed(true, { required: true });
    expect((run.scene as GargamelScene).file).toBe("s32cd2.mux");
    await run.finish();
  }, 60_000);

  it("échec : vidéo s32b, issue ingrédient raté, rien n'est donné", async () => {
    const run = await findSeed(false, { level: 2 });
    const scene = run.scene as GargamelScene;
    expect(scene.file).toBe("s32b.mux");
    expect(run.game.state.pending?.successChance).toBeCloseTo(1 / 4);
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "ingredient", success: false });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients).toBe(0);
  }, 60_000);

  it("l'indice de l'oiseau rend la réussite certaine, à tous les niveaux", async () => {
    for (const level of [0, 1, 2]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const run = await launchMinigame(32, { seed, level, bonus: true });
        expect(run.game.state.pending).toMatchObject({ bonus: true, successChance: 1 });
        expect((run.scene as GargamelScene).success).toBe(true);
        expect(run.game.state.bonusTag).toBe(0);
      }
    }
  }, 60_000);

  it("graine fixe : même tirage, même vidéo", async () => {
    const a = await launchMinigame(32, { seed: 42, level: 1 });
    const b = await launchMinigame(32, { seed: 42, level: 1 });
    expect((a.scene as GargamelScene).success).toBe((b.scene as GargamelScene).success);
    expect((a.scene as GargamelScene).file).toBe((b.scene as GargamelScene).file);
  }, 30_000);

  it("le niveau règle la chance : 1/2, 1/3, 1/4 (sur 240 parties de graines différentes)", async () => {
    const wins = [0, 0, 0];
    const games = 240;
    for (let level = 0; level < 3; level++) {
      for (let seed = 1; seed <= games; seed++) {
        const run = await launchMinigame(32, { seed: seed * 7919 + level, level });
        if ((run.scene as GargamelScene).success) wins[level]++;
      }
    }
    for (const [level, chance] of [[0, 1 / 2], [1, 1 / 3], [2, 1 / 4]] as const) {
      expect(Math.abs(wins[level] / games - chance)).toBeLessThan(0.09);
    }
    expect(wins[0]).toBeGreaterThan(wins[1]);
    expect(wins[1]).toBeGreaterThan(wins[2]);
  }, 180_000);

  it("la vidéo se passe avec Échap, sans attendre sa fin", async () => {
    const run = await launchMinigame(32, { seed: 3 });
    await run.run(1500);
    expect(run.outcome).toBeUndefined();
    await run.tap("Escape");
    expect(await run.finish(5000)).toMatchObject({ kind: "ingredient" });
  }, 30_000);

  it("la vidéo joue sur la voie son et la scène la coupe en partant", async () => {
    const run = await launchMinigame(32, { seed: 3, audio: true });
    await run.run(500);
    expect(run.host.audio.plays.length).toBeGreaterThan(0);
    await run.finish();
    expect(run.ctx.voice.voicePlaying).toBe(false);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S32 Chez Gargamel : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte de l'écran 7 : l'issue du tirage est appliquée, le tour est fini", async () => {
    for (const seed of [3, 5, 8]) {
      const s = await enterFromBoard(32, "GargamelScene", { seed });
      const scene = s.ctx.scenes.top as GargamelScene;
      expect(s.game.state.pending).toMatchObject({ scene: 32, player: 0 });
      expect(s.game.state.phase).toBe("minigame");
      const success = scene.success;
      await s.run(1000);
      await s.tap("Escape");
      await s.ready();
      expect(s.game.state.pending).toBeNull();
      expect(s.game.state.phase).toBe("turn");
      expect((s.game.player.ingredients & (1 << INGREDIENT)) !== 0).toBe(success);
    }
  }, 180_000);

  it("mode libre, lieu 16 : le mini-jeu se lance puis la carte revient sur le même lieu", async () => {
    const run = await enterFromFreeMode(32);
    expect(run.scene).toBeInstanceOf(GargamelScene);
    expect(run.game.state.pending).toMatchObject({ scene: 32 });
    await run.run(1000);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.shown.selection).toBe(16);
    expect(run.free.currentGame).toBeNull();
  }, 120_000);
});
