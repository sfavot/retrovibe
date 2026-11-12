/**
 * Groupe L1 : méthodes natives génériques (hotspots, sons, séquences différées, messages et boîtes, inventaire, groats, portes,
 * emplois du temps, hasard), portées en G1 parce que les autres groupes en dépendent (`docs/lure/engine.md`, § 8).
 *
 * Source (ScummVM, GPL v3+) : `Script::activateHotspot`, `setHotspotScript`, `addSound2`, `setHotspotFlagMask`, `clearSequenceDelayList`,
 * `deactivateHotspotSet`, `deactivateHotspot`, `resetPathfinder`, `addDelayedSequence`, `killSound`, `characterInRoom`, `setDesc`,
 * `setHotspotName`, `addSound`, `displayDialog`, `startSpeakingToNoone`, `stopSound`, `getDoorBlocked`, `characterChangeRoom`,
 * `decrInventoryItems`, `setTalking`, `setActionCtr`, `startSpeaking`, `disableHotspot`, `increaseNumGroats`, `enableHotspot`,
 * `displayMessage2`, `checkRoomNumber`, `doorClose`, `doorOpen`, `npcWait`, `displayMessage`, `setNewSupportData`, `setSupportData`,
 * `givePlayerItem`, `decreaseNumGroats`, `moveCharacterToPlayer`, `getNumGroats`, `animationLoad`, `addActions`, `randomToGeneral`,
 * `checkSound`, et, ajoutées au groupe en G1 parce que plusieurs zones s'en servent, `remoteRoomViewSetup` (la fissure de la cellule,
 * pièces 3 et 19), `setBlockingHotspotScript` (pièces 4, 28, 48) et `killPlayer` (dialogue de Goewin) (engines/lure/scripts.cpp) ; `roomTranslations` est
 * dans `exits.ts`.
 *
 * Écarts : aucun. La liste `dealloc_list_2` de ScummVM contient deux fois `0x272E` (et pas `0x272D`) : gardée telle quelle.
 */

import type { LureContext } from "../../context";
import { CharacterMode, CurrentAction, CursorState, Field, GameState, HotspotId, TickProc } from "../../ids";
import { ROOM_TRANSLATIONS } from "../../exits";
import { characterChangeRoom } from "../../support";
import type { MethodGroupTable } from "../index";

const DEALLOC_LIST_1 = [0x13f2, 0x418, 0x2711, 0x2712, 0x40d, 0x3ea, 0x411];
const DEALLOC_LIST_2 = [0x2729, 0x272a, 0x272b, 0x272c, 0x272e, 0x272e, 0x272f];
const DEALLOC_LIST_3 = [
  0x3ef, 0x3e9, 0x3eb, 0x3ec, 0x3ed, 0x3ee, 0x3f0, 0x3f1, 0x420, 0x429, 0x436, 0x2715, 0x2716, 0x2717, 0x2718, 0x2719, 0x271a, 0x271e, 0x271f,
  0x2720, 0x2721, 0x2722, 0x2725, 0x2726,
];
/** `hotspot_dealloc_set` : la troisième liste est la quatrième sans son premier élément. */
const HOTSPOT_DEALLOC_SET = [DEALLOC_LIST_1, DEALLOC_LIST_2, DEALLOC_LIST_3.slice(1), DEALLOC_LIST_3];

function scheduleSupport(ctx: LureContext, dataId: number) {
  const id = ctx.schedules.resolve(dataId);
  return id === null ? null : ({ kind: "schedule", id } as const);
}

/** 0 `activateHotspot`. */
function activateHotspot(ctx: LureContext, hotspotId: number): void {
  ctx.world.activateHotspot(hotspotId);
}

/** 1 `setHotspotScript` : script d'animation pris dans la table `0x3F0E`. */
function setHotspotScript(ctx: LureContext, hotspotId: number, scriptIndex: number): void {
  const offset = ctx.world.getHotspotScript(scriptIndex);
  const hotspot = ctx.world.getActiveHotspot(hotspotId);
  if (hotspot) hotspot.setHotspotScript(offset);
  else ctx.world.requireHotspot(hotspotId).hotspotScriptOffset = offset;
}

/** 5 `deactivateHotspotSet`. */
function deactivateHotspotSet(ctx: LureContext, listIndex: number): void {
  const list = HOTSPOT_DEALLOC_SET[listIndex];
  if (!list) throw new Error("deactivateHotspotSet : liste invalide");
  for (const id of list) ctx.world.deactivateHotspot(id);
}

