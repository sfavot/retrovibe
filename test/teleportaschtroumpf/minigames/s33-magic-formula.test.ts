import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  ANSWER_EXACT,
  ANSWER_MISPLACED,
  ANSWER_NONE,
  LEVEL_DISTINCT,
  LEVEL_SYMBOLS,
  LIST_SIZE,
  MAX_ATTEMPTS,
  MagicFormulaScene,
  SYMBOL_VOICES,
  createMagicFormula,
  drawSecret,
  drawSymbols,
  formulaTargetAt,
  isSubmitSwipe,
  levelRules,
  scoreGuess,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s33-magic-formula";
import { hasOriginalFiles } from "../helpers";
import { swipe, tap, touchDown, touchUp } from "../touch";
import { Session } from "../game-helpers";
import { doorPosition, enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame } from "./harness";

const INGREDIENT = 7;

describe("S33 : règles de la formule (pur, `1ceb:000c`)", () => {
  it("niveaux : 6, 7, 8 symboles ; l'indice de l'oiseau (niveau 3) en donne 5, le moins de choix ; pas de répétition aux niveaux 0 et 3", () => {
    expect(LEVEL_SYMBOLS).toEqual([6, 7, 8, 5]);
    expect(LEVEL_DISTINCT).toEqual([true, false, false, true]);
    expect(levelRules(0)).toEqual({ symbols: 6, distinct: true });
    expect(levelRules(3)).toEqual({ symbols: 5, distinct: true });
    // Nombre de formules possibles : l'indice de l'oiseau est bien le niveau le plus facile.
    const combos = [0, 1, 2, 3].map((level) => {
      const { symbols, distinct } = levelRules(level);
      return distinct ? symbols * (symbols - 1) * (symbols - 2) : symbols ** 3;
    });
    expect(combos).toEqual([120, 343, 512, 60]);
    expect(Math.min(...combos)).toBe(combos[3]);
  });

  it("la liste : huit symboles différents parmi douze (sprites de 3 en 3), un tirage pour le premier puis un par essai", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const list = drawSymbols(new BorlandRandom(seed));
      expect(list).toHaveLength(LIST_SIZE);
      expect(new Set(list).size).toBe(LIST_SIZE);
      for (const sprite of list) {
        expect(sprite % 3).toBe(0);
        expect(sprite).toBeGreaterThanOrEqual(0);
        expect(sprite).toBeLessThan(36);
      }
    }
    // Graine fixe : même liste, et le premier symbole vient du premier tirage (`rand × 12 / 0x8000`).
    expect(drawSymbols(new BorlandRandom(9))).toEqual(drawSymbols(new BorlandRandom(9)));
    expect(drawSymbols(new BorlandRandom(9))[0]).toBe(new BorlandRandom(9).below(12) * 3);
  });

  it("la formule : trois positions dans la liste ; sans répétition aux niveaux 0 et 3, avec répétitions possibles aux autres", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const distinct = drawSecret(new BorlandRandom(seed), 5, true);
      expect(new Set(distinct).size).toBe(3);
      expect(Math.max(...distinct)).toBeLessThan(5);
    }
    const repeats = Array.from({ length: 200 }, (_, seed) => drawSecret(new BorlandRandom(seed + 1), 6, false)).filter((s) => new Set(s).size < 3);
    expect(repeats.length).toBeGreaterThan(0);
  });

  it("la réponse : 2 bien placé, 1 présent ailleurs (une seule fois par emplacement de la formule), 0 absent", () => {
    expect(scoreGuess([0, 1, 2], [0, 1, 2])).toEqual([2, 2, 2]);
    expect(scoreGuess([0, 1, 2], [3, 4, 5])).toEqual([0, 0, 0]);
    expect(scoreGuess([0, 1, 2], [1, 2, 0])).toEqual([1, 1, 1]);
    expect(scoreGuess([0, 1, 2], [0, 2, 1])).toEqual([2, 1, 1]);
    // Un symbole proposé deux fois n'est apparié qu'une fois à la formule.
    expect(scoreGuess([0, 1, 2], [1, 1, 3])).toEqual([0, 2, 0]);
    expect(scoreGuess([0, 1, 2], [3, 0, 0])).toEqual([0, 1, 0]);
    // Formule à répétition : 1 2 1 contre 1 1 1 ; chaque 1 de la formule ne sert qu'une fois.
    expect(scoreGuess([1, 2, 1], [1, 1, 1])).toEqual([2, 0, 2]);
    expect(scoreGuess([1, 1, 2], [2, 2, 1])).toEqual([1, 0, 1]);
    expect([ANSWER_NONE, ANSWER_MISPLACED, ANSWER_EXACT]).toEqual([0, 1, 2]);
  });

  it("les voix des symboles : s33a003t à s33a014t", () => {
    expect(SYMBOL_VOICES).toHaveLength(12);
    expect(new Set(SYMBOL_VOICES).size).toBe(12);
    expect(Math.min(...SYMBOL_VOICES) + 3).toBe(3);
    expect(Math.max(...SYMBOL_VOICES) + 3).toBe(14);
  });

  it("doigt : chaque ligne de la liste désigne son symbole, chaque cadre du bas son emplacement, le reste rien", () => {
    for (let i = 0; i < 6; i++) {
      expect(formulaTargetAt(40, 0x18 + i * 0x16, 6)).toEqual({ kind: "symbol", index: i });
      expect(formulaTargetAt(12, 0x18 + i * 0x16 - 10, 6)).toEqual({ kind: "symbol", index: i });
    }
    expect(formulaTargetAt(40, 0x18 + 6 * 0x16, 6)).toBeNull();
    expect(formulaTargetAt(40, 0x18 + 6 * 0x16, 7)).toEqual({ kind: "symbol", index: 6 });
    expect(formulaTargetAt(40, 4, 6)).toBeNull();
    for (let j = 0; j < 3; j++) {
      expect(formulaTargetAt(0x69 + j * 0x41 + 0x1e, 0xa8, 6)).toEqual({ kind: "slot", index: j });
      expect(formulaTargetAt(0x69 + j * 0x41 + 2, 0xa1, 6)).toEqual({ kind: "slot", index: j });
    }
    expect(formulaTargetAt(200, 60, 6)).toBeNull();
    expect(formulaTargetAt(200, 0xb1 + 20, 6)).toBeNull();
    expect(formulaTargetAt(0x5a, 0xa8, 6)).toBeNull();
  });

  it("doigt : proposer, c'est glisser vers le haut depuis la partie droite (proposition ou parchemin)", () => {
    expect(isSubmitSwipe({ x: 200, dx: 0, dy: -40 })).toBe(true);
    expect(isSubmitSwipe({ x: 120, dx: 10, dy: -20 })).toBe(true);
    expect(isSubmitSwipe({ x: 200, dx: 0, dy: 40 })).toBe(false);
    expect(isSubmitSwipe({ x: 200, dx: 40, dy: -20 })).toBe(false);
    expect(isSubmitSwipe({ x: 40, dx: 0, dy: -40 })).toBe(false);
  });

  it("la requête est exigée : Game.openMinigame(33) d'abord", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createMagicFormula(game, () => undefined)).toThrow(/openMinigame\(33\)/);
  });
});

