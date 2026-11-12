/**
 * Gestionnaires de tick des personnages autonomes (G2) : `standardCharacterAnimHandler` (PNJ ordinaire : bulle, interlocuteur qui le
 * retient, arrivée sur un autre personnage, personnage heurté, attentes, puis l'action en tête de pile — emploi du temps, changement
 * de pièce, script, marche) et `followerAnimHandler` (Ratpouch et Goewin : rejoindre la pièce du joueur, actions aléatoires de la pièce
 * entre deux temps morts, puis le gestionnaire standard).
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::standardCharacterAnimHandler`, `followerAnimHandler` (engines/lure/hotspots.cpp),
 * `RandomActionList::getRoom`, `RandomActionSet::getEntry`, `setDone` (engines/lure/res_struct.cpp).
 *
 * Écarts : aucun. Le compteur d'attente des suiveurs est propre à chaque hotspot actif (`Hotspot.followerCountdown`), comme
 * `HotspotTickHandlers::countdownCtr` (un `HotspotTickHandlers` par `Hotspot` dans ScummVM).
 */

import type { LureContext } from "../context";
import { ROOM_TRANSLATIONS, npcRoomChange } from "../exits";
import type { Hotspot } from "../hotspot";
import { BlockedState, CharacterMode, CurrentAction, CursorState, Field, GENERAL_MAGIC_ID, HotspotId, TickProc } from "../ids";
import { scanPaused } from "../paused-list";
import { RandomActionType } from "../state";
import { charactersIntersecting, findIntersectingCharacters } from "../support";
import type { HandlerGroupTable } from "./index";

/** Champ qui garde les suiveurs du gestionnaire 7 à leur place (`fields.getField(37)`). */
const FOLLOWER_HOLD_FIELD = 37;

export function standardCharacterAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  const fields = world.fields;
  const actions = h.currentActions;
  const data = h.res;
  const player = world.requireActiveHotspot(HotspotId.PLAYER);

  h.handleTalkDialog();

  // Quelqu'un parle au personnage : il ne bouge pas.
  if (data.talkerId !== 0) {
    if (data.talkGate === GENERAL_MAGIC_ID) {
      fields.set(Field.ACTIVE_HOTSPOT_ID, data.talkGate);
      fields.set(Field.USE_HOTSPOT_ID, data.talkerId);
      ctx.script.execute(data.talkScriptOffset);
      data.talkerId = 0;
    } else {
      h.updateMovement();
      return;
    }
  }

  if (h.frameCtr > 0) {
    h.decrFrameCtr();
    return;
  }

  const impinging = findIntersectingCharacters(ctx, h);
  const bumpedPlayer = impinging.includes(HotspotId.PLAYER);

  // Personnage qui vient de changer de pièce, posé sur un autre.
  if (h.skipFlag) {
    if (impinging.length > 0) {
      if (bumpedPlayer && player.characterMode === CharacterMode.IDLE) {
        // Le joueur s'écarte de lui-même.
        player.blockedState = BlockedState.INITIAL;
        player.destHotspotId = 0;
        player.setRandomDest();
        ctx.room.cursorState = CursorState.BUMPED;
      } else {
        h.delayCtr = 10;
        h.characterMode = CharacterMode.PAUSED;
      }
      return;
    }
    h.skipFlag = false;
  }

  if (data.scriptHotspotId !== 0) {
    // Heurté par un autre personnage.
    fields.set(Field.USE_HOTSPOT_ID, data.scriptHotspotId);
    ctx.script.execute(data.tickScriptOffset);
    data.scriptHotspotId = 0;
  }

  if (h.pauseCtr !== 0) {
    h.updateMovement();
    ctx.movement.clearPath(h);
    if (h.pauseCtr > 1) {
      scanPaused(ctx, h);
      return;
    }
    h.pauseCtr = 0;
    if (h.characterMode === CharacterMode.NONE) {
      ctx.movement.clearPath(h);
      return;
    }
  }

  if (h.characterMode !== CharacterMode.NONE) {
    if (h.characterMode === CharacterMode.PLAYER_WAIT) {
      h.updateMovement();
      if (bumpedPlayer) return;
    } else if (h.delayCtr > 0) {
      h.updateMovement();
      // L'attente ne décompte que si le personnage qui l'a interpellé est là, contre lui.
      let decrement = data.actionHotspotId === 0;
      if (!decrement) {
        const other = world.requireHotspot(data.actionHotspotId);
        decrement = other.roomNumber === h.roomNumber && charactersIntersecting(other, data);
      }
      if (decrement) {
        h.delayCtr = h.delayCtr - 1;
        return;
      }
    }

    data.actionHotspotId = 0;
    const currentMode = h.characterMode;
    h.characterMode = CharacterMode.NONE;
    ctx.movement.clearPath(h);
    if (currentMode === CharacterMode.WAIT_FOR_PLAYER || currentMode === CharacterMode.WAIT_FOR_INTERACT) {
      data.talkOverride = 0;
      h.showMessage(1);
    }
    return;
  }

  switch (actions.action()) {
    case CurrentAction.NO_ACTION:
      h.updateMovement2(CharacterMode.IDLE);
      break;
    case CurrentAction.DISPATCH_ACTION: {
      const top = actions.top();
      if (top.roomNumber === 0) top.roomNumber = h.roomNumber;
      if (top.roomNumber === h.roomNumber) {
        h.skipFlag = false;
        h.doAction();
      } else {
        npcRoomChange(ctx, h);
      }
      break;
    }
    case CurrentAction.EXEC_HOTSPOT_SCRIPT:
      if (h.executeScript()) actions.top().action = CurrentAction.DISPATCH_ACTION;
      break;
    case CurrentAction.START_WALKING:
    case CurrentAction.PROCESSING_PATH:
    case CurrentAction.WALKING:
      ctx.movement.walkCharacter(h, impinging, bumpedPlayer);
      break;
    default:
      break;
  }
}

function followerAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  const player = world.requireActiveHotspot(HotspotId.PLAYER);

  if (h.res.tickProcId === TickProc.FOLLOWER_2 || world.fields.get(FOLLOWER_HOLD_FIELD) === 0) {
    if (h.currentActions.isEmpty() && h.roomNumber !== player.roomNumber) {
      // Rejoindre le joueur (ou la pièce de repli de la sienne).
      if (h.hotspotId === HotspotId.GOEWIN) {
        h.currentActions.addFront(CurrentAction.DISPATCH_ACTION, player.roomNumber);
      } else {
        const translation = ROOM_TRANSLATIONS.find(([src]) => src === player.roomNumber);
        if ((translation ? translation[1] : 0) === h.roomNumber) h.setRandomDest();
        else h.currentActions.addFront(CurrentAction.DISPATCH_ACTION, translation ? translation[1] : player.roomNumber);
      }
    }
  }

  if (h.characterMode !== CharacterMode.IDLE) {
    standardCharacterAnimHandler(ctx, h);
    return;
  }

  if (h.followerCountdown > 0) {
    h.followerCountdown--;
    standardCharacterAnimHandler(ctx, h);
    return;
  }

  // Action aléatoire de la pièce.
  const set = world.state.randomActions.find((s) => s.roomNumber === h.roomNumber);
  if (!set) {
    standardCharacterAnimHandler(ctx, h);
    return;
  }
  const actionIndex = ctx.rng.number(set.ids.length - 1);
  const actionType = set.types[actionIndex]!;
  const scheduleId = set.ids[actionIndex]!;
  if (actionType === RandomActionType.REPEAT_ONCE_DONE) {
    standardCharacterAnimHandler(ctx, h);
    return;
  }
  if (actionType === RandomActionType.REPEAT_ONCE) {
    // Une action unique ne se joue que devant le joueur.
    if (player.roomNumber !== h.roomNumber) {
      standardCharacterAnimHandler(ctx, h);
      return;
    }
    set.types[actionIndex] = RandomActionType.REPEAT_ONCE_DONE;
  }

  if (scheduleId === 0) {
    h.setRandomDest();
  } else {
    const entry = ctx.schedules.resolve(scheduleId);
    if (entry === null) throw new Error(`action aléatoire ${scheduleId.toString(16)} sans emploi du temps`);
    h.currentActions.addFront(CurrentAction.DISPATCH_ACTION, h.roomNumber, { kind: "schedule", id: entry });
    h.followerCountdown = ctx.rng.number(32);
  }
  standardCharacterAnimHandler(ctx, h);
}

export const CHARACTER_HANDLERS: HandlerGroupTable = { standardCharacterAnimHandler, followerAnimHandler };
