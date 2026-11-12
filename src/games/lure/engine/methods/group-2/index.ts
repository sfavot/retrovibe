/**
 * Groupe L2 : méthodes natives de la cellule et de Ratpouch : 20 et 65 `checkCellDoor`, 23 `isSkorlInCell`, 24 `ratpouchPushBricks`,
 * 26 `pauseRatpouch`.
 *
 * Source (ScummVM, GPL v3+) : `Script::checkCellDoor`, `isSkorlInCell`, `ratpouchPushBricks`, `pauseRatpouch` (engines/lure/scripts.cpp).
 *
 * Écarts : aucun.
 */

import type { LureContext } from "../../context";
import { CharacterMode, CurrentAction, Field, HotspotId } from "../../ids";
import type { MethodGroupTable } from "../index";
import { CELL_DOOR_SOUND, CELL_ROOM, RATPOUCH_PAUSE_DELAY, SEWER_ROOM } from "./ids";

/** 20 et 65 `checkCellDoor` : porte de la cellule ouverte et torche cachée : la musique démarre. */
function checkCellDoor(ctx: LureContext): void {
  const join = ctx.world.getExitJoin(HotspotId.CELL_DOOR);
  if (!join) throw new Error("checkCellDoor : porte de la cellule inconnue");
  if (join.blocked === 0 && ctx.world.fields.get(Field.TORCH_HIDE) !== 0) ctx.sound.addSound(CELL_DOOR_SOUND);
}

/** 23 `isSkorlInCell` : `GENERAL` = 0 si le Skorl est dans la pièce 1, 1 sinon. */
function isSkorlInCell(ctx: LureContext): void {
  const skorl = ctx.world.requireHotspot(HotspotId.SKORL);
  ctx.world.fields.set(Field.GENERAL, skorl.roomNumber === CELL_ROOM ? 0 : 1);
}

/** 24 `ratpouchPushBricks` : la sortie des briques s'ouvre, Ratpouch (sans être interruptible) part vers la pièce 7. */
function ratpouchPushBricks(ctx: LureContext): void {
  const join = ctx.world.getExitJoin(HotspotId.BRICKS);
  if (!join) throw new Error("ratpouchPushBricks : sortie des briques inconnue");
  join.blocked = 0;
  const ratpouch = ctx.world.requireActiveHotspot(HotspotId.RATPOUCH);
  ratpouch.setActions(0);
  ratpouch.currentActions.clear();
  ratpouch.currentActions.addBack(CurrentAction.DISPATCH_ACTION, SEWER_ROOM);
}

/** 26 `pauseRatpouch` : Ratpouch en pause pour très longtemps. */
function pauseRatpouch(ctx: LureContext): void {
  const ratpouch = ctx.world.requireActiveHotspot(HotspotId.RATPOUCH);
  ratpouch.characterMode = CharacterMode.PAUSED;
  ratpouch.delayCtr = RATPOUCH_PAUSE_DELAY;
}

export const GROUP_2_METHODS: MethodGroupTable = {
  20: checkCellDoor,
  23: isSkorlInCell,
  24: ratpouchPushBricks,
  26: pauseRatpouch,
  65: checkCellDoor,
};
