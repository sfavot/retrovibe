import type { Level, LevelObject } from "../../../src/games/swiv3d/data/level";
import { World, type WorldOptions } from "../../../src/games/swiv3d/engine/world";
import type { WorldEvent } from "../../../src/games/swiv3d/engine/events";
import type { PlayerInput } from "../../../src/games/swiv3d/engine/input";
import { input } from "../../../src/games/swiv3d/engine/input";
import { loadLevel } from "./helpers";

/** Enregistrement du bloc 105 : champs nommés, le reste à 0 (`params` = champs 4 à 15). */
export function rec(
  type: number,
  x: number,
  z: number,
  f: Partial<
    Pick<LevelObject, "angle" | "model" | "childModel" | "hitPoints" | "subtype" | "thrust">
  > & { extra?: Record<number, number> } = {},
): LevelObject {
  const params = new Array<number>(12).fill(0);
  params[0] = f.model ?? 0;
  params[1] = f.childModel ?? 0;
  params[2] = f.hitPoints ?? 0;
  params[3] = f.subtype ?? 0;
  params[4] = f.thrust ?? 0;
  for (const [k, v] of Object.entries(f.extra ?? {})) params[Number(k) - 4] = v;
  return {
    type,
    x,
    z,
    angle: f.angle ?? 0,
    model: params[0]!,
    childModel: params[1]!,
    hitPoints: params[2]!,
    subtype: params[3]!,
    thrust: params[4]!,
    params,
  };
}

export interface Scenario {
  world: World;
  level: Level;
  /** Position de départ du joueur en unités. */
  sx: number;
  sz: number;
  events: WorldEvent[];
  /** Avance de `n` ticks avec `inp`, accumule les événements ; retourne tous les événements du lot. */
  run(n: number, inp?: Partial<PlayerInput> | ((t: number) => Partial<PlayerInput>)): WorldEvent[];
}

/**
 * Monde réduit : le départ du joueur de `base` (niveau réel pour le terrain et les modèles) et les objets donnés. Les positions
 * des objets sont relatives au départ du joueur, en unités.
 */
export function scenario(
  base: string,
  make: (sx: number, sz: number, level: Level) => LevelObject[],
  opts: WorldOptions = {},
  startAt?: (level: Level) => { x: number; z: number },
): Scenario {
  const { level, models } = loadLevel(base);
  const original = level.objects.find((o) => o.type >= 1000 && o.type <= 1002)!;
  const start = startAt ? { ...original, ...startAt(level) } : original;
  const objects = [start, ...make(start.x, start.z, level)];
  const lvl: Level = { ...level, objects };
  const world = World.load(lvl, models, opts);
  const events: WorldEvent[] = [];
  return {
    world,
    level: lvl,
    sx: start.x,
    sz: start.z,
    events,
    run(n, inp = {}) {
      const out: WorldEvent[] = [];
      for (let t = 0; t < n; t++) {
        world.tick(input(typeof inp === "function" ? inp(t) : inp));
        out.push(...world.drainEvents());
      }
      events.push(...out);
      return out;
    },
  };
}

export const count = (events: WorldEvent[], kind: WorldEvent["kind"]): number =>
  events.filter((e) => e.kind === kind).length;

/** Position du nœud `i` du bloc 107 (unités). */
export const nodeAt = (i: number) => (level: Level): { x: number; z: number } => ({
  x: level.waypoints[i]!.x,
  z: level.waypoints[i]!.z,
});
