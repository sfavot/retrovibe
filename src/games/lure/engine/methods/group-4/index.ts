/**
 * Groupe L4 : méthodes natives de Goewin, des gargouilles, du brûleur à huile, de la transformation et du livre.
 *
 * Source (ScummVM, GPL v3+) : `Script::startOilBurner`, `transformPlayer`, `makeGoewinFollow`, `fixGoewin`, `makeGoewinWork`,
 * `freeGoewin`, `checkHasBook`, `enableGargoylesTalk`, `normalGoewin` (engines/lure/scripts.cpp), lues puis réécrites.
 *
 * Écarts : aucun dans la logique. `getActiveHotspot` suivi d'un `assert` (ScummVM) est `requireActiveHotspot` (lève) ; les méthodes
 * qui ne mettent pas d'`assert` (`makeGoewinFollow`, `makeGoewinWork`) lèvent aussi si Goewin n'est pas active, là où ScummVM
 * déréférence un pointeur nul. `Script::transformPlayer` active le hotspot 0x425 : s'il l'est déjà, `activateHotspot` rend l'existant
 * (comme ScummVM) et son script est relancé.
 */

import type { LureContext } from "../../context";
import { Action, Direction } from "../../../data/ids";
import { CharacterMode, CurrentAction, Field, HotspotId, RoomNum, SupportId, TickProc } from "../../ids";
import type { MethodGroupTable } from "../index";
import {
  GOEWIN_FREED_ACTIONS,
  GOEWIN_WORK_SCHEDULE_ROOM,
  GOEWIN_WORK_SCRIPT,
  GOEWIN_WORK_WALK,
  L4Hotspot,
  OIL_BURNER_X,
  TRANSFORM_SCRIPT,
} from "./ids";

/** Masque du verbe `action` dans `HotspotData.actions` (`1 << (action - 1)`). */
const verbBit = (action: number): number => (1 << (action - 1)) >>> 0;

/** 37 `startOilBurner` : le brûleur se place à x = 152 et s'anime. */
export function startOilBurner(ctx: LureContext): void {
  const burner = ctx.world.requireActiveHotspot(HotspotId.OIL_BURNER);
  burner.setPosition(OIL_BURNER_X, burner.y);
  burner.setTickProc(TickProc.STANDARD_ANIM);
}

/** 38 `transformPlayer` : les étincelles apparaissent sur le joueur (script `0x630`). */
export function transformPlayer(ctx: LureContext): void {
  const world = ctx.world;
  const transform = world.requireHotspot(HotspotId.TRANSFORM);
  const player = world.requireHotspot(HotspotId.PLAYER);
  transform.roomNumber = player.roomNumber;
  transform.startX = player.startX - 14;
  transform.startY = player.startY - 10;
  const sparkles = world.activateHotspot(HotspotId.TRANSFORM);
  if (!sparkles) return;
  sparkles.actionCtr = 0;
  sparkles.setHotspotScript(TRANSFORM_SCRIPT);
}

/** 41 `makeGoewinFollow` : Goewin suit le joueur dans les grottes (gestionnaire 8) et accepte « Dis à ». */
export function makeGoewinFollow(ctx: LureContext): void {
  const goewin = ctx.world.requireActiveHotspot(HotspotId.GOEWIN);
  goewin.setTickProc(TickProc.FOLLOWER_2);
  goewin.currentActions.clear();
  const entry = ctx.schedules.resolve(SupportId.GOEWIN_CAVE);
  goewin.currentActions.addFront(CurrentAction.DISPATCH_ACTION, RoomNum.CAVE, entry === null ? null : { kind: "schedule", id: entry });
  goewin.setActions(goewin.res.actions | verbBit(Action.TELL));
  goewin.actionCtr = 0;
  goewin.delayCtr = 0;
  goewin.characterMode = CharacterMode.NONE;
}

