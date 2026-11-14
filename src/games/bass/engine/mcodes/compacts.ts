/**
 * Mcodes des compacts (groupe M2 d'`engine.md` § 11) : niveaux de script, déplacement et animation, synchronisation, requêtes, grille,
 * `MegaSet`, lectures de champs, hasard, divers.
 *
 * Référence : ScummVM engines/sky/logic.cpp (`fnAr` … `fnEyeball`, `fnSkipIntroCode`, `fnQuit`, `fnPrintf`) (GPL v3 ou ultérieure).
 *
 * Le cheminement (`fnAr` → logique `L_AR`) et la grille (`fnPlotGrid`, `fnRemoveGrid`, `fnKillId`) passent par les services `Router` et
 * `WalkGrid` (vague E).
 */

import { CompactField as F, C_BASE_MODE, C_STAND_UP, NEXT_MEGA_SET, toInt16 } from "../../data/compact-fields";
import { Cpt, L as Logics, S91, ST, Var } from "../ids";
import type { McodeFn } from "./types";

export const fnAr: McodeFn = (L, x, y) => {
  const cpt = L.compact;
  cpt[F.downFlag] = 1; // échec supposé, au cas où une réplique interromprait la logique
  cpt[F.arTargetX] = x;
  cpt[F.arTargetY] = y;
  cpt[F.logic] = Logics.AR;
  cpt[F.xcood] = cpt[F.xcood]! & 0xfff8;
  cpt[F.ycood] = cpt[F.ycood]! & 0xfff8;
  return false;
};

export const fnArAnimate: McodeFn = (L) => {
  L.compact[F.mood] = 0; // « pas immobile »
  L.compact[F.logic] = Logics.AR_ANIM;
  return false;
};

export const fnIdle: McodeFn = (L) => {
  L.compact[F.logic] = 0;
  return true;
};

export const fnInteract: McodeFn = (L, targetId) => {
  const cpt = L.compact;
  cpt[F.mode] = cpt[F.mode]! + 4;
  cpt[F.logic] = Logics.SCRIPT;
  const target = L.compacts.require(targetId);
  L.compacts.setSub(cpt, cpt[F.mode]!, target[F.actionScript]!);
  L.compacts.setSub(cpt, cpt[F.mode]! + 2, 0);
  return false;
};

export const fnStartSub: McodeFn = (L, scr) => {
  const cpt = L.compact;
  cpt[F.mode] = cpt[F.mode]! + 4;
  L.compacts.setSub(cpt, cpt[F.mode]!, scr & 0xffff);
  L.compacts.setSub(cpt, cpt[F.mode]! + 2, scr >>> 16);
  return false;
};

export const fnTheyStartSub: McodeFn = (L, mega, scr) => {
  const cpt = L.compacts.require(mega);
  cpt[F.mode] = cpt[F.mode]! + 4;
  L.compacts.setSub(cpt, cpt[F.mode]!, scr & 0xffff);
  L.compacts.setSub(cpt, cpt[F.mode]! + 2, scr >>> 16);
  return true;
};

export const fnAssignBase: McodeFn = (L, id, scr) => {
  const cpt = L.compacts.require(id);
  cpt[F.mode] = C_BASE_MODE;
  cpt[F.logic] = Logics.SCRIPT;
  cpt[F.baseSub] = scr & 0xffff;
  cpt[F.baseSub_off] = scr >>> 16;
  return true;
};

export const fnGetTo: McodeFn = (L, targetPlaceId, mode) => {
  const cpt = L.compact;
  cpt[F.upFlag] = mode; // mode gardé pour le script d'action
  cpt[F.mode] = cpt[F.mode]! + 4;
  const place = L.compacts.fetch(cpt[F.place]!);
  if (!place) {
    L.deps.log("fnGetTo : pas de table de destinations (compact de lieu nul)");
    return false;
  }
  const table = L.compacts.fetch(place[F.getToTableId]!);
  if (!table) {
    L.deps.log("fnGetTo : table de destinations nulle");
    return false;
  }
  let p = 0;
  while (table[p] !== (targetPlaceId & 0xffff)) {
    p += 2;
    if (p >= table.length) throw new Error(`fnGetTo : destination ${targetPlaceId} absente`);
  }
  L.compacts.setSub(cpt, cpt[F.mode]!, table[p + 1]!);
  L.compacts.setSub(cpt, cpt[F.mode]! + 2, 0);
  return false;
};

