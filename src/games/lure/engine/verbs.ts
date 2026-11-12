/**
 * Verbes et actions d'emploi du temps d'un personnage (`Hotspot::doAction` et les `do*`, `npc*`) : ce que fait Diermot (ou un PNJ) quand
 * l'action en tête de sa pile est exécutée. Chaque verbe vérifie le hotspot visé (`actionPrecheck` : présence, marche jusqu'à lui),
 * oriente le personnage, cherche la séquence du verbe dans la liste d'actions du hotspot (`0x3F10`) et l'exécute ; une valeur `>= 0x8000`
 * est un message, une valeur rendue par la séquence aussi.
 *
 * Source (ScummVM, GPL v3+) : `Hotspot::doAction`, `doNothing`, `doGet`, `doOperate`, `doOpen`, `doClose`, `doUse`, `doGive`,
 * `doTalkTo`, `doTell`, `doLook`, `doLookAt`, `doLookThrough`, `doLookAction`, `doAsk`, `doDrink`, `doStatus`, `doGoto`, `doReturn`,
 * `doBribe`, `doExamine`, `doLockUnlock`, `npc*`, `getTalkId`, `startTalk` (engines/lure/hotspots.cpp).
 *
 * Écarts volontaires : la boîte de statut est une boîte de texte (`ctx.showDialogText(texte, true)`, centrée en hauteur comme ScummVM) ; « (nothing) » d'autres verbes est dans `game.ts`.
 */

import { Action, UiString } from "../data/ids";
import type { LureContext } from "./context";
import type { Hotspot } from "./hotspot";
import { CharacterMode, CurrentAction, Field, HotspotId, IDLE_COUNTDOWN_SIZE, Precheck, RoomNum, SupportId, TickProc } from "./ids";
import { resetPaused } from "./paused-list";
import { giveTellOrders } from "./tell";
import type { HotspotState, Support } from "./state";

/** Identifiants de noms des « étrangers » en français (`getTalkId`, version non anglaise). */
const STRANGER_NAME_IDS = new Set([381, 382]);

/** Hotspots regardés sans y marcher (`hotspotLookAtList`). */
const LOOK_AT_WITHOUT_WALK = new Set([0x411, 0x412, 0x41f, 0x420, 0x421, 0x422, 0x426, 0x427, 0x428, 0x429, 0x436, 0x437]);

/** Séquences de « Corromps » propres à certains personnages (`bribe_hotspot_list`) : personnage, séquence. */
const BRIBE_LIST: ReadonlyArray<readonly [number, number]> = [
  [0x421, 0x879],
  [0x3e9, 0x8c7],
  [0x429, 0x8d1],
  [0x422, 0x8d4],
  [0x420, 0x8d6],
  [0x42b, 0x956],
  [0x3f2, 0xbe6],
];

/** `doAction()` : action de la donnée en tête de pile (pour « Utilise », le hotspot visé est le second paramètre). */
export function doActionTop(ctx: LureContext, h: Hotspot): void {
  const entry = h.currentActions.top();
  const support = entry.support;
  if (!support || ctx.schedules.action(support) === Action.NONE) {
    doAction(ctx, h, Action.NONE, null);
    return;
  }
  const action = ctx.schedules.action(support);
  const params = ctx.schedules.params(support);
  const hotspot = params.length > 0 ? (ctx.world.hotspot(ctx.schedules.param(support, action === Action.USE ? 1 : 0)) ?? null) : null;
  doAction(ctx, h, action, hotspot);
}

function topSupport(h: Hotspot): Support {
  const support = h.currentActions.top().support;
  if (!support) throw new Error("action sans donnée d'emploi du temps");
  return support;
}

function topParam(ctx: LureContext, h: Hotspot, index: number): number {
  return ctx.schedules.param(topSupport(h), index);
}

function need(hotspot: HotspotState | null, action: number): HotspotState {
  if (!hotspot) throw new Error(`action ${action} sans hotspot`);
  return hotspot;
}