// --- Pilote ---------------------------------------------------------------------------------------------

interface Driver {
  tap(code: string, ms?: number): Promise<void>;
  until(done: () => boolean, limitMs?: number): Promise<void>;
}

const TAP_MS = 130;

/** Place le curseur de liste sur `target` pour l'emplacement courant (le plus court chemin, la liste boucle). */
async function pick(driver: Driver, scene: MagicFormulaScene, column: number, target: number): Promise<void> {
  while (scene.selectedColumn < column) await driver.tap("ArrowRight", TAP_MS);
  while (scene.selectedColumn > column) await driver.tap("ArrowLeft", TAP_MS);
  while (scene.guess[column] !== target) {
    const forward = (target - scene.guess[column] + scene.symbols) % scene.symbols;
    await driver.tap(forward <= scene.symbols / 2 ? "ArrowDown" : "ArrowUp", TAP_MS);
  }
}

/** Compose une proposition, la valide, attend la fin de l'animation de la réponse. */
async function propose(driver: Driver, scene: MagicFormulaScene, picks: readonly number[]): Promise<void> {
  const before = scene.attemptCount;
  for (let column = 0; column < 3; column++) await pick(driver, scene, column, picks[column]);
  await driver.tap("Space", TAP_MS);
  expect(scene.attemptCount).toBe(before + 1);
  await driver.until(() => !scene.answering || scene.stage !== "play", 30_000);
}

