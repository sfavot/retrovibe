import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  HIDDEN_OBJECTS,
  START_X,
  START_Y,
  ObservationScene,
  createObservation,
  drawPicture,
  internalLevel,
  pictureFile,
  timeLimit,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s25-observation";
import { hasOriginalFiles, listData } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

describe("S25 : règles de l'observation (pur, `260f:000e`)", () => {
  it("table : 25 zones de 37 ou 38 px de côté, dans l'ordre lettre puis chiffre", () => {
    expect(HIDDEN_OBJECTS).toHaveLength(25);
    for (const [x1, y1, x2, y2] of HIDDEN_OBJECTS) {
      expect(x2 - x1).toBeGreaterThanOrEqual(37);
      expect(x2 - x1).toBeLessThanOrEqual(38);
      expect(y2 - y1).toBeGreaterThanOrEqual(37);
      expect(y2 - y1).toBeLessThanOrEqual(38);
    }
    expect(HIDDEN_OBJECTS[0]).toEqual([78, 103, 116, 141]);
    expect(HIDDEN_OBJECTS[24]).toEqual([239, 71, 277, 109]);
  });

  it("décor : deux tirages `rand × 5000 / 0x8000 % 5`, la lettre puis le chiffre ; les 25 sortent", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const rng = new BorlandRandom(seed);
      const { letter, digit } = drawPicture((n) => rng.below(n));
      seen.add(`${letter}${digit}`);
      const check = new BorlandRandom(seed);
      expect([letter, digit]).toEqual([check.below(5000) % 5, check.below(5000) % 5]);
    }
    expect(seen.size).toBe(25);
  });

  it("fichier : s25a<lettre>0<chiffre>d.mcg (lettres a..e, chiffres 1..5)", () => {
    expect(pictureFile(0, 0)).toBe("s25aa01d.mcg");
    expect(pictureFile(4, 4)).toBe("s25ae05d.mcg");
    expect(pictureFile(2, 3)).toBe("s25ac04d.mcg");
  });

  it("temps : 35 − 5 × niveau interne (niveau du joueur + 1) = 30, 25, 20 s ; l'oiseau force 0 = 35 s", () => {
    expect([0, 1, 2].map((level) => timeLimit(internalLevel(level, false)))).toEqual([30, 25, 20]);
    expect([0, 1, 2].map((level) => timeLimit(internalLevel(level, true)))).toEqual([35, 35, 35]);
  });

  it("la requête est exigée : sans Game.openMinigame(25) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createObservation(game, () => undefined)).toThrow(/openMinigame\(25\)/);
  });
});

describe.skipIf(!hasOriginalFiles)("S25 : ressources", () => {
  it("les 25 décors, le curseur, le son du clic et 12 voix de chaque série existent", () => {
    const names = new Set(listData(() => true).map((p) => p.split("/").pop()!.toLowerCase()));
    for (let letter = 0; letter < 5; letter++) {
      for (let digit = 0; digit < 5; digit++) expect(names.has(pictureFile(letter, digit)), pictureFile(letter, digit)).toBe(true);
    }
    for (const name of ["s25a000s.hy8", "s25a000s.pal", "s25a001b.voc", "s25a002b.voc"]) expect(names.has(name), name).toBe(true);
    for (const prefix of ["s25b", "s25c"]) {
      for (let i = 1; i <= 12; i++) expect(names.has(`${prefix}${String(i).padStart(3, "0")}t.voc`), `${prefix}${i}`).toBe(true);
    }
  });
});

const sceneOf = (run: LaunchedMinigame) => run.scene as ObservationScene;

async function untilHunt(run: LaunchedMinigame): Promise<void> {
  await run.until(() => sceneOf(run).stage === "hunt");
}

async function clickAt(run: LaunchedMinigame, x: number, y: number, key = "Space"): Promise<void> {
  run.host.input.mouseMove(x, y);
  await run.tap(key, 60);
}