/** `doAction(action, hotspot)` : renseigne `ACTIVE_HOTSPOT_ID` / `USE_HOTSPOT_ID` et appelle le verbe. */
export function doAction(ctx: LureContext, h: Hotspot, action: number, hotspot: HotspotState | null): void {
  const fields = ctx.world.fields;
  if (hotspot) {
    fields.set(Field.ACTIVE_HOTSPOT_ID, hotspot.hotspotId);
    if (action === Action.USE) fields.set(Field.USE_HOTSPOT_ID, topParam(ctx, h, 0));
    else if (action === Action.GIVE || action === Action.ASK) fields.set(Field.USE_HOTSPOT_ID, topParam(ctx, h, 1));
    else fields.set(Field.USE_HOTSPOT_ID, hotspot.hotspotId);
  }

  switch (action) {
    case Action.GET:
      return doGet(ctx, h, need(hotspot, action));
    case Action.PUSH:
    case Action.PULL:
    case Action.OPERATE:
      return doOperate(ctx, h, need(hotspot, action));
    case Action.OPEN:
      return doOpen(ctx, h, need(hotspot, action));
    case Action.CLOSE:
      return doClose(ctx, h, need(hotspot, action));
    case Action.LOCK:
    case Action.UNLOCK:
      return doLockUnlock(ctx, h, need(hotspot, action));
    case Action.USE:
      return doUse(ctx, h, need(hotspot, action));
    case Action.GIVE:
      return doGive(ctx, h, need(hotspot, action));
    case Action.TALK_TO:
      return doTalkTo(ctx, h, need(hotspot, action));
    case Action.TELL:
      return doTell(ctx, h, need(hotspot, action));
    case Action.LOOK:
      return doLook(ctx, h);
    case Action.LOOK_AT:
    case Action.LOOK_THROUGH:
      return doLookAction(ctx, h, need(hotspot, action), action);
    case Action.ASK:
      return doAsk(ctx, h, need(hotspot, action));
    case Action.DRINK:
      return doDrink(ctx, h, need(hotspot, action));
    case Action.STATUS:
      return doStatus(ctx, h);
    case Action.GO_TO:
      return doGoto(ctx, h);
    case Action.RETURN:
      return doReturn(h);
    case Action.BRIBE:
      return doBribe(ctx, h, need(hotspot, action));
    case Action.EXAMINE:
      return doExamine(ctx, h, need(hotspot, action));
    case Action.NPC_SET_ROOM_AND_OFFSET:
      return npcSetRoomAndBlockedOffset(ctx, h);
    case Action.NPC_TALK_TO_PLAYER:
      return npcHeySir(ctx, h);
    case Action.NPC_EXEC_SCRIPT:
      return npcExecScript(ctx, h);
    case Action.NPC_RESET_PAUSED_LIST:
      return npcResetPausedList(ctx, h);
    case Action.NPC_SET_RAND_DEST:
      h.endAction();
      h.setRandomDest();
      return;
    case Action.NPC_WALKING_CHECK:
      return npcWalkingCheck(ctx, h, hotspot);
    case Action.NPC_SET_SUPPORT_OFFSET:
      return npcSetSupportOffset(ctx, h);
    case Action.NPC_SUPPORT_OFFSET_COND:
      return npcSupportOffsetConditional(ctx, h);
    case Action.NPC_DISPATCH_ACTION:
      return npcDispatchAction(ctx, h, need(hotspot, action));
    case Action.NPC_TALK_NPC_TO_NPC:
      return npcTalkNpcToNpc(ctx, h, need(hotspot, action));
    case Action.NPC_PAUSE: {
      const delay = topParam(ctx, h, 0);
      h.endAction();
      h.characterMode = CharacterMode.PAUSED;
      h.delayCtr = delay;
      return;
    }
    case Action.NPC_START_TALKING: {
      const stringId = topParam(ctx, h, 0);
      const dest = topParam(ctx, h, 1);
      h.converse(dest, stringId, false);
      h.endAction();
      return;
    }
    case Action.NPC_JUMP_ADDRESS:
      return npcJumpAddress(ctx, h);
    default:
      h.doNothing();
  }
}

/** Fin commune des verbes : `PC_WAIT` laisse l'action en place, un autre échec la termine. */
function precheck(h: Hotspot, hotspot: HotspotState): boolean {
  const result = h.actionPrecheck(hotspot);
  if (result === Precheck.WAIT) return false;
  if (result !== Precheck.EXECUTE) {
    h.endAction();
    return false;
  }
  return true;
}

