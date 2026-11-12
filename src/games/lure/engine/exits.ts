/**
 * Sorties de pièce vues par les personnages : sortie franchie sous les pieds (`RoomExitList::checkExits`), coordonnées de la sortie à
 * prendre pour aller vers une pièce (`RoomExitCoordinatesList`, prochaine pièce du trajet comprise), porte associée
 * (`RoomExitIndexedHotspotList::getHotspot`), pièces de repli des suiveurs (`roomTranslations`), et le départ d'un PNJ qui doit changer de
 * pièce pour son action (`npcRoomChange`) : marcher jusqu'à la sortie, ouvrir la porte fermée d'abord, renoncer après cinq essais, ne
 * pas partir vers une pièce qui renvoie aussitôt.
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::npcRoomChange` (engines/lure/hotspots.cpp), `RoomExitList::checkExits`,
 * `RoomExitCoordinatesList::getEntry`, `RoomExitCoordinates::getData`, `RoomExitIndexedHotspotList::getHotspot`, `roomTranslations`
 * (engines/lure/res_struct.cpp).
 *
 * Écarts : aucun. Comme ScummVM, le décompte des personnages de la pièce d'arrivée (« 4 au plus ») teste le personnage qui part et non
 * chaque hotspot de la liste : il vaut 0 sauf cas dégénéré (reproduit tel quel).
 */

import { Action } from "../data/ids";
import type { RoomExit, RoomExitCoordinate } from "../data/lure-dat";
import type { LureContext } from "./context";
import type { Hotspot } from "./hotspot";
import { CurrentAction, HotspotId } from "./ids";

/** `roomTranslations` : pièce du joueur vers la pièce où envoyer un personnage (`moveCharacterToPlayer`, suiveurs). */
export const ROOM_TRANSLATIONS: ReadonlyArray<readonly [number, number]> = [
  [0x1e, 0x13],
  [0x07, 0x08],
  [0x1c, 0x12],
  [0x26, 0x0f],
  [0x27, 0x0f],
  [0x28, 0x0f],
  [0x29, 0x0f],
  [0x22, 0x0a],
  [0x23, 0x13],
  [0x24, 0x14],
  [0x31, 0x2c],
  [0x2f, 0x2c],
];

/** `checkExits(x, y)` : première sortie de la pièce qui contient le point. */
export function findExit(ctx: LureContext, roomNumber: number, x: number, y: number): RoomExit | undefined {
  return ctx.world.roomExits(roomNumber).find((e) => x >= e.xs && x < e.xe && y >= e.ys && y < e.ye);
}

/** `coordinateList().getEntry(room).getData(destRoom)` : sortie à prendre dans `roomNumber` pour aller vers `destRoomNumber`. */
export function exitCoordinate(ctx: LureContext, roomNumber: number, destRoomNumber: number): RoomExitCoordinate {
  const entry = ctx.data.exitCoordinates[roomNumber - 1];
  if (!entry) throw new Error(`pièce ${roomNumber} sans coordonnées de sortie`);
  const index = entry.roomIndex[destRoomNumber - 1];
  const data = index === undefined ? undefined : entry.entries[index];
  if (!data) throw new Error(`pièce ${roomNumber} : pas de sortie vers ${destRoomNumber}`);
  return data;
}

/** `exitHotspots().getHotspot(room, index)` : porte de la sortie, `0xFFFF` si la sortie n'en a pas. */
export function exitHotspotId(ctx: LureContext, roomNumber: number, hotspotIndexId: number): number {
  const entry = ctx.data.exitHotspotIds.find((e) => e.roomNumber === roomNumber && e.hotspotIndex === hotspotIndexId);
  return entry ? entry.hotspotId : 0xffff;
}

/** `npcRoomChange` : le PNJ n'est pas dans la pièce de son action ; il part vers la sortie qui y mène. */
export function npcRoomChange(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  const actions = h.currentActions;

  h.exitCtr = h.exitCtr + 1;
  if (h.exitCtr >= 5) {
    // Trop d'essais : retour vers le joueur, ou gestionnaire de blocage de l'emploi du temps.
    h.exitCtr = 0;
    if (!actions.isEmpty()) {
      if (h.startRoomNumber !== 0) {
        const bottom = actions.bottom().support;
        if (!bottom || ctx.schedules.action(bottom) !== Action.RETURN) {
          const player = world.requireActiveHotspot(HotspotId.PLAYER);
          actions.clear();
          actions.addFrontAction(Action.RETURN, player.roomNumber, 0, 0);
        }
      }
    } else if (h.blockedOffset !== 0 && h.blockedOffset !== 0xffff) {
      const entry = ctx.schedules.resolve(h.blockedOffset);
      actions.addFront(CurrentAction.DISPATCH_ACTION, h.roomNumber, entry === null ? null : { kind: "schedule", id: entry });
    }
    return;
  }

  const srcRoom = h.roomNumber;
  const destRoom = actions.top().roomNumber;
  const exitData = exitCoordinate(ctx, srcRoom, destRoom);

  // Une prochaine pièce qui renvoie vers celle-ci : destination inaccessible (cycle), le personnage reste.
  const nextHop = exitData.roomNumber & 0xff;
  if (nextHop !== 0 && nextHop !== destRoom) {
    const backHop = exitCoordinate(ctx, nextHop, destRoom).roomNumber & 0xff;
    if (backHop === srcRoom) {
      actions.top().roomNumber = h.roomNumber;
      h.exitCtr = 0;
      return;
    }
  }

  if (h.hotspotId !== HotspotId.RATPOUCH) {
    let numCharacters = 0;
    for (let i = 0; i < world.activeHotspots.length; i++) {
      if (h.roomNumber === nextHop && h.layer !== 0 && h.hotspotId >= HotspotId.PLAYER && h.hotspotId < HotspotId.FIRST_NONCHARACTER) numCharacters++;
    }
    if (numCharacters >= 4) {
      const entry = ctx.schedules.resolve(world.getCharOffset(0));
      actions.addFront(CurrentAction.DISPATCH_ACTION, h.roomNumber, entry === null ? null : { kind: "schedule", id: entry });
      return;
    }
  }

  h.setDestPosition(exitData.x, exitData.y);
  h.destHotspotId = exitHotspotId(ctx, h.roomNumber, exitData.hotspotIndexId);
  if (h.destHotspotId !== 0xffff) {
    const join = world.getExitJoin(h.destHotspotId);
    if (!join) throw new Error(`sortie ${h.destHotspotId.toString(16)} sans porte`);
    if (join.blocked) {
      // Porte fermée : l'ouvrir d'abord.
      actions.addFrontAction(Action.OPEN, h.roomNumber, h.destHotspotId, 0);
      h.blockedFlag = false;
      return;
    }
  }

  actions.top().action = CurrentAction.START_WALKING;
  h.walkFlag = true;
}
