import type { LureEngine } from "../../../../src/games/lure/engine/game";
import type { Hotspot } from "../../../../src/games/lure/engine/hotspot";
import { CharacterMode, HotspotId, TickProc } from "../../../../src/games/lure/engine/ids";
import { makeEngine } from "../test-host";

/** Moteur démarré (script de démarrage joué, cellule en place). */
export function started(): LureEngine {
  const { engine } = makeEngine();
  engine.tick();
  return engine;
}

/**
 * Amène un personnage dans `room` à l'arrêt : activé, sans action, gestionnaire nul (il ne bouge plus), le pied (`y + heightCopy`)
 * sur `footY`.
 */
export function stand(engine: LureEngine, id: number, room: number, x: number, footY: number): Hotspot {
  const world = engine.world;
  const data = world.requireHotspot(id);
  data.roomNumber = room;
  const h = world.getActiveHotspot(id) ?? world.activateHotspot(id)!;
  h.setOccupied(false);
  h.currentActions.clear();
  h.characterMode = CharacterMode.NONE;
  h.delayCtr = 0;
  h.setTickProc(TickProc.NULL);
  h.setPosition(x, footY - h.heightCopy);
  return h;
}

export const run = (engine: LureEngine, name: string, h: Hotspot): void => engine.handlers.call(name, h);
export const call = (engine: LureEngine, index: number, p1 = 0, p2 = 0, p3 = 0): void => engine.methods.call(index, p1, p2, p3);

export const PLAYER = HotspotId.PLAYER;
