/**
 * Gestionnaire de tick du joueur (`playerAnimHandler`) : bulle, compte à rebours d'image, personnage qui vient d'arriver sur un autre
 * (`skipFlag`), arrêt demandé par un PNJ heurté (`pauseCtr`), attente (`characterMode`, `delayCtr`, reprise d'une destination
 * temporaire), puis l'action en tête de pile (rien, verbe à exécuter, script de hotspot bloquant, marche). La marche (`START_WALKING`,
 * `PROCESSING_PATH`, `WALKING`) est faite par le service `Movement` (`movement.ts`).
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::playerAnimHandler` (engines/lure/hotspots.cpp).
 *
 * Écarts : aucun ; même ordre que ScummVM.
 */

import type { LureContext } from "../context";
import type { Hotspot } from "../hotspot";
import { CharacterMode, CurrentAction } from "../ids";
import { scanPaused } from "../paused-list";
import { findIntersectingCharacters } from "../support";
import type { HandlerGroupTable } from "./index";

function playerAnimHandler(ctx: LureContext, h: Hotspot): void {
  h.handleTalkDialog();
  if (h.frameCtr > 0) {
    h.decrFrameCtr();
    return;
  }

  const impinging = findIntersectingCharacters(ctx, h);
  if (h.skipFlag) {
    if (impinging.length > 0) return;
    h.skipFlag = false;
  }

  if (h.pauseCtr > 0) {
    h.updateMovement();
    ctx.movement.clearPath(h);
    if (h.pauseCtr === 1) {
      h.pauseCtr = 0;
      if (h.characterMode === CharacterMode.NONE) {
        h.setOccupied(false);
        return;
      }
    } else {
      scanPaused(ctx, h);
      return;
    }
  }

  if (h.characterMode !== CharacterMode.NONE && h.characterMode !== CharacterMode.IDLE) {
    if (h.delayCtr !== 0) {
      h.updateMovement();
      ctx.movement.clearPath(h);
      h.delayCtr = h.delayCtr - 1;
      return;
    }
    h.setOccupied(false);
    h.characterMode = CharacterMode.NONE;
    if (h.tempDest.counter !== 0) {
      // Reprise de la destination laissée pour s'écarter.
      h.tempDest.counter = 0;
      h.setDestPosition(h.tempDest.x, h.tempDest.y);
      h.currentActions.addFront(CurrentAction.START_WALKING, h.roomNumber);
      h.walkFlag = false;
    }
    return;
  }

  const actions = h.currentActions;
  switch (actions.action()) {
    case CurrentAction.NO_ACTION:
      h.destHotspotId = 0;
      h.updateMovement2(CharacterMode.IDLE);
      h.doNothing();
      ctx.room.statusLine = "";
      break;
    case CurrentAction.DISPATCH_ACTION:
      h.destHotspotId = 0;
      h.doAction();
      break;
    case CurrentAction.EXEC_HOTSPOT_SCRIPT:
      if (h.executeScript()) actions.pop();
      break;
    case CurrentAction.START_WALKING:
    case CurrentAction.PROCESSING_PATH:
    case CurrentAction.WALKING:
      ctx.movement.walkPlayer(h, impinging);
      break;
    default:
      break;
  }
}

export const PLAYER_HANDLERS: HandlerGroupTable = { playerAnimHandler };