function doGet(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  if (!precheck(h, hotspot)) return;
  h.faceHotspot(hotspot);
  h.endAction();
  const sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, Action.GET);
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
    return;
  }
  if (sequenceOffset !== 0) {
    const result = ctx.script.execute(sequenceOffset);
    if (result === 1) return;
    if (result !== 0) {
      h.showMessage(result);
      return;
    }
  }
  hotspot.roomNumber = h.hotspotId;
  if (hotspot.hotspotId < HotspotId.START_NONVISUAL) {
    ctx.world.deactivateHotspot(hotspot.hotspotId);
    hotspot.descId2 = 0;
  }
}

function doOperate(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const action = ctx.schedules.action(topSupport(h));
  if (!precheck(h, hotspot)) return;
  h.actionCtr = 0;
  h.faceHotspot(hotspot);
  h.endAction();
  let sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, action);
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
  } else {
    sequenceOffset = ctx.script.execute(sequenceOffset);
    if (sequenceOffset > 1) h.showMessage(sequenceOffset);
  }
}

function doOpen(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const world = ctx.world;
  if (h.isRoomExit(hotspot.hotspotId)) {
    const join = world.getExitJoin(hotspot.hotspotId);
    if (join && !join.blocked) {
      h.showMessage(4);
      h.endAction();
      return;
    }
  }
  if (!precheck(h, hotspot)) return;
  h.faceHotspot(hotspot);
  h.actionCtr = 0;
  h.endAction();
  let sequenceOffset = world.getHotspotAction(hotspot.actionsOffset, Action.OPEN);
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
    return;
  }
  if (sequenceOffset !== 0) {
    sequenceOffset = ctx.script.execute(sequenceOffset);
    if (sequenceOffset === 1) return;
    if (sequenceOffset !== 0) {
      if (h.exitCtr !== 0) h.exitCtr = 4;
      h.showMessage(sequenceOffset);
      return;
    }
  }
  const join = world.getExitJoin(hotspot.hotspotId);
  if (!join) throw new Error(`« Ouvre » sur ${hotspot.hotspotId.toString(16)} qui n'est pas une porte`);
  if (join.blocked) {
    join.blocked = 0;
    if (h.hotspotId !== HotspotId.PLAYER) {
      h.characterMode = CharacterMode.PAUSED;
      h.delayCtr = 4;
    }
  }
}

function doClose(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const world = ctx.world;
  if (h.isRoomExit(hotspot.hotspotId)) {
    const join = world.getExitJoin(hotspot.hotspotId);
    if (join && join.blocked) {
      h.showMessage(3);
      h.endAction();
      return;
    }
  }
  if (!precheck(h, hotspot)) return;
  h.faceHotspot(hotspot);
  h.actionCtr = 0;
  h.endAction();
  let sequenceOffset = world.getHotspotAction(hotspot.actionsOffset, Action.CLOSE);
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
    return;
  }
  if (sequenceOffset !== 0) {
    sequenceOffset = ctx.script.execute(sequenceOffset);
    if (sequenceOffset !== 0) {
      h.showMessage(sequenceOffset);
      return;
    }
  }
  const join = world.getExitJoin(hotspot.hotspotId);
  if (!join) throw new Error(`« Ferme » sur ${hotspot.hotspotId.toString(16)} qui n'est pas une porte`);
  if (!join.blocked) {
    if (!h.doorCloseCheck(join.hotspots[0].hotspotId) || !h.doorCloseCheck(join.hotspots[1].hotspotId)) h.showMessage(2);
    else join.blocked = 1;
  }
}

function doUse(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const usedId = topParam(ctx, h, 0);
  const used = ctx.world.requireHotspot(usedId);
  h.res.useHotspotId = usedId;
  if (used.roomNumber !== h.hotspotId) {
    h.endAction();
    h.showMessage(0xf);
    return;
  }
  if (!precheck(h, hotspot)) return;
  h.faceHotspot(hotspot);
  h.endAction();
  if (h.hotspotId === HotspotId.RATPOUCH) {
    h.tempDest.x = 40;
    h.frameCtr = 80;
  }
  let sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, Action.USE);
  if (sequenceOffset >= 0x8000) h.showMessage(sequenceOffset);
  else if (sequenceOffset === 0) h.showMessage(17);
  else {
    sequenceOffset = ctx.script.execute(sequenceOffset);
    if (sequenceOffset !== 0) h.showMessage(sequenceOffset);
  }
}