export const fnSetToStand: McodeFn = (L) => {
  const cpt = L.compact;
  cpt[F.mood] = 1; // immobile
  cpt[F.grafixProgId] = L.compacts.getElem(cpt, C_STAND_UP + cpt[F.megaSet]! + cpt[F.dir]! * 4);
  cpt[F.grafixProgPos] = 0;
  const g = L.compacts.grafix(cpt);
  if (!g) throw new Error("fnSetToStand : pas d'animation debout");
  cpt[F.offset] = g.data[g.pos]!;
  cpt[F.logic] = Logics.SIMPLE_MOD;
  cpt[F.grafixProgPos] = cpt[F.grafixProgPos]! + 1;
  L.simpleAnim();
  return false;
};

export const fnTurnTo: McodeFn = (L, dir) => {
  const cpt = L.compact;
  const curDir = cpt[F.dir]!;
  cpt[F.dir] = dir & 0xffff;
  const tt = L.compacts.turnTable(cpt, curDir);
  if (!tt[dir]) return true;
  cpt[F.turnProgId] = tt[dir]!;
  cpt[F.turnProgPos] = 0;
  cpt[F.logic] = Logics.TURNING;
  L.runTurn();
  return false;
};

export const fnArrived: McodeFn = (L, scriptVar) => {
  L.compact[F.leaving] = scriptVar & 0xffff;
  L.vars[scriptVar >>> 2] = L.vars[scriptVar >>> 2]! + 1;
  return true;
};

export const fnLeaving: McodeFn = (L) => {
  const cpt = L.compact;
  cpt[F.atWatch] = 0;
  if (cpt[F.leaving]) {
    L.vars[cpt[F.leaving]! >> 2] = L.vars[cpt[F.leaving]! >> 2]! - 1;
    cpt[F.leaving] = 0;
  }
  return true;
};

export const fnSetAlternate: McodeFn = (L, scr) => {
  L.compact[F.alt] = scr & 0xffff;
  L.compact[F.logic] = Logics.ALT;
  return false;
};

export const fnAltSetAlternate: McodeFn = (L, target, scr) => {
  const cpt = L.compacts.require(target);
  cpt[F.alt] = scr & 0xffff;
  cpt[F.logic] = Logics.ALT;
  return false;
};

export const fnKillId: McodeFn = (L, id) => {
  if (id) {
    const cpt = L.compacts.require(id);
    if (cpt[F.status]! & ST.GRID_PLOT) L.deps.grid.removeObjectFromWalk(cpt);
    cpt[F.status] = 0;
  }
  return true;
};

export const fnStopMode: McodeFn = (L) => {
  L.compact[F.logic] = Logics.STOPPED;
  return false;
};

export const fnWeWait: McodeFn = (L, id) => {
  L.compact[F.waitingFor] = id & 0xffff;
  L.stopAndWait();
  return true; // « pas sûr » (commentaire d'origine)
};

export const fnSendSync: McodeFn = (L, mega, sync) => {
  L.compacts.require(mega)[F.sync] = sync & 0xffff;
  return false;
};

export const fnSendFastSync: McodeFn = (L, mega, sync) => {
  L.compacts.require(mega)[F.sync] = sync & 0xffff;
  return true;
};

export const fnSendRequest: McodeFn = (L, target, scr) => {
  L.compacts.require(target)[F.request] = scr & 0xffff;
  return false;
};

export const fnClearRequest: McodeFn = (L, target) => {
  L.compacts.require(target)[F.request] = 0;
  return true;
};

