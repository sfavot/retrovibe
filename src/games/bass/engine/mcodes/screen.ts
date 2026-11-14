/**
 * Mcodes d'écran et de chargement (groupe M1 d'`engine.md` § 11) : fichiers en cache, décor, fondus, palette, séquences « swing », plans de
 * dessin des sprites.
 *
 * Référence : ScummVM engines/sky/logic.cpp (`fnCacheChip`, `fnCacheFast`, `fnDrawScreen`, `fnSetPalette`, `fnFadeDown`, `fnFadeUp`,
 * `fnBlankScreen`, `fnNewSwingSeq`, `fnWaitSwingEnd`, `fnMiniLoad`, `fnFlushBuffers`, `fnFlushChip`, `fnForeground`, `fnBackground`,
 * `fnNewBackground`, `fnSort`, `fnNoSpriteEngine`, `fnNoSpritesA6`), screen.cpp (`fnDrawScreen`) (GPL v3 ou ultérieure).
 *
 * Les fondus, le défilement et l'attente d'une séquence sont des effets bloquants (`effects.ts`) : le mcode les demande et rend la main.
 * La part logique du moteur de sprites appelé au milieu de `fnDrawScreen` (compacts sans sprite désactivés) est faite tout de suite.
 */

import { CompactField as F } from "../../data/compact-fields";
import { drawScreen, fadeDown, fadeUp, waitSequenceEnd } from "../effects";
import { Cpt, ST, Var } from "../ids";
import type { Logic } from "../logic";
import type { McodeFn } from "./types";

export const fnCacheChip: McodeFn = (L, a) => {
  L.deps.sound.stopFx();
  L.deps.items.cacheChip(L.compacts.require(a & 0xffff));
  return true;
};

export const fnCacheFast: McodeFn = (L, a) => {
  L.deps.items.cacheFast(L.compacts.fetch(a & 0xffff));
  return true;
};

export const fnDrawScreen: McodeFn = (L, a, b) => {
  const { system, screen } = L.deps;
  system.currentPalette = a;
  // `Screen::fnDrawScreen` : fondu au noir, nouveau décor (le moteur de sprites désactive les compacts sans sprite), fondu.
  L.spriteEngineStatus();
  L.block(drawScreen(screen, a, b, system.systemFlags));
  if (L.vars[Var.SCREEN] === 32) {
    // WORKAROUND du bogue 1140 (ScummVM) : le jardinier attend un `sync` de Foster ; on le lui envoie à chaque entrée dans l'écran 32.
    fnSendSync(L, Cpt.ID_SC32_GARDENER, 1, 0);
  }
  return true;
};

/** Repris ici pour `fnDrawScreen` (aussi dans `compacts.ts`). */
function fnSendSync(L: Logic, mega: number, sync: number, _c: number): boolean {
  L.compacts.require(mega)[F.sync] = sync & 0xffff;
  return false;
}

export const fnSetPalette: McodeFn = (L, a) => {
  L.deps.screen.setPalette(a);
  L.deps.system.currentPalette = a;
  return true;
};

export const fnFadeDown: McodeFn = (L, a) => {
  L.block(fadeDown(L.deps.screen, a, L.deps.system.systemFlags));
  return true;
};

export const fnFadeUp: McodeFn = (L, a, b) => {
  L.deps.system.currentPalette = a;
  L.block(fadeUp(L.deps.screen, a, b, L.deps.system.systemFlags));
  return true;
};

export const fnBlankScreen: McodeFn = (L) => {
  L.deps.screen.clearScreen();
  return true;
};

export const fnNewSwingSeq: McodeFn = (L, a) => {
  // « Seuls certains fichiers marchent sur PC » : les autres séquences sont ignorées, comme dans ScummVM.
  if (a === 85 || a === 106 || a === 75 || a === 15) L.deps.screen.startSequence(a, L.deps.items.fetch(a), L.deps.nowMs());
  else L.deps.log(`fnNewSwingSeq : séquence ${a} ignorée`);
  return true;
};

export const fnWaitSwingEnd: McodeFn = (L) => {
  L.block(waitSequenceEnd(L.deps.screen, () => L.deps.nowMs(), () => void L.deps.takeSkip()));
  return true;
};

export const fnMiniLoad: McodeFn = (L, a) => {
  L.deps.items.miniLoad(a & 0xffff);
  return true;
};

export const fnFlushBuffers: McodeFn = (L) => {
  L.deps.items.flushBuffers();
  return true;
};

/** « Devrait être automatique » : sans effet dans ScummVM. */
export const fnFlushChip: McodeFn = () => true;

export const fnForeground: McodeFn = (L, sprite) => {
  setLayer(L.compacts.require(sprite), ST.FOREGROUND);
  return true;
};

export const fnBackground: McodeFn = (L) => {
  setLayer(L.compact, ST.BACKGROUND);
  return true;
};

export const fnNewBackground: McodeFn = (L, sprite) => {
  setLayer(L.compacts.require(sprite), ST.BACKGROUND);
  return true;
};

export const fnSort: McodeFn = (L, mega) => {
  setLayer(L.compacts.require(mega), ST.SORT);
  return true;
};

export const fnNoSpriteEngine: McodeFn = (L) => {
  setLayer(L.compact, 0);
  return true;
};

export const fnNoSpritesA6: McodeFn = (L, us) => {
  setLayer(L.compacts.require(us), 0);
  return true;
};

/** Remplace les trois bits de plan (arrière, avant, trié). */
function setLayer(cpt: Uint16Array, layer: number): void {
  cpt[F.status] = (cpt[F.status]! & 0xfff8) | layer;
}