function doGive(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const world = ctx.world;
  const usedId = topParam(ctx, h, 1);
  const used = world.requireHotspot(usedId);
  h.res.useHotspotId = usedId;
  if (used.roomNumber !== h.hotspotId) {
    h.endAction();
    h.showMessage(0xf);
    return;
  }
  if (!precheck(h, hotspot)) return;
  h.faceHotspot(hotspot);
  h.endAction();
  if (hotspot.hotspotId !== HotspotId.PRISONER || usedId !== HotspotId.BOTTLE) h.showMessage(7, hotspot.hotspotId);

  let sequenceOffset = world.getHotspotAction(hotspot.actionsOffset, Action.GIVE);
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
  } else if (sequenceOffset !== 0) {
    sequenceOffset = ctx.script.execute(sequenceOffset);
    if (sequenceOffset === HotspotId.NOONE) {
      const index = world.fields.get(Field.GIVE_TALK_INDEX);
      startTalk(ctx, h, hotspot, world.getGiveTalkId(index));
    } else if (sequenceOffset === 0) {
      used.roomNumber = hotspot.hotspotId;
    } else if (sequenceOffset > 1) {
      world.getActiveHotspot(hotspot.hotspotId)?.showMessage(sequenceOffset, h.hotspotId);
    }
  }
}

function doTalkTo(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const fields = ctx.world.fields;
  fields.set(Field.ACTIVE_HOTSPOT_ID, hotspot.hotspotId);
  fields.set(Field.USE_HOTSPOT_ID, hotspot.hotspotId);
  if (hotspot.hotspotId !== HotspotId.SKORL && (hotspot.roomNumber !== 28 || hotspot.hotspotId !== HotspotId.BLACKSMITH)) {
    if (!precheck(h, hotspot)) return;
  }
  h.faceHotspot(hotspot);
  h.endAction();
  // WORKAROUND de ScummVM : pas de conversation pendant une question en cours.
  if (h.res.talkDestCharacterId !== 0) return;

  const sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, Action.TALK_TO);
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
    return;
  }
  if (sequenceOffset !== 0) {
    const result = ctx.script.execute(sequenceOffset);
    if (result !== 0) {
      h.endAction();
      return;
    }
  }
  const talkId = getTalkId(ctx, hotspot);
  if (talkId === 0) return;
  startTalk(ctx, h, hotspot, talkId);
}

function doTell(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const world = ctx.world;
  world.fields.set(Field.ACTIVE_HOTSPOT_ID, hotspot.hotspotId);
  world.fields.set(Field.USE_HOTSPOT_ID, hotspot.hotspotId);
  const character = world.requireActiveHotspot(hotspot.hotspotId);
  if (!precheck(h, hotspot)) return;
  h.converse(hotspot.hotspotId, 0x7c, true, false);
  const sequenceOffset = world.getHotspotAction(hotspot.actionsOffset, Action.TELL);
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
  } else if (sequenceOffset !== 0) {
    const result = ctx.script.execute(sequenceOffset);
    if (result === 0) {
      giveTellOrders(character, ctx.schedules.params(topSupport(h)));
    }
  }
  h.endAction();
}

function doLook(ctx: LureContext, h: Hotspot): void {
  h.endAction();
  ctx.showDialog(ctx.room.descId);
}

function doLookAction(ctx: LureContext, h: Hotspot, hotspot: HotspotState, action: number): void {
  let sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, action);
  if (hotspot.hotspotId >= HotspotId.FIRST_NONCHARACTER && !LOOK_AT_WITHOUT_WALK.has(hotspot.hotspotId)) {
    if (!precheck(h, hotspot)) return;
  }
  h.faceHotspot(hotspot);
  h.actionCtr = 0;
  h.endAction();
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
    return;
  }
  if (sequenceOffset !== 0) sequenceOffset = ctx.script.execute(sequenceOffset);
  if (sequenceOffset === 0) ctx.showDialog(hotspot.descId2 !== 0 ? hotspot.descId2 : hotspot.descId);
}

