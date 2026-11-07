/**
 * Robot de partie : joue les vrais écrans de Zoombinis par la souris de l'hôte de test (choix du groupe, camps, 12 épreuves). Partagé par
 * `full-game.test.ts` (graine 11) et `full-game-seeds.test.ts` (plusieurs graines).
 */
import { expect } from "vitest";
import { createZoombinisEngine, type ZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { ScreenId, type Scene, type SceneFactory } from "../../src/games/zoombinis/engine/scene";
import { installServices, type ZoombinisServices } from "../../src/games/zoombinis/engine/services";
import { acceptingBridge, BRIDGE_ANCHORS, type Bridge } from "../../src/games/zoombinis/game/puzzles/bridge";
import { SLOT_ANCHORS, robot as cavesRobot } from "../../src/games/zoombinis/game/puzzles/caves";
import { robot as ferryRobot } from "../../src/games/zoombinis/game/puzzles/ferry";
import { fleensView, isSolved as fleensSolved, robotChoice } from "../../src/games/zoombinis/game/puzzles/fleens";
import { robotPlan as hotelPlan } from "../../src/games/zoombinis/game/puzzles/hotel";
import { planLilly } from "../../src/games/zoombinis/game/puzzles/lilly";
import { MAZE2_RAMPS, planMaze2 } from "../../src/games/zoombinis/game/puzzles/maze2";
import { netRobot } from "../../src/games/zoombinis/game/puzzles/net";
import { pizzaRobot, ingredientsOf } from "../../src/games/zoombinis/game/puzzles/pizza";
import { createPlay, robot as slidesRobot, slotPosition } from "../../src/games/zoombinis/game/puzzles/slides";
import { isFinished as smokeFinished, robotPlan as smokePlan } from "../../src/games/zoombinis/game/puzzles/smoke";
import { correctEntrances, type Entrance } from "../../src/games/zoombinis/game/puzzles/tunnels";
import { registerScenes } from "../../src/games/zoombinis/scenes";
import type { BridgeScene } from "../../src/games/zoombinis/scenes/puzzles/bridge";
import type { CavesScene } from "../../src/games/zoombinis/scenes/puzzles/caves";
import { createFerryScene, type FerryProbe } from "../../src/games/zoombinis/scenes/puzzles/ferry";
import type { FleensScene } from "../../src/games/zoombinis/scenes/puzzles/fleens";
import type { HotelScene } from "../../src/games/zoombinis/scenes/puzzles/hotel";
import { createLillyScene, type LillyProbe } from "../../src/games/zoombinis/scenes/puzzles/lilly";
import type { Maze2Scene } from "../../src/games/zoombinis/scenes/puzzles/maze2";
import { NET_FIRE_REGION, NET_SYMBOL_REGIONS, netProbeOf } from "../../src/games/zoombinis/scenes/puzzles/net";
import { PIZZA_INGREDIENT_REGIONS, PIZZA_SERVE_REGIONS, pizzaStateOf } from "../../src/games/zoombinis/scenes/puzzles/pizza";
import type { SlidesScene } from "../../src/games/zoombinis/scenes/puzzles/slides";
import { SMOKE_WAGON, type SmokeScene } from "../../src/games/zoombinis/scenes/puzzles/smoke";
import { resetTunnelsVisits, type TunnelsScene } from "../../src/games/zoombinis/scenes/puzzles/tunnels";
import { BUTTON_GO, type PuzzleKit } from "../../src/games/zoombinis/scenes/puzzle-kit";
import { runFor, TestHost } from "./engine-test-host";

export const S = ScreenId;
export const TICK_MS = 17;

export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

export const nameOf = (id: number): string => Object.entries(S).find(([, v]) => v === id)?.[0] ?? String(id);

/** Les 16 types du groupe choisi : tous différents, pieds identiques (le bac peut alors asseoir tout le monde). */
export const groupAttrs = (i: number): [number, number, number, number] => [1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1];

// ---------------------------------------------------------------------------------------------------------------------------
// Partie

export interface Rig {
  host: TestHost;
  engine: ZoombinisEngine;
  services: ZoombinisServices;
  zb: ZoombinisServices["game"];
  scenes: Map<number, Scene>;
  probes: Map<number, unknown>;
  /** Écrans créés, dans l'ordre. */
  visited: number[];
  /** Survivants du groupe à l'entrée de chaque épreuve, camp et ville atteints. */
  arrivals: [number, number][];
}

/** Moteur sur les vrais écrans (`registerScenes`), chaque fabrique gardant la scène créée ; transitions coupées, tous debout. */
export async function boot(host = new TestHost(), seed = 11): Promise<Rig> {
  host.present = () => undefined;
  const engine = createZoombinisEngine(host, { seed });
  const services = await installServices(engine);
  const scenes = new Map<number, Scene>();
  const probes = new Map<number, unknown>();
  const visited: number[] = [];
  const registry = new Map<number, SceneFactory>();
  registerScenes({ register: (id: number, factory: SceneFactory) => void registry.set(id, factory) } as unknown as ZoombinisEngine);
  registry.set(S.ferry, () => createFerryScene((p) => probes.set(S.ferry, p)));
  registry.set(S.lilly, () => createLillyScene((p) => probes.set(S.lilly, p)));
  for (const [id, factory] of registry) {
    engine.register(id as ScreenId, () => {
      const scene = factory();
      scenes.set(id, scene);
      visited.push(id);
      return scene;
    });
  }
  const zb = services.game;
  zb.game.options.transitionsOff = true;
  zb.game.options.lessAction = true;
  zb.game.options.magneticMouse = false;
  resetTunnelsVisits();
  return { host, engine, services, zb, scenes, probes, visited, arrivals: [] };
}

export const tick = (r: Rig, n: number) => runFor(r.engine, r.host, n * TICK_MS);

/** Avance jusqu'à `done` ; au-delà de `limit` ticks, échoue en décrivant l'écran courant. */
export async function until(r: Rig, label: string, done: () => boolean, limit = 3000): Promise<void> {
  const start = r.engine.ctx.clock.ticks;
  for (let waited = 0; waited < limit; waited += 5) {
    expect(r.engine.error, `erreur moteur (${label})`).toBeNull();
    if (done()) return;
    await tick(r, 5);
  }
  if (done()) return;
  throw new Error(`blocage : ${label} (écran ${nameOf(r.engine.scenes.currentId as number)}, ${r.engine.ctx.clock.ticks - start} ticks)`);
}

export const screenIs = (r: Rig, id: number) => (r.engine.scenes.currentId as number) === id;
export const center = (rect: Rect): Point => ({ x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) });
export const clickRect = (r: Rig, rect: Rect) => {
  const c = center(rect);
  r.host.click(c.x, c.y);
};

