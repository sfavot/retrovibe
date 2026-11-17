import { describe, expect, it } from "vitest";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import {
  EVENT_HIGH,
  EVENT_LOW,
  EVENT_NONE,
  FRAME_TICKS,
  GAIN,
  LAST_FRAME,
  MODULE,
  POSE_DUCK,
  POSE_JUMP,
  POSE_RUN,
  TYPE_DECOR,
  TYPE_FREE,
  TYPE_HIGH,
  TYPE_LOW,
  WARMUP_FRAMES,
  script,
  type IdefixState,
} from "../../../src/games/asterix/scenes/minigames/m34";
import type { Launched } from "../game-helpers";
import { exeTables, hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { clear, nextObstacle, playM34 } from "./m34-player";

/**
 * Mini-jeu d'Idéfix (`docs/asterix/minigames/m34.md`) : lancé seul par sa case, joué au clavier ou au clic sur le moteur
 * de test. Réinscrit ici pour que `menu` puisse lancer la version du menu principal (argument 0).
 */
let menu = false;
registerMinigame(MODULE, (play, entry) => script(play, menu ? { ...entry, argument: 0 } : entry));

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));
const obstacles = (state: IdefixState) => state.objects.slice(0, 2);

/** Joue en franchissant tout, et relève le type de chaque obstacle à son apparition. */
async function playAndCount(run: Launched, shots = ""): Promise<number[]> {
  const state = minigameState<IdefixState>(run);
  const seen: number[] = [];
  const ages = [0, 0];
  let shot = 0;
  while (run.screen === "minigame") {
    obstacles(state).forEach((object, i) => {
      if (object.type !== TYPE_FREE && object.age < ages[i]) seen.push(object.type);
      ages[i] = object.type === TYPE_FREE ? Infinity : object.age;
    });
    if (shots && state.event !== EVENT_NONE && shot < 4) run.shot(`${shots}-${shot++}`);
    if (!(await clear(run, state))) await run.frame();
  }
  return seen;
}