export const fnCheckRequest: McodeFn = (L) => {
  const cpt = L.compact;
  if (!cpt[F.request]) return true;
  cpt[F.mode] = 4; // C_ACTION_MODE
  cpt[F.actionSub] = cpt[F.request]!;
  cpt[F.actionSub_off] = 0;
  cpt[F.request] = 0;
  return false;
};

export const fnFaceId: McodeFn = (L, otherId) => {
  const cpt = L.compact;
  const other = L.compacts.require(otherId);
  let x = toInt16(cpt[F.xcood]! - other[F.xcood]!);
  if (x < 0) {
    x = toInt16(-x); // nous sommes à gauche
    cpt[F.getToFlag] = 3;
  } else {
    cpt[F.getToFlag] = 2;
  }
  let y = toInt16(cpt[F.ycood]! - (other[F.ycood]! + other[F.mouseRelY]! + other[F.mouseSizeY]!));
  if (y < 0) {
    y = toInt16(-y); // l'autre est plus bas
    if (y >= x) cpt[F.getToFlag] = 1;
  } else if (y >= x) {
    cpt[F.getToFlag] = 0;
  }
  return true;
};

export const fnResetId: McodeFn = (L, id, resetBlock) => {
  const cpt = L.compacts.fetch(id & 0xffff);
  const rst = L.compacts.fetch(resetBlock & 0xffff);
  if (!cpt) {
    L.deps.log(`fnResetId(): Compact ${id} (id) == NULL`);
    return true;
  }
  if (!rst) {
    L.deps.log(`fnResetId(): Compact ${resetBlock} (resetBlock) == NULL`);
    return true;
  }
  let p = 0;
  let off: number;
  while ((off = rst[p++]!) !== 0xffff) L.compacts.setElem(cpt, off, rst[p++]!);
  return true;
};

export const fnToggleGrid: McodeFn = (L) => {
  L.compact[F.status] = L.compact[F.status]! ^ ST.GRID_PLOT;
  return true;
};

export const fnPause: McodeFn = (L, cycles) => {
  L.compact[F.flag] = cycles & 0xffff;
  L.compact[F.logic] = Logics.PAUSE;
  return false;
};

export const fnRunAnimMod: McodeFn = (L, animNo) => {
  const cpt = L.compact;
  cpt[F.grafixProgId] = animNo;
  cpt[F.grafixProgPos] = 0;
  cpt[F.offset] = firstWord(L, cpt);
  cpt[F.grafixProgPos] = cpt[F.grafixProgPos]! + 1;
  cpt[F.logic] = Logics.MOD_ANIMATE;
  L.runAnim();
  return false;
};

export const fnSimpleMod: McodeFn = (L, animSeqNo) => {
  const cpt = L.compact;
  cpt[F.grafixProgId] = animSeqNo;
  cpt[F.grafixProgPos] = 0;
  cpt[F.logic] = Logics.SIMPLE_MOD;
  cpt[F.offset] = firstWord(L, cpt);
  cpt[F.grafixProgPos] = cpt[F.grafixProgPos]! + 1;
  L.simpleAnim();
  return false;
};

export const fnRunFrames: McodeFn = (L, sequenceNo) => {
  const cpt = L.compact;
  cpt[F.grafixProgId] = sequenceNo;
  cpt[F.grafixProgPos] = 0;
  cpt[F.logic] = Logics.FRAMES;
  cpt[F.offset] = firstWord(L, cpt);
  cpt[F.grafixProgPos] = cpt[F.grafixProgPos]! + 1;
  L.simpleAnim();
  return false;
};

/** `*getGrafixPtr(_compact)` : premier mot du programme (décalage des images). */
function firstWord(L: Parameters<McodeFn>[0], cpt: Uint16Array): number {
  const g = L.compacts.grafix(cpt);
  if (!g) throw new Error(`programme graphique ${cpt[F.grafixProgId]} absent`);
  return g.data[g.pos]!;
}

export const fnAwaitSync: McodeFn = (L) => {
  if (L.compact[F.sync]) return true;
  L.compact[F.logic] = Logics.WAIT_SYNC;
  return false;
};

export const fnIncMegaSet: McodeFn = (L) => {
  L.compact[F.megaSet] = L.compact[F.megaSet]! + NEXT_MEGA_SET;
  return true;
};

