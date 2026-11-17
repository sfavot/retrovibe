import { describe, expect, it } from "vitest";
import {
  DURATION,
  GAIN,
  LANES,
  LANE_BOTTOM,
  LANE_MIDDLE,
  LANE_TOP,
  MODULE,
  POSE_DUCKING,
  POSE_JUMPING,
  POSE_STANDING,
  SPEED_PER_LEVEL,
  type PoissonsState,
} from "../../../src/games/asterix/scenes/minigames/m22";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { dodge, jumpFrame, playM22, pressAt } from "./m22-player";

/**
 * Mini-jeu des Poissons (`docs/asterix/minigames/m22.md`) : lancé seul par sa case, joué au clavier ou au clic sur le
 * moteur de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));

/** Joue jusqu'au choc en évitant tous les poissons, sauf ceux du couloir `lane`, traités par `mistake`. */
async function untilHit(run: Launched, lane: number, mistake: (state: PoissonsState) => Promise<boolean>): Promise<PoissonsState> {
  const state = minigameState<PoissonsState>(run);
  while (!state.hit) {
    expect(run.screen).toBe("minigame");
    const acted = state.fishActive && state.lane === lane ? await mistake(state) : await dodge(run, state);
    if (!acted) await run.frame();
  }
  return state;
}

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu des Poissons (M22)", () => {
  it("la case 2 lance le mini-jeu inscrit, après son annonce", async () => {
    const run = await launchMinigame({ module: MODULE });
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(1);
    expect(loaded(run, "K60TE01")).toBe(true);
    expect(loaded(run, "M22DA000.MCC")).toBe(true);
    expect(minigameState<PoissonsState>(run)).toMatchObject({ fishActive: false, pose: POSE_STANDING, hit: false });
  });

  for (const action of [0, 1, 2]) {
    it(`niveau Action ${action} : victoire après ${DURATION} s, ${GAIN} sesterce, vitesses du niveau`, async () => {
      const run = await launchMinigame({ module: MODULE, action }, { seed: 100 + action });
      const state = minigameState<PoissonsState>(run);
      const started = run.host.time;
      const speeds = new Map<number, number>();
      const lanes: number[] = [];
      let flying = false;
      while (run.screen === "minigame") {
        if (state.fishActive && !flying) {
          lanes.push(state.lane);
          speeds.set(state.lane, state.speed);
          // Aucun poisson ne part après la fin du temps.
          expect(run.host.time - started).toBeLessThan((DURATION + 1) * 1000);
        }
        flying = state.fishActive;
        if (!(await dodge(run, state))) await run.frame();
      }
      expect(state).toMatchObject({ won: true, lost: false, hit: false });
      expect(run.host.time - started).toBeGreaterThanOrEqual(DURATION * 1000);
      // Les trois couloirs sont sortis, jamais deux fois de suite le même, et le premier n'est jamais celui du bas.
      expect(new Set(lanes).size).toBe(3);
      expect(lanes.every((lane, i) => i === 0 || lane !== lanes[i - 1])).toBe(true);
      expect(lanes[0]).not.toBe(LANE_BOTTOM);
      for (const lane of LANES) expect(speeds.get(lane.y)).toBe(lane.speed + SPEED_PER_LEVEL * action);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(GAIN);
      expect(loaded(run, "M22DA001.MCC")).toBe(true);
      expect(loaded(run, "M22AA.MUX")).toBe(true);
      expect(loaded(run, "K22TE01")).toBe(false);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("défaite : sans rien faire, le premier poisson du milieu ou du bas touche ; aucun sesterce, la voix du perdant", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 7 });
    const state = minigameState<PoissonsState>(run);
    const started = run.host.time;
    await playM22(run, false);
    expect(state).toMatchObject({ won: false, lost: true, hit: true, dazed: true });
    expect([LANE_MIDDLE, LANE_BOTTOM]).toContain(state.lane);
    expect(run.host.time - started).toBeLessThan(DURATION * 1000);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(loaded(run, "K22TE01")).toBe(true);
    expect(loaded(run, "M22AA.MUX")).toBe(false);
    expect(run.rt.missing).toEqual([]);
  });

  it("le sesterce gagné s'ajoute à ceux du joueur", async () => {
    const run = await launchMinigame({ module: MODULE, action: 2 }, { seed: 3 });
    minigamePlayer(run).sesterces = 5;
    await playM22(run, true);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(5 + GAIN);
  });

  // Les cinq chocs de `2580:0135` : couloir, faute du joueur, animation de `m22sa001.hy8` (la posture après le choc).
  const jump = (run: Launched) => (state: PoissonsState) => pressAt(run, state, "ArrowUp", jumpFrame(state));
  const duck = (run: Launched) => (state: PoissonsState) => pressAt(run, state, "ArrowDown", 1);
  const still = () => () => Promise.resolve(false);
  const HITS = [
    { name: "debout, poisson du milieu", lane: LANE_MIDDLE, mistake: still, pose: 0 },
    { name: "debout, poisson du bas", lane: LANE_BOTTOM, mistake: still, pose: 1 },
    { name: "baissé, poisson du bas", lane: LANE_BOTTOM, mistake: duck, pose: 2 },
    { name: "en saut, poisson du haut", lane: LANE_TOP, mistake: jump, pose: 3 },
    { name: "en saut, poisson du milieu", lane: LANE_MIDDLE, mistake: jump, pose: 4 },
  ];
  HITS.forEach(({ name, lane, mistake, pose }, index) => {
    it(`choc ${name} : animation ${pose}, puis les étoiles et la défaite`, async () => {
      const run = await launchMinigame({ module: MODULE, action: index % 3 }, { seed: 40 + index });
      const state = await untilHit(run, lane, mistake(run));
      expect(state).toMatchObject({ hit: true, lane, pose, fishActive: false, dazed: false });
      await run.until(() => state.dazed, 3_000);
      expect(state.pose).toBe(4);
      // Les commandes sont mortes après le choc.
      await run.tap("ArrowUp");
      expect(state.pose).toBe(4);
      await run.until(() => run.screen !== "minigame", 5_000);
      expect(state.lost).toBe(true);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(0);
    });
  });

  it("un poisson du haut passe au-dessus d'un joueur debout ou baissé", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 12 });
    const state = minigameState<PoissonsState>(run);
    const passed = { standing: 0, ducking: 0 };
    let flying = false;
    let ducked = false;
    while ((passed.standing === 0 || passed.ducking === 0) && run.screen === "minigame") {
      if (flying && !state.fishActive && state.lane === LANE_TOP) passed[ducked ? "ducking" : "standing"]++;
      if (!flying && state.fishActive) ducked = false;
      flying = state.fishActive;
      let acted: boolean;
      // Une fois un poisson du haut passé debout, les suivants sont attendus baissé.
      if (state.lane === LANE_TOP && passed.standing > 0) {
        acted = !ducked && (await pressAt(run, state, "ArrowDown", 6));
        ducked ||= acted;
      } else acted = await dodge(run, state);
      if (!acted) await run.frame();
    }
    expect(passed.standing).toBeGreaterThan(0);
    expect(passed.ducking).toBeGreaterThan(0);
    expect(state.hit).toBe(false);
  });

  it("clic ou toucher direct (D11) : moitié haute pour sauter, moitié basse pour se baisser", async () => {
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<PoissonsState>(run);
    await run.click(60, 30);
    await run.until(() => state.pose !== POSE_STANDING, 500);
    expect(state.pose).toBe(POSE_JUMPING);
    await run.until(() => state.pose === POSE_STANDING, 2_000);
    await run.click(300, 190);
    await run.until(() => state.pose !== POSE_STANDING, 500);
    expect(state.pose).toBe(POSE_DUCKING);
    // Espace, sans position, ne commande rien.
    await run.until(() => state.pose === POSE_STANDING, 2_000);
    await run.tap("Space");
    await run.run(300);
    expect(state.pose).toBe(POSE_STANDING);
  });
});