/** Une proposition fausse à coup sûr : trois positions qui ne sont pas dans la formule, ou à défaut des positions décalées. */
function wrongPicks(scene: MagicFormulaScene, salt: number): number[] {
  const absent = Array.from({ length: scene.symbols }, (_, i) => i).filter((i) => !scene.secret.includes(i));
  return [0, 1, 2].map((k) => absent[(salt + k) % absent.length] ?? (scene.secret[k] + 1) % scene.symbols);
}

async function launch(options: { seed?: number; level?: number; bonus?: boolean; audio?: boolean; required?: boolean } = {}): Promise<LaunchedMinigame> {
  return launchMinigame(33, {
    seed: options.seed ?? 3,
    level: options.level ?? 0,
    bonus: options.bonus,
    audio: options.audio,
    setup: (game) => {
      if (options.required) game.state.goal.ingredients |= 1 << INGREDIENT;
      else game.state.goal.ingredients &= ~(1 << INGREDIENT);
    },
  });
}

describe.skipIf(!hasOriginalFiles)("S33 La Formule Magique : niveaux et tirage", () => {
  it("le niveau règle le nombre de symboles : 6, 7, 8 ; l'indice de l'oiseau : 5, sans répétition", async () => {
    const expected: [number, number][] = [[0, 6], [1, 7], [2, 8]];
    for (const [level, symbols] of expected) {
      const run = await launch({ level });
      const scene = run.scene as MagicFormulaScene;
      expect(scene.symbols).toBe(symbols);
      expect(scene.currentLevel).toBe(level);
      expect(scene.secret.every((s) => s < symbols)).toBe(true);
    }
    for (let seed = 1; seed <= 12; seed++) {
      const run = await launch({ seed, level: 2, bonus: true });
      const scene = run.scene as MagicFormulaScene;
      expect(scene.symbols).toBe(5);
      expect(scene.currentLevel).toBe(3);
      expect(new Set(scene.secret).size).toBe(3);
      expect(run.game.state.pending?.bonus).toBe(true);
      expect(run.game.state.bonusTag).toBe(0);
    }
    // Niveau 0 : jamais de répétition ; niveaux 1 et 2 : il en arrive.
    let repeated = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const strict = (await launch({ seed, level: 0 })).scene as MagicFormulaScene;
      expect(new Set(strict.secret).size).toBe(3);
      const loose = (await launch({ seed, level: 2 })).scene as MagicFormulaScene;
      if (new Set(loose.secret).size < 3) repeated++;
    }
    expect(repeated).toBeGreaterThan(0);
  }, 120_000);

  it("graine fixe : même formule", async () => {
    const a = (await launch({ seed: 21, level: 1 })).scene as MagicFormulaScene;
    const b = (await launch({ seed: 21, level: 1 })).scene as MagicFormulaScene;
    expect(a.secret).toEqual(b.secret);
    const c = (await launch({ seed: 22, level: 1 })).scene as MagicFormulaScene;
    expect([...c.secret]).not.toEqual([...a.secret]);
  }, 30_000);
});