/** 43 `fixGoewin` : Goewin reprend son comportement ordinaire (emploi du temps standard) et n'accepte plus « Dis à ». */
export function fixGoewin(ctx: LureContext): void {
  const goewin = ctx.world.requireActiveHotspot(HotspotId.GOEWIN);
  goewin.setTickProc(TickProc.STANDARD_CHARACTER);
  const entry = ctx.schedules.resolve(SupportId.GOEWIN_STANDARD);
  if (entry === null) throw new Error("emploi du temps standard de Goewin introuvable");
  goewin.currentActions.clear();
  goewin.currentActions.addFront(CurrentAction.DISPATCH_ACTION, goewin.roomNumber, { kind: "schedule", id: entry });
  goewin.setActions(goewin.res.actions & ~verbBit(Action.TELL));
  goewin.actionCtr = 0;
  goewin.delayCtr = 0;
  goewin.characterMode = CharacterMode.NONE;
}

/** 52 `makeGoewinWork` : Goewin travaille à la boutique (script `0x616`, longue attente, gestionnaire 27). */
export function makeGoewinWork(ctx: LureContext): void {
  const goewin = ctx.world.requireActiveHotspot(HotspotId.GOEWIN);
  goewin.updateMovement();
  goewin.currentActions.addBack(CurrentAction.EXEC_HOTSPOT_SCRIPT, GOEWIN_WORK_SCHEDULE_ROOM);
  goewin.setHotspotScript(GOEWIN_WORK_SCRIPT);
  goewin.delayCtr = 1500;
  goewin.setTickProc(TickProc.GOEWIN_SHOP);
  goewin.res.walkX = GOEWIN_WORK_WALK.x;
  goewin.res.walkY = GOEWIN_WORK_WALK.y;
}

/** 55 `freeGoewin` : Goewin libérée (données seulement : elle peut ne pas être active). */
export function freeGoewin(ctx: LureContext): void {
  const goewin = ctx.world.requireHotspot(HotspotId.GOEWIN);
  goewin.actions = GOEWIN_FREED_ACTIONS;
  goewin.actionCtr = 1;
}

/** 58 `checkHasBook` : `SEQUENCE_RESULT` vaut 1 si le joueur porte le livre. */
export function checkHasBook(ctx: LureContext): void {
  const book = ctx.world.requireHotspot(HotspotId.BOOK);
  ctx.world.fields.set(Field.SEQUENCE_RESULT, book.roomNumber === HotspotId.PLAYER ? 1 : 0);
}

/** 59 `enableGargoylesTalk` : les deux gargouilles n'acceptent plus que « Parle à ». */
export function enableGargoylesTalk(ctx: LureContext): void {
  for (const id of [L4Hotspot.GARGOYLE_1, L4Hotspot.GARGOYLE_2]) ctx.world.requireHotspot(id).actions = verbBit(Action.TALK_TO);
}

/** 60 `normalGoewin` : Goewin reprend l'action en tête de sa pile, regarde vers le haut et n'a plus de point d'accès (le joueur vient à elle). */
export function normalGoewin(ctx: LureContext): void {
  const goewin = ctx.world.requireActiveHotspot(HotspotId.GOEWIN);
  if (!goewin.currentActions.isEmpty()) goewin.currentActions.top().action = CurrentAction.DISPATCH_ACTION;
  goewin.characterMode = CharacterMode.NONE;
  goewin.setDirection(Direction.UP);
  goewin.setTickProc(TickProc.STANDARD_CHARACTER);
  goewin.res.walkX = 0;
  goewin.res.walkY = 0;
}

export const GROUP_4_METHODS: MethodGroupTable = {
  37: startOilBurner,
  38: transformPlayer,
  41: makeGoewinFollow,
  43: fixGoewin,
  52: makeGoewinWork,
  55: freeGoewin,
  58: checkHasBook,
  59: enableGargoylesTalk,
  60: normalGoewin,
};