/** Avance jusqu'à ce que le prochain obstacle soit du type voulu et ait cet âge ; les autres sont franchis. */
async function untilObstacle(run: Launched, type: number, age: number): Promise<IdefixState> {
  const state = minigameState<IdefixState>(run);
  for (;;) {
    expect(run.screen).toBe("minigame");
    const object = nextObstacle(state);
    if (object?.type === type) {
      if (object.age >= age) return state;
      await run.frame();
    } else if (!(await clear(run, state))) await run.frame();
  }
}

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu d'Idéfix (M34)", () => {
  const tables = exeTables().idefix;

  it("tables de l'exécutable : sept parcours, de plus en plus chargés", () => {
    expect(tables.courses.map((course) => course.size)).toEqual([7, 11, 11, 13, 13, 14, 14]);
    expect([...tables.courses[0]]).toEqual([[42, 1], [75, 2], [115, 1], [150, 2], [187, 1], [222, 2], [259, 1]]);
    expect(tables.decorSpans).toEqual([80, 56, 70, 66, 68]);
    expect(tables.decorDelays).toEqual([6, 9, 7, 7, 7]);
    // Tous les obstacles arrivent avant la fin de la course.
    for (const course of tables.courses) expect(Math.max(...course.keys()) * 2 + 25).toBeLessThan(LAST_FRAME);
  });

  it("la case 47 lance le mini-jeu inscrit, après son annonce", async () => {
    menu = false;
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<IdefixState>(run);
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(46);
    expect(loaded(run, "K60TE3")).toBe(true);
    expect(loaded(run, "M34DA000.MCC")).toBe(true);
    expect(state).toMatchObject({ inGame: true, hit: false, event: EVENT_NONE });
    expect(state.frame - WARMUP_FRAMES).toBeLessThanOrEqual(1);
    // Le décor est déjà en place, aucun obstacle n'est encore parti.
    expect(state.objects.filter((object) => object.type === TYPE_DECOR).length).toBeGreaterThan(3);
    expect(obstacles(state).every((object) => object.type === TYPE_FREE)).toBe(true);
    await run.run(1_000);
    run.shot("m34-run");
  });

  for (const action of [0, 1, 2]) {
    it(`niveau Action ${action} : parcours ${2 * action + 1} ou ${2 * action + 2}, victoire, ${GAIN} sesterce`, async () => {
      menu = false;
      const run = await launchMinigame({ module: MODULE, action }, { seed: 300 + action });
      const state = minigameState<IdefixState>(run);
      expect([2 * action + 1, 2 * action + 2]).toContain(state.course);
      const started = run.host.time;
      const seen = await playAndCount(run, `m34-a${action}`);
      expect(state).toMatchObject({ won: true, hit: false, lost: false });
      expect(seen).toEqual([...tables.courses[state.course].values()]);
      // 20 images par seconde : la course dure 28 secondes.
      const seconds = (run.host.time - started) / 1000;
      expect(seconds).toBeGreaterThan(((LAST_FRAME - WARMUP_FRAMES) * FRAME_TICKS) / 60 - 0.5);
      expect(seconds).toBeLessThan(((LAST_FRAME - WARMUP_FRAMES + 30) * FRAME_TICKS) / 60);
      await run.run(2_000);
      run.shot(`m34-a${action}-end`);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(GAIN);
      expect(loaded(run, "M34AG.MUK")).toBe(true);
      expect(loaded(run, "M34AG1")).toBe(true);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("défaite : sans rien faire, le premier obstacle touche Idéfix ; aucun sesterce", async () => {
    menu = false;
    const run = await launchMinigame({ module: MODULE }, { seed: 7 });
    const state = minigameState<IdefixState>(run);
    minigamePlayer(run).sesterces = 4;
    const first = [...tables.courses[state.course]][0];
    await playM34(run, false);
    expect(state).toMatchObject({ hit: true, won: false, pose: first[1] === TYPE_LOW ? 0 : 1 });
    // L'obstacle part à l'image 2 × moment et touche 22 images plus tard.
    expect(state.frame).toBe(first[0] * 2 + 22);
    run.shot("m34-hit");
    await run.until(() => state.lost, 5_000);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(4);
    expect(run.rt.missing).toEqual([]);
  });

  it("mauvais geste : se baisser devant un obstacle du sol, sauter sous un obstacle du plafond", async () => {
    menu = false;
    const low = await launchMinigame({ module: MODULE, action: 1 }, { seed: 21 });
    let state = await untilObstacle(low, TYPE_LOW, 9);
    await low.tap("ArrowDown");
    expect(state.pose).toBe(POSE_DUCK);
    await low.until(() => state.hit, 2_000);
    expect(state.pose).toBe(0);

    const high = await launchMinigame({ module: MODULE, action: 1 }, { seed: 22 });
    state = await untilObstacle(high, TYPE_HIGH, 9);
    await high.tap("ArrowUp");
    expect(state.pose).toBe(POSE_JUMP);
    await high.until(() => state.hit, 2_000);
    expect(state.pose).toBe(1);
  });

  it("un saut parti trop tôt ou trop tard ne franchit pas l'obstacle", async () => {
    menu = false;
    for (const [seed, age] of [[31, 2], [32, 19]] as const) {
      const run = await launchMinigame({ module: MODULE }, { seed });
      const state = await untilObstacle(run, TYPE_LOW, age);
      await run.tap("ArrowUp");
      await run.until(() => state.hit || state.event === EVENT_NONE && (nextObstacle(state)?.type ?? TYPE_HIGH) !== TYPE_LOW, 3_000);
      await run.run(500);
      expect(state.hit).toBe(true);
    }
  });

  it("le jugement d'un obstacle dure quatre images", async () => {
    menu = false;
    const run = await launchMinigame({ module: MODULE }, { seed: 41 });
    const state = minigameState<IdefixState>(run);
    while (state.event === EVENT_NONE) if (!(await clear(run, state))) await run.frame();
    const kind = state.event;
    expect([EVENT_LOW, EVENT_HIGH]).toContain(kind);
    const from = state.frame;
    await run.until(() => state.event === EVENT_NONE, 1_000);
    expect(state.hit).toBe(false);
    expect(state.frame - from).toBe(3);
  });

  it("clic ou toucher direct (D11) : moitié haute pour sauter, moitié basse pour se baisser", async () => {
    menu = true;
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<IdefixState>(run);
    // Espace, sans position, ne commande rien.
    await run.tap("Space");
    await run.run(200);
    expect(state.pose).toBe(POSE_RUN);
    await run.click(160, 30);
    await run.until(() => state.pose !== POSE_RUN, 500);
    expect(state.pose).toBe(POSE_JUMP);
    await run.until(() => state.pose === POSE_RUN, 2_000);
    await run.click(160, 180);
    await run.until(() => state.pose !== POSE_RUN, 500);
    expect(state.pose).toBe(POSE_DUCK);
    expect(state.hit).toBe(false);
  });

  it("jeu du menu (argument 0) : parcours 0, sept obstacles, aucun sesterce même gagné", async () => {
    menu = true;
    const run = await launchMinigame({ module: MODULE, action: 2 }, { seed: 50 });
    const state = minigameState<IdefixState>(run);
    expect(state).toMatchObject({ inGame: false, course: 0 });
    const seen = await playAndCount(run);
    expect(seen).toEqual([1, 2, 1, 2, 1, 2, 1]);
    expect(state.won).toBe(true);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(loaded(run, "M34AG.MUK")).toBe(true);
    expect(run.rt.missing).toEqual([]);
  });

  it("jeu du menu sans entrée (démonstration) : Idéfix bute sur le premier obstacle et le jeu rend la main", async () => {
    menu = true;
    const run = await launchMinigame({ module: MODULE }, { seed: 51 });
    const state = minigameState<IdefixState>(run);
    await playM34(run, false);
    expect(state).toMatchObject({ hit: true, frame: 42 * 2 + 22 });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
  });
});
