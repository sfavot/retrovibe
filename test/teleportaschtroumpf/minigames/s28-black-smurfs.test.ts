import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import { sceneIngredient } from "../../../src/games/teleportaschtroumpf/scenes/minigames/common";
import {
  BlackSmurfsScene,
  CURSOR_STEP,
  HIT_MARGINS,
  START_X,
  START_Y,
  TARGETS,
  TARGET_COUNT,
  TARGET_HIT,
  TARGET_MISSED,
  TARGET_UP,
  TARGET_WAITING,
  createBlackSmurfs,
  hitMargin,
  isHit,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s28-black-smurfs";
import type { TestHost } from "../engine-test-host";
import { hasOriginalFiles } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

describe("S28 : règles des Schtroumpfs noirs (pur, `2573:000f`)", () => {
  it("huit cibles aux abscisses distinctes, dont les zones de tir sont dans l'écran", () => {
    expect(TARGETS).toHaveLength(8);
    expect(new Set(TARGETS.map((t) => t.x)).size).toBe(8);
    for (const { zone } of TARGETS) {
      expect(zone.left).toBeLessThan(zone.right);
      expect(zone.top).toBeLessThan(zone.bottom);
      expect(zone.left).toBeGreaterThanOrEqual(0);
      expect(zone.right).toBeLessThanOrEqual(320);
      expect(zone.bottom).toBeLessThanOrEqual(200);
    }
    expect(TARGET_COUNT).toBe(10);
  });

  it("la zone est stricte (bornes exclues) et rétrécit de la marge de chaque côté : 0, 4, 8 pixels", () => {
    expect([0, 1, 2].map(hitMargin)).toEqual([...HIT_MARGINS]);
    expect(HIT_MARGINS).toEqual([0, 4, 8]);
    const t = TARGETS[0]; // gauche 0x17, droite 0x46, haut 0x53, bas 0x8f
    expect(isHit(t, 0x17, 0x60, 0)).toBe(false);
    expect(isHit(t, 0x18, 0x60, 0)).toBe(true);
    expect(isHit(t, 0x45, 0x60, 0)).toBe(true);
    expect(isHit(t, 0x46, 0x60, 0)).toBe(false);
    expect(isHit(t, 0x30, 0x53, 0)).toBe(false);
    expect(isHit(t, 0x30, 0x54, 0)).toBe(true);
    expect(isHit(t, 0x30, 0x8e, 0)).toBe(true);
    expect(isHit(t, 0x30, 0x8f, 0)).toBe(false);
    expect(isHit(t, 0x1a, 0x60, 0)).toBe(true);
    expect(isHit(t, 0x1a, 0x60, 4)).toBe(false);
    expect(isHit(t, 0x1d, 0x60, 4)).toBe(true);
    expect(isHit(t, 0x1d, 0x60, 8)).toBe(false);
    expect(isHit(t, 0x23, 0x60, 8)).toBe(true);
    expect(isHit(t, 0x30, 0x58, 8)).toBe(false);
    expect(isHit(t, 0x30, 0x5c, 8)).toBe(true);
    expect(isHit(t, 0x30, 0x86, 8)).toBe(true);
    expect(isHit(t, 0x30, 0x87, 8)).toBe(false);
  });

  it("l'ingrédient de la scène est le 6", () => {
    expect(sceneIngredient(28)).toBe(6);
  });

  it("la requête est exigée : sans Game.openMinigame(28) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createBlackSmurfs(game, () => undefined)).toThrow(/openMinigame\(28\)/);
    game.openMinigame(22);
    expect(() => createBlackSmurfs(game, () => undefined)).toThrow(/openMinigame\(28\)/);
  });
});

interface BotOptions {
  /** Ne tire jamais. */
  passive?: boolean;
  /** Tire à côté de la zone (à 100 pixels à gauche). */
  miss?: boolean;
}

const KEYS = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" } as const;

/**
 * Pilote : vise le centre de la zone (réduite de la marge) de la cible sortie avec les flèches tenues (diagonales comprises), puis
 * tire d'un appui de 3 ticks. Il ne devine pas où sortira la cible : il attend qu'elle soit là. Appelé une fois par image (≈ 1 tick).
 */