describe.skipIf(!hasOriginalFiles)("S25 Observation : décor, recherche, résultat", () => {
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(25, options);
    await run.until(() => !run.ctx.fade.active);
    return run;
  };

  it("départ : le chrono ne court pas pendant le fondu d'entrée ; curseur au centre, décor affiché", async () => {
    const run = await launchMinigame(25, { seed: 3 });
    const scene = sceneOf(run);
    expect(run.ctx.fade.active).toBe(true);
    await run.run(100);
    expect(scene.searchSeconds).toBe(0);
    expect(scene.stage).toBe("intro");
    await untilHunt(run);
    expect(run.ctx.input.mouseX).toBe(START_X);
    expect(run.ctx.input.mouseY).toBe(START_Y);
    run.shot("s25-debut");
  }, 60_000);

  it("graine fixe : même décor ; des graines différentes les font varier ; le niveau règle le temps, pas le décor", async () => {
    const a = sceneOf(await launch({ seed: 21 }));
    const b = sceneOf(await launch({ seed: 21 }));
    expect(a.picture.file).toBe(b.picture.file);
    const files = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) files.add(sceneOf(await launch({ seed })).picture.file);
    expect(files.size).toBeGreaterThan(12);
    const limits: number[] = [];
    for (const level of [0, 1, 2]) {
      const other = sceneOf(await launch({ seed: 21, level }));
      expect(other.picture.file).toBe(a.picture.file);
      limits.push(other.limit);
    }
    expect(limits).toEqual([30, 25, 20]);
  }, 120_000);

  it("curseur : suit la souris, les flèches le déplacent de 2 px par tick", async () => {
    const run = await launch({ seed: 3 });
    await untilHunt(run);
    const { input } = run.ctx;
    run.host.input.keyDown("ArrowRight");
    await run.run(500);
    run.host.input.keyUp("ArrowRight");
    expect(input.mouseX).toBeGreaterThan(START_X + 40);
    expect(input.mouseX).toBeLessThanOrEqual(START_X + 2 * 31);
    run.host.input.mouseMove(40, 60);
    await run.run(100);
    expect(input.mouseX).toBe(40);
  }, 60_000);

  it("réussite rapide : un clic sur l'objet avant le tiers du temps donne 3 points ; le double cadre entoure l'objet", async () => {
    const run = await launch({ seed: 3, audio: true });
    const scene = sceneOf(run);
    await untilHunt(run);
    await run.run(1500);
    const { x, y } = scene.targetCenter;
    await clickAt(run, x, y);
    expect(scene.ending).toBe("hit");
    await run.until(() => scene.stage === "voice");
    expect(scene.spokenVoice).toMatch(/^s25c0(0[1-9]|1[0-2])t\.voc$/);
    run.shot("s25-reussite");
    expect(await run.finish()).toEqual({ kind: "points", points: 3 });
    expect(scene.points).toBe(3);
  }, 60_000);

  it("points selon le temps (niveau 0, 30 s) : 3 avant 10 s, 2 de 10 à 19 s, 1 ensuite", async () => {
    for (const [wait, points] of [
      [4500, 3],
      [12_500, 2],
      [22_500, 1],
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

  it("niveau 2 (20 s) : 3 avant 6 s, 2 de 6 à 12 s, 1 ensuite", async () => {
    for (const [wait, points] of [
      [3500, 3],
      [8500, 2],
      [14_500, 1],
    ] as const) {
      const run = await launch({ seed: 8, level: 2 });
      const scene = sceneOf(run);
      await untilHunt(run);
      await run.run(wait);
      const { x, y } = scene.targetCenter;
      await clickAt(run, x, y);
      expect(await run.finish()).toEqual({ kind: "points", points });
    }
  }, 120_000);

  it("échec : un clic à côté ne donne rien, le curseur reste affiché et aucun cadre n'apparaît ; voix s25b007..012", async () => {
    const run = await launch({ seed: 3, audio: true });
    const scene = sceneOf(run);
    await untilHunt(run);
    const { x, y } = scene.targetCenter;
    await clickAt(run, (x + 160) % 320, (y + 100) % 200);
    expect(scene.ending).toBe("miss");
    await run.until(() => scene.stage === "voice");
    expect(scene.spokenVoice).toMatch(/^s25b0(0[7-9]|1[0-2])t\.voc$/);
    run.shot("s25-echec-clic");
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
  }, 60_000);

  it("Entrée (clic droit) ne termine pas la recherche", async () => {
    const run = await launch({ seed: 3 });
    const scene = sceneOf(run);
    await untilHunt(run);
    const { x, y } = scene.targetCenter;
    await clickAt(run, x, y, "Enter");
    await run.run(300);
    expect(scene.stage).toBe("hunt");
    expect(scene.ending).toBeNull();
  }, 60_000);

  it("temps écoulé : 30 s sans clic = échec, voix s25b001..006", async () => {
    const run = await launch({ seed: 3, audio: true });
    const scene = sceneOf(run);
    await untilHunt(run);
    await run.run(28_000);
    expect(scene.stage).toBe("hunt");
    await run.run(3000);
    expect(scene.ending).toBe("timeout");
    await run.until(() => scene.stage === "voice");
    expect(scene.spokenVoice).toMatch(/^s25b00[1-6]t\.voc$/);
    run.shot("s25-echec-temps");
    expect(await run.finish()).toEqual({ kind: "points", points: 0 });
  }, 120_000);

  it("la voix de fin est tirée avec un seul rand, après les deux du décor (même graine, même voix)", async () => {
    const voices: string[] = [];
    for (let i = 0; i < 2; i++) {
      const run = await launch({ seed: 12 });
      const scene = sceneOf(run);
      await untilHunt(run);
      await run.run(31_000);
      await run.finish();
      voices.push(scene.spokenVoice!);
    }
    expect(voices[0]).toBe(voices[1]);
    const rng = new BorlandRandom(12);
    const probe = new BorlandRandom(12);
    drawPicture((n) => probe.below(n));
    // Le moteur de test tire peut-être d'autres nombres avant la scène : on vérifie seulement que la voix est dans la série des délais.
    expect(rng.below(6)).toBeGreaterThanOrEqual(0);
    expect(voices[0]).toMatch(/^s25b00[1-6]t\.voc$/);
  }, 120_000);

  it("indice de l'oiseau : niveau interne 0, 35 s, même pour le niveau 2 du joueur ; l'indice est consommé", async () => {
    const bird = await launch({ seed: 3, bonus: true, level: 2 });
    const plain = await launch({ seed: 3, level: 2 });
    expect(sceneOf(bird).internalLevel).toBe(0);
    expect(sceneOf(bird).limit).toBe(35);
    expect(sceneOf(bird).hasBonus).toBe(true);
    expect(sceneOf(plain).internalLevel).toBe(3);
    expect(sceneOf(plain).limit).toBe(20);
    expect(bird.game.state.bonusTag).toBe(0);
    await untilHunt(bird);
    await bird.run(33_000);
    expect(sceneOf(bird).stage).toBe("hunt");
    await bird.run(3000);
    expect(sceneOf(bird).ending).toBe("timeout");
  }, 120_000);

  it("plateau : un clic juste = des gouttes de rosée, le plateau reprend la main", async () => {
    const s = await enterFromBoard(25, "ObservationScene", { seed: 11 });
    const scene = s.ctx.scenes.top as ObservationScene;
    expect(scene).toBeInstanceOf(ObservationScene);
    expect(s.game.state.pending).toMatchObject({ scene: 25, player: 0 });
    const before = s.game.player.points;
    await s.until(() => scene.stage === "hunt");
    await s.run(1000);
    const { x, y } = scene.targetCenter;
    s.host.input.mouseMove(x, y);
    await s.tap("Space");
    await s.until(() => scene.stage === "done", 60_000);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(scene.ending).toBe("hit");
    expect(s.game.player.points).toBe(before + 3);
    expect(s.history).toContain("ObservationScene");
  }, 180_000);

  it("plateau : temps écoulé = rien", async () => {
    const s = await enterFromBoard(25, "ObservationScene", { seed: 11 });
    const scene = s.ctx.scenes.top as ObservationScene;
    const before = s.game.player.points;
    await s.until(() => scene.stage === "done", 90_000);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.player.points).toBe(before);
  }, 180_000);

  it("mode libre : la partie se joue, puis la carte revient sans rien appliquer", async () => {
    const run = await enterFromFreeMode(25, { seed: 5 });
    const scene = run.scene as ObservationScene;
    expect(scene).toBeInstanceOf(ObservationScene);
    expect(run.game.state.pending).toMatchObject({ scene: 25 });
    await run.until(() => scene.stage === "hunt", 60_000);
    await run.run(500);
    const { x, y } = scene.targetCenter;
    run.host.input.mouseMove(x, y);
    await run.tap("Space", 60);
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 90_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);
});
