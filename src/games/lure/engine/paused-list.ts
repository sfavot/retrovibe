/**
 * Liste des personnages en attente (`PausedCharacterList`) : quand un personnage qui marche en heurte un autre, il note la paire
 * (« `src` attend `dest` ») pour `IDLE_COUNTDOWN_SIZE` images, prend une destination au hasard pour s'écarter, et l'autre personnage
 * s'arrête (`pauseCtr`) ; la boucle décompte la liste à chaque image.
 *
 * Source (ScummVM, GPL v3+) : `PausedCharacter`, `PausedCharacterList::reset`, `countdown`, `scan`, `check` (engines/lure/res_struct.cpp).
 *
 * Écart : la liste est un tableau de numéros dans l'état (`LureState.pausedList`) ; ScummVM garde un pointeur vers les données du
 * personnage attendu (`charHotspot`), retrouvé ici par son numéro.
 */

import type { LureContext } from "./context";
import type { Hotspot } from "./hotspot";
import { BlockedState, CharacterMode, CurrentAction, HotspotId, IDLE_COUNTDOWN_SIZE } from "./ids";

/** `PausedCharacter`. */
export interface PausedCharacter {
  srcCharId: number;
  destCharId: number;
  counter: number;
}

/** `reset(hotspotId)` : les attentes de ce personnage finissent à la prochaine image. */
export function resetPaused(ctx: LureContext, hotspotId: number): void {
  for (const rec of ctx.world.state.pausedList) {
    if (rec.srcCharId !== hotspotId) continue;
    rec.counter = 1;
    if (rec.destCharId < HotspotId.START_EXIT) ctx.world.requireHotspot(rec.destCharId).pauseCtr = 1;
  }
}

/** `countdown()` : une image de moins pour chaque attente ; le personnage attendu garde `pauseCtr = compteur + 1`. */
export function countdownPaused(ctx: LureContext): void {
  const state = ctx.world.state;
  state.pausedList = state.pausedList.filter((rec) => {
    rec.counter--;
    if (rec.destCharId < HotspotId.START_EXIT) ctx.world.requireHotspot(rec.destCharId).pauseCtr = rec.counter + 1;
    return rec.counter !== 0;
  });
}

/** `scan(h)` : un personnage bloqué qui cherche encore son chemin prolonge ses attentes. */
export function scanPaused(ctx: LureContext, h: Hotspot): void {
  if (h.blockedState === BlockedState.NONE) return;
  for (const rec of ctx.world.state.pausedList) {
    if (rec.srcCharId !== h.hotspotId) continue;
    rec.counter = IDLE_COUNTDOWN_SIZE;
    if (rec.destCharId < HotspotId.START_EXIT) ctx.world.requireHotspot(rec.destCharId).pauseCtr = IDLE_COUNTDOWN_SIZE;
  }
}

/**
 * `check(charId, impinging)` : 0 si le personnage peut avancer ; 1 s'il heurte le joueur qui ne couvre pas sa case ; 2 s'il a heurté un
 * nouveau personnage (attente notée, l'autre s'arrête, destination au hasard pour s'écarter).
 */
export function checkPaused(ctx: LureContext, charId: number, impinging: readonly number[]): number {
  const world = ctx.world;
  const charHotspot = world.requireActiveHotspot(charId);
  let result = 0;
  for (const id of impinging) {
    const hotspot = world.getActiveHotspot(id);
    if (!hotspot || (!hotspot.currentActions.isEmpty() && hotspot.currentActions.top().action === CurrentAction.EXEC_HOTSPOT_SCRIPT)) continue;
    // Le hotspot vers lequel on marche exprès n'est pas un obstacle.
    if (charHotspot.walkToHotspotId === hotspot.hotspotId) continue;
    if (world.state.pausedList.some((rec) => rec.srcCharId === charId && rec.destCharId === hotspot.hotspotId)) continue;

    if (hotspot.hotspotId === HotspotId.PLAYER && !hotspot.coveredFlag) {
      hotspot.updateMovement();
      return 1;
    }

    world.requireHotspot(hotspot.hotspotId);
    world.state.pausedList.push({ srcCharId: charId, destCharId: hotspot.hotspotId, counter: IDLE_COUNTDOWN_SIZE });
    charHotspot.blockedState = BlockedState.INITIAL;

    if (hotspot.hotspotId < HotspotId.START_EXIT) {
      if (
        charHotspot.characterMode === CharacterMode.PAUSED ||
        (charHotspot.pauseCtr === 0 && charHotspot.characterMode === CharacterMode.NONE)
      ) {
        if (hotspot.characterMode !== CharacterMode.WAIT_FOR_INTERACT) hotspot.res.scriptHotspotId = charId;
      }
      hotspot.pauseCtr = IDLE_COUNTDOWN_SIZE;
    }

    if (result === 0) charHotspot.setRandomDest();
    result = 2;
  }
  return result;
}
