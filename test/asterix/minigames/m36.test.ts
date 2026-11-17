import { describe, expect, it } from "vitest";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import {
  DELAY_PER_LEVEL,
  GAIN,
  GROUND_Y,
  HIT_MAX_Y,
  HIT_MIN_Y,
  MODULE,
  MOVE_LEFT,
  MOVE_NONE,
  MOVE_RIGHT,
  ROCK_ALIGN_Y,
  ROCK_SPEED,
  ROCK_SPEED_PER_LEVEL,
  ciel,
  type CielState,
} from "../../../src/games/asterix/scenes/minigames/m36";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { dodge, playM36, threatened } from "./m36-player";

/**
 * Mini-jeu du Ciel sur la tête (`docs/asterix/minigames/m36.md`) : lancé seul par sa case, joué au clavier ou au clic
 * sur le moteur de test. Inscrit ici en attendant `minigames/index.ts`.
 */
registerMinigame(MODULE, ciel);

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));
/** Images de la vidéo : marqueur 1 (fin de la pluie) et marqueur 2 (gagné). */
const END_FRAME = 305;
const WIN_FRAME = 331;

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu du Ciel sur la tête (M36)", () => {
  it("la case 23 lance le mini-jeu inscrit, après son annonce", async () => {
    const run = await launchMinigame({ module: MODULE });
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(22);
    expect(loaded(run, "K60TE4")).toBe(true);
    expect(loaded(run, "M36SA000.HY8")).toBe(true);
    expect(minigameState<CielState>(run)).toMatchObject({ pos: 1, move: MOVE_NONE, hit: false, falling: false, phase: -1 });
  });

  for (const action of [0, 1, 2]) {
    it(`niveau Action ${action} : victoire au marqueur 2, ${GAIN} sesterce, vitesse et rythme du niveau`, async () => {
      const run = await launchMinigame({ module: MODULE, action }, { seed: 200 + action });
      const state = minigameState<CielState>(run);
      const speed = ROCK_SPEED + ROCK_SPEED_PER_LEVEL * action;
      const lanes: number[] = [];
      const gaps: number[] = [];
      let falling = false;
      let crashedAt = -1;
      let aimed = 0;
      let shots = 0;
      while (run.screen === "minigame") {
        if (state.falling && !falling) {
          lanes.push(state.lane);
          if (threatened(state)) aimed++;
          expect(state.speed).toBe(speed);
          expect(state.rockY).toBe(ROCK_ALIGN_Y % speed);
          // Aucun rocher ne part après le marqueur 1.
          expect(state.frame).toBeLessThan(END_FRAME);
          if (crashedAt >= 0) gaps.push(state.frame - crashedAt);
        }
        if (!state.falling && falling) crashedAt = state.frame;
        falling = state.falling;
        if (state.falling && shots < 3 && (state.crashed || state.rockY > 100)) {
          run.shot(`m36-a${action}-${shots++}`);
        }
        if (!(await dodge(run, state))) await run.frame();
      }
      expect(state).toMatchObject({ won: true, hit: false, phase: 2, ending: true });
      expect(state.frame).toBeGreaterThanOrEqual(WIN_FRAME);
      // Les trois couloirs sont visés ; environ un rocher sur deux tombe sur le joueur.
      expect(new Set(lanes).size).toBe(3);
      expect(aimed).toBeGreaterThan(lanes.length / 4);
      // Attente entre deux rochers : (3 − niveau) × 5 + 0..7 images.
      const base = (3 - action) * DELAY_PER_LEVEL;
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(base);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(base + 7);
      // Plus le niveau monte, plus il tombe de rochers.
      expect(lanes.length).toBeGreaterThanOrEqual([7, 9, 12][action]);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(GAIN);
      expect(loaded(run, "M36A.MUX")).toBe(true);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("défaite : sans bouger, un rocher qui vise le joueur le touche ; aucun sesterce", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 7 });
    const state = minigameState<CielState>(run);
    await run.until(() => state.hit, 30_000);
    run.shot("m36-hit");
    expect(state).toMatchObject({ hit: true, falling: false, pos: 1, won: false });
    expect(state.lane).toBe(1);
    expect(state.rockY).toBeGreaterThan(HIT_MIN_Y);
    expect(state.rockY).toBeLessThan(HIT_MAX_Y);
    expect(state.frame).toBeLessThan(END_FRAME);
    // La vidéo s'arrête à l'image suivante.
    const frame = state.frame;
    await run.until(() => run.screen !== "minigame", 1_000);
    expect(state.frame).toBe(frame + 1);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(run.rt.missing).toEqual([]);
  });

  it("perdu, avec le son : le joueur assommé reste animé le temps du bruitage du choc (2,3 s)", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 7, audio: true });
    const state = minigameState<CielState>(run);
    await run.until(() => state.hit, 60_000);
    await run.until(() => run.screen !== "minigame", 1_000);
    const ended = run.host.time;
    await run.run(1_000);
    run.shot("m36-stunned");
    expect(loaded(run, "M36B0004")).toBe(true);
    // L'animation « assommé » (22 images à 6 ticks) tient dans le bruitage ; les étoiles la suivent.
    await run.until(() => state.stunned, 2_000);
    expect(state.move).toBe(MOVE_LEFT);
    await untilMinigameOver(run);
    expect(run.host.time - ended).toBeGreaterThan(2_200);
    expect(minigamePlayer(run).sesterces).toBe(0);
  });

  it("le robot perd en ne bougeant pas, et le sesterce gagné s'ajoute à ceux du joueur", async () => {
    const lost = await launchMinigame({ module: MODULE, action: 2 }, { seed: 3 });
    minigamePlayer(lost).sesterces = 5;
    await playM36(lost, false);
    expect(minigameState<CielState>(lost) ?? null).toBeNull();
    await untilMinigameOver(lost);
    expect(minigamePlayer(lost).sesterces).toBe(5);

    const won = await launchMinigame({ module: MODULE, action: 2 }, { seed: 3 });
    minigamePlayer(won).sesterces = 5;
    await playM36(won, true);
    await untilMinigameOver(won);
    expect(minigamePlayer(won).sesterces).toBe(5 + GAIN);
  });

  it("le joueur ne change de couloir qu'à la fin de son pas, et reste dans les trois couloirs", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 11 });
    const state = minigameState<CielState>(run);
    await run.tap("ArrowLeft");
    await run.until(() => state.move !== MOVE_NONE, 500);
    expect(state).toMatchObject({ move: MOVE_LEFT, pos: 1 });
    await run.until(() => state.move === MOVE_NONE, 1_000);
    expect(state.pos).toBe(0);
    // Au bord gauche, la flèche gauche ne fait rien.
    await run.tap("ArrowLeft");
    await run.run(300);
    expect(state).toMatchObject({ move: MOVE_NONE, pos: 0 });
    await run.tap("ArrowRight");
    await run.until(() => state.move === MOVE_RIGHT, 500);
    await run.until(() => state.move === MOVE_NONE, 1_000);
    expect(state.pos).toBe(1);
  });

  it("un rocher qui s'écrase dépasse le sol, puis le suivant part", async () => {
    const run = await launchMinigame({ module: MODULE, action: 1 }, { seed: 5 });
    const state = minigameState<CielState>(run);
    while (!state.crashed) {
      expect(run.screen).toBe("minigame");
      if (!(await dodge(run, state))) await run.frame();
    }
    expect(state.rockY).toBeGreaterThan(GROUND_Y);
    await run.until(() => !state.falling, 1_000);
    expect(state.delay).toBeGreaterThanOrEqual(2 * DELAY_PER_LEVEL);
  });

  it("clic ou toucher direct (D11) : moitié gauche pour un pas à gauche, moitié droite pour un pas à droite", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 11 });
    const state = minigameState<CielState>(run);
    await run.click(40, 100);
    await run.until(() => state.move !== MOVE_NONE, 500);
    expect(state.move).toBe(MOVE_LEFT);
    await run.until(() => state.move === MOVE_NONE, 1_000);
    expect(state.pos).toBe(0);
    await run.click(280, 100);
    await run.until(() => state.move !== MOVE_NONE, 500);
    expect(state.move).toBe(MOVE_RIGHT);
    // Espace, sans position, ne commande rien.
    await run.until(() => state.move === MOVE_NONE, 1_000);
    await run.tap("Space");
    await run.run(300);
    expect(state).toMatchObject({ move: MOVE_NONE, pos: 1 });
  });
});
