import type { DatPoint, DatRoomAction } from "../data/dat";
import { type GameState, INVENTORY_SIZE, OBJ_HEIGHT, OBJ_WIDTH, Verb } from "./state";

/**
 * Verbes, réponses par défaut et inventaire : `roomParse` et `room_0` (engines/drascula/rooms.cpp), `selectVerb` et
 * `selectVerbFromBar` (interface.cpp), `chooseObject`, `addObject`, `removeObject`, `whichObject` (objects.cpp), ScummVM.
 * Fonctions pures sur l'état ; les gestionnaires qui parlent ou marchent sont des séquences, dans `loop.ts`.
 */

/** Pseudo-pièces de `roomActions` : 0 (réponses par défaut), 200 (objets de l'inventaire), 201 (objets de toutes les pièces). */
export const DEFAULT_ROOM = 0;
export const INVENTORY_ROOM = 200;
export const ANY_ROOM = 201;

/**
 * Ligne de `roomActions` qui répond au verbe ou à l'objet `picked` sur l'objet `objectId` (`roomParse`). Les lignes d'une
 * pièce se suivent dans la table : la recherche s'arrête à la première ligne d'une autre pièce après celles de `room`. Une ligne
 * de chapitre -1 vaut pour tous les chapitres, un verbe -1 (`kVerbDefault`) pour tous les verbes, un objet -1 pour tous les objets.
 */
export function findRoomAction(
  actions: readonly DatRoomAction[],
  room: number,
  chapter: number,
  picked: number,
  objectId: number,
): DatRoomAction | null {
  let seen = false;
  for (const action of actions) {
    if (action.room === room) {
      seen = true;
      if (
        (action.chapter === chapter || action.chapter === -1) &&
        (action.action === picked || action.action === Verb.Default) &&
        (action.objectId === objectId || action.objectId === -1)
      ) {
        return action;
      }
    } else if (seen) {
      break;
    }
  }
  return null;
}

/** Excuses de `room_0` quand rien ne répond : regarder, puis les autres verbes (numéros de répliques de `text`). */
const LOOK_EXCUSES = [100, 101, 54] as const;
const ACTION_EXCUSES = [11, 109, 111, 110, 115, 116] as const;

/**
 * Réplique d'excuse de `room_0` (chapitres 2, 4, 5 et 6 ; `null` aux chapitres 1 et 3, couverts par `roomActions`), en
 * faisant tourner les excuses.
 */
export function nextExcuse(state: GameState): number | null {
  if (state.chapter !== 2 && state.chapter < 4) return null;
  if (state.pickedObject === Verb.Look) {
    const speech = LOOK_EXCUSES[state.excuseLook];
    state.excuseLook = (state.excuseLook + 1) % LOOK_EXCUSES.length;
    return speech;
  }
  const speech = ACTION_EXCUSES[state.excuseAction];
  state.excuseAction = (state.excuseAction + 1) % ACTION_EXCUSES.length;
  return speech;
}

/** Ajoute un objet dans la première case libre, sauf s'il y est déjà (`addObject`). Lève si l'inventaire est plein. */
export function addObject(state: GameState, object: number): void {
  if (state.inventory.indexOf(object, 1) > 0) return;
  for (let slot = 1; slot < INVENTORY_SIZE; slot++) {
    if (state.inventory[slot] === 0) {
      state.inventory[slot] = object;
      return;
    }
  }
  throw new Error(`inventaire plein : impossible d'ajouter l'objet ${object}`);
}

/** Retire un objet de l'inventaire (`removeObject(obj)`) ; rend faux s'il n'y était pas. */
export function removeObject(state: GameState, object: number): boolean {
  const slot = state.inventory.indexOf(object, 1);
  if (slot < 1) return false;
  state.inventory[slot] = 0;
  return true;
}

export function hasObject(state: GameState, object: number): boolean {
  return state.inventory.indexOf(object, 1) > 0;
}

/** Case de l'inventaire sous le point (`whichObject`), 0 s'il n'y en a pas ; `locations` : `itemLocations` de `drascula.dat`. */
export function inventorySlotAt(locations: readonly DatPoint[], x: number, y: number): number {
  for (let slot = 1; slot < INVENTORY_SIZE; slot++) {
    const at = locations[slot];
    if (at && x > at.x && y > at.y && x < at.x + OBJ_WIDTH && y < at.y + OBJ_HEIGHT) return slot;
  }
  return 0;
}

/**
 * Remet dans l'inventaire l'objet tenu en main (`chooseObject` et `selectVerb`) : au chapitre 5, la prise (objet 16) ne
 * revient pas d'elle-même. `checkMenu` : `chooseObject` ne le fait que hors de l'écran d'inventaire.
 */
function returnHeldObject(state: GameState, checkMenu: boolean): void {
  if (!state.takeObject || (checkMenu && state.menuScreen)) return;
  if (state.chapter === 5 && state.pickedObject === 16) return;
  addObject(state, state.pickedObject);
}

/** Met un objet en main (`chooseObject`) ; le curseur prend son image (vague R). */
export function chooseObject(state: GameState, object: number): void {
  returnHeldObject(state, true);
  state.takeObject = true;
  state.pickedObject = object;
}

/** Choisit un verbe (`selectVerb`) : l'objet tenu retourne dans l'inventaire ; `Verb.None` vide le curseur. */
export function selectVerb(state: GameState, verb: number): void {
  returnHeldObject(state, false);
  if (verb > 0) {
    state.takeObject = true;
    state.pickedObject = verb;
  } else {
    state.takeObject = false;
    state.hasName = false;
  }
}

/** Verbe de la barre sous l'abscisse `x` (`selectVerbFromBar`), `Verb.None` hors des icônes ou sur « marcher » (icône 0). */
export function verbAtBar(verbBarX: readonly number[], x: number): number {
  for (let n = 1; n < 7; n++) {
    if (x > verbBarX[n] && x < verbBarX[n + 1]) return n;
  }
  return Verb.None;
}