function bot(scene: BlackSmurfsScene, host: TestHost, options: BotOptions = {}) {
  const held = new Set<string>();
  const set = (code: string, down: boolean) => {
    if (down === held.has(code)) return;
    if (down) {
      held.add(code);
      host.input.keyDown(code);
    } else {
      held.delete(code);
      host.input.keyUp(code);
    }
  };
  let shotFrames = 0;
  return () => {
    if (shotFrames > 0 && --shotFrames === 0) set("Space", false);
    const aiming = scene.targetState === TARGET_UP && scene.targetIndex >= 0 && !options.passive;
    let tx = scene.cursor.x;
    let ty = scene.cursor.y;
    if (aiming) {
      const { zone } = TARGETS[scene.targetIndex];
      const margin = scene.margin;
      tx = (zone.left + zone.right) / 2 + (options.miss ? -100 : 0);
      ty = (zone.top + margin + zone.bottom - margin) / 2;
    }
    const { x, y } = scene.cursor;
    set(KEYS.left, aiming && tx - x < -3);
    set(KEYS.right, aiming && tx - x > 3);
    set(KEYS.up, aiming && ty - y < -3);
    set(KEYS.down, aiming && ty - y > 3);
    const arrived = aiming && Math.abs(tx - x) <= 3 && Math.abs(ty - y) <= 3;
    if (arrived && scene.canHit && shotFrames === 0) {
      set("Space", true);
      shotFrames = 3;
    }
  };
}

const finished = (scene: BlackSmurfsScene) => scene.stage !== "play";

async function play(run: LaunchedMinigame, options: BotOptions = {}): Promise<void> {
  const scene = run.scene as BlackSmurfsScene;
  const act = bot(scene, run.host, options);
  await run.until(() => {
    act();
    return finished(scene);
  }, 300_000);
}

