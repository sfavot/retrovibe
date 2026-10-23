import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  BirthdayScene,
  CANDLE_BLOWING,
  CANDLE_LIT,
  CANDLE_OUT,
  CANDLE_POSITIONS,
  CANDLE_RELIGHTING,
  createBirthday,
  pointsForTime,
  timeLimit,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s29-birthday";
import type { TestHost } from "../engine-test-host";
import { hasOriginalFiles } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

describe("S29 : règles de l'anniversaire (pur, `1da0:0009`)", () => {
  it("temps imparti : 30 − 4 × niveau secondes", () => {
    expect([0, 1, 2].map(timeLimit)).toEqual([30, 26, 22]);
  });

  it("gouttes de rosée : moins de 10 s → 3, moins de 20 s → 2, sinon 1", () => {
    expect([0, 5, 9, 10, 15, 19, 20, 29, 30].map(pointsForTime)).toEqual([3, 3, 3, 2, 2, 2, 1, 1, 1]);
  });

  it("huit bougies, de gauche à droite", () => {
    expect(CANDLE_POSITIONS).toHaveLength(8);
    const xs = CANDLE_POSITIONS.map(([x]) => x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("la requête est exigée : sans Game.openMinigame(29) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createBirthday(game, () => undefined)).toThrow(/openMinigame\(29\)/);
    game.openMinigame(22);
    expect(() => createBirthday(game, () => undefined)).toThrow(/openMinigame\(29\)/);
  });
});

/**
 * Pilote : une décision par itération de la boucle (toutes les 5 ticks). Sur une bougie allumée il souffle, sinon il va vers la
 * bougie allumée la plus proche. Les touches sont tapées un tick.
 */
function bot(scene: BirthdayScene, host: TestHost) {
  let seen = 0;
  let down: string[] = [];
  const tap = (code: string) => {
    host.input.keyDown(code);
    down.push(code);
  };
  return () => {
    for (const code of down) host.input.keyUp(code);
    down = [];
    if (scene.stage !== "play" || scene.iterations === seen) return;
    seen = scene.iterations;
    const states = scene.states;
    const at = scene.position - 1;
    if (states[at] === CANDLE_LIT) return tap("Space");
    let target = -1;
    for (let i = 0; i < states.length; i++) {
      if (states[i] === CANDLE_LIT && (target < 0 || Math.abs(i - at) < Math.abs(target - at))) target = i;
    }
    if (target >= 0) tap(target > at ? "ArrowRight" : "ArrowLeft");
  };
}

/** Joue le pilote jusqu'à la fin de la boucle (les huit éteintes ou le temps écoulé). */
async function playBot(run: LaunchedMinigame): Promise<void> {
  const scene = run.scene as BirthdayScene;
  const act = bot(scene, run.host);
  await run.until(() => {
    act();
    return scene.stage !== "play" && scene.stage !== "release";
  }, 120_000);
}

const secondsOf = (run: LaunchedMinigame) => (run.scene as BirthdayScene).seconds;

describe.skipIf(!hasOriginalFiles)("S29 L'Anniversaire : bougies, souffle, temps", () => {
  /** Lance la scène et laisse finir le fondu d'entrée : la boucle (et le chrono) ne démarre qu'ensuite. */
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(29, options);
    await run.until(() => !run.ctx.fade.active);
    return run;
  };

  it("départ : huit bougies allumées, curseur sur une des sept premières, le chrono ne court pas pendant le fondu d'entrée", async () => {
    const run = await launchMinigame(29, { seed: 3 });
    const scene = run.scene as BirthdayScene;
    expect(run.ctx.fade.active).toBe(true);
    await run.run(100);
    expect(scene.iterations).toBe(0);
    await run.until(() => !run.ctx.fade.active);
    expect(scene.states).toEqual(Array(8).fill(CANDLE_LIT));
    expect(scene.position).toBeGreaterThanOrEqual(1);
    expect(scene.position).toBeLessThanOrEqual(7);
    expect(scene.stage).toBe("play");
    expect(scene.internalLevel).toBe(0);
    run.shot("s29-debut");
  }, 30_000);

  it("graine fixe : même bougie de départ ; des graines différentes la font varier (1 à 7)", async () => {
    const a = await launch({ seed: 21 });
    const b = await launch({ seed: 21 });
    expect((a.scene as BirthdayScene).position).toBe((b.scene as BirthdayScene).position);
    const seen = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) seen.add(((await launch({ seed })).scene as BirthdayScene).position);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(7);
    expect(seen.size).toBeGreaterThan(3);
  }, 120_000);

  it("gauche / droite : un pas par appui, borné à 1 et 8 ; une flèche tenue ne fait qu'un pas (la boucle attend le relâchement)", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as BirthdayScene;
    for (let i = 0; i < 10; i++) await run.tap("ArrowLeft", 120);
    expect(scene.position).toBe(1);
    await run.tap("ArrowRight", 120);
    expect(scene.position).toBe(2);
    await run.tap("KeyX", 120); // X = droite (clavier d'origine)
    expect(scene.position).toBe(3);
    await run.tap("KeyZ", 120);
    expect(scene.position).toBe(2);
    for (let i = 0; i < 12; i++) await run.tap("ArrowRight", 120);
    expect(scene.position).toBe(8);
    // Tenue 2 s : un seul pas.
    for (let i = 0; i < 3; i++) await run.tap("ArrowLeft", 120);
    expect(scene.position).toBe(5);
    run.host.input.keyDown("ArrowLeft");
    await run.run(2000);
    expect(scene.position).toBe(4);
    expect(scene.stage).toBe("release");
    run.host.input.keyUp("ArrowLeft");
    await run.run(300);
    expect(scene.stage).toBe("play");
  }, 60_000);

  it("une flèche tenue plus de 5 s repart (plafond de 1f33:030e)", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as BirthdayScene;
    for (let i = 0; i < 10; i++) await run.tap("ArrowLeft", 120);
    expect(scene.position).toBe(1);
    run.host.input.keyDown("ArrowRight");
    await run.run(5500);
    expect(scene.position).toBe(3);
    run.host.input.keyUp("ArrowRight");
  }, 60_000);

  it("Espace sur une bougie allumée : extinction en 12 images (1 s), puis éteinte ; sur une bougie éteinte : sans effet", async () => {
    const run = await launch({ seed: 5, audio: true });
    const scene = run.scene as BirthdayScene;
    const at = scene.position - 1;
    const blow = await run.ctx.resources.voc("s29a001b.voc");
    const miss = await run.ctx.resources.voc("s29a002b.voc");
    const voiceStarts = run.host.audio.plays.length;
    await run.tap("Space", 120);
    expect(scene.states[at]).toBe(CANDLE_BLOWING);
    // Canal de bruitages : la musique n'est ni coupée ni relancée.
    expect(run.host.audio.plays.length).toBe(voiceStarts);
    expect(run.host.audio.stops).toBe(0);
    expect(scene.states.filter((s) => s === CANDLE_LIT)).toHaveLength(7);
    expect(run.host.audio.effects.at(-1)?.sound.samples).toEqual(blow.samples);
    run.shot("s29-souffle-0");
    await run.run(500);
    run.shot("s29-souffle-1");
    await run.until(() => scene.states[at] === CANDLE_OUT, 3000);
    run.shot("s29-eteinte");
    await run.tap("Space", 120);
    expect(scene.states[at]).toBe(CANDLE_OUT);
    expect(run.host.audio.effects.at(-1)?.sound.samples).toEqual(miss.samples);
  }, 60_000);

  it("une bougie soufflée se rallume 3 à 8 s plus tard (animation de rallumage 1 s, son s29a003b), toujours seule", async () => {
    const delays: number[] = [];
    for (const seed of [2, 4, 6, 8, 10, 12]) {
      const run = await launch({ seed, audio: true });
      const scene = run.scene as BirthdayScene;
      const at = scene.position - 1;
      const relight = await run.ctx.resources.voc("s29a003b.voc");
      await run.tap("Space", 120);
      const start = run.ctx.clock.ticks;
      await run.until(() => scene.states[at] === CANDLE_RELIGHTING, 12_000);
      delays.push((run.ctx.clock.ticks - start) / 60);
      expect(run.host.audio.effects.at(-1)?.sound.samples).toEqual(relight.samples);
      await run.until(() => scene.states[at] === CANDLE_LIT, 3000);
    }
    expect(Math.min(...delays)).toBeGreaterThan(2.9);
    expect(Math.max(...delays)).toBeLessThan(9);
    expect(new Set(delays.map(Math.round)).size).toBeGreaterThan(1);
  }, 120_000);

  it("huit bougies éteintes ensemble avant la fin du temps : 3 gouttes, vidéo s29c, l'issue est appliquée", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as BirthdayScene;
    await playBot(run);
    expect(scene.hasWon).toBe(true);
    expect(scene.hasTimedOut).toBe(false);
    expect(scene.states).toEqual(Array(8).fill(CANDLE_OUT));
    run.shot("s29-reussite-fin");
    await run.until(() => scene.stage === "result", 30_000);
    run.shot("s29-reussite-video");
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "points", points: 3 });
    expect(run.host.loaded.some((f) => /S29C\.MUX/i.test(f))).toBe(true);
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(3);
  }, 120_000);

  it("les points suivent le temps lu après le fondu sonore (3 s au volume maximal) : départ à 11 s → 2, à 18 s → 1", async () => {
    for (const [wait, points] of [[11_000, 2], [18_000, 1]] as const) {
      const run = await launch({ seed: 7 });
      await run.run(wait);
      expect(run.scene.constructor.name).toBe("BirthdayScene");
      await playBot(run);
      expect((run.scene as BirthdayScene).hasWon).toBe(true);
      expect(await run.finish(60_000)).toEqual({ kind: "points", points });
    }
  }, 180_000);

  it("sans fondu sonore (volume 0), la lecture du temps est immédiate : 9 s → 3 gouttes, 10 s → 2", async () => {
    const early = await launch({ seed: 7 });
    early.ctx.voice.setVolume(0);
    await early.run(5000);
    await playBot(early);
    expect(secondsOf(early)).toBeLessThan(10);
    expect(await early.finish(60_000)).toEqual({ kind: "points", points: 3 });
    const late = await launch({ seed: 7 });
    late.ctx.voice.setVolume(0);
    await late.run(10_000);
    await playBot(late);
    expect(secondsOf(late)).toBeGreaterThanOrEqual(10);
    expect(await late.finish(60_000)).toEqual({ kind: "points", points: 2 });
  }, 180_000);

  it("le fondu sonore rend le volume réglé par le joueur", async () => {
    const run = await launch({ seed: 7 });
    run.ctx.voice.setVolume(9);
    await playBot(run);
    await run.run(500);
    expect(run.ctx.voice.volume).toBeLessThan(9);
    await run.finish(60_000);
    expect(run.ctx.voice.volume).toBe(9);
  }, 120_000);

  it.each([
    [0, 31],
    [1, 27],
    [2, 23],
  ])("niveau %i : sans rien faire, le temps est écoulé à %i s, 0 goutte, vidéo s29b", async (level, seconds) => {
    const run = await launch({ seed: 9, level });
    const scene = run.scene as BirthdayScene;
    expect(scene.internalLevel).toBe(level);
    await run.until(() => scene.hasTimedOut, 60_000);
    expect(secondsOf(run)).toBe(seconds);
    expect(scene.hasWon).toBe(false);
    run.shot(`s29-temps-ecoule-n${level}`);
    await run.until(() => scene.stage === "result", 30_000);
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "points", points: 0 });
    expect(run.host.loaded.some((f) => /S29B\.MUX/i.test(f))).toBe(true);
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(0);
  }, 120_000);

  it("le niveau 2 laisse moins de temps : une partie gagnée à 25 s au niveau 0 est perdue au niveau 2", async () => {
    const slow = await launch({ seed: 7, level: 0 });
    slow.ctx.voice.setVolume(0);
    await slow.run(24_000);
    await playBot(slow);
    expect((slow.scene as BirthdayScene).hasWon).toBe(true);
    expect(await slow.finish(60_000)).toEqual({ kind: "points", points: 1 });
    const hard = await launch({ seed: 7, level: 2 });
    hard.ctx.voice.setVolume(0);
    await hard.run(24_000);
    await playBot(hard);
    expect((hard.scene as BirthdayScene).hasWon).toBe(false);
    expect(await hard.finish(60_000)).toEqual({ kind: "points", points: 0 });
  }, 180_000);

  it("indice de l'oiseau : niveau 0 (30 s) même pour un joueur de niveau 2, l'indice est consommé", async () => {
    const run = await launch({ seed: 9, level: 2, bonus: true });
    const scene = run.scene as BirthdayScene;
    expect(run.game.state.pending).toMatchObject({ scene: 29, level: 2, bonus: true });
    expect(run.game.state.bonusTag).toBe(0);
    expect(scene.internalLevel).toBe(0);
    await run.until(() => scene.hasTimedOut, 60_000);
    expect(secondsOf(run)).toBe(31);
  }, 60_000);

  it("temps écoulé alors que les huit sont éteintes en même temps : c'est un échec (le test du temps l'emporte)", async () => {
    const run = await launch({ seed: 7, level: 2 });
    const scene = run.scene as BirthdayScene;
    run.ctx.voice.setVolume(0);
    await run.run(22_000);
    await playBot(run);
    // Le pilote a pu éteindre les huit juste après 22 s : la fin est un échec dans tous les cas.
    expect(scene.hasWon).toBe(false);
    expect(await run.finish(60_000)).toEqual({ kind: "points", points: 0 });
  }, 120_000);

  it("les vidéos de fin se passent avec Échap", async () => {
    const run = await launch({ seed: 7 });
    await playBot(run);
    await run.until(() => (run.scene as BirthdayScene).stage === "result", 30_000);
    await run.run(800);
    expect(run.outcome).toBeUndefined();
    await run.tap("Escape");
    expect(await run.finish(5000)).toMatchObject({ kind: "points" });
  }, 120_000);

  it("captures : mi-partie, curseur et bougies rallumées", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as BirthdayScene;
    const act = bot(scene, run.host);
    let shots = 0;
    await run.until(() => {
      act();
      if (shots === 0 && scene.states.filter((s) => s === CANDLE_OUT).length >= 3) {
        run.shot("s29-mi-partie");
        shots++;
      }
      return scene.stage !== "play" && scene.stage !== "release";
    }, 60_000);
    await run.run(1500);
    run.shot("s29-fin-de-boucle");
    await run.finish(60_000);
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("S29 L'Anniversaire : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte de la scène 29 : partie gagnée → les gouttes sont ajoutées, le tour est fini", async () => {
    const s = await enterFromBoard(29, "BirthdayScene", { seed: 11 });
    const scene = s.ctx.scenes.top as BirthdayScene;
    expect(scene).toBeInstanceOf(BirthdayScene);
    expect(s.game.state.pending).toMatchObject({ scene: 29, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    const before = s.game.player.points;
    const act = bot(scene, s.host);
    while (scene.stage === "play" || scene.stage === "release") {
      act();
      await s.run(16);
    }
    expect(scene.hasWon).toBe(true);
    await s.until(() => scene.stage === "result", 30_000);
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.points).toBe(before + 3);
    expect(s.history).toContain("BirthdayScene");
  }, 180_000);

  it("plateau : temps écoulé → rien n'est gagné", async () => {
    const s = await enterFromBoard(29, "BirthdayScene", { seed: 11 });
    const scene = s.ctx.scenes.top as BirthdayScene;
    const before = s.game.player.points;
    await s.until(() => scene.stage === "result", 90_000);
    expect(scene.hasTimedOut).toBe(true);
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.points).toBe(before);
  }, 180_000);

  it("mode libre : la partie se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(29, { seed: 5 });
    const scene = run.scene as BirthdayScene;
    expect(scene).toBeInstanceOf(BirthdayScene);
    expect(run.game.state.pending).toMatchObject({ scene: 29 });
    const act = bot(scene, run.host);
    while (scene.stage === "play" || scene.stage === "release") {
      act();
      await run.run(16);
    }
    await run.until(() => scene.stage === "result", 30_000);
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);
});