/** Effectif du groupe qui vient d'arriver : debout dans le camp (compteur du camp), habitants (ville) ou membres présents (épreuve). */
export function present(r: Rig, id: number): number {
  const { counters, group } = r.zb.game;
  if (id === S.baseCamp) return counters.camp1;
  if (id === S.bcTwo) return counters.camp2;
  if (id === S.town) return counters.town;
  return group.members.filter((z) => z.present).length;
}

/** Attend l'écran `id` et que sa scène soit chargée. */
export async function reach(r: Rig, id: number): Promise<void> {
  // Avec les fondus d'écran, l'écran est gelé pendant son fondu d'entrée (clics perdus) : on attend sa fin.
  await until(r, `arriver à l'écran ${nameOf(id)}`, () => screenIs(r, id) && !r.services.fades.blocking, 6000);
  await tick(r, 20);
  if (r.arrivals[r.arrivals.length - 1]?.[0] !== id) r.arrivals.push([id, present(r, id)]);
}

/** Point où le membre est bien le Zoombini le plus en avant. */
function grabPoint(kit: PuzzleKit, index: number): Point | null {
  const member = kit.members[index]!;
  const rect = member.snoid.feature.rect!;
  for (let y = Math.floor((rect.top + rect.bottom) / 2); y < rect.bottom; y += 2)
    for (let x = Math.floor((rect.left + rect.right) / 2); x < rect.right; x += 2) if (kit.memberAt(x, y) === member) return { x, y };
  return null;
}