function doAsk(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const world = ctx.world;
  const usedId = topParam(ctx, h, 1);
  const dest = world.getActiveHotspot(hotspot.hotspotId);
  const used = world.requireHotspot(usedId);
  h.res.useHotspotId = usedId;
  if (!precheck(h, hotspot)) return;
  h.faceHotspot(hotspot);
  h.endAction();
  h.showMessage(9, hotspot.hotspotId);
  let sequenceOffset = world.getHotspotAction(hotspot.actionsOffset, Action.ASK);
  if (sequenceOffset >= 0x8000) {
    dest?.showMessage(sequenceOffset, h.hotspotId);
  } else if (sequenceOffset !== 0) {
    sequenceOffset = ctx.script.execute(sequenceOffset);
    if (sequenceOffset === 0) {
      used.roomNumber = h.hotspotId;
      dest?.showMessage(32, h.hotspotId);
    } else if (sequenceOffset !== 1) {
      dest?.showMessage(sequenceOffset, h.hotspotId);
    }
  }
}

function doDrink(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const fields = ctx.world.fields;
  fields.set(Field.ACTIVE_HOTSPOT_ID, hotspot.hotspotId);
  fields.set(Field.USE_HOTSPOT_ID, hotspot.hotspotId);
  h.endAction();
  if (hotspot.roomNumber !== h.hotspotId) {
    h.showMessage(0xf);
    return;
  }
  const sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, Action.DRINK);
  if (sequenceOffset >= 0x8000) h.showMessage(sequenceOffset);
  else if (sequenceOffset === 0) h.showMessage(22);
  else {
    const result = ctx.script.execute(sequenceOffset);
    if (result === 0) hotspot.roomNumber = 0;
    else if (result !== 1) h.showMessage(result);
  }
}

/** Texte de la boîte de statut (`doStatus`) : pièce, objets portés, groats. */
export function statusText(ctx: LureContext): string {
  const ui = ctx.data.uiStrings;
  let buffer = ctx.text(ctx.room.roomNumber);
  buffer += "\n\n" + ui[UiString.YOU_ARE_CARRYING];
  let numItems = 0;
  for (const rec of ctx.world.state.hotspots) {
    if (rec.roomNumber !== HotspotId.PLAYER) continue;
    buffer += numItems++ === 0 ? ": " : ", ";
    buffer += ctx.text(rec.nameId);
  }
  if (numItems === 0) buffer += ui[UiString.INV_NOTHING];
  const groats = ctx.world.fields.numGroats;
  if (groats > 0) buffer += `\n\n${ui[UiString.YOU_HAVE]}${groats} ${ui[groats === 1 ? UiString.GROAT : UiString.GROATS]}`;
  return buffer;
}

function doStatus(ctx: LureContext, h: Hotspot): void {
  h.endAction();
  ctx.showDialogText(statusText(ctx), true);
}

function doGoto(ctx: LureContext, h: Hotspot): void {
  h.exitCtr = 0;
  h.blockedOffset = 0;
  const top = h.currentActions.top();
  top.roomNumber = topParam(ctx, h, 0);
  h.endAction();
}

function doReturn(h: Hotspot): void {
  h.currentActions.top().roomNumber = h.startRoomNumber;
  h.endAction();
}

function doBribe(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const fields = ctx.world.fields;
  fields.set(Field.ACTIVE_HOTSPOT_ID, hotspot.hotspotId);
  fields.set(Field.USE_HOTSPOT_ID, hotspot.hotspotId);
  if (!precheck(h, hotspot)) return;
  // Comme ScummVM : la séquence de la liste est cherchée par le numéro du personnage qui corrompt, et sa valeur est ensuite perdue.
  const entry = BRIBE_LIST.find(([id]) => id === h.hotspotId);
  if (entry && (entry[1] & 0x8000) !== 0) ctx.script.execute(entry[1] & 0x7fff);
  h.faceHotspot(hotspot);
  h.actionCtr = 0;
  h.endAction();
  let sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, Action.BRIBE);
  if (sequenceOffset !== 0) {
    sequenceOffset = ctx.script.execute(sequenceOffset);
    if (sequenceOffset !== 0) return;
  }
  h.showMessage(fields.get(Field.TALK_INDEX) === 6 ? 0x30 : 0x29);
}

function doExamine(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const fields = ctx.world.fields;
  fields.set(Field.ACTIVE_HOTSPOT_ID, hotspot.hotspotId);
  fields.set(Field.USE_HOTSPOT_ID, hotspot.hotspotId);
  h.endAction();
  let sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, Action.EXAMINE);
  if (sequenceOffset >= 0x8000) {
    h.showMessage(sequenceOffset);
    return;
  }
  if (sequenceOffset !== 0) sequenceOffset = ctx.script.execute(sequenceOffset);
  if (sequenceOffset === 0) ctx.showDialog(hotspot.descId);
}