describe.skipIf(!hasOriginalFiles)("S28 Les Schtroumpfs Noirs : cibles, viseur, tirs, issue", () => {
  /** Lance la scène et laisse finir le fondu d'entrée : la boucle (et les chronos) ne démarre qu'ensuite. */
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(28, options);
    await run.until(() => !run.ctx.fade.active);
    return run;
  };

  /** Première graine (à partir de `from`) pour laquelle le pilote gagne : le viseur ne va qu'à 60 pixels par seconde, une partie n'est pas gagnée d'avance. */
  const winningSeed = async (options: LaunchOptions = {}, from = 1): Promise<LaunchedMinigame> => {
    for (let seed = from; seed < from + 80; seed++) {
      const run = await launch({ ...options, seed });
      await play(run);
      if (!(run.scene as BlackSmurfsScene).hasFailed) return run;
    }
    throw new Error("aucune graine gagnante");
  };

  it("départ : décor, viseur au centre, aucune cible pendant les 2 premières secondes ; ensuite une cible sort", async () => {
    const run = await launch({ seed: 3 });
    const scene = run.scene as BlackSmurfsScene;
    expect(scene.stage).toBe("play");
    expect(scene.internalLevel).toBe(0);
    expect(scene.targetState).toBe(TARGET_WAITING);
    run.shot("s28-debut");
    await run.run(1800);
    expect(scene.appearances).toBe(0);
    expect(scene.cursor).toEqual({ x: START_X, y: START_Y });
    await run.until(() => scene.targetState === TARGET_UP, 5000);
    expect(scene.appearances).toBe(1);
    expect(scene.targetIndex).toBeGreaterThanOrEqual(0);
    expect(scene.targetIndex).toBeLessThan(8);
    run.shot("s28-cible-sort");
    await run.until(() => scene.canHit, 5000);
    run.shot("s28-cible-sortie");
  }, 60_000);

  it("graine fixe : mêmes cibles dans le même ordre ; des graines différentes les font varier", async () => {
    const targets = async (seed: number) => {
      const run = await launch({ seed });
      const scene = run.scene as BlackSmurfsScene;
      const seen: number[] = [];
      await run.until(() => {
        if (scene.targetState === TARGET_UP && seen.length < scene.appearances) seen.push(scene.targetIndex);
        return scene.stage !== "play";
      }, 60_000);
      return seen;
    };
    const a = await targets(21);
    expect(await targets(21)).toEqual(a);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) seen.add((await targets(seed)).join(""));
    expect(seen.size).toBeGreaterThan(1);
  }, 120_000);

  it("viseur : 5 pixels par image (12 par seconde) par direction tenue, diagonales comprises ; Z, Q, X, A valent gauche, haut, droite, bas", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as BlackSmurfsScene;
    const iterations = scene.iterations;
    run.host.input.keyDown("ArrowRight");
    run.host.input.keyDown("ArrowDown");
    await run.run(1000);
    run.host.input.keyUp("ArrowRight");
    run.host.input.keyUp("ArrowDown");
    const steps = scene.iterations - iterations;
    expect(steps).toBeGreaterThanOrEqual(11);
    expect(steps).toBeLessThanOrEqual(13);
    expect(scene.cursor).toEqual({ x: START_X + CURSOR_STEP * steps, y: START_Y + CURSOR_STEP * steps });
    const origin = scene.cursor;
    await run.tap("KeyZ", 300);
    await run.tap("KeyQ", 300);
    expect(scene.cursor.x).toBeLessThan(origin.x);
    expect(scene.cursor.y).toBeLessThan(origin.y);
    const mid = scene.cursor;
    await run.tap("KeyX", 300);
    await run.tap("KeyA", 300);
    expect(scene.cursor.x).toBeGreaterThan(mid.x);
    expect(scene.cursor.y).toBeGreaterThan(mid.y);
  }, 60_000);

  it("un appui plus court qu'une image compte quand même", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as BlackSmurfsScene;
    await run.run(100);
    const before = scene.cursor.x;
    run.host.input.keyDown("ArrowLeft");
    await run.run(17);
    run.host.input.keyUp("ArrowLeft");
    await run.run(200);
    expect(scene.cursor.x).toBe(before - CURSOR_STEP);
  }, 30_000);

  it("souris : le viseur se place sous le pointeur dès qu'elle bouge ; une touche le déplace jusqu'au prochain mouvement", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as BlackSmurfsScene;
    await run.run(300);
    expect(scene.cursor).toEqual({ x: START_X, y: START_Y });
    run.ctx.input.mouseMove(START_X + 100, START_Y - 30);
    await run.run(20);
    expect(scene.cursor).toEqual({ x: START_X + 100, y: START_Y - 30 });
    // Une touche reprend la main : la souris immobile ne ramène plus le viseur.
    await run.tap("ArrowLeft", 100);
    const settled = scene.cursor;
    expect(settled.x).toBeLessThan(START_X + 100);
    await run.run(500);
    expect(scene.cursor).toEqual(settled);
    run.ctx.input.mouseMove(START_X, START_Y);
    await run.run(20);
    expect(scene.cursor).toEqual({ x: START_X, y: START_Y });
  }, 30_000);

  it("clic pendant que la souris bouge : le tir part de la position du clic ; deux clics rapides font deux tirs", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as BlackSmurfsScene;
    await run.until(() => scene.canHit, 6000);
    const { zone } = TARGETS[scene.targetIndex];
    const inside = { x: (zone.left + zone.right) >> 1, y: (zone.top + zone.bottom) >> 1 };
    run.ctx.input.mouseMove(inside.x, inside.y);
    run.ctx.input.mouseDown(0);
    run.ctx.input.mouseUp(0);
    await run.run(17);
    // La souris repart aussitôt, avant l'itération qui joue le tir.
    run.ctx.input.mouseMove(0, 0);
    await run.run(150);
    expect(scene.hitCount).toBe(1);
    const shots = scene.shotCount;
    for (let i = 0; i < 2; i++) {
      run.ctx.input.mouseDown(0);
      await run.run(20);
      run.ctx.input.mouseUp(0);
      await run.run(40);
    }
    expect(scene.shotCount).toBe(shots + 2);
  }, 30_000);

  it("une cible oubliée plus de 3 s après sa sortie : la partie est perdue, 0 ingrédient, vidéo s28b, l'issue est appliquée", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as BlackSmurfsScene;
    await run.until(() => scene.targetState === TARGET_UP, 5000);
    await run.until(() => scene.canHit, 2000);
    const start = run.ctx.clock.ticks;
    await run.until(() => scene.targetState === TARGET_MISSED, 6000);
    const seconds = (run.ctx.clock.ticks - start) / 60;
    expect(seconds).toBeGreaterThan(2.9);
    expect(seconds).toBeLessThan(3.4);
    await run.until(() => scene.hasFailed, 2000);
    expect(scene.appearances).toBe(1);
    run.shot("s28-echec");
    await run.until(() => scene.stage === "result", 30_000);
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: false });
    expect(run.host.loaded.some((f) => /S28B\.MUX/i.test(f))).toBe(true);
    run.game.resolveMinigame(run.outcome!);
    expect(run.game.player.ingredients & (1 << 6)).toBe(0);
  }, 120_000);

  it("tir sur la cible : son s28a002b, la cible tombe puis la suivante attend 2 s ; tir à côté : son s28a003b, impact, rien de perdu", async () => {
    const run = await launch({ seed: 7, audio: true });
    const scene = run.scene as BlackSmurfsScene;
    const hit = await run.ctx.resources.voc("s28a002b.voc");
    const miss = await run.ctx.resources.voc("s28a003b.voc");
    // Un tir à vide, avant toute cible : raté.
    await run.tap("Space", 120);
    expect(run.host.audio.effects.at(-1)?.sound.samples).toEqual(miss.samples);
    expect(scene.missCount).toBe(1);
    expect(scene.hasFailed).toBe(false);
    run.shot("s28-tir-rate");
    const act = bot(scene, run.host);
    await run.until(() => {
      act();
      return scene.targetState === TARGET_HIT;
    }, 30_000);
    expect(run.host.audio.effects.at(-1)?.sound.samples).toEqual(hit.samples);
    expect(scene.hitCount).toBe(1);
    run.shot("s28-touche");
    await run.until(() => scene.targetState === TARGET_WAITING, 5000);
    const waiting = run.ctx.clock.ticks;
    await run.until(() => scene.targetState === TARGET_UP, 5000);
    expect((run.ctx.clock.ticks - waiting) / 60).toBeGreaterThanOrEqual(2);
    expect(scene.appearances).toBe(2);
  }, 120_000);

  it("un tir par appui : le bouton tenu ne répète pas ; relâché puis enfoncé, il tire à nouveau", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as BlackSmurfsScene;
    run.host.input.keyDown("Space");
    await run.run(1000);
    expect(scene.shotCount).toBe(1);
    run.host.input.keyUp("Space");
    await run.run(300);
    run.host.input.keyDown("Space");
    await run.run(300);
    run.host.input.keyUp("Space");
    expect(scene.shotCount).toBe(2);
  }, 30_000);

  it("le viseur s'enfonce pendant trois images après un tir (sprites 0x39 à 0x3b), puis revient au repos", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as BlackSmurfsScene;
    const frames: number[] = [];
    run.host.input.keyDown("Space");
    await run.until(() => {
      if (frames.at(-1) !== scene.cursorFrame) frames.push(scene.cursorFrame);
      return frames.length >= 6 || run.ctx.clock.ticks > 3000;
    }, 5000);
    run.host.input.keyUp("Space");
    // Le bouton tenu relance l'animation à chaque fois (`bVar3` est remis à vrai tant que le bouton est enfoncé).
    expect(frames.slice(0, 5)).toEqual([0, 1, 2, 3, 0]);
    run.shot("s28-viseur");
  }, 30_000);

  it("le viseur n'est pas borné (comme l'original) : il peut sortir de l'écran sans erreur", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as BlackSmurfsScene;
    run.host.input.keyDown("ArrowLeft");
    await run.run(4000);
    run.host.input.keyUp("ArrowLeft");
    expect(scene.cursor.x).toBeLessThan(0);
    expect(scene.stage).toBe("play");
  }, 30_000);

  it("partie gagnée : dix cibles apparues (la dixième jamais dessinée), neuf touchées, ingrédient 6 donné, vidéo s28c1 hors objectif", async () => {
    const run = await winningSeed({ setup: (game) => (game.state.goal.ingredients &= ~(1 << 6)) });
    const scene = run.scene as BlackSmurfsScene;
    expect(scene.hasFailed).toBe(false);
    expect(scene.appearances).toBe(10);
    expect(scene.hitCount).toBe(9);
    run.shot("s28-reussite-fin");
    await run.until(() => scene.stage === "result", 30_000);
    run.shot("s28-reussite-video");
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "ingredient", success: true });
    expect(run.host.loaded.some((f) => /S28C1\.MUX/i.test(f))).toBe(true);
    expect(run.host.loaded.some((f) => /S28C2\.MUX/i.test(f))).toBe(false);
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients & (1 << 6)).not.toBe(0);
  }, 300_000);

  it("l'ingrédient 6 fait partie de l'objectif : vidéo s28c2 (comme S27, S32 ; la vidéo s28c1 sinon)", async () => {
    const run = await winningSeed({ setup: (game) => (game.state.goal.ingredients |= 1 << 6) });
    await run.until(() => (run.scene as BlackSmurfsScene).stage === "result", 30_000);
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: true });
    expect(run.host.loaded.some((f) => /S28C2\.MUX/i.test(f))).toBe(true);
    expect(run.host.loaded.some((f) => /S28C1\.MUX/i.test(f))).toBe(false);
  }, 300_000);

  it("tous les tirs à côté : aucune cible touchée, la première oubliée termine la partie", async () => {
    const run = await launch({ seed: 7 });
    const scene = run.scene as BlackSmurfsScene;
    await play(run, { miss: true });
    expect(scene.hitCount).toBe(0);
    expect(scene.hasFailed).toBe(true);
    expect(scene.missCount).toBeGreaterThan(0);
    expect(scene.appearances).toBe(1);
  }, 120_000);

  it.each([[0], [1], [2]])("niveau %i : marge de la zone de tir de %i × 4 pixels de chaque côté", async (level) => {
    const run = await launch({ seed: 9, level });
    const scene = run.scene as BlackSmurfsScene;
    expect(scene.internalLevel).toBe(level);
    expect(scene.margin).toBe(level * 4);
  }, 30_000);

  it("indice de l'oiseau : niveau 0 (zone entière) même pour un joueur de niveau 2, l'indice est consommé", async () => {
    const run = await launch({ seed: 9, level: 2, bonus: true });
    const scene = run.scene as BlackSmurfsScene;
    expect(run.game.state.pending).toMatchObject({ scene: 28, level: 2, bonus: true });
    expect(run.game.state.bonusTag).toBe(0);
    expect(scene.internalLevel).toBe(0);
    expect(scene.margin).toBe(0);
  }, 30_000);

  it("une partie gagnée au niveau 2 reste possible, avec la zone rétrécie", async () => {
    const run = await winningSeed({ level: 2 });
    expect((run.scene as BlackSmurfsScene).margin).toBe(8);
    expect(await run.finish(300_000)).toEqual({ kind: "ingredient", success: true });
  }, 600_000);

  it("le fondu sonore de fin rend le volume réglé par le joueur", async () => {
    const run = await launch({ seed: 7 });
    run.ctx.voice.setVolume(9);
    await play(run, { passive: true });
    await run.run(500);
    expect(run.ctx.voice.volume).toBeLessThan(9);
    await run.finish(120_000);
    expect(run.ctx.voice.volume).toBe(9);
  }, 120_000);

  it("les vidéos de fin se passent avec Échap", async () => {
    const run = await launch({ seed: 7 });
    await play(run, { passive: true });
    await run.until(() => (run.scene as BlackSmurfsScene).stage === "result", 30_000);
    await run.run(800);
    expect(run.outcome).toBeUndefined();
    await run.tap("Escape");
    expect(await run.finish(5000)).toMatchObject({ kind: "ingredient" });
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("S28 Les Schtroumpfs Noirs : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte de la scène 28 : cible oubliée → rien n'est gagné, le tour est fini", async () => {
    const s = await enterFromBoard(28, "BlackSmurfsScene", { seed: 11 });
    const scene = s.ctx.scenes.top as BlackSmurfsScene;
    expect(scene).toBeInstanceOf(BlackSmurfsScene);
    expect(s.game.state.pending).toMatchObject({ scene: 28, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    const before = s.game.player.ingredients;
    await s.until(() => scene.stage === "result", 90_000);
    expect(scene.hasFailed).toBe(true);
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.ingredients).toBe(before);
    expect(s.history).toContain("BlackSmurfsScene");
  }, 240_000);

  it("plateau : partie gagnée → l'ingrédient 6 est ajouté", async () => {
    for (let seed = 1; seed < 80; seed++) {
      const s = await enterFromBoard(28, "BlackSmurfsScene", { seed });
      const scene = s.ctx.scenes.top as BlackSmurfsScene;
      const act = bot(scene, s.host);
      while (!finished(scene)) {
        act();
        await s.run(16);
      }
      if (scene.hasFailed) continue;
      s.game.state.players[0].ingredients &= ~(1 << 6);
      await s.until(() => scene.stage === "result", 30_000);
      await s.run(800);
      await s.tap("Escape");
      await s.ready();
      expect(s.game.state.pending).toBeNull();
      expect(s.game.player.ingredients & (1 << 6)).not.toBe(0);
      return;
    }
    throw new Error("aucune graine gagnante");
  }, 600_000);

  it("mode libre : la partie se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(28, { seed: 5 });
    const scene = run.scene as BlackSmurfsScene;
    expect(scene).toBeInstanceOf(BlackSmurfsScene);
    expect(run.game.state.pending).toMatchObject({ scene: 28 });
    await run.until(() => scene.stage === "result", 90_000);
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.currentGame).toBeNull();
  }, 240_000);
});
