/**
 * Marche des personnages : les trois actions de pile `START_WALKING` (nouvelle recherche de chemin), `PROCESSING_PATH` (recherche,
 * éventuellement sur plusieurs images, puis traitement d'un chemin introuvable) et `WALKING` (un pas par image, porte refermée en
 * route, personnage heurté, sortie franchie), pour le joueur (`playerAnimHandler`) et pour les PNJ (`standardCharacterAnimHandler`),
 * qui ne réagissent pas de la même façon à un blocage.
 *
 * Source (ScummVM, GPL v3+) : cas `START_WALKING`, `PROCESSING_PATH`, `WALKING` de `HotspotTickHandlers::playerAnimHandler` et de
 * `HotspotTickHandlers::standardCharacterAnimHandler`, `Hotspot::walkingStep`, `PathFinder::clear` (engines/lure/hotspots.cpp),
 * `MovementDataList::getFrame` (engines/lure/res_struct.cpp).
 *
 * C'est l'implémentation du service `Movement` (`services.ts`) ; les tests peuvent le remplacer (téléportation de `test-host.ts`).
 * Le curseur « sablier » (`walkTo` avec un budget non nul) et le curseur flèche rendu à la fin d'une recherche passent par
 * `room.cursor`.
 *
 * Écarts : une sortie-hotspot visée sans porte (`getExitJoin` nul pour un PNJ, plantage de ScummVM) est traitée comme une porte ouverte
 * et journalisée ; une image de marche introuvable est journalisée (avertissement de ScummVM).
 */

import { Direction } from "../data/ids";
import type { Movement as MovementFrame } from "../data/lure-dat";
import type { LureContext } from "./context";
import { findExit } from "./exits";
import type { Hotspot } from "./hotspot";
import { BlockedState, CharacterMode, Covered, CurrentAction, Cursor, CursorState, HotspotId, IDLE_COUNTDOWN_SIZE, SupportId } from "./ids";
import { PATHFIND_COUNTDOWN, PathResult, clearPath, numSteps, processPath, resetPath } from "./pathfinder";
import { checkPaused, resetPaused, scanPaused } from "./paused-list";
import type { Movement } from "./services";
import { checkRoomChange } from "./support";

/** `MovementDataList::getFrame` : déplacement et image suivante après l'image `currentFrame` (la première si elle est la dernière). */
export function movementFrame(frames: readonly MovementFrame[], currentFrame: number): MovementFrame | null {
  if (frames.length === 0) return null;
  const index = frames.findIndex((f) => f.frameNumber === currentFrame);
  if (index < 0 || index === frames.length - 1) return frames[0]!;
  return frames[index + 1]!;
}

/** `walkingStep` : un pas du tronçon en tête ; vrai quand le chemin est fini. */
export function walkingStep(ctx: LureContext, h: Hotspot): boolean {
  const pf = h.pathFinder;
  if (pf.list.length === 0) return true;
  if (pf.stepCtr >= numSteps(pf.list[0]!)) {
    pf.stepCtr = 0;
    pf.list.shift();
    if (pf.list.length === 0) return true;
  }
  const top = pf.list[0]!;
  if (pf.stepCtr === 0) h.setDirection(top.direction);

  const anim = h.anim;
  let frames: readonly MovementFrame[];
  switch (top.direction) {
    case Direction.UP:
      frames = anim?.up ?? [];
      break;
    case Direction.DOWN:
      frames = anim?.down ?? [];
      break;
    case Direction.LEFT:
      frames = anim?.left ?? [];
      break;
    case Direction.RIGHT:
      frames = anim?.right ?? [];
      break;
    default:
      return true;
  }
  const frame = movementFrame(frames, h.frameNumber);
  if (frame) {
    h.setFrameNumber(frame.frameNumber);
    h.setPosition(h.x + frame.xChange, h.y + frame.yChange);
    pf.stepCtr++;
  } else {
    ctx.journal.log(`hotspot ${h.hotspotId.toString(16)} : pas d'image de marche (image ${h.frameNumber}, direction ${top.direction})`);
  }
  return false;
}

export class LureMovement implements Movement {
  /**
   * @param pathfindCountdown budget d'un appel de la recherche : 0 comme ScummVM (d'un trait), `ORIGINAL_PATHFIND_COUNTDOWN` (4 000) pour
   * la recherche découpée de l'exécutable d'origine.
   */
  constructor(
    private readonly ctx: LureContext,
    readonly pathfindCountdown: number = PATHFIND_COUNTDOWN,
  ) {}

  clearPath(h: Hotspot): void {
    clearPath(h.pathFinder, this.pathfindCountdown);
  }

  private startPath(h: Hotspot): void {
    h.coveredFlag = Covered.INITIAL;
    h.setOccupied(false);
    resetPath(h.pathFinder, this.ctx.world.requireRoom(h.roomNumber).paths, h.widthCopy, this.pathfindCountdown);
  }

  private process(h: Hotspot) {
    return processPath(h.pathFinder, h, this.pathfindCountdown);
  }

