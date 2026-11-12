import type { LureEngine } from "../../../../src/games/lure/engine/game";
import type { Hotspot } from "../../../../src/games/lure/engine/hotspot";
import { CharacterMode, TickProc } from "../../../../src/games/lure/engine/ids";
import { BarManager } from "../../../../src/games/lure/engine/bar";

/** Le joueur entre dans `room` par le chemin du jeu (`playerNewPos`) ; `y` est celui du haut du sprite. Un tick. */
export function enterRoom(engine: LureEngine, room: number, x: number, y: number): void {
  engine.world.fields.playerNewPos = { roomNumber: room, x, y };
  engine.tick();
}

/** Moteur au démarrage (script de démarrage joué, pièce 1 affichée). */
export function started(engine: LureEngine): LureEngine {
  engine.tick();
  return engine;
}

export function barOf(engine: LureEngine): BarManager {
  if (!(engine.bar instanceof BarManager)) throw new Error("le service de bar n'est pas un BarManager");
  return engine.bar;
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