describe.skipIf(!hasOriginalFiles)("S33 La Formule Magique : commandes", () => {
  it("haut / bas parcourent la liste en boucle, gauche / droite changent d'emplacement et reprennent son choix", async () => {
    const run = await launch({ level: 0 });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    expect([scene.selectedColumn, scene.selectedSymbol, ...scene.guess]).toEqual([0, 0, 0, 0, 0]);
    await run.tap("ArrowUp", TAP_MS);
    expect(scene.selectedSymbol).toBe(5);
    expect(scene.guess[0]).toBe(5);
    await run.tap("ArrowDown", TAP_MS);
    expect(scene.selectedSymbol).toBe(0);
    await run.tap("ArrowDown", TAP_MS);
    await run.tap("ArrowDown", TAP_MS);
    expect(scene.guess[0]).toBe(2);
    await run.tap("ArrowLeft", TAP_MS);
    expect(scene.selectedColumn).toBe(0);
    await run.tap("ArrowRight", TAP_MS);
    expect(scene.selectedColumn).toBe(1);
    expect(scene.selectedSymbol).toBe(0);
    await run.tap("ArrowDown", TAP_MS);
    await run.tap("ArrowRight", TAP_MS);
    await run.tap("ArrowRight", TAP_MS);
    expect(scene.selectedColumn).toBe(2);
    await run.tap("ArrowLeft", TAP_MS);
    expect(scene.selectedSymbol).toBe(1);
    expect([...scene.guess]).toEqual([2, 1, 0]);
    run.shot("s33-commandes");
  }, 60_000);

  it("une touche tenue ne répète qu'après 0,5 s ; les touches sont ignorées pendant l'animation d'une réponse", async () => {
    const run = await launch({ level: 2 });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    run.host.input.keyDown("ArrowDown");
    await run.run(300);
    expect(scene.selectedSymbol).toBe(1);
    await run.run(500);
    expect(scene.selectedSymbol).toBeGreaterThanOrEqual(2);
    run.host.input.keyUp("ArrowDown");
    await run.run(300);
    // Pendant l'animation : rien ne bouge.
    const before = scene.selectedSymbol;
    await run.tap("Space", TAP_MS);
    expect(scene.answering).toBe(true);
    await run.tap("ArrowDown", 40);
    await run.tap("Space", 40);
    expect(scene.selectedSymbol).toBe(before);
    expect(scene.attemptCount).toBe(1);
    await run.until(() => !scene.answering);
    await run.tap("ArrowDown", TAP_MS);
    expect(scene.selectedSymbol).toBe((before + 1) % 8);
  }, 60_000);

  it("les sons : un clic à chaque déplacement, 003b pour un symbole bien placé, 004b sinon (canal de bruitages, un seul emplacement : le dernier reste)", async () => {
    const run = await launch({ level: 0, audio: true });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    const { effects } = run.host.audio;
    const voicesBefore = run.host.audio.plays.length;
    await run.tap("ArrowDown", TAP_MS);
    const move = effects.at(-1)!.sound;
    await run.tap("ArrowRight", TAP_MS);
    expect(effects.at(-1)!.sound).toBe(move);
    // Une proposition sans aucune formule exacte : trois fois le même son, différent du clic.
    await propose(run, scene, wrongPicks(scene, 0));
    const answer = effects.at(-1)!.sound;
    expect(answer).not.toBe(move);
    // Les bruitages ne passent pas par la voie : la musique n'a pas été relancée à chaque son.
    expect(run.host.audio.plays.length).toBe(voicesBefore);
    expect(scene.lastAnswers.every((a) => a !== ANSWER_EXACT)).toBe(true);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S33 La Formule Magique : au doigt (ajout du port)", () => {
  /** Toucher bref puis un pas de logique (5 ticks). */
  const touch = async (run: LaunchedMinigame, x: number, y: number) => {
    tap(run.host.input, x, y);
    await run.run(TAP_MS);
  };
  const slotPoint = (column: number): [number, number] => [0x69 + column * 0x41 + 0x1e, 0xa8];
  const symbolPoint = (index: number): [number, number] => [40, 0x18 + index * 0x16];

  it("toucher un emplacement puis un symbole compose la proposition, avec le clic des flèches ; glisser vers le haut la propose", async () => {
    const run = await launch({ level: 1, audio: true });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    const { effects } = run.host.audio;
    await run.tap("ArrowDown", TAP_MS);
    const move = effects.at(-1)!.sound;
    for (let column = 2; column >= 0; column--) {
      const before = effects.length;
      await touch(run, ...slotPoint(column));
      expect(scene.selectedColumn).toBe(column);
      await touch(run, ...symbolPoint(scene.secret[column]));
      expect(scene.guess[column]).toBe(scene.secret[column]);
      expect(scene.selectedSymbol).toBe(scene.secret[column]);
      expect(effects.length).toBeGreaterThan(before);
      expect(effects.at(-1)!.sound).toBe(move);
    }
    expect(scene.attemptCount).toBe(0);
    swipe(run.host.input, 200, 0xa8, 0, -50);
    await run.run(TAP_MS);
    expect(scene.attemptCount).toBe(1);
    await run.until(() => !scene.answering || scene.stage !== "play", 30_000);
    expect(scene.lastAnswers).toEqual([2, 2, 2]);
    expect(scene.succeeded).toBe(true);
    expect(await run.finish(120_000)).toEqual({ kind: "ingredient", success: true });
  }, 180_000);

  it("le doigt qui se pose ne propose rien ; toucher le parchemin, glisser ailleurs ou vers le bas ne fait rien", async () => {
    const run = await launch({ level: 0 });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    touchDown(run.host.input, 200, 0xa8);
    await run.run(400);
    expect(scene.attemptCount).toBe(0);
    touchUp(run.host.input, 200, 0xa8 + 30);
    await run.run(TAP_MS);
    await touch(run, 200, 60);
    await touch(run, 300, 10);
    swipe(run.host.input, 40, 0x60, 0, -50);
    await run.run(TAP_MS);
    swipe(run.host.input, 200, 0x40, 0, 50);
    await run.run(TAP_MS);
    swipe(run.host.input, 200, 0xa8, 60, 0);
    await run.run(TAP_MS);
    expect(scene.attemptCount).toBe(0);
    expect(scene.guess).toEqual([0, 0, 0]);
    expect(scene.selectedColumn).toBe(0);
    // Un toucher sous la liste (au-delà du dernier symbole du niveau) ne choisit rien non plus.
    await touch(run, 40, 0x18 + scene.symbols * 0x16);
    expect(scene.guess).toEqual([0, 0, 0]);
  }, 60_000);

  it("pendant l'animation d'une réponse, les touchers sont ignorés comme les flèches", async () => {
    const run = await launch({ level: 0 });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    const picks = wrongPicks(scene, 0);
    for (let column = 0; column < 3; column++) {
      await touch(run, ...slotPoint(column));
      await touch(run, ...symbolPoint(picks[column]));
    }
    swipe(run.host.input, 200, 0xa8, 0, -50);
    await run.run(TAP_MS);
    expect(scene.answering).toBe(true);
    await touch(run, ...slotPoint(0));
    await touch(run, ...symbolPoint((picks[2] + 1) % scene.symbols));
    expect(scene.selectedColumn).toBe(2);
    expect(scene.guess).toEqual(picks);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S33 La Formule Magique : parties", () => {
  it("réussite du premier coup : voix des trois symboles, vidéo s33c2 (ingrédient hors objectif), ingrédient 7 donné", async () => {
    const run = await launch({ level: 1 });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    run.shot("s33-debut");
    await propose(run, scene, scene.secret);
    expect(scene.lastAnswers).toEqual([2, 2, 2]);
    expect(scene.succeeded).toBe(true);
    run.shot("s33-reussite");
    await run.until(() => scene.stage === "video", 60_000);
    expect(scene.endVideo).toBe("s33c2.mux");
    expect(run.outcome).toBeUndefined();
    await run.run(1500);
    run.shot("s33-reussite-video");
    const outcome = await run.finish(120_000);
    expect(outcome).toEqual({ kind: "ingredient", success: true });
    run.game.resolveMinigame(outcome);
    expect((run.game.player.ingredients & (1 << INGREDIENT)) !== 0).toBe(true);
    expect(run.game.player.ingredientCount).toBe(1);
  }, 180_000);

  it("réussite avec l'ingrédient 7 dans l'objectif : s33c1", async () => {
    const run = await launch({ level: 0, required: true });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    await propose(run, scene, scene.secret);
    await run.until(() => scene.stage === "video", 60_000);
    expect(scene.endVideo).toBe("s33c1.mux");
    await run.tap("Escape");
    expect(await run.finish(30_000)).toEqual({ kind: "ingredient", success: true });
  }, 180_000);

  it("réponses partielles : un symbole bien placé, un présent ailleurs, un absent, puis réussite au 3ᵉ essai", async () => {
    const run = await launch({ level: 0, seed: 5 });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    const [a, b, c] = scene.secret;
    const absent = Array.from({ length: scene.symbols }, (_, i) => i).find((i) => !scene.secret.includes(i))!;
    await propose(run, scene, [a, c, absent]);
    expect(scene.lastAnswers).toEqual([2, 1, 0]);
    run.shot("s33-reponse-1");
    await propose(run, scene, [b, a, c]);
    expect(scene.lastAnswers).toEqual([1, 1, 2]);
    await propose(run, scene, scene.secret);
    expect(scene.attemptCount).toBe(3);
    expect(scene.succeeded).toBe(true);
    run.shot("s33-trois-essais");
    expect(await run.finish(180_000)).toMatchObject({ success: true });
  }, 240_000);

  it("six propositions fausses : la formule est montrée, voix, vidéo s33b, issue ratée, rien n'est donné", async () => {
    const run = await launch({ level: 0 });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await propose(run, scene, wrongPicks(scene, attempt));
      if (attempt === 2) run.shot("s33-trois-reponses");
    }
    expect(scene.succeeded).toBe(false);
    await run.until(() => scene.stage === "names", 60_000);
    await run.run(300);
    run.shot("s33-echec-formule");
    await run.until(() => scene.stage === "video", 60_000);
    expect(scene.endVideo).toBe("s33b.mux");
    const outcome = await run.finish(120_000);
    expect(outcome).toEqual({ kind: "ingredient", success: false });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients).toBe(0);
  }, 240_000);

  it("120 secondes sans trouver : échec, après la fin de l'animation en cours", async () => {
    const run = await launch({ level: 0 });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    await propose(run, scene, wrongPicks(scene, 0));
    await run.run(90_000);
    expect(scene.stage).toBe("play");
    await run.until(() => scene.stage !== "play", 60_000);
    expect(scene.attemptCount).toBe(1);
    expect(await run.finish(180_000)).toEqual({ kind: "ingredient", success: false });
  }, 240_000);

  it("la fin coupe le son d'abord (fondu de volume), le restitue pour les voix puis rend le volume à la sortie", async () => {
    const run = await launch({ level: 0, audio: true });
    const scene = run.scene as MagicFormulaScene;
    await run.until(() => scene.stage === "play");
    run.ctx.voice.setVolume(6);
    await propose(run, scene, scene.secret);
    await run.until(() => scene.stage === "soundFade", 30_000);
    await run.run(500);
    expect(run.ctx.voice.volume).toBeLessThan(6);
    await run.until(() => scene.stage === "names", 30_000);
    expect(run.ctx.voice.volume).toBe(6);
    await run.finish(180_000);
    expect(run.ctx.voice.volume).toBe(6);
  }, 240_000);
});

describe.skipIf(!hasOriginalFiles)("S33 La Formule Magique : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte de l'écran 5 : une réussite donne l'ingrédient 7 et finit le tour", async () => {
    const s = await enterFromBoard(33, "MagicFormulaScene", { seed: 4 });
    const scene = s.ctx.scenes.top as MagicFormulaScene;
    expect(s.game.state.pending).toMatchObject({ scene: 33, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    await s.until(() => scene.stage === "play");
    await propose(s, scene, scene.secret);
    await s.until(() => scene.stage === "video", 120_000);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect((s.game.player.ingredients & (1 << INGREDIENT)) !== 0).toBe(true);
  }, 300_000);

  it("plateau : un échec ne donne rien, le tour est fini quand même", async () => {
    const s = await enterFromBoard(33, "MagicFormulaScene", { seed: 6 });
    const scene = s.ctx.scenes.top as MagicFormulaScene;
    await s.until(() => scene.stage === "play");
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) await propose(s, scene, wrongPicks(scene, attempt));
    await s.until(() => scene.stage === "video", 120_000);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.ingredients & (1 << INGREDIENT)).toBe(0);
  }, 300_000);

  it("plateau avec l'indice de l'oiseau sur S33 : 5 symboles (le niveau 3), l'indice est consommé", async () => {
    const s = await Session.start({ seed: 4 });
    await s.ready();
    s.game.state.bonusTag = 33;
    s.place(doorPosition(33));
    await s.tap("Space");
    await s.settle("MagicFormulaScene");
    const scene = s.ctx.scenes.top as MagicFormulaScene;
    expect(s.game.state.pending).toMatchObject({ scene: 33, bonus: true });
    expect(scene.symbols).toBe(5);
    expect(scene.currentLevel).toBe(3);
    expect(s.game.state.bonusTag).toBe(0);
  }, 120_000);

  it("mode libre, lieu 6 : le mini-jeu se lance, puis la carte revient sur le même lieu", async () => {
    const run = await enterFromFreeMode(33);
    const scene = run.scene as MagicFormulaScene;
    expect(scene).toBeInstanceOf(MagicFormulaScene);
    expect(run.game.state.pending).toMatchObject({ scene: 33 });
    await run.until(() => scene.stage === "play");
    await propose(run, scene, scene.secret);
    await run.until(() => scene.stage === "video", 120_000);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 60_000);
    expect(run.free.shown.selection).toBe(6);
    expect(run.free.currentGame).toBeNull();
  }, 300_000);
});
