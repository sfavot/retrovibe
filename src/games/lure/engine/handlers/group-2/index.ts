/**
 * Groupe L2 : gestionnaires de tick de la cellule et de l'égout : 9-10 `jailorAnimHandler` (Skorl de la cellule et du château),
 * 13 `sonicRatAnimHandler`, 14 `droppingTorchAnimHandler`, 15 `playerSewerExitAnimHandler`, 20 `prisonerAnimHandler`.
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::jailorAnimHandler`, `sonicRatAnimHandler`, `droppingTorchAnimHandler`,
 * `playerSewerExitAnimHandler`, `prisonerAnimHandler` (engines/lure/hotspots.cpp).
 *
 * Écarts : le Skorl pris sur le fait ne bloque rien ici : il pose `GS_RESTORE_RESTART | GS_CAUGHT` et la boucle (`game.ts`) joue la
 * séquence de capture. `jailorAnimHandler` n'appelle pas `handleTalkDialog` (ScummVM non plus : `standardCharacterAnimHandler` le fait).
 */

import type { LureContext } from "../../context";
import type { Hotspot } from "../../hotspot";
import { CharacterMode, GameState, HotspotId, TickProc, FULL_SCREEN_HEIGHT, FULL_SCREEN_WIDTH, MENUBAR_Y_SIZE } from "../../ids";
import { Direction } from "../../../data/ids";
import { charactersIntersecting } from "../../support";
import { standardCharacterAnimHandler } from "../character";
import { standardAnimHandler } from "../group-1/index";
import type { HandlerGroupTable } from "../index";
import {
  FIRE_ID,
  FIRE_SOUND,
  PRISONER_ACTIVE_SCRIPT,
  PRISONER_IDLE_SCRIPT,
  PRISONER_RANDOM_RANGE,
  PRISONER_RANDOM_THRESHOLD,
  STRAW_FIRE_ID,
} from "./ids";
import { Field } from "../../ids";

/** 9-10 `jailorAnimHandler` : le Skorl qui rattrape le joueur (champ 11 non nul, ou Skorl du château) met fin à la partie. */
function jailorAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  const player = world.requireHotspot(HotspotId.PLAYER);
  if (world.fields.get(11) !== 0 || h.hotspotId === HotspotId.CASTLE_SKORL) {
    if (!h.skipFlag && !ctx.preloadFlag && h.roomNumber === player.roomNumber) {
      if (charactersIntersecting(h.res, player)) ctx.gameState = GameState.RESTORE_RESTART | GameState.CAUGHT;
    }
  }
  standardCharacterAnimHandler(ctx, h);
}

/** 13 `sonicRatAnimHandler` : le rat attend le joueur, puis joue son animation. */
function sonicRatAnimHandler(ctx: LureContext, h: Hotspot): void {
  if (h.actionCtr === 0) {
    const player = ctx.world.requireHotspot(HotspotId.PLAYER);
    if (charactersIntersecting(h.res, player)) h.actionCtr = 1;
  } else {
    standardAnimHandler(ctx, h);
  }
}

/** 14 `droppingTorchAnimHandler` : à la fin de la chute, la torche cède la place au feu de paille. */
function droppingTorchAnimHandler(ctx: LureContext, h: Hotspot): void {
  if (h.frameCtr > 0) {
    h.frameCtr = h.frameCtr - 1;
    return;
  }
  if (!h.executeScript()) return;
  const world = ctx.world;
  world.deactivateHotspot(h.hotspotId);
  world.activateHotspot(STRAW_FIRE_ID);
  ctx.sound.addSound(FIRE_SOUND);
  // Le feu est activé avec son chargement « 4 » (animation lancée), puis reprend son chargement d'origine.
  const fire = world.requireHotspot(FIRE_ID);
  fire.flags |= 0x80;
  fire.loadOffset = 4;
  world.activateHotspot(FIRE_ID);
  fire.loadOffset = 2;
}

/** 15 `playerSewerExitAnimHandler` : la chute dans l'égout finie, Diermot et Ratpouch sont remis en jeu. */
function playerSewerExitAnimHandler(ctx: LureContext, h: Hotspot): void {
  if (h.frameCtr > 0) {
    h.decrFrameCtr();
    return;
  }
  if (!h.executeScript()) return;
  const world = ctx.world;
  h.layer = 0;
  world.deactivateHotspot(h.hotspotId);

  const player = world.requireActiveHotspot(HotspotId.PLAYER);
  player.setPosition(FULL_SCREEN_WIDTH >> 1, (FULL_SCREEN_HEIGHT - MENUBAR_Y_SIZE) >> 1);
  player.setDirection(Direction.DOWN);
  player.characterMode = CharacterMode.NONE;

  const ratpouch = world.requireActiveHotspot(HotspotId.RATPOUCH);
  ratpouch.characterMode = CharacterMode.NONE;
  ratpouch.delayCtr = 0;
  ratpouch.setActions(0x821c00);
  ratpouch.currentActions.clear();
  // Une seconde exécution du script (comme ScummVM) : fini, la chute devient un personnage ordinaire.
  if (h.executeScript()) {
    h.setTickProc(TickProc.STANDARD_CHARACTER);
    h.actionCtr = 0;
  }
}

/** 20 `prisonerAnimHandler` : le prisonnier de la cellule bouge de temps en temps tant qu'il est vivant. */
function prisonerAnimHandler(ctx: LureContext, h: Hotspot): void {
  h.handleTalkDialog();
  if (h.frameCtr > 0) {
    h.frameCtr = h.frameCtr - 1;
    return;
  }
  if (h.actionCtr !== 0) {
    // Comme ScummVM (`executeScript() == 0`) : c'est un script qui n'est PAS fini qui est remplacé par le script de repos.
    if (!h.executeScript()) {
      h.actionCtr = 0;
      h.setHotspotScript(PRISONER_IDLE_SCRIPT);
    }
    return;
  }
  if (ctx.world.fields.get(Field.PRISONER_DEAD) === 0 && ctx.rng.number(PRISONER_RANDOM_RANGE) >= PRISONER_RANDOM_THRESHOLD) {
    h.actionCtr = 1;
    h.setHotspotScript(PRISONER_ACTIVE_SCRIPT);
  }
}

export const GROUP_2_HANDLERS: HandlerGroupTable = {
  jailorAnimHandler,
  sonicRatAnimHandler,
  droppingTorchAnimHandler,
  playerSewerExitAnimHandler,
  prisonerAnimHandler,
};
