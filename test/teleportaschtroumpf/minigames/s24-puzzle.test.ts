import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  HOLE_HEIGHT,
  HOLE_WIDTH,
  PICTURE_COUNT,
  PuzzleScene,
  SLOT_STEP,
  SLOT_X,
  SLOT_Y,
  createPuzzle,
  holeCount,
  placeHoles,
  pointsForTime,
  previewSeconds,
  timeLimit,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s24-puzzle";
import { hasOriginalFiles } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

describe("S24 : règles du puzzle (pur, `2e6a:0001`)", () => {
  it("trous, temps et aperçu selon le niveau : 3, 4, 5 trous ; 40, 35, 30 s ; 5, 4, 3 s d'aperçu", () => {
    expect([0, 1, 2].map(holeCount)).toEqual([3, 4, 5]);
    expect([0, 1, 2].map(timeLimit)).toEqual([40, 35, 30]);
    expect([0, 1, 2].map(previewSeconds)).toEqual([5, 4, 3]);
  });

  it("points : moins du tiers du temps 3, moins des deux tiers 2, sinon 1 (divisions entières)", () => {
    expect([0, 12, 13, 25, 26, 39].map((s) => pointsForTime(s, 40))).toEqual([3, 3, 2, 2, 1, 1]);
    expect([0, 10, 11, 22, 23, 34].map((s) => pointsForTime(s, 35))).toEqual([3, 3, 2, 2, 1, 1]);
    expect([0, 9, 10, 19, 20, 29].map((s) => pointsForTime(s, 30))).toEqual([3, 3, 2, 2, 1, 1]);
  });

  it("trous : un par colonne, jamais chevauchés, vignettes en permutation, tirage fixe pour une graine", () => {
    for (let seed = 1; seed < 400; seed++) {
      for (const count of [3, 4, 5]) {
        const rng = new BorlandRandom(seed);
        const holes = placeHoles((n) => rng.below(n), count);
        const column = Math.trunc(0x107 / count);
        expect(holes).toHaveLength(count);
        holes.forEach((h, i) => {
          expect(h.x).toBeGreaterThanOrEqual(i * column + 6);
          expect(h.x).toBeLessThan(i * column + 6 + column - 5);
          expect(h.y).toBeGreaterThanOrEqual(4);
          expect(h.y).toBeLessThan(4 + 0x7b);
          for (const other of holes.slice(0, i)) {
            const apart = Math.abs(h.x - other.x) >= 0x26 || Math.abs(h.y - other.y) >= 0x17;
            expect(apart).toBe(true);
          }
        });
        expect(holes.map((h) => h.slot).sort()).toEqual(Array.from({ length: count }, (_, i) => i));
      }
    }
    const a = new BorlandRandom(9);
    const b = new BorlandRandom(9);
    expect(placeHoles((n) => a.below(n), 4)).toEqual(placeHoles((n) => b.below(n), 4));
  });

  it("la requête est exigée : sans Game.openMinigame(24) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createPuzzle(game, () => undefined)).toThrow(/openMinigame\(24\)/);
  });
});

// --- Pilote -------------------------------------------------------------------------------------------

async function click(run: LaunchedMinigame, x: number, y: number, hold = 120): Promise<void> {
  run.host.input.mouseMove(x, y);
  run.host.input.mouseDown(0);
  await run.run(hold);
  run.host.input.mouseUp(0);
  await run.run(100);
}

/** Clic au centre du trou `index`. */
async function clickHole(run: LaunchedMinigame, index: number): Promise<void> {
  const hole = (run.scene as PuzzleScene).holes[index];
  await click(run, hole.x + (HOLE_WIDTH >> 1), hole.y + (HOLE_HEIGHT >> 1));
}

