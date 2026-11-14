/**
 * Mcodes de texte et de parole (groupe M3 d'`engine.md` § 11) : répliques, choix de dialogue, textes à l'écran, LINC.
 *
 * Référence : ScummVM engines/sky/logic.cpp (`fnPointerText`, `fnSpeakMe`, `fnSpeakMeDir`, `fnSpeakWait`, `fnSpeakWaitDir`, `fnChooser`,
 * `fnHighlight`, `fnTextKill`, `fnNewList`, `fnAskThis`, `fnTextModule`, `fnPrintCredit`, `fnLookAt`, `fnLincTextModule`, `fnTextKill2`,
 * `fnSetFont`, `stdSpeak`) (GPL v3 ou ultérieure).
 *
 * Le texte lui-même (`Text::lowTextManager`, police, mise en page) est le service `BassText`, fourni par `engine/text.ts`
 * (`BassTextManager`) ; la voix, le sous-titre et la durée d'une réplique sont dans `Logic.stdSpeak`. Avec `NullText` (tests de logique sans données de
 * texte), ces mcodes journalisent le texte demandé et font seulement le reste de leur travail.
 */

import { CompactField as F } from "../../data/compact-fields";
import { DATA_FILE_HEADER_SIZE, parseDataFileHeader } from "../../data/header";
import { lookAtWait } from "../effects";
import { Cpt, FIRST_TEXT_COMPACT, L as Logics, SF, ST, TOP_LEFT_X, TOP_LEFT_Y, Var } from "../ids";
import type { Logic } from "../logic";
import type { McodeFn } from "./types";

/** Nombre de textes adressés par `fnTextKill` / `fnTextKill2` (10, de `FIRST_TEXT_COMPACT`). */
const TEXT_KILL_COUNT = 10;

function missingText(L: Logic, mcode: string, textNum: number): void {
  L.deps.log(`${mcode} : texte ${textNum} non formé (textes non portés)`);
}

export const fnPointerText: McodeFn = (L, a) => {
  L.deps.text.pointerText(a, L.deps.mouse.x, L.deps.mouse.y);
  return true;
};

export const fnSpeakMe: McodeFn = (L, targetId, mesgNum, animNum) => {
  // WORKAROUND du bogue 4230 (ScummVM) : Mme Piermont au téléphone, répliques ignorées hors de l'écran 38.
  if (targetId === Cpt.ID_DANIELLE && animNum === 0x9b && L.vars[Var.SCREEN] !== 38) return false;
  L.stdSpeak(L.compacts.require(targetId), mesgNum, animNum, 0);
  return false;
};

export const fnSpeakMeDir: McodeFn = (L, targetId, mesgNum, animNum) => {
  // Le joueur : l'animation dépend de la direction (deux tailles).
  return fnSpeakMe(L, targetId, mesgNum, (animNum + (L.compact[F.dir]! << 1)) >>> 0);
};

export const fnSpeakWait: McodeFn = (L, id, message, animation) => {
  L.compact[F.flag] = id & 0xffff;
  L.compact[F.logic] = Logics.LISTEN;
  return fnSpeakMe(L, id, message, animation);
};

export const fnSpeakWaitDir: McodeFn = (L, a, b, c) => {
  L.compact[F.flag] = a & 0xffff;
  L.compact[F.logic] = Logics.LISTEN;
  const speaker = L.compacts.require(a);
  if (c) {
    c = (c + (speaker[F.dir]! << 1)) >>> 0;
    L.stdSpeak(speaker, b, c, speaker[F.dir]! << 1);
  } else {
    L.stdSpeak(speaker, b, c, 0);
  }
  return false;
};

export const fnChooser: McodeFn = (L) => {
  const { vars, compacts } = L;
  L.deps.system.systemFlags |= SF.CHOOSING; // pas de sauvegarde pendant un choix
  vars[Var.THE_CHOSEN_ONE] = 0;
  let p = Var.TEXT1;
  let ycood = TOP_LEFT_Y;
  while (vars[p]) {
    const textNum = vars[p++]!;
    const info = L.deps.text.lowTextManager(textNum, 320, 0, 241, false);
    const anim = vars[p++]!;
    if (!info) {
      missingText(L, "fnChooser", textNum);
      continue;
    }
    if (info.sprite) stipple(info.sprite);
    const textCompact = compacts.require(info.compactNum);
    textCompact[F.getToFlag] = textNum & 0xffff;
    textCompact[F.downFlag] = anim & 0xffff; // numéro d'animation
    textCompact[F.status] = textCompact[F.status]! | ST.MOUSE;
    textCompact[F.xcood] = TOP_LEFT_X;
    textCompact[F.ycood] = ycood;
    ycood = (ycood + info.height) & 0xffff;
  }
  if (p === Var.TEXT1) return true;
  L.compact[F.logic] = Logics.CHOOSE; // joueur figé jusqu'au choix
  L.deps.mouse.addHuman();
  return false;
};

