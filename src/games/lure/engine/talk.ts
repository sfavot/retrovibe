/**
 * Dialogues : `talkAnimHandler` (le gestionnaire de tick du joueur pendant une conversation) et `talkEndConversation`.
 *
 * Une conversation est un enregistrement de `0x3F12` : des **entrées** (ce que Diermot peut dire : séquence de condition, texte,
 * séquence de suite) et des **réponses** (ce que répond le personnage). Le gestionnaire est une machine à états (`TalkState`) rejouée à
 * chaque image : `START` (quelles options montrer ; `SELECT` si plusieurs, sinon `RESPOND`), `SELECT` (le joueur choisit au pointeur dans
 * les lignes du haut de l'écran), `RESPOND` / `RESPOND_2` (la question prononcée par Diermot), `RESPOND_3` (la réponse choisie, ses
 * séquences), `RESPONSE_WAIT` (la bulle du personnage, puis la suite ou la fin).
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::talkAnimHandler`, `talkEndConversation` (engines/lure/hotspots.cpp),
 * `TalkData::getResponse`, `TalkDataList::saveToStream` (res_struct.cpp).
 *
 * Écarts volontaires (voir `docs/lure/talk.md`) :
 * - le choix n'est pas dessiné par le gestionnaire : le moteur garde les lignes et la ligne survolée (`talkSelectView`), le rendu les
 *   dessine (`render/talk-select.ts`) ;
 * - le clic est un **événement** (`registerTalkClick`, appelé par `LureEngine.handleClick`) et non l'état du bouton à l'image : un clic
 *   plus court qu'une image n'est pas perdu ;
 * - une option déjà choisie (`descId |= 0x4000` dans ScummVM, qui modifie les données) est un drapeau « posé » gardé dans l'état de la
 *   partie, pas dans les données partagées (`talkAskedKeys` / `restoreTalkAsked` pour la sauvegarde) ;
 * - les erreurs de ScummVM (`assert`, `error`) sont des exceptions ; une boucle de pré-séquences de réponse qui ne s'arrête pas lève au
 *   bout de `MAX_RESPONSE_CHAIN` tours.
 */

import type { TalkEntry, TalkRecord } from "../data/lure-dat";
import { Action } from "../data/ids";
import type { LureContext } from "./context";
import type { Hotspot } from "./hotspot";
import { HotspotId, MENUBAR_Y_SIZE, TickProc } from "./ids";
import type { TalkSessionState } from "./state";
import { TalkState } from "./world";
import type { HandlerGroupTable } from "./handlers/index";

/** Texte « vide » : l'option ou la réponse n'a rien à dire (`TALK_MAGIC_ID`). */
export const TALK_MAGIC_ID = 0x424;
/** Valeur rendue par la pré-séquence d'une réponse qui l'accepte (`TALK_RESPONSE_MAGIC_ID`). */
export const TALK_RESPONSE_MAGIC_ID = 0x1092;
/** Lignes de choix dessinées au plus (`MAX_TALK_SELECTIONS`). */
export const MAX_TALK_SELECTIONS = 4;
/** Garde contre une chaîne de pré-séquences de réponse qui ne s'arrête pas (le `do … while` de ScummVM n'en a pas). */
const MAX_RESPONSE_CHAIN = 64;

/** Option proposée : son rang dans l'enregistrement, l'entrée et son texte (`descId & 0x3FFF`). */
export interface TalkChoice {
  index: number;
  entry: TalkEntry;
  textId: number;
}

/** Ce que le rendu dessine pendant le choix : les lignes (codes du jeu) et la ligne survolée (1 à n, 0 : aucune). */
export interface TalkSelectView {
  lines: string[];
  selected: number;
  /** Rang dans l'enregistrement de l'entrée de chaque ligne (pour les tests et les captures). */
  entries: number[];
}

function session(ctx: LureContext): TalkSessionState {
  return ctx.world.state.talk;
}

const ASKED_STRIDE = 1024;

function askedKey(record: TalkRecord, index: number): number {
  if (index >= ASKED_STRIDE) throw new RangeError(`dialogue ${record.recordId.toString(16)} : trop d'entrées`);
  return record.recordId * ASKED_STRIDE + index;
}

/** `descId` d'une entrée avec le drapeau « posé » (bit 14). */
function effectiveDescId(s: TalkSessionState, record: TalkRecord, index: number): number {
  const entry = record.entries[index]!;
  return s.asked.includes(askedKey(record, index)) ? (entry.descId | 0x4000) & 0xffff : entry.descId;
}

/** Clés des entrées déjà choisies, triées (pour la sauvegarde : `TalkDataList::saveToStream` écrit le `descId` de chaque entrée). */
export function talkAskedKeys(ctx: LureContext): number[] {
  return [...session(ctx).asked];
}