/** Les trous dans l'ordre où la rangée du bas les demande. */
function order(scene: PuzzleScene): number[] {
  return scene.holes.map((h, i) => [h.slot, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
}

async function launch(options: LaunchOptions = {}, shot?: string): Promise<LaunchedMinigame> {
  const run = await launchMinigame(24, { seed: 5, ...options });
  if (shot) {
    await run.run(1500);
    run.shot(`${shot}-apercu`);
  }
  // Aperçu du tableau entier, relâchement, puis le jeu.
  await run.until(() => (run.scene as PuzzleScene).stage === "play");
  return run;
}

describe.skipIf(!hasOriginalFiles)("S24 Le Puzzle : mise en place", () => {
  it("tableau et trous tirés par la graine ; l'aperçu dure 5 s au niveau 0 et un clic le raccourcit", async () => {
    const run = await launchMinigame(24, { seed: 5 });
    const scene = run.scene as PuzzleScene;
    expect(scene.stage).toBe("preview");
    expect(scene.picture).toBeGreaterThanOrEqual(1);
    expect(scene.picture).toBeLessThanOrEqual(PICTURE_COUNT);
    expect(scene.holes).toHaveLength(3);
    await run.run(1500);
    run.shot("s24-apercu");
    await run.run(2500);
    expect(scene.stage).toBe("preview");
    await run.until(() => scene.stage === "play");
    expect(run.ctx.input.mouseX).toBe(0xa0);
    expect(run.ctx.input.mouseY).toBe(0x64);

    const quick = await launchMinigame(24, { seed: 5 });
    await quick.run(800);
    await click(quick, 10, 10);
    await quick.until(() => (quick.scene as PuzzleScene).stage === "play", 2000);
    const again = await launchMinigame(24, { seed: 5 });
    const twin = again.scene as PuzzleScene;
    expect(twin.picture).toBe(scene.picture);
    expect(twin.holes).toEqual(scene.holes);
  }, 60_000);

  it("le niveau donne 3, 4 ou 5 trous et 40, 35 ou 30 s ; l'indice de l'oiseau remet le niveau 0", async () => {
    for (const level of [0, 1, 2]) {
      const run = await launchMinigame(24, { seed: 5, level });
      const scene = run.scene as PuzzleScene;
      expect(scene.holes).toHaveLength(level + 3);
      expect(scene.limit).toBe(40 - 5 * level);
    }
    const bonus = await launchMinigame(24, { seed: 5, level: 2, bonus: true });
    const scene = bonus.scene as PuzzleScene;
    expect(scene.effectiveLevel).toBe(0);
    expect(scene.holes).toHaveLength(3);
    expect(scene.limit).toBe(40);
  }, 60_000);

  it("la rangée du bas montre la vignette de chaque trou, celle à trouver est encadrée, les trous sont pleins", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as PuzzleScene;
    await run.run(100);
    run.shot("s24-jeu");
    const { work, background } = run.ctx.surface;
    for (const hole of scene.holes) {
      const dx = SLOT_X + hole.slot * SLOT_STEP;
      // La vignette recopie le tableau (premier pixel, hors du cadre).
      expect(work[SLOT_Y * 320 + dx]).toBe(background[hole.y * 320 + hole.x]);
      // Le trou est rempli de 0x7F (le curseur est au centre, loin des trous : pas de survol).
      expect(work[(hole.y + 3) * 320 + hole.x + 3]).toBe(0x7f);
    }
    const target = scene.holes[scene.targetIndex];
    expect(target.slot).toBe(0);
    expect(work[0x9d * 320 + 0x1e + target.slot * SLOT_STEP]).toBe(0x7e);
    expect(work[0xb5 * 320 + 0x45 + target.slot * SLOT_STEP]).toBe(0x7e);
  }, 60_000);

  it("le survol d'un trou l'entoure de deux cadres, 0x7E et 0x7F", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as PuzzleScene;
    const hole = scene.holes[1];
    run.host.input.mouseMove(hole.x + 5, hole.y + 5);
    await run.run(100);
    expect(scene.hoveredHole).toBe(1);
    const { work } = run.ctx.surface;
    expect(work[(hole.y - 1) * 320 + hole.x + 10]).toBe(0x7e);
    expect(work[(hole.y - 2) * 320 + hole.x + 10]).toBe(0x7f);
    run.shot("s24-survol");
    run.host.input.mouseMove(2, 2);
    await run.run(100);
    expect(scene.hoveredHole).toBe(-1);
  }, 60_000);

  it("les flèches déplacent le curseur de 2 px par tick, Espace clique", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as PuzzleScene;
    const hole = scene.holes[scene.targetIndex];
    run.host.input.mouseMove(hole.x - 8, hole.y + 4);
    run.host.input.keyDown("ArrowRight");
    await run.until(() => run.ctx.input.mouseX >= hole.x + 4, 3000);
    run.host.input.keyUp("ArrowRight");
    await run.run(100);
    expect(scene.hoveredHole).toBe(scene.targetIndex);
    await run.tap("Space", 120);
    expect(scene.foundCount).toBe(1);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S24 Le Puzzle : parties", () => {
  it("réussite rapide : les deux premiers trous suffisent (le dernier se devine), 3 points, fondu sonore compris", async () => {
    const run = await launch({ seed: 5 }, "s24-rapide");
    const scene = run.scene as PuzzleScene;
    const [first, second, last] = order(scene);
    await clickHole(run, first);
    expect(scene.foundCount).toBe(1);
    expect(scene.targetIndex).toBe(second);
    expect(scene.isFound[first]).toBe(true);
    run.shot("s24-premier-trou");
    await clickHole(run, second);
    expect(scene.stage).toBe("fade");
    expect(scene.ending).toBe("won");
    // Le trou resté ouvert est encadré pendant le fondu sonore.
    await run.run(200);
    const hole = scene.holes[last];
    expect(run.ctx.surface.work[(hole.y - 1) * 320 + hole.x + 10]).toBe(0x7e);
    run.shot("s24-fondu");
    const outcome = await run.finish();
    expect(scene.ending).toBe("won");
    // Fondu sonore : 15 crans de 0,2 s = 3 s ajoutées au temps lu.
    expect(scene.measuredSeconds).toBeGreaterThanOrEqual(3);
    expect(scene.measuredSeconds).toBeLessThan(13);
    expect(outcome).toEqual({ kind: "points", points: 3 });
    expect(run.ctx.surface.work).toEqual(run.ctx.surface.background);
  }, 120_000);

  it("réussite lente : 2 points entre 13 s et 26 s lues, 1 point au-delà", async () => {
    const slow = async (waitMs: number) => {
      const run = await launch({ seed: 5 });
      const scene = run.scene as PuzzleScene;
      const [first, second] = order(scene);
      await run.run(waitMs);
      await clickHole(run, first);
      await clickHole(run, second);
      return { outcome: await run.finish(), seconds: scene.measuredSeconds };
    };
    const two = await slow(12_000);
    expect(two.seconds).toBeGreaterThanOrEqual(13);
    expect(two.seconds).toBeLessThan(26);
    expect(two.outcome).toEqual({ kind: "points", points: 2 });
    const one = await slow(24_000);
    expect(one.seconds).toBeGreaterThanOrEqual(26);
    expect(one.seconds).toBeLessThan(40);
    expect(one.outcome).toEqual({ kind: "points", points: 1 });
  }, 180_000);

  it("un clic sur un autre trou met fin à la partie : 0 point, bruit faux, trous restants encadrés", async () => {
    const run = await launch({ seed: 5, audio: true });
    const scene = run.scene as PuzzleScene;
    const bad = await run.ctx.resources.voc("s24a002b.voc");
    const [first, second] = order(scene);
    await clickHole(run, second);
    expect(scene.ending).toBe("wrong");
    expect(scene.foundCount).toBe(0);
    expect(run.host.audio.effects.at(-1)?.sound.samples).toEqual(bad.samples);
    expect(scene.stage).toBe("fade");
    await run.run(200);
    const hole = scene.holes[first];
    expect(run.ctx.surface.work[(hole.y - 1) * 320 + hole.x + 10]).toBe(0x7e);
    run.shot("s24-echec");
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "points", points: 0 });
  }, 120_000);

  it("un clic dans le vide ne fait rien", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as PuzzleScene;
    await click(run, 2, 2);
    expect(scene.stage).toBe("play");
    expect(scene.foundCount).toBe(0);
  }, 60_000);

  it("temps écoulé (40 s au niveau 0) : 0 point", async () => {
    const run = await launch({ seed: 5 });
    const scene = run.scene as PuzzleScene;
    await run.until(() => scene.stage !== "play", 45_000);
    expect(scene.ending).toBe("timeout");
    expect(scene.seconds).toBeGreaterThanOrEqual(40);
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "points", points: 0 });
  }, 120_000);

  it("niveau 2 : cinq trous, quatre clics justes", async () => {
    const run = await launch({ seed: 5, level: 2 });
    const scene = run.scene as PuzzleScene;
    expect(scene.holes).toHaveLength(5);
    for (const index of order(scene).slice(0, 4)) await clickHole(run, index);
    expect(scene.ending).toBe("won");
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "points", points: 3 });
  }, 120_000);

  it("graine fixe : même tableau, mêmes trous, même issue", async () => {
    const play = async () => {
      const run = await launch({ seed: 21 });
      const scene = run.scene as PuzzleScene;
      const [first, second] = order(scene);
      await clickHole(run, first);
      await clickHole(run, second);
      return { picture: scene.picture, holes: scene.holes, outcome: await run.finish() };
    };
    const a = await play();
    const b = await play();
    expect(b).toEqual(a);
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("S24 Le Puzzle : parcours depuis le plateau et depuis le mode libre", () => {
  it("plateau, porte de la scène 24 : réussite → les points sont ajoutés et le tour est fini", async () => {
    const s = await enterFromBoard(24, "PuzzleScene", { seed: 11 });
    const scene = s.ctx.scenes.top as PuzzleScene;
    expect(scene).toBeInstanceOf(PuzzleScene);
    expect(s.game.state.pending).toMatchObject({ scene: 24, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    const before = s.game.player.points;
    await s.until(() => scene.stage === "play");
    const clickAt = async (index: number) => {
      const hole = scene.holes[index];
      s.host.input.mouseMove(hole.x + 18, hole.y + 10);
      s.host.input.mouseDown(0);
      await s.run(120);
      s.host.input.mouseUp(0);
      await s.run(100);
    };
    // Le niveau du joueur donne le nombre de trous : tous sauf le dernier.
    const needed = order(scene).slice(0, scene.holes.length - 1);
    for (const index of needed) await clickAt(index);
    expect(scene.foundCount).toBe(needed.length);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.points).toBe(before + 3);
    expect(s.history).toContain("PuzzleScene");
  }, 180_000);

  it("mode libre : la partie se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(24, { seed: 5 });
    const scene = run.scene as PuzzleScene;
    expect(scene).toBeInstanceOf(PuzzleScene);
    expect(run.game.state.pending).toMatchObject({ scene: 24 });
    await run.until(() => scene.stage === "play");
    const [first, second] = order(scene);
    await clickHole(run, first);
    await clickHole(run, second);
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 60_000);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);
});
