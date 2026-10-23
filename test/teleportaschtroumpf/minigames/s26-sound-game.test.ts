import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  BASE_TIME_LIMIT,
  ORIGIN_X,
  ORIGIN_Y,
  SoundGameScene,
  TARGETS,
  createSoundGame,
  drawPicture,
  isHit,
  pointsForTime,
  soundFile,
  timeLimit,
  tolerance,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s26-sound-game";
import { hasOriginalFiles, listData } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

describe("S26 : règles du jeu sonore (pur, `1ed0:000b`)", () => {
  it("décor : 1 à 9, jamais 5, et les huit autres sortent", () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      const rng = new BorlandRandom(seed);
      seen.add(drawPicture((n) => rng.below(n)));
    }
    expect(seen.has(5)).toBe(false);
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  });

  it("table : 9 décors de 4 objets, zones non vides ; le décor 5 est celui du 7", () => {
    expect(TARGETS).toHaveLength(9);
    for (const picture of TARGETS) {
      expect(picture).toHaveLength(4);
      for (const [x1, y1, x2, y2] of picture) {
        expect(x2).toBeGreaterThan(x1);
        expect(y2).toBeGreaterThan(y1);
      }
    }
    expect(TARGETS[4]).toEqual(TARGETS[6]);
  });

  it("bruits : trois séries de quatre fichiers (1..4, 5..8, 11..14) selon le décor", () => {
    expect([1, 2, 3].map((p) => soundFile(p, 1))).toEqual(["s26a001b.voc", "s26a001b.voc", "s26a001b.voc"]);
    expect([4, 6].map((p) => soundFile(p, 4))).toEqual(["s26a008b.voc", "s26a008b.voc"]);
    expect([7, 8, 9].map((p) => soundFile(p, 1))).toEqual(["s26a011b.voc", "s26a011b.voc", "s26a011b.voc"]);
    expect(soundFile(9, 4)).toBe("s26a014b.voc");
    expect(soundFile(4, 1)).toBe("s26a005b.voc");
  });

  it("zone cliquable : décalée de (32, 40), élargie de 6 px (10 avec l'oiseau), bord droit et bas exclus", () => {
    const rect = [201, 87, 239, 116] as const;
    const [x1, y1, x2, y2] = rect;
    const left = x1 - ORIGIN_X;
    const top = y1 - ORIGIN_Y;
    const right = x2 - ORIGIN_X;
    const bottom = y2 - ORIGIN_Y;
    const m = tolerance(false);
    expect(m).toBe(6);
    expect(tolerance(true)).toBe(10);
    expect(isHit(rect, m, left - m, top - m)).toBe(true);
    expect(isHit(rect, m, left - m - 1, top)).toBe(false);
    expect(isHit(rect, m, left, top - m - 1)).toBe(false);
    expect(isHit(rect, m, right + m - 1, bottom + m - 1)).toBe(true);
    expect(isHit(rect, m, right + m, bottom)).toBe(false);
    expect(isHit(rect, m, left, bottom + m)).toBe(false);
    expect(isHit(rect, tolerance(true), left - 8, top)).toBe(true);
    expect(isHit(rect, m, left - 8, top)).toBe(false);
  });

  it("temps : 15 s, 19 avec l'oiseau ; points : 3 sous le tiers, 2 sous les deux tiers, sinon 1", () => {
    expect(timeLimit(false)).toBe(BASE_TIME_LIMIT);
    expect(timeLimit(true)).toBe(19);
    expect([0, 4, 5, 9, 10, 14, 15].map((s) => pointsForTime(s, 15))).toEqual([3, 3, 2, 2, 1, 1, 1]);
    expect([0, 5, 6, 11, 12, 18].map((s) => pointsForTime(s, 19))).toEqual([3, 3, 2, 2, 1, 1]);
  });

  it("la requête est exigée : sans Game.openMinigame(26) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createSoundGame(game, () => undefined)).toThrow(/openMinigame\(26\)/);
  });
});

describe.skipIf(!hasOriginalFiles)("S26 : ressources", () => {
  it("les 12 bruits (1..4, 5..8, 11..14), l'erreur, 6 voix d'échec et 6 de réussite existent", () => {
    const names = new Set(listData(() => true).map((p) => p.split("/").pop()!.toLowerCase()));
    for (const picture of [1, 4, 7]) {
      for (let target = 1; target <= 4; target++) expect(names.has(soundFile(picture, target)), soundFile(picture, target)).toBe(true);
    }
    for (const name of ["s26a099b.voc", "s26a000s.hy8", "s26a000s.pal"]) expect(names.has(name), name).toBe(true);
    for (const prefix of ["s26b", "s26c"]) {
      for (let i = 1; i <= 6; i++) expect(names.has(`${prefix}00${i}t.voc`)).toBe(true);
    }
  });
});

const sceneOf = (run: LaunchedMinigame) => run.scene as SoundGameScene;

/** Attend la fin du décor, du fondu et du bruit : le curseur apparaît. */
async function untilHunt(run: LaunchedMinigame): Promise<void> {
  await run.until(() => sceneOf(run).stage === "hunt");
}