/** Rétablit les entrées déjà choisies (chargement d'une sauvegarde). */
export function restoreTalkAsked(ctx: LureContext, keys: readonly number[]): void {
  const s = session(ctx);
  s.asked = [...new Set(keys)].sort((a, b) => a - b);
}

/** Une conversation est en cours (le joueur est au gestionnaire de dialogue). */
export function isTalking(ctx: LureContext): boolean {
  return ctx.world.talkState !== TalkState.NONE || ctx.world.activeTalkData !== null;
}

/** Choix en cours, pour le rendu ; `null` hors de l'état `SELECT`. */
export function talkSelectView(ctx: LureContext): TalkSelectView | null {
  if (ctx.world.talkState !== TalkState.SELECT) return null;
  const s = session(ctx);
  const record = ctx.world.activeTalkData;
  if (!record) return null;
  const lines = s.choices.map((i) => ctx.text(effectiveDescId(s, record, i) & 0x3fff));
  return { lines, selected: s.hover, entries: [...s.choices] };
}

/** Un clic (`left` : bouton gauche) pendant une conversation : le gestionnaire le lit à l'image qui suit. */
export function registerTalkClick(ctx: LureContext, left: boolean): void {
  session(ctx).click = left ? 1 : 2;
}

/** `talkEndConversation` : le joueur reprend son gestionnaire, le personnage est libéré (et attend 24 images). */
export function talkEndConversation(ctx: LureContext): void {
  const world = ctx.world;
  const s = session(ctx);
  const character = world.requireActiveHotspot(s.destCharacter);
  const player = world.requireActiveHotspot(HotspotId.PLAYER);
  player.setTickProc(TickProc.PLAYER);
  // La conversation est finie : le joueur n'a plus d'interlocuteur.
  player.res.talkDestCharacterId = 0;
  character.res.useHotspotId = 0;
  character.res.talkerId = 0;
  character.delayCtr = 24;
  world.setTalkData(0);
  world.currentAction = Action.NONE;
  world.talkState = TalkState.NONE;
}

/** L'option `line` (à partir de 1) de l'écran de choix. */
function choiceAt(s: TalkSessionState, record: TalkRecord, line: number): TalkChoice {
  const index = s.choices[line - 1];
  if (index === undefined) throw new Error(`dialogue ${record.recordId.toString(16)} : aucune option à choisir`);
  return { index, entry: record.entries[index]!, textId: effectiveDescId(s, record, index) & 0x3fff };
}

function requireRecord(ctx: LureContext): TalkRecord {
  const record = ctx.world.activeTalkData;
  if (!record) throw new Error("gestionnaire de dialogue sans dialogue actif");
  return record;
}

/** `TALK_START` : les options à montrer, puis `SELECT` (plusieurs options dont une parle) ou `RESPOND` (la première, d'office). */
function startState(ctx: LureContext, s: TalkSessionState, record: TalkRecord): void {
  const world = ctx.world;
  s.choices = [];
  s.responseIndex = -1;
  let showSelections = false;

  for (let index = world.talkStartEntry; index < record.entries.length; index++) {
    const entry = record.entries[index]!;
    const descId = effectiveDescId(s, record, index);
    // Les deux bits de poids fort à 1 : option épuisée, sautée.
    if (descId >> 14 === 3) continue;

    const sequenceOffset = entry.preSequenceId & 0x3fff;
    const showLine = sequenceOffset === 0 || ctx.script.execute(sequenceOffset) !== 0;
    if (showLine) {
      const textId = descId & 0x3fff;
      s.choices.push(index);
      showSelections ||= textId !== TALK_MAGIC_ID;
    }
    if ((entry.preSequenceId & 0x8000) !== 0) break;
  }

  if (showSelections && s.choices.length > 1) {
    s.hover = 0;
    world.talkState = TalkState.SELECT;
  } else {
    world.talkState = TalkState.RESPOND;
    world.talkSelection = 1;
  }
}

/** `TALK_SELECT` : la ligne sous le pointeur ; clic gauche = choisir, autre bouton = abandonner (le personnage fait « ? »). */
function selectState(ctx: LureContext, s: TalkSessionState): void {
  const world = ctx.world;
  let line = Math.floor(ctx.room.mouseY / MENUBAR_Y_SIZE);
  if (line > MAX_TALK_SELECTIONS || (line !== 0 && s.choices[line - 1] === undefined)) line = 0;
  s.hover = line;

  const click = s.click;
  if (click === 2) {
    talkEndConversation(ctx);
    // Le personnage fait part de son étonnement.
    world.getActiveHotspot(s.destCharacter)?.showMessage(13, HotspotId.NOONE);
  } else if (click === 1 && line !== 0) {
    world.talkSelection = line;
    world.talkState = TalkState.RESPOND;
  }
}