export const fnDecMegaSet: McodeFn = (L) => {
  L.compact[F.megaSet] = L.compact[F.megaSet]! - NEXT_MEGA_SET;
  return true;
};

export const fnSetMegaSet: McodeFn = (L, mega, setNo) => {
  L.compacts.require(mega)[F.megaSet] = Math.imul(setNo, NEXT_MEGA_SET);
  return true;
};

export const fnMoveItems: McodeFn = (L, listNo, screenNo) => {
  const moveList = L.compacts.require(Cpt.MOVE_LIST);
  const list = L.compacts.require(moveList[listNo]!);
  let p = 0;
  for (let i = 0; i < 2; i++) {
    if (!list[p]) return true;
    L.compacts.require(list[p++]!)[F.screen] = screenNo & 0xffff;
  }
  return true;
};

export const fnRandom: McodeFn = (L, a) => {
  L.vars[Var.RND] = L.deps.rng.number(65536) & a;
  return true;
};

export const fnPersonHere: McodeFn = (L, id, room) => {
  L.vars[Var.RESULT] = L.compacts.require(id)[F.screen] === room ? 1 : 0;
  return true;
};

export const fnFetchX: McodeFn = (L, id) => {
  L.vars[Var.RESULT] = L.compacts.require(id)[F.xcood]!;
  return true;
};

export const fnFetchY: McodeFn = (L, id) => {
  L.vars[Var.RESULT] = L.compacts.require(id)[F.ycood]!;
  return true;
};

export const fnTestList: McodeFn = (L, id, x, y) => {
  L.vars[Var.RESULT] = 0; // échec supposé
  const list = L.compacts.require(id);
  for (let p = 0; list[p]; p += 5) {
    if (x >= list[p]! && x < list[p + 1]! && y >= list[p + 2]! && y < list[p + 3]!) L.vars[Var.RESULT] = list[p + 4]!;
  }
  return true;
};

export const fnFetchPlace: McodeFn = (L, id) => {
  L.vars[Var.RESULT] = L.compacts.require(id)[F.place]!;
  return true;
};

export const fnCustomJoey: McodeFn = (L, id) => {
  const cpt = L.compacts.require(id);
  L.vars[Var.PLAYER_X] = cpt[F.xcood]!;
  L.vars[Var.PLAYER_Y] = cpt[F.ycood]!;
  L.vars[Var.PLAYER_MOOD] = cpt[F.mood]!;
  L.vars[Var.PLAYER_SCREEN] = cpt[F.screen]!;
  return true;
};

export const fnChangeName: McodeFn = (L, id, textNo) => {
  L.compacts.require(id)[F.cursorText] = textNo & 0xffff;
  return true;
};

export const fnPlotGrid: McodeFn = (L, x, y, width) => {
  L.deps.grid.plotGrid(x, y, width, L.compact);
  return true;
};

export const fnRemoveGrid: McodeFn = (L, x, y, width) => {
  L.deps.grid.removeGrid(x, y, width, L.compact);
  return true;
};

export const fnEyeball: McodeFn = (L, id) => {
  const eyeTable = L.compacts.require(id);
  const foster = L.compacts.require(Cpt.BLUE_FOSTER);
  const x = ((foster[F.xcood]! - 168) >>> 0) >>> 3; // 168 < x < 416
  const y = (((foster[F.ycood]! - 256) >>> 0) << 2) >>> 0; // 256 < y < 296
  L.vars[Var.RESULT] = eyeTable[(x + y) >>> 0]! + S91;
  return true;
};

export const fnSkipIntroCode: McodeFn = (L) => {
  L.deps.system.pastIntro = true;
  return true;
};

/** Suspend le script à chaque tour : boucle d'attente des scripts (`fnQuit` ne quitte pas). */
export const fnQuit: McodeFn = () => false;

export const fnPrintf: McodeFn = (L, a, b, c) => {
  L.deps.log(`fnPrintf(${a}, ${b}, ${c})`);
  return true;
};