async function clickAt(run: LaunchedMinigame, x: number, y: number, key = "Space"): Promise<void> {
  run.host.input.mouseMove(x, y);
  await run.tap(key, 60);
}

describe.skipIf(!hasOriginalFiles)("S26 Jeu Sonore : décor, bruit, recherche, résultat", () => {
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(26, options);
    await run.until(() => !run.ctx.fade.active);
    return run;
  };

  it("départ : le décor tiré est affiché 5 s ; le chrono ne court pas pendant le fondu d'entrée", async () => {
    const run = await launchMinigame(26, { seed: 3 });
    const scene = sceneOf(run);
    expect(run.ctx.fade.active).toBe(true);
    await run.run(100);
    expect(scene.seconds).toBe(0);
    await run.until(() => !run.ctx.fade.active);
    expect(scene.stage).toBe("view");
    expect(scene.pictureNumber).not.toBe(5);
    expect(scene.targetNumber).toBeGreaterThanOrEqual(1);
    expect(scene.targetNumber).toBeLessThanOrEqual(4);
    run.shot("s26-decor");
    await run.run(4500);
    expect(scene.stage).toBe("view");
    await run.run(1500);
    expect(scene.stage).not.toBe("view");
  }, 60_000);

  it("un clic abrège l'attente du décor (Espace ou Entrée)", async () => {
    for (const key of ["Space", "Enter"]) {
      const run = await launch({ seed: 3 });
      await run.run(500);
      await run.tap(key, 60);
      expect(sceneOf(run).stage).toBe("fadeOut");
    }
  }, 60_000);

  it("graine fixe : même décor et même objet ; des graines différentes les font varier ; le niveau ne change rien", async () => {
    const a = sceneOf(await launch({ seed: 21 }));
    const b = sceneOf(await launch({ seed: 21 }));
    expect([a.pictureNumber, a.targetNumber]).toEqual([b.pictureNumber, b.targetNumber]);
    const pictures = new Set<number>();
    const targets = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const scene = sceneOf(await launch({ seed }));
      pictures.add(scene.pictureNumber);
      targets.add(scene.targetNumber);
    }
    expect(pictures.size).toBeGreaterThan(4);
    expect(targets.size).toBe(4);
    for (const level of [1, 2]) {
      const other = sceneOf(await launch({ seed: 21, level }));
      expect([other.pictureNumber, other.targetNumber, other.limit, other.margin]).toEqual([a.pictureNumber, a.targetNumber, 15, 6]);
    }
  }, 120_000);

  it("déroulé (audio actif) : décor, fondu, pause, bruit dans le noir, puis le curseur sur un écran noir", async () => {
    const run = await launch({ seed: 3, audio: true });
    const scene = sceneOf(run);
    await run.until(() => scene.stage === "listen");
    expect(run.ctx.palette.black).toBe(true);
    const played = run.host.audio.plays.at(-1)!;
    expect(played.sound.samples.length).toBeGreaterThan(2000);
    await run.until(() => scene.stage === "hunt");
    expect(run.ctx.palette.black).toBe(false);
    expect(run.ctx.input.mouseX).toBe(0xa0);
    expect(run.ctx.input.mouseY).toBe(100);
    run.shot("s26-chasse");
    // Les couleurs du décor ne sont pas dans la palette des sprites : l'écran n'affiche que le curseur.
    const shown = run.host.presentations.at(-1)!;
    const lit = new Set<number>();
    for (let i = 0; i < 320 * 200; i++) {
      const p = shown.surface[i];
      if (shown.palette[p * 3] + shown.palette[p * 3 + 1] + shown.palette[p * 3 + 2] > 0) lit.add(i);
    }
    expect(lit.size).toBeLessThan(2500);
  }, 120_000);

  it("curseur : suit la souris, les flèches le déplacent de 2 px par tick, l'image change toutes les 5 ticks", async () => {
    const run = await launch({ seed: 3 });
    const scene = sceneOf(run);
    await untilHunt(run);
    const { input } = run.ctx;
    run.host.input.keyDown("ArrowRight");
    await run.run(500);
    run.host.input.keyUp("ArrowRight");
    expect(input.mouseX).toBeGreaterThan(0xa0 + 40);
    expect(input.mouseX).toBeLessThanOrEqual(0xa0 + 2 * 31);
    run.host.input.mouseMove(40, 60);
    await run.run(100);
    expect(input.mouseX).toBe(40);
    const before = scene.frameIndex;
    await run.run(400);
    expect(scene.frameIndex).not.toBe(before);
  }, 60_000);

  it("réussite rapide : un clic sur l'objet avant 5 s donne 3 points ; le double cadre entoure l'objet", async () => {
    const run = await launch({ seed: 3 });
    const scene = sceneOf(run);
    await untilHunt(run);
    await run.run(1500);
    const { x, y } = scene.targetCenter;
    await clickAt(run, x, y);
    await run.until(() => scene.stage === "revealPause");
    run.shot("s26-reussite");
    expect(await run.finish()).toEqual({ kind: "points", points: 3 });
    expect(scene.hasWon).toBe(true);
  }, 60_000);

  it("points selon le temps : 3 avant 5 s, 2 de 5 à 9 s, 1 ensuite", async () => {
    for (const [wait, points] of [
      [2500, 3],
      [6500, 2],
      [11_500, 1],
    ] as const) {
      const run = await launch({ seed: 8 });
      const scene = sceneOf(run);
      await untilHunt(run);
      await run.run(wait);
      const { x, y } = scene.targetCenter;
      await clickAt(run, x, y);
      expect(await run.finish()).toEqual({ kind: "points", points });
    }
  }, 120_000);

  it("échec : un clic ailleurs ne donne rien, et le cadre montre quand même l'objet", async () => {
    const run = await launch({ seed: 3 });
    const scene = sceneOf(run);
    await untilHunt(run);
    const { x, y } = scene.targetCenter;
    await clickAt(run, (x + 160) % 320, (y + 100) % 200);
    expect(scene.hasWon).toBe(false);
    await run.until(() => scene.stage === "revealPause");
    run.shot("s26-echec");
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
  }, 60_000);

  it("Entrée (clic droit) termine aussi la recherche, comme un échec, même sur l'objet", async () => {
    const run = await launch({ seed: 3 });
    const scene = sceneOf(run);
    await untilHunt(run);
    const { x, y } = scene.targetCenter;
    await clickAt(run, x, y, "Enter");
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
    expect(scene.hasWon).toBe(false);
  }, 60_000);

  it("temps écoulé : 15 s sans clic = échec", async () => {
    const run = await launch({ seed: 3 });
    const scene = sceneOf(run);
    await untilHunt(run);
    await run.run(13_000);
    expect(scene.stage).toBe("hunt");
    await run.run(2500);
    expect(scene.stage).not.toBe("hunt");
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
  }, 60_000);

  it("indice de l'oiseau : zone élargie de 4 px et 19 s au lieu de 15", async () => {
    const bird = await launch({ seed: 3, bonus: true });
    const plain = await launch({ seed: 3 });
    expect(sceneOf(bird).margin).toBe(10);
    expect(sceneOf(bird).limit).toBe(19);
    expect(sceneOf(plain).margin).toBe(6);
    expect(bird.game.state.bonusTag).toBe(0);
    // À 8 px du bord gauche de l'objet : manqué sans l'indice, trouvé avec.
    const [x1, y1, , y2] = sceneOf(plain).targetRect;
    const edgeX = x1 - ORIGIN_X - 8;
    const midY = Math.floor((y1 + y2) / 2) - ORIGIN_Y;
    await untilHunt(plain);
    await clickAt(plain, edgeX, midY);
    expect((await plain.finish()).kind).toBe("points");
    expect(sceneOf(plain).hasWon).toBe(false);
    await untilHunt(bird);
    await run15(bird);
    await clickAt(bird, edgeX, midY);
    await bird.finish();
    expect(sceneOf(bird).hasWon).toBe(true);
    expect(sceneOf(bird).points).toBe(3);
  }, 120_000);

  it("plateau : un clic juste = des gouttes de rosée, le plateau reprend la main", async () => {
    const s = await enterFromBoard(26, "SoundGameScene", { seed: 11 });
    const scene = s.ctx.scenes.top as SoundGameScene;
    expect(scene).toBeInstanceOf(SoundGameScene);
    expect(s.game.state.pending).toMatchObject({ scene: 26, player: 0 });
    const before = s.game.player.points;
    await s.until(() => scene.stage === "hunt");
    await s.run(1000);
    const { x, y } = scene.targetCenter;
    s.host.input.mouseMove(x, y);
    await s.tap("Space");
    await s.until(() => scene.stage === "done", 60_000);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(scene.hasWon).toBe(true);
    expect(s.game.player.points).toBe(before + 3);
    expect(s.history).toContain("SoundGameScene");
  }, 180_000);

  it("plateau : temps écoulé = rien", async () => {
    const s = await enterFromBoard(26, "SoundGameScene", { seed: 11 });
    const scene = s.ctx.scenes.top as SoundGameScene;
    const before = s.game.player.points;
    await s.until(() => scene.stage === "done", 60_000);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.points).toBe(before);
  }, 180_000);

  it("mode libre : la partie se joue, puis la carte revient sans rien appliquer", async () => {
    const run = await enterFromFreeMode(26, { seed: 5 });
    const scene = run.scene as SoundGameScene;
    expect(scene).toBeInstanceOf(SoundGameScene);
    expect(run.game.state.pending).toMatchObject({ scene: 26 });
    await run.until(() => scene.stage === "hunt", 60_000);
    await run.tap("Enter", 60);
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 60_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);
});

/** Laisse passer quelques secondes de recherche sans toucher à rien (pour ne pas cliquer au premier tick). */
async function run15(run: LaunchedMinigame): Promise<void> {
  await run.run(500);
}