/** Glisse un membre (appui, déplacement, relâchement) pour que ses pieds arrivent en `feet`. */
export async function dragMember(r: Rig, kit: PuzzleKit, index: number, feet: Point): Promise<void> {
  const member = kit.members[index]!;
  const point = grabPoint(kit, index);
  if (!point) throw new Error(`blocage : membre ${index} non saisissable (écran ${nameOf(r.engine.scenes.currentId as number)})`);
  const at = { x: point.x - member.snoid.position.x, y: point.y - member.snoid.position.y };
  r.host.input.moveMouse(point.x, point.y);
  r.host.input.mouseDown("left");
  await tick(r, 4);
  r.host.input.moveMouse(feet.x + at.x, feet.y + at.y);
  await tick(r, 8);
  r.host.input.mouseUp("left");
  await tick(r, 6);
}

/** Glisse un objet d'un point à un autre. */
async function dragPoint(r: Rig, from: Point, to: Point): Promise<void> {
  r.host.input.moveMouse(from.x, from.y);
  r.host.input.mouseDown("left");
  await tick(r, 4);
  r.host.input.moveMouse(to.x, to.y);
  await tick(r, 8);
  r.host.input.mouseUp("left");
  await tick(r, 6);
}

/** Membres debout, les plus en avant d'abord (les mieux saisissables). */
const byFront = (kit: PuzzleKit, indexes: number[]): number[] =>
  [...indexes].sort((a, b) => kit.members[b]!.snoid.position.y - kit.members[a]!.snoid.position.y);