/** `TALK_RESPOND` : la question de Diermot dans sa bulle (sauf option muette). */
function respondState(ctx: LureContext, h: Hotspot, s: TalkSessionState, record: TalkRecord): void {
  const world = ctx.world;
  if (h.res.talkCountdown !== 0) {
    // Une bulle en cours doit finir.
    h.handleTalkDialog();
    return;
  }
  const choice = choiceAt(s, record, world.talkSelection);
  const key = askedKey(record, choice.index);
  if (!s.asked.includes(key)) s.asked = [...s.asked, key].sort((a, b) => a - b);
  if (choice.textId !== TALK_MAGIC_ID) {
    h.converse(s.destCharacter, choice.textId);
    world.talkState = TalkState.RESPOND_2;
  } else {
    world.talkState = TalkState.RESPOND_3;
  }
}

/** `TALK_RESPOND_3` : la réponse du personnage (séquences de rang et de pré-séquence), sa bulle. */
function respondThree(ctx: LureContext, s: TalkSessionState, record: TalkRecord): void {
  const world = ctx.world;
  const choice = choiceAt(s, record, world.talkSelection);

  let responseNumber = choice.entry.postSequenceId;
  if ((responseNumber & 0x8000) !== 0) responseNumber = ctx.script.execute(responseNumber & 0x7fff);

  let response: TalkEntry | undefined;
  for (let guard = 0; ; guard++) {
    if (guard >= MAX_RESPONSE_CHAIN) throw new Error(`dialogue ${record.recordId.toString(16)} : réponses qui bouclent`);
    response = record.responses[responseNumber];
    if (!response) throw new Error(`dialogue ${record.recordId.toString(16)} : réponse ${responseNumber} invalide`);
    s.responseIndex = responseNumber;
    if (!response.preSequenceId) break;
    responseNumber = ctx.script.execute(response.preSequenceId);
    if (responseNumber === TALK_RESPONSE_MAGIC_ID) break;
  }

  let descId = response.descId;
  if ((descId & 0x8000) !== 0) descId = ctx.script.execute(descId & 0x7fff);
  if (descId !== TALK_MAGIC_ID) world.getActiveHotspot(s.destCharacter)?.converse(HotspotId.PLAYER, descId, true);
  world.talkState = TalkState.RESPONSE_WAIT;
}

/** `TALK_RESPONSE_WAIT` : la réponse est dite ; la suite (nouvelles options) ou la fin de la conversation. */
function responseWait(ctx: LureContext, h: Hotspot, s: TalkSessionState, record: TalkRecord): void {
  const world = ctx.world;
  h.handleTalkDialog();
  const character = world.requireActiveHotspot(s.destCharacter);
  if (character.res.talkCountdown > 0 || world.state.talkingCharacter !== 0) return;

  const response = record.responses[s.responseIndex];
  if (!response) throw new Error("dialogue sans réponse choisie");
  let result = response.postSequenceId;
  let keepTalking: boolean;
  if (result === 0xffff) {
    keepTalking = false;
  } else if ((result & 0x8000) === 0) {
    keepTalking = true;
  } else {
    result = ctx.script.execute(result & 0x7fff);
    keepTalking = result !== 0xffff;
  }

  if (keepTalking) {
    world.talkStartEntry = result;
    world.talkState = TalkState.START;
  } else {
    talkEndConversation(ctx);
  }
}

/** `talkAnimHandler` : un pas de la conversation, au tick du joueur. */
export function talkAnimHandler(ctx: LureContext, h: Hotspot): void {
  const world = ctx.world;
  const s = session(ctx);
  const record = requireRecord(ctx);
  try {
    let state: number = world.talkState;

    if (state === TalkState.NONE) {
      s.destCharacter = h.res.talkDestCharacterId;
      if (s.destCharacter === 0) throw new Error("dialogue sans interlocuteur");
      // Un autre dialogue (une bulle) doit finir avant de commencer à parler.
      if (ctx.room.isDialogShowing()) return;
      state = TalkState.START;
    }

    switch (state) {
      case TalkState.START:
        startState(ctx, s, record);
        break;
      case TalkState.SELECT:
        selectState(ctx, s);
        break;
      case TalkState.RESPOND:
        respondState(ctx, h, s, record);
        break;
      case TalkState.RESPOND_2:
        // Attendre que la bulle de la question soit fermée.
        h.handleTalkDialog();
        if (world.state.talkingCharacter !== 0) break;
        respondThree(ctx, s, record);
        break;
      case TalkState.RESPOND_3:
        respondThree(ctx, s, record);
        break;
      case TalkState.RESPONSE_WAIT:
        responseWait(ctx, h, s, record);
        break;
      default:
        break;
    }
  } finally {
    s.click = 0;
  }
}

export const TALK_HANDLERS: HandlerGroupTable = { talkAnimHandler };
