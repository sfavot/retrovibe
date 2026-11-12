/**
 * Fonctions d'appui des personnages (`Support`) : personnages qui se chevauchent, changement de pièce d'un personnage, sortie de pièce
 * franchie.
 *
 * Source (ScummVM, GPL v3+) : `Support::findIntersectingCharacters`, `checkForIntersectingCharacter`, `checkRoomChange`,
 * `characterChangeRoom`, `charactersIntersecting`, `isCharacterInList` (engines/lure/hotspots.cpp).
 *
 * Écarts : aucun. `checkRoomChange` est appelé par la marche (`movement.ts`).
 */

import type { LureContext } from "./context";
import { findExit } from "./exits";
import type { Hotspot } from "./hotspot";
import { CurrentAction, CursorState, HotspotId } from "./ids";
import type { HotspotState } from "./state";

export const MAX_NUM_IMPINGING = 10;

/** Personnages actifs (sauf `h`) dont la base touche celle de `h` placé en `(xp, yp)` dans `roomNumber` (sa place actuelle par défaut). */
export function findIntersectingCharacters(ctx: LureContext, h: Hotspot, xp?: number, yp?: number, roomNumber?: number): number[] {
  if (roomNumber === undefined) {
    xp = h.x;
    yp = h.y;
    roomNumber = h.roomNumber;
  }
  const left = xp!;
  const right = xp! + h.widthCopy;
  const top = yp! + h.heightCopy - h.yCorrection - h.charRectY;
  const bottom = yp! + h.heightCopy + h.charRectY;
  const out: number[] = [];
  for (const other of ctx.world.activeHotspots) {
    if (
      h.hotspotId === other.hotspotId ||
      other.layer === 0 ||
      roomNumber !== other.roomNumber ||
      other.hotspotId >= HotspotId.FIRST_NONCHARACTER ||
      other.skipFlag
    )
      continue;
    const otherY = other.y + other.heightCopy;
    if (
      other.x >= right ||
      other.x + other.widthCopy <= left ||
      otherY + other.charRectY <= top ||
      otherY - other.charRectY - other.yCorrection >= bottom
    )
      continue;
    if (out.length === MAX_NUM_IMPINGING) throw new Error("trop de personnages se chevauchent");
    out.push(other.hotspotId);
  }
  return out;
}

export function checkForIntersectingCharacter(ctx: LureContext, h: Hotspot, xp: number, yp: number, roomNumber: number): boolean {
  return findIntersectingCharacters(ctx, h, xp, yp, roomNumber).length !== 0;
}

/** `checkRoomChange` : le pied du personnage est dans une sortie de la pièce ; la sortie est prise (séquence ou changement de pièce). */
export function checkRoomChange(ctx: LureContext, h: Hotspot): boolean {
  const x = h.x + (h.widthCopy >> 1);
  const y = h.y + h.heightCopy - (h.yCorrection >> 1);
  const exit = findExit(ctx, h.roomNumber, x, y);
  if (!exit) return false;
  if (exit.sequenceOffset !== 0xffff) ctx.script.execute(exit.sequenceOffset);
  else characterChangeRoom(ctx, h, exit.roomNumber, exit.x, exit.y, directionOf(exit.direction));
  return true;
}

function directionOf(direction: "up" | "down" | "left" | "right" | "none"): number {
  return { up: 0, down: 1, left: 2, right: 3, none: 4 }[direction];
}

/**
 * `characterChangeRoom` : le joueur demande le changement à la boucle (`playerNewPos`), sauf si un personnage bloque l'arrivée (il
 * marche alors au hasard dans la pièce) ; un autre personnage change de pièce tout de suite, ou attend (emploi du temps d'index 0).
 */
export function characterChangeRoom(ctx: LureContext, h: Hotspot, roomNumber: number, newX: number, newY: number, dir: number): void {
  const fields = ctx.world.fields;
  if (h.hotspotId === HotspotId.PLAYER) {
    if (ctx.room.cursorState !== CursorState.NONE) return;
    const p = fields.playerNewPos;
    if (checkForIntersectingCharacter(ctx, h, newX, newY - 48, roomNumber)) {
      h.tempDest.x = h.destX;
      h.tempDest.y = h.destY;
      h.tempDest.counter = 1;
      ctx.room.cursorState = CursorState.BUMPED;
      h.actionCtr = 0;
      h.blockedState = h.blockedState + 1;
      h.destHotspotId = 0;
      h.setRandomDest();
      p.roomNumber = 0;
    } else {
      h.setDirection(dir);
      p.roomNumber = roomNumber;
      p.x = newX;
      p.y = newY - 48;
    }
    return;
  }

  const x = (newX & 0xfff8) | 5;
  const y = (newY - h.heightCopy) & 0xfff8;
  if (checkForIntersectingCharacter(ctx, h, x, y, roomNumber)) {
    const entry = ctx.schedules.resolve(ctx.world.getCharOffset(0));
    h.currentActions.addFront(CurrentAction.DISPATCH_ACTION, h.roomNumber, entry === null ? null : { kind: "schedule", id: entry });
  } else {
    h.roomNumber = roomNumber;
    h.setPosition(x, y);
    h.skipFlag = true;
    h.setDirection(dir);
    h.exitCtr = 0;
    h.currentActions.top().action = CurrentAction.DISPATCH_ACTION;
  }
}

/** `charactersIntersecting` : les bases de deux personnages se touchent (marge de 4 pixels en largeur, 2 en hauteur). */
export function charactersIntersecting(a: HotspotState, b: HotspotState): boolean {
  return !(
    a.startX + a.widthCopy + 4 < b.startX ||
    b.startX + b.widthCopy + 4 < a.startX ||
    b.startY + b.heightCopy - b.yCorrection - 2 >= a.startY + a.heightCopy + 2 ||
    b.startY + b.heightCopy + 2 < a.startY + a.heightCopy - a.yCorrection - 2
  );
}

export function isCharacterInList(list: readonly number[], charId: number): boolean {
  return list.includes(charId);
}