/** 6 `deactivateHotspot` : hors de toute pièce (`0xFFFF`), désactivé dans les menus (`0x20`). */
function deactivateHotspot(ctx: LureContext, hotspotId: number): void {
  if (hotspotId < HotspotId.START_NONVISUAL) ctx.world.deactivateHotspot(hotspotId);
  const hs = ctx.world.requireHotspot(hotspotId);
  hs.roomNumber = 0xffff;
  hs.flags |= 0x20;
  if (hotspotId < HotspotId.START_NONVISUAL) hs.layer = 0xff;
}

/** 10 `characterInRoom` : `GENERAL` = 1 si le personnage est dans la pièce. */
function characterInRoom(ctx: LureContext, characterId: number, roomNumber: number): void {
  let result = 0;
  if (characterId >= HotspotId.PLAYER && ctx.world.requireHotspot(characterId).roomNumber === roomNumber) result = 1;
  ctx.world.fields.set(Field.GENERAL, result);
}

/** 25 `characterChangeRoom(y, x, room)` : le personnage du tick en cours change de pièce ; l'octet haut de `room` est la direction. */
function characterChangeRoomMethod(ctx: LureContext, y: number, x: number, roomNumber: number): void {
  const character = ctx.world.requireActiveHotspot(ctx.world.fields.get(Field.CHARACTER_HOTSPOT_ID));
  characterChangeRoom(ctx, character, roomNumber & 0xff, ((x - 0x80) << 16) >> 16, ((y - 0x80) << 16) >> 16, roomNumber >> 8);
}

/** 18 `remoteRoomViewSetup` : le joueur ne bouge plus (gestionnaire nul) ; sa pièce est retenue pour le retour (`OLD_ROOM_NUMBER`). */
function remoteRoomViewSetup(ctx: LureContext): void {
  const player = ctx.world.requireActiveHotspot(HotspotId.PLAYER);
  player.setTickProc(TickProc.NULL);
  ctx.world.fields.set(Field.OLD_ROOM_NUMBER, player.roomNumber);
}

/** 27 `setBlockingHotspotScript` : le personnage joue un script d'animation (action `EXEC_HOTSPOT_SCRIPT`) ; le joueur ne répond plus. */
function setBlockingHotspotScript(ctx: LureContext, charId: number, scriptIndex: number): void {
  const offset = ctx.world.getHotspotScript(scriptIndex);
  if (charId === HotspotId.PLAYER) ctx.room.cursorState = CursorState.SEQUENCE;
  const h = ctx.world.requireActiveHotspot(charId);
  h.setHotspotScript(offset);
  h.currentActions.top().action = CurrentAction.EXEC_HOTSPOT_SCRIPT;
  h.setOccupied(true);
}

/** 49 `setSupportData` : remplace l'action en tête de pile (contournement de ScummVM pour le Skorl de la pièce 45). */
function setSupportData(ctx: LureContext, hotspotId: number, index: number): void {
  if (index === HotspotId.CASTLE_SKORL) return;
  const support = scheduleSupport(ctx, ctx.world.getCharOffset(index));
  if (!support) throw new Error("setSupportData : entrée absente");
  const h = ctx.world.requireActiveHotspot(hotspotId);
  if (h.currentActions.isEmpty()) throw new Error("setSupportData : pile vide");
  h.currentActions.pop();
  h.currentActions.addFront(CurrentAction.DISPATCH_ACTION, h.roomNumber, support);
}

/** 53 `moveCharacterToPlayer`. */
function moveCharacterToPlayer(ctx: LureContext, characterId: number): void {
  const player = ctx.world.requireActiveHotspot(HotspotId.PLAYER);
  const character = ctx.world.requireActiveHotspot(characterId);
  const actions = character.currentActions;
  if (!actions.isEmpty() && actions.top().roomNumber === player.roomNumber) return;
  let destRoom = player.roomNumber;
  const translation = ROOM_TRANSLATIONS.find(([src]) => src === destRoom);
  if (translation) destRoom = translation[1];
  if (actions.isEmpty()) actions.addFront(CurrentAction.DISPATCH_ACTION, destRoom);
  else actions.top().roomNumber = destRoom;
}