  walkPlayer(h: Hotspot, impinging: readonly number[]): void {
    const ctx = this.ctx;
    const room = ctx.room;
    const actions = h.currentActions;
    let action = actions.action();

    if (action === CurrentAction.START_WALKING) {
      this.startPath(h);
      actions.pop();
      actions.addFront(CurrentAction.PROCESSING_PATH, h.roomNumber);
      action = CurrentAction.PROCESSING_PATH;
    }

    if (action === CurrentAction.PROCESSING_PATH) {
      h.characterMode = CharacterMode.NONE;
      scanPaused(ctx, h);
      const result = this.process(h);
      if (result === PathResult.UNFINISHED) return;

      if (result !== PathResult.OK && (h.walkFlag || result !== PathResult.DEST_OCCUPIED)) {
        if (h.blockedState === BlockedState.FINAL) {
          resetPaused(ctx, h.hotspotId);
          h.blockedState = BlockedState.NONE;
          actions.pop();
          h.characterMode = CharacterMode.PLAYER_WAIT;
          h.delayCtr = 7;
          return;
        }
        if (h.blockedState !== BlockedState.NONE) {
          // Bloqué : s'écarter au hasard, puis reprendre la destination (`tempDest`).
          h.tempDest.x = h.destX;
          h.tempDest.y = h.destY;
          h.tempDest.counter = 1;
          h.blockedState = h.blockedState + 1;
          h.setRandomDest();
          return;
        }
      }

      h.characterMode = CharacterMode.NONE;
      h.setPosition(h.x, h.y & 0xfff8);
      if (h.pathFinder.list.length === 0) {
        room.cursor = Cursor.ARROW;
        actions.top().action = CurrentAction.DISPATCH_ACTION;
        return;
      }
      actions.top().action = CurrentAction.WALKING;
      if (room.cursor !== Cursor.CAMERA) room.cursor = Cursor.ARROW;
      action = CurrentAction.WALKING;
    }

    if (action === CurrentAction.WALKING) {
      h.setOccupied(false);
      if (h.destHotspotId !== 0) {
        const join = ctx.world.getExitJoin(h.destHotspotId);
        if (join?.blocked) {
          // La porte visée s'est refermée.
          actions.pop();
          h.setOccupied(true);
          return;
        }
      }
      if (checkPaused(ctx, HotspotId.PLAYER, impinging) === 0) {
        if (walkingStep(ctx, h)) {
          if (room.cursorState === CursorState.BUMPED) room.cursorState = CursorState.NONE;
          if (h.tempDest.counter !== 0) {
            h.characterMode = CharacterMode.PLAYER_WAIT;
            h.delayCtr = IDLE_COUNTDOWN_SIZE;
            return;
          }
          actions.top().action = CurrentAction.DISPATCH_ACTION;
        }
        if (checkRoomChange(ctx, h)) return;
      }
      h.setOccupied(true);
    }
  }

  walkCharacter(h: Hotspot, impinging: readonly number[], bumpedPlayer: boolean): void {
    const ctx = this.ctx;
    const actions = h.currentActions;
    let action = actions.action();

    if (action === CurrentAction.START_WALKING) {
      this.startPath(h);
      actions.top().action = CurrentAction.PROCESSING_PATH;
      action = CurrentAction.PROCESSING_PATH;
    }

    if (action === CurrentAction.PROCESSING_PATH) {
      scanPaused(ctx, h);
      const result = this.process(h);
      if (result === PathResult.UNFINISHED) return;

      if (result === PathResult.OK || (h.destHotspotId === 0 && result === PathResult.DEST_OCCUPIED)) {
        h.blockedState = BlockedState.NONE;
        if (h.pathFinder.list.length === 0) {
          actions.top().action = CurrentAction.DISPATCH_ACTION;
          return;
        }
        actions.top().action = CurrentAction.WALKING;
        // WORKAROUND de ScummVM : pas de recalage vertical si le personnage est déjà dans une sortie (arrivée refusée).
        const x = h.x + (h.widthCopy >> 1);
        const y = h.y + h.heightCopy - (h.yCorrection >> 1);
        if (!findExit(ctx, h.roomNumber, x, y)) h.setPosition(h.x, h.y & 0xfff8);
      } else if (h.blockedState === BlockedState.FINAL) {
        // Deux recherches sans chemin : le personnage renonce à cette marche.
        resetPaused(ctx, h.hotspotId);
        h.updateMovement();
        actions.pop();
        h.blockedFlag = false;
        h.blockedState = BlockedState.NONE;
        h.characterMode = CharacterMode.PAUSED;
        h.delayCtr = 2;
        if (actions.isEmpty() || actions.top().roomNumber !== h.roomNumber) h.destHotspotId = 0xffff;
        if (bumpedPlayer) h.characterMode = CharacterMode.PLAYER_WAIT;
      } else {
        // Bloqué : l'emploi du temps « retour » (RETURN_SUPPORT_ID) passe devant, au-dessus d'une action factice.
        const entry = ctx.schedules.resolve(SupportId.RETURN);
        if (entry === null) throw new Error("emploi du temps RETURN_SUPPORT_ID absent");
        h.blockedState = h.blockedState + 1;
        if (!h.blockedFlag) {
          actions.addFront(CurrentAction.DISPATCH_ACTION, 0);
          h.blockedFlag = true;
        }
        const top = actions.top();
        top.action = CurrentAction.DISPATCH_ACTION;
        top.support = { kind: "schedule", id: entry };
        top.roomNumber = h.roomNumber;
      }

      if (actions.isEmpty() || actions.top().action !== CurrentAction.WALKING) return;
      action = CurrentAction.WALKING;
    }

    if (action === CurrentAction.WALKING) {
      h.setOccupied(false);
      if (h.destHotspotId !== 0 && h.destHotspotId !== 0xffff) {
        const join = ctx.world.getExitJoin(h.destHotspotId);
        if (!join) ctx.journal.log(`hotspot ${h.hotspotId.toString(16)} : sortie ${h.destHotspotId.toString(16)} sans porte`);
        if (join?.blocked) {
          actions.top().action = CurrentAction.DISPATCH_ACTION;
          h.setOccupied(true);
          return;
        }
      }
      if (checkPaused(ctx, h.hotspotId, impinging) === 0) {
        if (walkingStep(ctx, h)) actions.top().action = CurrentAction.DISPATCH_ACTION;
        if (checkRoomChange(ctx, h)) return;
      }
      h.setOccupied(true);
    }
  }
}