/** Clique « go » puis attend la sortie de l'écran. */
async function leave(r: Rig, from: number): Promise<void> {
  const rect = { left: BUTTON_GO.left + 5, top: BUTTON_GO.top + 5, right: BUTTON_GO.left + 6, bottom: BUTTON_GO.top + 6 };
  for (let attempt = 0; attempt < 4 && screenIs(r, from); attempt++) {
    clickRect(r, rect);
    await until(r, `quitter ${nameOf(from)} par « go »`, () => !screenIs(r, from), 1500).catch((error) => {
      if (attempt === 3) throw error;
    });
  }
  expect(screenIs(r, from), `« go » de ${nameOf(from)} sans effet`).toBe(false);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Robots par épreuve. `lose` = nombre de Zoombinis laissés sans jouer.

type Driver = (r: Rig, lose: number) => Promise<void>;

const playBridge: Driver = async (r, lose) => {
  const scene = r.scenes.get(S.bridge) as BridgeScene;
  await until(r, "gorges : sonde", () => (scene.probe?.kit.members.length ?? 0) > 0);
  const p = scene.probe!;
  const played: number[] = [];
  const count = p.kit.members.length - lose;
  for (let n = 0; n < count; n++) {
    const index = byFront(p.kit, p.kit.members.map((m) => m.index).filter((i) => p.statuses[i] === "wait" && !played.includes(i)))[0]!;
    const bridge = acceptingBridge(p.state.rule, p.state.attrs[index]!) as Bridge;
    await dragMember(r, p.kit, index, BRIDGE_ANCHORS[bridge as 1 | 2]);
    played.push(index);
    await until(r, "gorges : file vide", () => p.queue.length === 0, 400);
  }
  await until(r, "gorges : tous traversés", () => played.every((i) => p.statuses[i] === "crossed"), 4000);
  await until(r, "gorges : tous arrivés", () => p.kit.members.every((m) => m.snoid.resting), 600);
  expect(p.state.errors).toBe(0);
  await until(r, "gorges : « go » actif", () => p.kit.goEnabled, 600);
  await leave(r, S.bridge);
};

export const playTunnels: Driver = async (r, lose) => {
  const scene = r.scenes.get(S.tunnels) as TunnelsScene;
  await until(r, "grottes de passe-clos : sonde", () => scene.debug.kit !== null && scene.debug.rules !== null);
  const kit = scene.debug.kit!;
  const count = kit.members.length - lose;
  for (let i = 0; i < count; i++) {
    const entrance = correctEntrances(scene.debug.rules!, kit.members[i]!.zoombini.attrs)[0] as Entrance;
    await dragMember(r, kit, i, scene.debug.entranceAnchor(entrance));
    await until(r, `grottes : le membre ${i} arrive`, () => scene.debug.statusOf(i) === "arrived", 3000);
    await until(r, "grottes : file vide", () => !scene.debug.busy && scene.debug.queueLength === 0 && !kit.members[i]!.snoid.walking, 3000);
  }
  expect(scene.debug.state!.saved).toBe(count);
  await until(r, "grottes : « go » actif", () => kit.goEnabled, 600);
  await leave(r, S.tunnels);
};

const playPizza: Driver = async (r) => {
  const scene = r.scenes.get(S.pizza)!;
  await until(r, "hutte à pizza : état", () => pizzaStateOf(scene) !== null);
  const state = pizzaStateOf(scene)!;
  const level = state.level;
  await tick(r, 2500);
  for (const meal of pizzaRobot(state)) {
    for (const k of ingredientsOf(meal)) {
      clickRect(r, PIZZA_INGREDIENT_REGIONS[level]![k]!);
      await tick(r, 12);
    }
    clickRect(r, PIZZA_SERVE_REGIONS[1]!);
    await tick(r, 1700);
  }
  await tick(r, 600);
  await leave(r, S.pizza);
};

const playFerry: Driver = async (r, lose) => {
  await until(r, "bac : sonde", () => ((r.probes.get(S.ferry) as FerryProbe | undefined)?.kit.members.length ?? 0) > 0);
  const p = r.probes.get(S.ferry) as FerryProbe;
  const result = ferryRobot(
    p.raft,
    p.kit.members.map((m) => m.zoombini.attrs),
  );
  const moves = result.moves.slice(0, Math.max(0, result.moves.length - lose));
  for (const move of moves) {
    await dragMember(r, p.kit, move.member, p.raft.seats[move.seat]!.anchor);
    await until(r, "bac : pose finie", () => !p.busy, 2500);
    expect(p.play.seatOf[move.member], `bac : le membre ${move.member} reste assis`).toBe(move.seat);
  }
  await until(r, "bac : « go » actif", () => p.kit.goEnabled, 600);
  await leave(r, S.ferry);
};

const playLilly: Driver = async (r, lose) => {
  await until(r, "têtards : sonde", () => ((r.probes.get(S.lilly) as LillyProbe | undefined)?.party.length ?? 0) > 0);
  const p = r.probes.get(S.lilly) as LillyProbe;
  await until(r, "têtards : introduction", () => p.lock === 0, 1500);
  const total = p.party.length - lose;
  for (let n = 0; n < total; n++) {
    const move = planLilly(p.state).find((m) => m.kind === "drop");
    if (!move || move.kind !== "drop") throw new Error("blocage : têtards, le robot ne propose plus de dépôt");
    const view = p.toads[move.toad]!;
    await tick(r, 6);
    const rect = view.feature.rect!;
    const grab = center(rect);
    r.host.input.moveMouse(grab.x, grab.y);
    r.host.input.mouseDown("left");
    await tick(r, 3);
    const to = p.origin(0, move.row);
    r.host.input.moveMouse(to.x, to.y);
    await tick(r, 6);
    r.host.input.mouseUp("left");
    await tick(r, 4);
    const before = p.state.arrivals;
    await until(r, `têtards : dépôt ${n} accepté`, () => p.state.launched === n + 1, 200);
    await until(r, `têtards : le crapaud ${move.toad} arrive et se repose`, () => p.state.arrivals > before && ((view.phase === "rest" && view.feature.scriptId === 10043 + move.toad) || view.toad.retired), 6000);
  }
  await until(r, "têtards : « suite » actif", () => p.kit.goEnabled, 600);
  expect(p.state.arrivals).toBe(total);
  await leave(r, S.lilly);
};

const playSlides: Driver = async (r, lose) => {
  const scene = r.scenes.get(S.slides) as SlidesScene;
  await until(r, "monte-pierre : sonde", () => (scene.probe?.kit.members.length ?? 0) > 0);
  const p = scene.probe!;
  const plan = slidesRobot(createPlay(p.board, p.play.members));
  if (!plan) throw new Error("blocage : monte-pierre, le robot ne relie pas le groupe sur ce plateau");
  for (const { member, slot } of plan.slice(0, Math.max(0, plan.length - lose))) {
    await dragMember(r, p.kit, member, slotPosition(p.board.slots[slot]!));
    await tick(r, 12);
  }
  if (lose === 0) {
    await until(r, "monte-pierre : victoire", () => p.ev.victory, 300);
    await until(r, "monte-pierre : danse", () => p.celebrating, 300).catch(() => undefined);
    if (p.celebrating) {
      r.host.click(300, 450);
      await tick(r, 3);
    }
  }
  await until(r, "monte-pierre : « go » actif", () => p.kit.goEnabled, 600);
  await leave(r, S.slides);
};

const playFleens: Driver = async (r) => {
  const scene = r.scenes.get(S.fleens) as FleensScene;
  await until(r, "nizibooms : sonde", () => (scene.probe?.kit.members.length ?? 0) > 0);
  const p = scene.probe!;
  for (let guard = 0; guard < 20 && !fleensSolved(p.state); guard++) {
    const choice = robotChoice(fleensView(p.state, p.kit.members.map((m) => ({ ...m.zoombini, present: true }))));
    if (choice === null) {
      const v = fleensView(p.state, p.kit.members.map((m) => ({ ...m.zoombini, present: true })));
      throw new Error(`blocage : nizibooms, le robot ne propose plus d'essai (essai ${guard}, cocons ${p.state.cocoons}, niveau ${v.level}, essayés ${JSON.stringify(v.tried)}, branche ${v.branch.length}, terrasse ${v.terrace.length}, membres ${v.members.length})`);
    }
    await until(r, "nizibooms : repère libre", () => p.dropTarget.owner === null && !p.introPlaying, 900);
    await dragMember(r, p.kit, choice, { x: 438, y: 357 });
    await until(r, "nizibooms : essai fini", () => p.trial === null && p.pending === 0, 1500);
  }
  expect(fleensSolved(p.state)).toBe(true);
  await until(r, "nizibooms : clôture", () => p.state.closed, 900);
  await until(r, "nizibooms : « go » actif", () => p.kit.goEnabled, 600);
  await leave(r, S.fleens);
};

const playHotel: Driver = async (r, lose) => {
  const scene = r.scenes.get(S.hotel) as HotelScene;
  await until(r, "hôtel : sonde", () => (scene.probe?.kit?.members.length ?? 0) > 0);
  const p = scene.probe!;
  for (let i = 0; i < 6 && p.phase !== "play"; i++) {
    r.host.click(300, 200);
    await tick(r, 5);
  }
  expect(p.phase).toBe("play");
  await tick(r, 2);
  const plan = hotelPlan(p.state);
  const count = plan.length - lose;
  for (let member = 0; member < count; member++) {
    await dragMember(r, p.kit!, member, p.point(plan[member]!));
    await until(r, "hôtel : pose finie", () => !p.busy, 3000);
  }
  expect(p.state.accepted).toBe(count);
  await until(r, "hôtel : « go » actif", () => p.kit!.goEnabled, 600);
  await leave(r, S.hotel);
};

const playNet: Driver = async (r) => {
  const scene = r.scenes.get(S.net)!;
  await until(r, "muraille : sonde", () => netProbeOf(scene) !== null);
  const p = () => netProbeOf(scene)!;
  const level = p().state.level;
  await until(r, "muraille : tir permis", () => p().canFire, 4000);
  const shots = netRobot(structuredClone(p().state)).shots;
  for (const shot of shots) {
    await until(r, "muraille : tir permis", () => p().canFire, 5000);
    for (let row = 0; row < 3; row++) {
      if (row === 0 && level < 2) continue;
      clickRect(r, NET_SYMBOL_REGIONS[row]![shot.selectors[row]!]!);
      await tick(r, 6);
    }
    clickRect(r, NET_FIRE_REGION);
    await tick(r, 33);
  }
  await until(r, "muraille : tous passés", () => p().state.freed === p().kit.members.length && p().statuses.every((status) => status === "crossed"), 4000);
  await until(r, "muraille : « go » actif", () => p().kit.goEnabled, 600);
  await leave(r, S.net);
};

const playCaves: Driver = async (r, lose) => {
  const scene = r.scenes.get(S.caves) as CavesScene;
  await until(r, "tanière du sphinx : sonde", () => (scene.probe?.kit.members.length ?? 0) > 0);
  const p = scene.probe!;
  const slots = cavesRobot(p.state);
  const order = byFront(p.kit, p.kit.members.map((m) => m.index).filter((i) => p.state.slotOf[i] === 0));
  const count = order.length - lose;
  for (const index of order.slice(0, count)) {
    await dragMember(r, p.kit, index, SLOT_ANCHORS[slots[index]! - 1]!);
    await tick(r, 40);
  }
  if (lose === 0) {
    expect(p.state.lion).toBe(0);
    await until(r, "tanière du sphinx : victoire", () => p.hasWon, 800);
  }
  await until(r, "tanière du sphinx : « go » actif", () => p.kit.goEnabled, 800);
  await leave(r, S.caves);
};

const playSmoke: Driver = async (r) => {
  const scene = r.scenes.get(S.smoke) as SmokeScene;
  await until(r, "piège de cristal : sonde", () => (scene.probe?.kit.members.length ?? 0) > 0);
  const p = scene.probe!;
  const size = p.state.members.length;
  for (let guard = 0; guard < 2 * size + 2 && !smokeFinished(p.state); guard++) {
    await until(r, "piège de cristal : prêt", () => !p.locked && (p.level <= 2 || p.ready), 2000);
    if (smokeFinished(p.state)) break;
    if (p.state.awaitingRound) {
      r.host.click(p.leverPoint.x, p.leverPoint.y);
      await tick(r, 2);
      await until(r, "piège de cristal : manche", () => !p.locked, 800);
    }
    const plan = smokePlan(p.state)!;
    if (!plan) throw new Error("blocage : piège de cristal, pas de plan du robot");
    if (p.level <= 2) {
      await dragMember(r, p.kit, plan.member!, SMOKE_WAGON);
      await dragPoint(r, p.silhouetteAt(plan.silhouette!)!, p.crystalPoint);
    } else {
      for (const c of plan.left!) await dragPoint(r, p.crystalAt(c)!, p.casePoint("left", p.state.left.length));
      for (const c of plan.right!) await dragPoint(r, p.crystalAt(c)!, p.casePoint("right", p.state.right.length));
    }
    const before = p.state.tested;
    r.host.click(p.leverPoint.x, p.leverPoint.y);
    await tick(r, 2);
    await until(r, "piège de cristal : test fait", () => p.state.tested > before, 2000);
  }
  await until(r, "piège de cristal : fin", () => !p.locked && smokeFinished(p.state), 2000);
  await until(r, "piège de cristal : « go » actif", () => p.kit.goEnabled, 800);
  await leave(r, S.smoke);
};

const playMaze2: Driver = async (r, lose) => {
  const scene = r.scenes.get(S.maze2) as Maze2Scene;
  await until(r, "gouffre des véhibules : sonde", () => (scene.probe?.kit.members.length ?? 0) > 0);
  const p = scene.probe!;
  const plan = planMaze2(p.snapshot(), 100_000);
  if (!plan.complete) throw new Error("blocage : gouffre des véhibules, aucun plan ne sauve tout le groupe");
  const launches = plan.launches.slice(0, Math.max(0, plan.launches.length - lose));
  for (const launch of launches) {
    await dragMember(r, p.kit, launch.id - 1, MAZE2_RAMPS[launch.ramp - 1]!.drop);
    await until(r, `gouffre : lancer ${launch.id} parti`, () => p.world.launched.includes(launch.id), 100);
    await until(
      r,
      `gouffre : lancer ${launch.id} fini`,
      () => p.launches === 0 && p.world.flights.every((f) => f.state === "wait") && p.kit.members.every((m) => !m.snoid.walking),
      6000,
    );
  }
  await until(r, "gouffre : « go » actif", () => p.kit.goEnabled, 800);
  await leave(r, S.maze2);
};

export const DRIVERS: Record<number, Driver> = {
  [S.bridge]: playBridge,
  [S.tunnels]: playTunnels,
  [S.pizza]: playPizza,
  [S.ferry]: playFerry,
  [S.lilly]: playLilly,
  [S.slides]: playSlides,
  [S.fleens]: playFleens,
  [S.hotel]: playHotel,
  [S.net]: playNet,
  [S.caves]: playCaves,
  [S.smoke]: playSmoke,
  [S.maze2]: playMaze2,
};

// ---------------------------------------------------------------------------------------------------------------------------
// Choix des Zoombinis et camps

/** Écran 3 : 16 Zoombinis choisis par clics (attributs puis « ajouter »), puis départ. */
export async function pickGroup(r: Rig, order: readonly number[] = Array.from({ length: 16 }, (_, i) => i)): Promise<void> {
  r.zb.session.screen = S.picker;
  r.zb.session.previous = S.map;
  r.zb.game.resumeScreen = S.picker;
  r.engine.start(S.picker);
  await tick(r, 100);
  expect(r.engine.error).toBeNull();
  const attribute = (row: number, value: number): [number, number] => [3 + 39 * (value - 1) + 19, 304 + 44 * row + 20];
  const chosen = [0, 0, 0, 0];
  for (const i of order) {
    const attrs = groupAttrs(i);
    for (let row = 0; row < 4; row++) {
      if (chosen[row] !== attrs[row]) {
        r.host.click(...attribute(row, attrs[row]!));
        await tick(r, 20);
      }
      chosen[row] = attrs[row]!;
    }
    r.host.click(232, 323);
    await tick(r, 20);
  }
  await until(r, "choix : 16 Zoombinis", () => r.zb.game.group.members.length === 16, 1500);
  await tick(r, 1000);
  r.host.click(619, 459);
}

export const CAMP_EXITS: Record<number, readonly Point[]> = {
  [S.baseCamp]: [
    { x: 618, y: 328 },
    { x: 618, y: 404 },
  ],
  [S.bcTwo]: [{ x: 618, y: 338 }],
};

/** Camp : attend que le groupe soit au complet debout, puis prend la sortie `exit` (0 : chemin A, 1 : chemin B). */
export async function leaveCamp(r: Rig, camp: number, exit: number): Promise<void> {
  await reach(r, camp);
  await tick(r, 300);
  const point = CAMP_EXITS[camp]![exit]!;
  for (let attempt = 0; attempt < 4 && screenIs(r, camp); attempt++) {
    r.host.click(point.x, point.y);
    await until(r, `quitter le camp ${nameOf(camp)}`, () => !screenIs(r, camp), 1500).catch((error) => {
      if (attempt === 3) throw error;
    });
  }
}

/** Joue l'épreuve `screen`, vérifie la destination, rend le nombre de survivants. */
export async function puzzle(r: Rig, screen: number, expected: number, lose = 0): Promise<void> {
  await reach(r, screen);
  await DRIVERS[screen]!(r, lose);
  await reach(r, expected);
}

export type Path = "A" | "B";

/** Chemin complet depuis un groupe de 16 choisi jusqu'à Zoombiniville ; renvoie l'ordre des écrans traversés. */
export async function playAdventure(r: Rig, path: Path, losses: Partial<Record<number, number>> = {}, order?: readonly number[]): Promise<void> {
  const first = path === "A" ? [S.ferry, S.lilly, S.slides] : [S.fleens, S.hotel, S.net];
  const chain = [S.bridge, S.tunnels, S.pizza, S.baseCamp, ...first, S.bcTwo, S.caves, S.smoke, S.maze2, S.town];
  await pickGroup(r, order);
  for (let i = 0; i < chain.length - 1; i++) {
    const screen = chain[i]!;
    const next = chain[i + 1]!;
    if (screen === S.baseCamp || screen === S.bcTwo) {
      await leaveCamp(r, screen, screen === S.baseCamp && path === "B" ? 1 : 0);
      continue;
    }
    expect(nextScreen(screen, path), nameOf(screen)).toBe(next);
    await puzzle(r, screen, next, losses[screen] ?? 0);
  }
  await reach(r, S.town);
}

export function nextScreen(screen: number, path: Path): number {
  const A: number[] = [S.bridge, S.tunnels, S.pizza, S.baseCamp, S.ferry, S.lilly, S.slides, S.bcTwo, S.caves, S.smoke, S.maze2, S.town];
  const B: number[] = [S.bridge, S.tunnels, S.pizza, S.baseCamp, S.fleens, S.hotel, S.net, S.bcTwo, S.caves, S.smoke, S.maze2, S.town];
  const chain = path === "A" ? A : B;
  return chain[chain.indexOf(screen) + 1]!;
}

export const PATH_SCREENS: Record<Path, number[]> = {
  A: [S.picker, S.bridge, S.tunnels, S.pizza, S.baseCamp, S.ferry, S.lilly, S.slides, S.bcTwo, S.caves, S.smoke, S.maze2, S.town],
  B: [S.picker, S.bridge, S.tunnels, S.pizza, S.baseCamp, S.fleens, S.hotel, S.net, S.bcTwo, S.caves, S.smoke, S.maze2, S.town],
};
/** Dernière épreuve de l'étape 2 (chemin A) ou 3 (chemin B), qui pose le monument de l'étape. */
export const MIDDLE_STAGE: Record<Path, number> = { A: 2, B: 3 };
