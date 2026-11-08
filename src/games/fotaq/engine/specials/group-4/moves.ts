/**
 * Mouvements spéciaux du groupe 4 : 2 à 4 (les tenues de Joe), 5 et 6 (la palette de la robe), 7 et 8 (début et fin de la course de
 * voiture), 31 (attendre la voiture avant l'huile) et 32 (secousse de l'écran). Réécriture de `Logic::asmMakeJoeUseDress`,
 * `asmMakeJoeUseNormalClothes`, `asmMakeJoeUseUnderwear`, `asmSwitchToDressPalette`, `asmSwitchToNormalPalette`,
 * `asmStartCarAnimation`, `asmStopCarAnimation`, `asmWaitForCarPosition` et `asmShakeScreen` (engines/queen/logic.cpp, ScummVM, GPL v3
 * ou ultérieure ; 5, 6 et 32 sont ceux de la version DOS).
 *
 * Écarts : 31 attend aussi que la voiture s'arrête (`BamFlag.Stop`) : ScummVM boucle alors sans fin sur une ligne qui n'arrive jamais.
 * Les tenues sont celles du moteur (`FotaqEngine.joeUse*`, sans leur cinématique : `showCut` faux comme dans ScummVM) ; 5 et 6 ne
 * changent que la palette (la tenue elle-même est posée par 2 et 3).
 */

import type { Sequence } from "../../../../../engine/sequence";
import type { FotaqEngine } from "../../loop";
import type { SpecialMove } from "../../script";
import { BamFlag } from "../bam";
import { bobOf, shake, stageOf } from "../kit";
import { GUN_SHOTS_BOB, OIL_CAR_INDEX, OIL_OBJECT } from "./ids";

/** 2 : Joe met la robe. */
function* useDress(g: FotaqEngine): Sequence {
  yield* g.joeUseDress(false);
}

/** 3 : Joe remet ses vêtements. */
function* useNormalClothes(g: FotaqEngine): Sequence {
  yield* g.joeUseClothes(false);
}

/** 4 : Joe en sous-vêtements. */
function* useUnderwear(g: FotaqEngine): Sequence {
  g.joeUseUnderwear();
}

/** 5 : la palette de la robe (`Display::palSetJoeDress`). */
function* switchToDressPalette(g: FotaqEngine): Sequence {
  stageOf(g).display.palette.setJoeDress();
}

/** 6 : la palette des vêtements (`Display::palSetJoeNormal`). */
function* switchToNormalPalette(g: FotaqEngine): Sequence {
  stageOf(g).display.palette.setJoeNormal();
}

/** 7 : la course commence (la table repart de sa première ligne, les trois bobs sont remis à zéro). */
function* startCarAnimation(g: FotaqEngine): Sequence {
  const { bam } = stageOf(g);
  bam.flag = BamFlag.Play;
  bam.prepare(g);
}

/** 8 : la course finit ; l'huile et les tirs disparaissent. */
function* stopCarAnimation(g: FotaqEngine): Sequence {
  const stage = stageOf(g);
  stage.bam.flag = BamFlag.Stop;
  const oil = stage.bobs.findBob(g, OIL_OBJECT);
  if (oil > 0) bobOf(g, oil).active = false;
  bobOf(g, GUN_SHOTS_BOB).active = false;
}

/** 31 : le décor court jusqu'à la ligne de la table où la voiture de Rico est sous le camion (l'huile peut tomber). */
function* waitForCarPosition(g: FotaqEngine): Sequence {
  const { bam } = stageOf(g);
  while (bam.index !== OIL_CAR_INDEX && bam.flag !== BamFlag.Stop) yield* g.update();
}

/** 32 : l'écran remonte d'un coup de 3 lignes pendant une image, puis revient (le choc de l'avion). */
function* shakeScreen(g: FotaqEngine): Sequence {
  shake(g, true);
  yield* g.update();
  shake(g, false);
  yield* g.update();
}

export const hotelMoves: Readonly<Record<number, SpecialMove>> = {
  2: useDress,
  3: useNormalClothes,
  4: useUnderwear,
  5: switchToDressPalette,
  6: switchToNormalPalette,
  7: startCarAnimation,
  8: stopCarAnimation,
  31: waitForCarPosition,
  32: shakeScreen,
};
