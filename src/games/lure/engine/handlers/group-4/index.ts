/**
 * Groupe L4 : gestionnaires de tick de Goewin captive, Catriona, Morkus, des gargouilles, des crânes (grottes), du dragon, des
 * Skorls du château et du serf du chevalet.
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::goewinCaptiveAnimHandler`, `catrionaAnimHandler`, `morkusAnimHandler`,
 * `gargoyleAnimHandler`, `skullAnimHandler`, `dragonFireAnimHandler`, `castleSkorlAnimHandler`, `rackSerfAnimHandler`
 * (engines/lure/hotspots.cpp), lus puis réécrits.
 *
 * Écarts : aucun dans la logique. Règle de la vague T : ceux de ScummVM qui commencent par `handleTalkDialog()` (Catriona, Morkus,
 * gargouille, Skorl du château, serf) le font ici aussi ; `goewinCaptiveAnimHandler`, `skullAnimHandler` et `dragonFireAnimHandler`
 * ne le font pas dans ScummVM (Goewin captive, crânes, dragon ne parlent pas : Goewin libérée change de gestionnaire).
 */

import type { LureContext } from "../../context";
import type { Hotspot } from "../../hotspot";
import { GameState, HotspotFlag, HotspotId, TickProc } from "../../ids";
import type { HandlerGroupTable } from "../index";
import { RackSerfScript, SkullDoor } from "../../methods/group-4/ids";

/** 19 `goewinCaptiveAnimHandler` : tant que `actionCtr > 0`, joue le script ; à sa fin Goewin devient un personnage ordinaire. */
export function goewinCaptiveAnimHandler(_ctx: LureContext, h: Hotspot): void {
  if (h.actionCtr > 0 && h.executeScript()) {
    h.setTickProc(TickProc.STANDARD_CHARACTER);
    h.actionCtr = 0;
  }
}

/** 21 `catrionaAnimHandler` : script d'animation, image suivante après `actionCtr` images (5 si 0). */
export function catrionaAnimHandler(_ctx: LureContext, h: Hotspot): void {
  h.handleTalkDialog();
  if (h.frameCtr > 0) {
    h.decrFrameCtr();
  } else {
    h.executeScript();
    h.frameCtr = h.actionCtr === 0 ? 5 : h.actionCtr;
  }
}

/** 22 `morkusAnimHandler` : à la fin de son script, l'un des deux suivants (au hasard) après une attente de 20 à 82 images. */
export function morkusAnimHandler(ctx: LureContext, h: Hotspot): void {
  h.handleTalkDialog();
  if (h.frameCtr > 0) {
    h.decrFrameCtr();
    return;
  }
  if (h.executeScript()) {
    h.setHotspotScript(ctx.rng.number(100) >= 50 ? 0x54 : 0);
    h.frameCtr = 20 + ctx.rng.number(63);
  }
}

/** 26 `gargoyleAnimHandler` : seulement les bulles. */
export function gargoyleAnimHandler(_ctx: LureContext, h: Hotspot): void {
  h.handleTalkDialog();
}

/** 28 à 33 `skullAnimHandler` : l'image du crâne suit l'état (bloquée ou non) de la porte qu'il commande. */
export function skullAnimHandler(ctx: LureContext, h: Hotspot): void {
  const id = h.hotspotId;
  let doorId: number = SkullDoor.DEFAULT;
  if (id === 0x42e || id === 0x431 || id === 0x432) doorId = SkullDoor.SOUTH_WEST;
  else if (id === 0x42f || id === 0x433) doorId = SkullDoor.SOUTH_EAST;
  const join = ctx.world.getExitJoin(doorId);
  if (!join) throw new Error(`crâne ${id.toString(16)} : porte ${doorId.toString(16)} sans jonction`);
  const blocked = join.blocked !== 0;
  if (id === 0x42e || id === 0x42f) h.setFrameNumber(blocked ? 0 : 1);
  else h.setFrameNumber(blocked ? 1 : 0);
}

/** 34 `dragonFireAnimHandler` : le feu joue son script ; à sa fin le joueur est mort (restauration ou redémarrage). */
export function dragonFireAnimHandler(ctx: LureContext, h: Hotspot): void {
  if (h.executeScript()) ctx.gameState = GameState.RESTORE_RESTART;
}

/** 35 `castleSkorlAnimHandler` : à la fin de son script le Skorl s'efface et celui de la salle à manger (`0x3F3`) apparaît. */
export function castleSkorlAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  h.handleTalkDialog();
  if (h.frameCtr > 0) {
    h.decrFrameCtr();
    return;
  }
  if (h.executeScript()) {
    const data = world.requireHotspot(h.hotspotId);
    world.deactivateHotspot(data.hotspotId);
    data.roomNumber = 0xffff;
    data.layer = 255;
    data.talkCountdown = 0;
    data.flags |= HotspotFlag.MENU_EXCLUSION;
    world.requireHotspot(HotspotId.CASTLE_SKORL).roomNumber = 45;
    world.activateHotspot(HotspotId.CASTLE_SKORL);
  }
}

/** 36 `rackSerfAnimHandler` : `actionCtr` 1 et 2 : le serf s'agite ; 3 et 4 : il s'échappe, Ratpouch prend sa place et lui parle. */
export function rackSerfAnimHandler(ctx: LureContext, h: Hotspot): void {
  h.handleTalkDialog();
  if (h.frameCtr > 0) {
    h.decrFrameCtr();
    return;
  }
  switch (h.actionCtr) {
    case 1:
      h.setHotspotScript(RackSerfScript.FREE);
      h.actionCtr = 2;
      break;
    case 2:
      if (h.executeScript()) h.actionCtr = 0;
      break;
    case 3:
      h.setHotspotScript(RackSerfScript.ESCAPE);
      h.actionCtr = 4;
      h.layer = 2;
      runEscape(ctx, h);
      break;
    case 4:
      runEscape(ctx, h);
      break;
    default:
      break;
  }
}

/** Fin de `rackSerfAnimHandler` (cas 4, atteint aussi en tombant du cas 3 dans ScummVM). */
function runEscape(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  if (h.executeScript()) {
    h.layer = 255;
    world.deactivateHotspot(h.hotspotId);
    world.requireHotspot(HotspotId.RATPOUCH).roomNumber = 4;
    const ratpouch = world.activateHotspot(HotspotId.RATPOUCH);
    ratpouch?.converse(HotspotId.PLAYER, 0x9c, true);
  }
}

export const GROUP_4_HANDLERS: HandlerGroupTable = {
  goewinCaptiveAnimHandler,
  catrionaAnimHandler,
  morkusAnimHandler,
  gargoyleAnimHandler,
  skullAnimHandler,
  dragonFireAnimHandler,
  castleSkorlAnimHandler,
  rackSerfAnimHandler,
};
