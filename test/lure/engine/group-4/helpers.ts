import type { LureEngine } from "../../../../src/games/lure/engine/game";
import { HotspotId } from "../../../../src/games/lure/engine/ids";
import { Driver, makeEngine, type TestHost } from "../test-host";

export { hasOriginalFiles } from "../test-host";

export interface Setup {
  engine: LureEngine;
  host: TestHost;
  driver: Driver;
}

/** Moteur sur les vrais fichiers, démarré (script de démarrage joué). */
export function start(options: Parameters<typeof makeEngine>[0] = {}): Setup {
  const { engine, host } = makeEngine(options);
  const driver = new Driver(engine, host);
  driver.ticks(3);
  return { engine, host, driver };
}

/** Comme la commande `enter N` du débogueur de ScummVM : quitte la pièce, entre dans `room`, y met le joueur (pas de marche). */
export function enter(engine: LureEngine, room: number): void {
  engine.room.leaveRoom();
  engine.room.setRoomNumber(room);
  engine.world.requireActiveHotspot(HotspotId.PLAYER).roomNumber = room;
}

/** Comme `give` du débogueur : l'objet est dans l'inventaire du joueur (ou d'un autre personnage). */
export function give(engine: LureEngine, item: number, character: number = HotspotId.PLAYER): void {
  engine.world.requireHotspot(item).roomNumber = character;
}

/** Comme `setfield` : champ de la table des valeurs. */
export function setField(engine: LureEngine, field: number, value: number): void {
  engine.world.fields.set(field, value);
}

export function field(engine: LureEngine, f: number): number {
  return engine.world.fields.get(f);
}

/** Appelle la méthode native `index` comme le ferait une séquence. */
export function callMethod(engine: LureEngine, index: number, p1 = 0, p2 = 0, p3 = 0): void {
  engine.methods.call(index, p1, p2, p3);
}

/**
 * Goewin active et libérée, comme après le dialogue `0xE8D0` du village (séquence `0x2182` : `freeGoewin`) : elle joue son script de
 * libération (animation captive, qui change d'animation à sa fin) puis prend le gestionnaire standard. Rend le nombre d'images jouées.
 */
export function freeGoewinAndWait(engine: LureEngine, room: number = 31): number {
  const world = engine.world;
  world.requireHotspot(HotspotId.GOEWIN).roomNumber = room;
  world.activateHotspot(HotspotId.GOEWIN);
  callMethod(engine, 55);
  let ticks = 0;
  while (world.requireActiveHotspot(HotspotId.GOEWIN).tickProcId !== 2 && ticks < 2000) {
    engine.tick();
    ticks++;
  }
  return ticks;
}
