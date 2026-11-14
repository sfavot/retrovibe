/**
 * Mcodes de la souris et du menu d'objets (groupe M3 d'`engine.md` § 11).
 *
 * Référence : ScummVM engines/sky/logic.cpp (`fnDiskMouse` … `fnCursorUp`, `fnOpenHand`, `fnCloseHand`, `fnNoHuman`, `fnAddHuman`,
 * `fnAddButtons`, `fnNoButtons`, `fnSetStop`, `fnClearStop`, `fnStartMenu` hors iOS, `fnUnhighlight`, `fnToggleMouse`, `fnMouseOn`,
 * `fnMouseOff`, `fnSaveCoods`) et mouse.cpp (GPL v3 ou ultérieure).
 */

import { CompactField as F } from "../../data/compact-fields";
import { Cursor, ST, TOP_LEFT_X, Var } from "../ids";
import type { McodeFn } from "./types";

export const fnDiskMouse: McodeFn = (L) => {
  L.deps.mouse.sprite(Cursor.DISK, 11, 11);
  return true;
};

export const fnNormalMouse: McodeFn = (L) => {
  L.deps.mouse.sprite(Cursor.NORMAL, 0, 0);
  return true;
};

export const fnBlankMouse: McodeFn = (L) => {
  L.deps.mouse.sprite(Cursor.BLANK, 0, 0);
  return true;
};

export const fnCrossMouse: McodeFn = (L) => L.fnCrossMouse();

export const fnCursorRight: McodeFn = (L) => {
  L.deps.mouse.sprite(Cursor.RIGHT, 9, 4);
  return true;
};

export const fnCursorLeft: McodeFn = (L) => {
  L.deps.mouse.sprite(Cursor.LEFT, 0, 5);
  return true;
};

export const fnCursorDown: McodeFn = (L) => {
  L.deps.mouse.sprite(Cursor.DOWN, 9, 4);
  return true;
};

export const fnCursorUp: McodeFn = (L) => {
  L.deps.mouse.sprite(Cursor.UP, 9, 4);
  return true;
};

export const fnOpenHand: McodeFn = (L) => {
  L.deps.mouse.openCloseHand(true);
  return true;
};

export const fnCloseHand: McodeFn = (L) => {
  L.deps.mouse.openCloseHand(false);
  return true;
};

export const fnNoHuman: McodeFn = (L) => L.fnNoHuman();

export const fnAddHuman: McodeFn = (L) => L.deps.mouse.addHuman();

export const fnAddButtons: McodeFn = (L) => {
  L.vars[Var.MOUSE_STATUS] = L.vars[Var.MOUSE_STATUS]! | 4;
  return true;
};

export const fnNoButtons: McodeFn = (L) => {
  L.vars[Var.MOUSE_STATUS] = L.vars[Var.MOUSE_STATUS]! & 0xfffffffb;
  return true;
};

export const fnSetStop: McodeFn = (L) => {
  L.vars[Var.MOUSE_STOP] = L.vars[Var.MOUSE_STOP]! | 1;
  return true;
};

export const fnClearStop: McodeFn = (L) => {
  L.vars[Var.MOUSE_STOP] = 0;
  return true;
};

/** `fnStartMenu` (version PC) : barre d'objets en haut de l'écran, 11 cases à partir de `SCROLL_OFFSET`. */
export const fnStartMenu: McodeFn = (L, firstObject) => {
  const { vars, compacts, objectList } = L;
  const screen = vars[Var.SCREEN]! & 0xffff;
  const first = firstObject >>> 2;
  for (const id of [47, 48]) {
    const arrow = compacts.require(id);
    arrow[F.status] = ST.MOUSE + ST.FOREGROUND + ST.LOGIC + ST.RECREATE;
    arrow[F.screen] = screen;
  }

  let menuLength = 0;
  for (let i = first; i < first + objectList.length; i++) if (vars[i]) objectList[menuLength++] = vars[i]!;
  vars[Var.MENU_LENGTH] = menuLength;

  // Cases vides : compacts 51 et suivants.
  let blankId = 51;
  for (let i = menuLength; i < 11; i++) objectList[i] = blankId++;

  for (let i = 0; i < objectList.length; i++) {
    if (!objectList[i]) break;
    compacts.require(objectList[i]!)[F.status] = ST.LOGIC;
  }

  if (menuLength < 11) vars[Var.SCROLL_OFFSET] = 0;
  else if (menuLength < vars[Var.SCROLL_OFFSET]! + 11) vars[Var.SCROLL_OFFSET] = menuLength - 11;

  let rollingX = TOP_LEFT_X + 28;
  for (let i = 0; i < 11; i++) {
    const cpt = compacts.require(objectList[vars[Var.SCROLL_OFFSET]! + i]!);
    cpt[F.status] = ST.MOUSE + ST.FOREGROUND + ST.LOGIC + ST.RECREATE;
    cpt[F.screen] = screen;
    cpt[F.xcood] = rollingX;
    rollingX += 24;
    cpt[F.ycood] = vars[Var.MENU] === 2 ? 136 : 112;
  }
  return true;
};

export const fnUnhighlight: McodeFn = (L, item) => {
  const cpt = L.compacts.require(item);
  cpt[F.frame] = cpt[F.frame]! - 1;
  cpt[F.getToFlag] = 0;
  return true;
};

export const fnToggleMouse: McodeFn = (L, a) => {
  const cpt = L.compacts.require(a);
  cpt[F.status] = cpt[F.status]! ^ ST.MOUSE;
  return true;
};

export const fnMouseOn: McodeFn = (L, a) => {
  const cpt = L.compacts.require(a);
  cpt[F.status] = cpt[F.status]! | ST.MOUSE;
  return true;
};

export const fnMouseOff: McodeFn = (L, a) => {
  const cpt = L.compacts.require(a);
  cpt[F.status] = cpt[F.status]! & ~ST.MOUSE;
  return true;
};

export const fnSaveCoods: McodeFn = (L) => {
  L.deps.mouse.saveCoods();
  return true;
};