export const GROUP_1_METHODS: MethodGroupTable = {
  0: activateHotspot,
  1: setHotspotScript,
  2: (ctx, soundIndex) => ctx.sound.addSound2(soundIndex),
  3: (ctx, maskVal) => {
    ctx.world.fields.hdrFlagMask = maskVal & 0xff;
  },
  4: (ctx) => ctx.delays.clear(true),
  5: deactivateHotspotSet,
  6: deactivateHotspot,
  7: (ctx) => {
    for (const h of ctx.world.characters()) ctx.movement.clearPath(h);
  },
  8: (ctx, seqOffset, delay, canClear) => ctx.delays.add(delay, seqOffset, canClear !== 0),
  9: (ctx, soundNumber) => ctx.sound.killSound(soundNumber),
  10: characterInRoom,
  11: (ctx, hotspotId, descId) => {
    ctx.world.requireHotspot(hotspotId).descId = descId;
  },
  12: (ctx, hotspotId, nameId) => {
    ctx.world.requireHotspot(hotspotId).nameId = nameId;
  },
  13: (ctx, soundIndex) => ctx.sound.addSound(soundIndex),
  16: (ctx, stringId) => ctx.showDialog(stringId),
  18: remoteRoomViewSetup,
  19: (ctx, characterId, stringId) => ctx.world.requireActiveHotspot(characterId).converse(HotspotId.NOONE, stringId, true),
  21: (ctx, soundIndex) => ctx.sound.stopSound(soundIndex),
  22: (ctx, hotspotId) => {
    const join = ctx.world.getExitJoin(hotspotId);
    if (!join) throw new Error(`getDoorBlocked : ${hotspotId.toString(16)} n'est pas une porte`);
    ctx.world.fields.set(Field.GENERAL, join.blocked);
  },
  25: characterChangeRoomMethod,
  27: setBlockingHotspotScript,
  28: () => {},
  29: (ctx, characterId, destHotspot, messageId) => ctx.world.getActiveHotspot(characterId)?.converse(destHotspot, messageId, true, false),
  30: (ctx, hotspotId, value) => {
    ctx.world.requireHotspot(hotspotId).actionCtr = value & 0xff;
  },
  31: (ctx, characterId, destHotspot, messageId) => ctx.world.requireActiveHotspot(characterId).converse(destHotspot, messageId, false, false),
  32: (ctx, hotspotId) => {
    ctx.world.requireHotspot(hotspotId).flags |= 0x20;
  },
  34: (ctx, _v1, numGroats) => {
    ctx.world.fields.numGroats = (ctx.world.fields.numGroats + numGroats) & 0xffff;
  },
  35: (ctx, hotspotId) => {
    const h = ctx.world.requireHotspot(hotspotId);
    h.flags = (h.flags & 0xdf) | 0x80;
  },
  36: (ctx, messageId, hotspotId) => ctx.world.requireActiveHotspot(hotspotId).showMessage(messageId),
  40: (ctx, hotspotId, roomNumber) => {
    const result = ctx.world.requireHotspot(hotspotId).roomNumber === roomNumber ? 1 : 0;
    ctx.world.fields.set(Field.SEQUENCE_RESULT, result);
  },
  42: (ctx, hotspotId) => {
    const join = ctx.world.getExitJoin(hotspotId);
    if (!join) throw new Error("doorClose : ce n'est pas une porte");
    join.blocked = 1;
  },
  44: (ctx, hotspotId) => {
    const join = ctx.world.getExitJoin(hotspotId);
    if (!join) throw new Error("doorOpen : ce n'est pas une porte");
    join.blocked = 0;
  },
  45: (ctx, hotspotId) => {
    const h = ctx.world.requireActiveHotspot(hotspotId);
    h.characterMode = CharacterMode.WAIT_FOR_INTERACT;
    h.delayCtr = 130;
  },
  47: (ctx, messageId, characterId, destCharacterId) => ctx.world.getActiveHotspot(characterId)?.showMessage(messageId, destCharacterId),
  48: (ctx, index, hotspotId) => {
    const support = scheduleSupport(ctx, ctx.world.getCharOffset(index));
    const h = ctx.world.requireActiveHotspot(hotspotId);
    h.blockedFlag = false;
    h.currentActions.addFront(CurrentAction.DISPATCH_ACTION, h.roomNumber, support);
    h.actionCtr = 0;
  },
  49: setSupportData,
  50: (ctx, hotspotId) => {
    const h = ctx.world.requireHotspot(hotspotId);
    h.roomNumber = HotspotId.PLAYER;
    h.flags |= 0x80;
  },
  51: (ctx, _characterId, numGroats) => {
    ctx.world.fields.numGroats = (ctx.world.fields.numGroats - numGroats) & 0xffff;
  },
  53: moveCharacterToPlayer,
  57: (ctx) => ctx.world.fields.set(Field.GENERAL, ctx.world.fields.numGroats),
  61: (ctx) => {
    ctx.gameState = GameState.RESTORE_RESTART;
  },
  62: (ctx, hotspotId) => {
    ctx.world.addHotspot(hotspotId);
  },
  63: (ctx, hotspotId, actions) => {
    const h = ctx.world.requireHotspot(hotspotId);
    h.actions = (h.actions | actions) >>> 0;
  },
  64: (ctx, maxVal, minVal) => {
    const v = minVal + ctx.rng.number((maxVal - minVal) >>> 0);
    ctx.world.fields.set(Field.GENERAL, v);
  },
  66: (ctx, soundNumber) => ctx.world.fields.set(Field.GENERAL, ctx.sound.isSoundActive(soundNumber) ? 1 : 0),
};
