/**
 * Mcodes du son, des sections et de la partie (groupe M4 d'`engine.md` § 11).
 *
 * Référence : ScummVM engines/sky/logic.cpp (`fnLeaveSection`, `fnEnterSection`, `fnRestoreGame`, `fnRestartGame`, `fnStartFx`,
 * `fnStopFx`, `fnStartMusic`, `fnStopMusic`, `fnQuitToDos`, `fnPauseFx`, `fnUnPauseFx`) (GPL v3 ou ultérieure).
 *
 * Écarts volontaires : `replaceMouseCursors` ne fait que noter le fichier des curseurs d'objets (le rendu le lira) ; `fnRestoreGame` ouvre le
 * dialogue du site (D5, vague S) par `BassControl.restoreGame` ; `fnEnterSection` dit au son si la section est rechargée par une restitution
 * (`SF_GAME_RESTORED` : `Sound::loadSection` garde alors les effets à relancer, `restoreSfx`).
 */

import { SF, Var } from "../ids";
import type { Logic } from "../logic";
import type { McodeFn } from "./types";

/** Section de LINC : autres curseurs d'objets. */
const LINC_SECTION = 5;

export const fnLeaveSection: McodeFn = (L, sectionNo) => {
  if (sectionNo === LINC_SECTION) L.deps.mouse.objectCursorFile = 60301;
  return true;
};

/** `fnEnterSection` : musique, effets et grilles de la section rechargés si elle change (ou après une restitution). */
export const fnEnterSection: McodeFn = (L, sectionNo) => enterSection(L, sectionNo);

export function enterSection(L: Logic, sectionNo: number): boolean {
  const { system, sound, grid, mouse } = L.deps;
  L.vars[Var.CUR_SECTION] = sectionNo;
  system.currentMusic = 0;
  if (sectionNo === LINC_SECTION) mouse.objectCursorFile = 60302;
  if (sectionNo !== L.currentSection || system.systemFlags & SF.GAME_RESTORED) {
    L.currentSection = sectionNo;
    sound.loadSection((sectionNo + 1) & 0xff, (system.systemFlags & SF.GAME_RESTORED) !== 0);
    grid.loadGrids();
    system.systemFlags &= ~SF.GAME_RESTORED;
  }
  return true;
}

export const fnRestoreGame: McodeFn = (L) => {
  L.deps.control.restoreGame();
  return false;
};

export const fnRestartGame: McodeFn = (L) => {
  L.deps.control.restartGame();
  return false;
};

export const fnStartFx: McodeFn = (L, sound, b) => {
  L.deps.sound.startFx(sound, b & 1);
  return true;
};

export const fnStopFx: McodeFn = (L) => {
  L.deps.sound.stopFx();
  return true;
};

export const fnStartMusic: McodeFn = (L, a) => {
  if (!(L.deps.system.systemFlags & SF.MUS_OFF)) L.deps.sound.startMusic(a & 0xffff);
  L.deps.system.currentMusic = a & 0xffff;
  return true;
};

export const fnStopMusic: McodeFn = (L) => {
  L.deps.sound.startMusic(0);
  L.deps.system.currentMusic = 0;
  return true;
};

export const fnQuitToDos: McodeFn = (L) => {
  L.deps.control.quit();
  return false;
};

export const fnPauseFx: McodeFn = (L) => {
  L.deps.sound.pauseFx();
  return true;
};

export const fnUnPauseFx: McodeFn = (L) => {
  L.deps.sound.unPauseFx();
  return true;
};