function doLockUnlock(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const action = ctx.schedules.action(topSupport(h));
  const fields = ctx.world.fields;
  fields.set(Field.ACTIVE_HOTSPOT_ID, hotspot.hotspotId);
  fields.set(Field.USE_HOTSPOT_ID, hotspot.hotspotId);
  if (!precheck(h, hotspot)) return;
  h.faceHotspot(hotspot);
  h.endAction();
  const sequenceOffset = ctx.world.getHotspotAction(hotspot.actionsOffset, action);
  if (sequenceOffset >= 0x8000) h.showMessage(sequenceOffset);
  else if (sequenceOffset !== 0) ctx.script.execute(sequenceOffset);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Actions d'emploi du temps des PNJ
// ---------------------------------------------------------------------------------------------------------------------------------

function npcSetRoomAndBlockedOffset(ctx: LureContext, h: Hotspot): void {
  const support = topSupport(h);
  h.exitCtr = 0;
  h.blockedOffset = ctx.schedules.param(support, 1);
  h.currentActions.top().roomNumber = ctx.schedules.param(support, 0);
  h.endAction();
}

function npcHeySir(ctx: LureContext, h: Hotspot): void {
  const player = ctx.world.requireActiveHotspot(HotspotId.PLAYER);
  if (!player.currentActions.isEmpty()) {
    h.delayCtr = 12;
    h.characterMode = CharacterMode.PAUSED;
    h.actionCtr = 0;
    return;
  }
  h.showMessage(0x22, HotspotId.PLAYER);
  h.delayCtr = 130;
  h.characterMode = CharacterMode.WAIT_FOR_PLAYER;
  h.res.talkOverride = topParam(ctx, h, 0);
  h.doNothing();
}

function npcExecScript(ctx: LureContext, h: Hotspot): void {
  const offset = topParam(ctx, h, 0);
  h.endAction();
  ctx.script.execute(offset);
}

function npcResetPausedList(ctx: LureContext, h: Hotspot): void {
  h.characterMode = CharacterMode.HESITATE;
  h.delayCtr = IDLE_COUNTDOWN_SIZE + 1;
  resetPaused(ctx, h.hotspotId);
  h.endAction();
}

function npcWalkingCheck(ctx: LureContext, h: Hotspot, hotspot: HotspotState | null): void {
  const fields = ctx.world.fields;
  const id = topParam(ctx, h, 0);
  h.endAction();
  fields.set(Field.USE_HOTSPOT_ID, id);
  fields.set(Field.ACTIVE_HOTSPOT_ID, id);
  if (id < HotspotId.PLAYER || need(hotspot, Action.NPC_WALKING_CHECK).roomNumber === h.roomNumber) h.characterWalkingCheck(id);
}

function npcSetSupportOffset(ctx: LureContext, h: Hotspot): void {
  const support = topSupport(h);
  const entryId = ctx.schedules.param(support, 0);
  const next = ctx.schedules.resolve(entryId, ctx.schedules.parentSet(support));
  h.currentActions.top().support = next === null ? null : { kind: "schedule", id: next };
}

/** Lance l'action de la donnée qui vient de remplacer celle en tête (`npcSupportOffsetConditional`, `npcDispatchAction`). */
function dispatchNew(ctx: LureContext, h: Hotspot, support: Support | null): void {
  h.currentActions.top().support = support;
  if (!support) throw new Error("emploi du temps : entrée suivante absente");
  const action = ctx.schedules.action(support);
  const params = ctx.schedules.params(support);
  const hotspot = params.length === 0 ? null : (ctx.world.hotspot(params[action === Action.USE ? 1 : 0]!) ?? null);
  doAction(ctx, h, action, hotspot);
}

function npcSupportOffsetConditional(ctx: LureContext, h: Hotspot): void {
  const support = topSupport(h);
  const scriptOffset = ctx.schedules.param(support, 0);
  const entryId = ctx.schedules.param(support, 1);
  let next: Support | null;
  if (ctx.script.execute(scriptOffset) === 0) {
    next = ctx.schedules.nextSupport(support);
  } else {
    const id = ctx.schedules.resolve(entryId, ctx.schedules.parentSet(support));
    next = id === null ? null : { kind: "schedule", id };
  }
  dispatchNew(ctx, h, next);
}

function npcDispatchAction(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const fields = ctx.world.fields;
  const support = topSupport(h);
  fields.set(Field.USE_HOTSPOT_ID, ctx.schedules.param(support, 0));
  fields.set(Field.ACTIVE_HOTSPOT_ID, ctx.schedules.param(support, 0));
  const result = h.actionPrecheck(hotspot);
  if (result === Precheck.EXECUTE) {
    h.endAction();
  } else if (result !== Precheck.WAIT) {
    const id = ctx.schedules.resolve(ctx.schedules.param(support, 0), ctx.schedules.parentSet(support));
    dispatchNew(ctx, h, id === null ? null : { kind: "schedule", id });
  }
}

function npcTalkNpcToNpc(ctx: LureContext, h: Hotspot, hotspot: HotspotState): void {
  const fields = ctx.world.fields;
  const support = topSupport(h);
  fields.set(Field.ACTIVE_HOTSPOT_ID, hotspot.hotspotId);
  fields.set(Field.USE_HOTSPOT_ID, hotspot.hotspotId);
  if (!precheck(h, hotspot)) return;
  if (hotspot.talkCountdown !== 0) return;
  const p = ctx.schedules.params(support);
  if (p[1] !== 0) {
    h.converse(hotspot.hotspotId, p[1]!, true, false);
    h.res.talkCountdown += p[2]!;
    h.delayCtr = h.delayCtr + p[2]!;
  }
  if (p[3] !== 0) ctx.world.requireActiveHotspot(hotspot.hotspotId).converse(h.hotspotId, p[3]!, true, false);
  h.endAction();
}

function npcJumpAddress(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  const fields = world.fields;
  const procIndex = topParam(ctx, h, 0);
  h.endAction();
  switch (procIndex) {
    case 0:
      if (fields.get(Field.OLD_ROOM_NUMBER) === 19) {
        fields.set(Field.TALK_INDEX, 24);
        world.requireHotspot(0x3f1).nameId = 0x154;
        ctx.showDialog(0xab9);
      }
      break;
    case 1: {
      const player = world.requireActiveHotspot(HotspotId.PLAYER);
      if (player.y < 52) {
        const entry = ctx.schedules.resolve(SupportId.JUMP_ADDR_2);
        h.currentActions.clear();
        h.currentActions.addFront(CurrentAction.DISPATCH_ACTION, RoomNum.CELLAR, entry === null ? null : { kind: "schedule", id: entry });
      }
      break;
    }
    default:
      throw new Error(`npcJumpAddress : index ${procIndex} invalide`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------------------------------------------------------------

/** `getTalkId` : dialogue imposé (`talkOverride`, consommé), sinon celui de l'index de conversation (0 pour un étranger). */
export function getTalkId(ctx: LureContext, character: HotspotState): number {
  if (character.talkOverride !== 0) {
    const result = character.talkOverride;
    character.talkOverride = 0;
    return result;
  }
  const header = ctx.world.getTalkHeader(character.hotspotId);
  if (!header) throw new Error(`personnage ${character.hotspotId.toString(16)} sans dialogues`);
  const talkIndex = STRANGER_NAME_IDS.has(character.nameId) ? 0 : ctx.world.fields.get(Field.TALK_INDEX) + 1;
  // `TalkHeaderData::getEntry` : au-delà de la liste, ScummVM lève une erreur.
  const entry = header.entries[talkIndex];
  if (entry === undefined) throw new Error(`personnage ${character.hotspotId.toString(16)} : dialogue ${talkIndex} absent`);
  return entry;
}

/** `startTalk` : passe le joueur au gestionnaire de dialogue (vague T) avec le dialogue `id`. */
export function startTalk(ctx: LureContext, h: Hotspot, character: HotspotState, id: number): void {
  h.setTickProc(TickProc.TALK);
  character.talkerId = h.hotspotId;
  character.talkGate = 0;
  character.talkDestCharacterId = h.hotspotId;
  h.res.talkDestCharacterId = character.hotspotId;
  h.res.talkGate = 0;
  ctx.world.talkStartEntry = 0;
  ctx.world.setTalkData(id);
}
