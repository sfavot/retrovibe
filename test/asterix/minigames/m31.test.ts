import { describe, expect, it } from "vitest";
import { parseHy8 } from "../../../src/engine/infogrames/data/hy8";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import {
  CARPETS_MIN,
  CARPET_FLY,
  CARPET_MAX_X,
  CARPET_MAX_Y,
  CARPET_MIN_X,
  CARPET_MIN_Y,
  GAIN,
  JUMP_DX,
  JUMP_DY,
  LAND_LEFT,
  LAND_RIGHT,
  MODULE,
  POSE_FALL,
  POSE_HOP,
  POSE_IDLE,
  POSE_JUMP,
  ROW_HEIGHT,
  TIME_LIMIT,
  TURN_FALL_RANK,
  fakir,
  type FakirState,
} from "../../../src/games/asterix/scenes/minigames/m31";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { FLY_FRAMES, JUMP_FRAMES, TURN_FRAMES, carpetAfter, jumpLands, mustHop, nextCarpet, nextFrame, ownCarpet, playM31 } from "./m31-player";

/**
 * Mini-jeu du Fakir (`docs/asterix/minigames/m31.md`) : lancé seul par sa case, joué au clavier ou au clic sur le moteur
 * de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */
registerMinigame(MODULE, fakir);

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));