/** Trame des choix (`fnChooser`) : un pixel sur deux du fond devient la couleur 1. */
function stipple(sprite: Uint8Array): void {
  const header = parseDataFileHeader(sprite);
  const size = header.height * header.width;
  const data = sprite.subarray(DATA_FILE_HEADER_SIZE);
  let index = 0;
  while (index < size) {
    if (index % header.width <= 1) index ^= 1;
    if (!data[index]) data[index] = 1;
    index += 2;
  }
}

export const fnHighlight: McodeFn = (L, itemNo, pen) => {
  pen = (((pen - 11) >>> 0) ^ 1) >>> 0;
  pen = (pen + 241) >>> 0;
  const textCompact = L.compacts.require(itemNo);
  L.deps.text.changeTextSpriteColor(L.deps.items.fetch(textCompact[F.flag]!), pen & 0xff);
  return true;
};

export const fnTextKill: McodeFn = (L) => {
  for (let i = 0, id = FIRST_TEXT_COMPACT; i < TEXT_KILL_COUNT; i++, id++) {
    const cpt = L.compacts.require(id);
    if (cpt[F.status]! & ST.MOUSE) cpt[F.status] = 0;
  }
  return true;
};

export const fnNewList: McodeFn = (L) => {
  for (let i = 0; i < 16; i++) L.vars[Var.TEXT1 + i] = 0;
  return true;
};

export const fnAskThis: McodeFn = (L, textNo, animNo) => {
  let p = Var.TEXT1;
  while (L.vars[p]) p += 2;
  L.vars[p++] = textNo;
  L.vars[p] = animNo;
  return true;
};

export const fnTextModule: McodeFn = (L, a, b) => {
  L.deps.text.textModule(a, b);
  return true;
};

export const fnPrintCredit: McodeFn = (L, a, _b, c) => {
  const info = L.deps.text.lowTextManager(a, 240, 0, 248, true);
  if (!info) {
    missingText(L, "fnPrintCredit", a);
    return true;
  }
  const credit = L.compacts.require(info.compactNum);
  credit[F.xcood] = 168;
  credit[F.ycood] = a === 558 && c === 215 ? 211 : c & 0xffff;
  L.vars[Var.RESULT] = info.compactNum;
  return true;
};

export const fnLookAt: McodeFn = (L, a, _b, c) => {
  const info = L.deps.text.lowTextManager(a, 240, 0, 248, true);
  const textCpt = info ? L.compacts.require(info.compactNum) : null;
  if (textCpt) {
    textCpt[F.xcood] = 168;
    textCpt[F.ycood] = c & 0xffff;
  } else {
    missingText(L, "fnLookAt", a);
  }
  // `recreate`, `spriteEngine`, `flip` : le texte s'affiche ; puis attente d'au moins 800 ms (effet bloquant). Le texte n'est effacé
  // qu'à la fin de l'effet : l'écran doit le dessiner (`status` non nul) quand l'effet compose l'image.
  L.spriteEngineStatus();
  L.fnNoHuman();
  L.deps.mouse.lock();
  L.block(
    (function* () {
      yield* lookAtWait(
        L.deps.screen,
        () => L.deps.takeSkip(),
        () => L.deps.mouse.held !== 0,
      );
      if (textCpt) textCpt[F.status] = 0;
    })(),
  );
  L.deps.mouse.unlock();
  L.deps.mouse.addHuman();
  return true;
};

export const fnLincTextModule: McodeFn = (L, textPos, textNo, buttonAction) => {
  if (buttonAction & 0x8000) for (let v = Var.LINC_DIGIT_0; v <= Var.LINC_DIGIT_9; v++) L.vars[v] = 0;
  buttonAction &= 0x7fff;
  if (buttonAction < 10) L.vars[Var.LINC_DIGIT_0 + buttonAction] = textNo;
  const info = L.deps.text.lowTextManager(textNo, 220, 0, 215, false);
  if (!info) {
    missingText(L, "fnLincTextModule", textNo);
    return true;
  }
  const textCpt = L.compacts.require(info.compactNum);
  if (textPos < 20) {
    textCpt[F.xcood] = 152;
    textCpt[F.ycood] = textPos * 13 + 170; // numéro de ligne (texte)
  } else if (textPos > 20) {
    textCpt[F.xcood] = textPos; // abscisse (chiffres)
    textCpt[F.ycood] = 214;
  } else {
    L.deps.log("fnLincTextModule: textPos == 20");
  }
  textCpt[F.getToFlag] = textNo & 0xffff;
  return true;
};

export const fnTextKill2: McodeFn = (L) => {
  for (let i = 0, id = FIRST_TEXT_COMPACT; i < TEXT_KILL_COUNT; i++, id++) L.compacts.require(id)[F.status] = 0;
  return true;
};

export const fnSetFont: McodeFn = (L, font) => {
  L.deps.text.setFont(font);
  return true;
};