/** Grimpe sur le premier tapis comme le robot, et s'arrête posé dessus. */
async function climbOne(run: Launched, state: FakirState): Promise<void> {
  while (state.climbed === 0) {
    if (jumpLands(state)) await run.tap("ArrowUp");
    await nextFrame(run, state);
  }
  while (state.pose !== POSE_IDLE) await nextFrame(run, state);
  expect(state).toMatchObject({ climbed: 1, over: false });
}

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu du Fakir (M31)", () => {
  it("la planche m31s.hy8 : aucun déplacement par image, et une image marquée (bruitage) par animation du joueur", () => {
    const sheet = parseHy8(readOriginal("MDF/31/M31S.HY8"));
    expect(sheet.animations.flatMap((animation) => animation.frames).every((frame) => frame.dx === 0 && frame.dy === 0)).toBe(true);
    const tagged = sheet.animations.map((animation) => animation.frames.findIndex((frame) => frame.duration === 2));
    expect(tagged).toEqual([-1, -1, -1, 3, 3, 2, -1, -1]);
    expect(sheet.animations.map((animation) => animation.frames.length)).toEqual([FLY_FRAMES, TURN_FRAMES, 0, 11, JUMP_FRAMES, 14, 1, TURN_FRAMES]);
  });

  it("la case 36 lance le mini-jeu inscrit, après son annonce : le joueur au sol, les tapis en vol", async () => {
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<FakirState>(run);
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(35);
    expect(loaded(run, "K60TE")).toBe(true);
    expect(loaded(run, "M31S.HY8")).toBe(true);
    expect(state).toMatchObject({ climbed: 0, x: 0x4b, pose: POSE_IDLE, timeUp: false, over: false, won: false });
  });

  for (const action of [0, 1, 2]) {
    it(`niveau Action ${action} : ${action + CARPETS_MIN} tapis, le sommet en moins de ${TIME_LIMIT} s, ${GAIN} sesterces et les deux vidéos`, async () => {
      const run = await launchMinigame({ module: MODULE, action }, { seed: 20 + action });
      const state = minigameState<FakirState>(run);
      const count = action + CARPETS_MIN;
      minigamePlayer(run).sesterces = 4;
      expect(state.count).toBe(count);
      expect(state.carpets).toHaveLength(count);
      expect(loaded(run, `M31DA00${action}.MCC`)).toBe(true);
      expect(state.y).toBe(count * ROW_HEIGHT + 0x2d);
      // Chaque tapis part sur la diagonale de son étage, dans la course.
      state.carpets.forEach((carpet, i) => {
        expect(carpet.x).toBeGreaterThanOrEqual(CARPET_MIN_X);
        expect(carpet.x).toBeLessThanOrEqual(CARPET_MAX_X);
        expect(carpet.y).toBeGreaterThanOrEqual(CARPET_MIN_Y);
        expect(carpet.y).toBeLessThanOrEqual(CARPET_MAX_Y);
        // Une image a déjà été jouée : le tapis a fait un pas depuis son tirage.
        expect(carpet.y - carpet.dir).toBe(i * ROW_HEIGHT + ((carpet.x - carpet.dir * 2 - CARPET_MIN_X) >> 1) + ROW_HEIGHT);
      });
      run.shot(`m31-depart-${action}`);
      const started = run.host.time;
      const heights: number[] = [];
      let shot = false;
      while (run.screen === "minigame") {
        if (state.pose === POSE_IDLE && !state.won) {
          if (heights.at(-1) !== state.climbed) heights.push(state.climbed);
          if (mustHop(state)) await run.tap("Space");
          else if (jumpLands(state)) await run.tap("ArrowUp");
        }
        if (!shot && state.pose === POSE_JUMP && state.climbed === 2) {
          await run.run(300);
          run.shot(`m31-saut-${action}`);
          shot = true;
        }
        await nextFrame(run, state);
      }
      expect(heights).toEqual(Array.from({ length: count + 1 }, (_, i) => i));
      expect(state).toMatchObject({ climbed: count + 1, won: true, over: false, timeUp: false });
      expect(run.host.time - started).toBeLessThan(TIME_LIMIT * 1000);
      await run.until(() => loaded(run, "M31AA.MUX"), 20_000);
      await run.run(1_000);
      run.shot(`m31-video-${action}`);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(4 + GAIN);
      expect(loaded(run, "M31AB.MUX")).toBe(true);
      expect(loaded(run, "K63TE02")).toBe(false);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("les tapis vont et viennent de (2, 1) par image et se retournent sur place en 12 images, comme le prévoit le robot", async () => {
    const run = await launchMinigame({ module: MODULE, action: 2 }, { seed: 9 });
    const state = minigameState<FakirState>(run);
    const turns = new Set<number>();
    for (let frame = 0; frame < 400; frame++) {
      const expected = state.carpets.map(nextCarpet);
      await nextFrame(run, state);
      expect(state.carpets).toEqual(expected);
      state.carpets.forEach((carpet, i) => {
        if (carpet.mode !== CARPET_FLY) turns.add(i);
      });
    }
    expect(turns.size).toBe(6);
    expect(carpetAfter(state.carpets[0], 3)).toEqual(nextCarpet(nextCarpet(nextCarpet(state.carpets[0]))));
    expect(state).toMatchObject({ climbed: 0, pose: POSE_IDLE, over: false });
  });

  it("un saut à côté du tapis : chute, fin sans sesterce ni voix", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 4 });
    const state = minigameState<FakirState>(run);
    const started = run.host.time;
    // On attend que le tapis du bas soit, à la retombée, hors de la fenêtre `x − 22 < X < x + 15`.
    for (;;) {
      const target = carpetAfter(state.carpets[state.count - 1], JUMP_FRAMES);
      const x = state.x + JUMP_DX;
      if (!(target.x - LAND_LEFT < x && x < target.x + LAND_RIGHT)) break;
      await nextFrame(run, state);
    }
    const from = { x: state.x, y: state.y };
    await run.tap("ArrowUp");
    await run.until(() => state.pose === POSE_FALL, 2_000);
    expect(state).toMatchObject({ climbed: 1, x: from.x + JUMP_DX, y: from.y + JUMP_DY, over: false });
    await run.run(400);
    run.shot("m31-chute");
    await run.until(() => run.screen !== "minigame", 3_000);
    expect(state).toMatchObject({ over: true, won: false, timeUp: false });
    expect(run.host.time - started).toBeLessThan(TIME_LIMIT * 1000);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(loaded(run, "K63TE02")).toBe(false);
    expect(loaded(run, "M31AA.MUX")).toBe(false);
    expect(run.rt.missing).toEqual([]);
  });

  it("le tapis emporte le joueur ; s'il se retourne sous un joueur immobile, celui-ci tombe à la 7e image du demi-tour", async () => {
    const run = await launchMinigame({ module: MODULE, action: 1 }, { seed: 6 });
    const state = minigameState<FakirState>(run);
    await climbOne(run, state);
    const carpet = ownCarpet(state)!;
    // Posé, le joueur suit le tapis, ramené entre `x − 10` et `x`.
    while (carpet.mode === CARPET_FLY) {
      await nextFrame(run, state);
      if (carpet.mode === CARPET_FLY && state.x >= carpet.x - 10 && state.x <= carpet.x) {
        const before = { x: state.x, y: state.y, dir: carpet.dir };
        await nextFrame(run, state);
        if (carpet.mode === CARPET_FLY) expect({ x: state.x, y: state.y }).toEqual({ x: before.x + 2 * before.dir, y: before.y + before.dir });
      }
    }
    expect(state.pose).toBe(POSE_IDLE);
    await run.until(() => state.pose === POSE_FALL, 2_000);
    expect(carpet.mode).not.toBe(CARPET_FLY);
    expect(carpet.rank).toBe(TURN_FALL_RANK);
    await run.until(() => run.screen !== "minigame", 3_000);
    expect(state).toMatchObject({ over: true, won: false });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
  });

  it("un saut sur place au demi-tour garde le joueur sur son tapis", async () => {
    const run = await launchMinigame({ module: MODULE, action: 1 }, { seed: 6 });
    const state = minigameState<FakirState>(run);
    await climbOne(run, state);
    const carpet = ownCarpet(state)!;
    let hops = 0;
    while (hops < 3) {
      expect(run.screen).toBe("minigame");
      if (state.pose === POSE_IDLE && mustHop(state)) {
        const at = { x: state.x, y: state.y };
        await run.tap("Space");
        await run.until(() => state.pose === POSE_HOP, 500);
        if (hops === 0) {
          await run.run(300);
          run.shot("m31-saut-sur-place");
        }
        await run.until(() => state.pose !== POSE_HOP, 2_000);
        expect(state).toMatchObject({ pose: POSE_IDLE, climbed: 1, ...at });
        hops++;
      }
      await nextFrame(run, state);
    }
    expect(state.over).toBe(false);
    expect(ownCarpet(state)).toBe(carpet);
  });

  it(`sans rien faire : temps écoulé après ${TIME_LIMIT} s, Panoramix le dit, aucun sesterce`, async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 2 });
    const state = minigameState<FakirState>(run);
    const started = run.host.time;
    await playM31(run, false);
    expect(state).toMatchObject({ climbed: 0, timeUp: true, over: true, won: false });
    expect(run.host.time - started).toBeGreaterThan((TIME_LIMIT + 1) * 1000);
    expect(run.host.time - started).toBeLessThan((TIME_LIMIT + 3) * 1000);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(loaded(run, "K63TE02")).toBe(true);
    expect(loaded(run, "M31AA.MUX")).toBe(false);
    expect(run.rt.missing).toEqual([]);
  });

  it("temps écoulé sur un tapis : les commandes sont mortes, puis le joueur tombe", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 2 });
    const state = minigameState<FakirState>(run);
    const started = run.host.time;
    await climbOne(run, state);
    while (run.host.time - started < TIME_LIMIT * 1000) {
      if (state.pose === POSE_IDLE && mustHop(state)) await run.tap("Space");
      await nextFrame(run, state);
    }
    expect(state).toMatchObject({ climbed: 1, over: false });
    await run.until(() => state.pose === POSE_IDLE, 2_000);
    await run.tap("ArrowUp");
    expect(state).toMatchObject({ climbed: 1, pose: POSE_IDLE });
    await run.until(() => run.screen !== "minigame", 6_000);
    expect(state).toMatchObject({ climbed: 1, over: true, won: false });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(loaded(run, "K63TE02")).toBe(state.timeUp);
  });

  it("clic ou toucher direct (D11) : moitié haute pour monter, moitié basse ou Espace pour sauter sur place", async () => {
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<FakirState>(run);
    await run.click(160, 150);
    await run.until(() => state.pose !== POSE_IDLE, 500);
    expect(state).toMatchObject({ pose: POSE_HOP, climbed: 0 });
    // Au sol, un saut sur place retombe toujours.
    await run.until(() => state.pose === POSE_IDLE, 2_000);
    expect(state).toMatchObject({ climbed: 0, x: 0x4b, over: false });
    await run.tap("Space");
    await run.until(() => state.pose !== POSE_IDLE, 500);
    expect(state.pose).toBe(POSE_HOP);
    await run.until(() => state.pose === POSE_IDLE, 2_000);
    await run.click(160, 40);
    await run.until(() => state.pose !== POSE_IDLE, 500);
    expect(state).toMatchObject({ pose: POSE_JUMP, climbed: 1 });
  });
});
