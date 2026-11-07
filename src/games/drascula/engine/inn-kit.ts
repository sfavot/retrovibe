import type { DrasculaRenderer } from "../render/renderer";
import type { DrasculaEngine } from "./loop";
import type { GameState } from "./state";

/**
 * L'auberge animée des chapitres 1 (pièce 62, `update_62_pre`) et 2 (pièce 14, `update_14_pre`) : le même code dans ScummVM
 * (engines/drascula/rooms.cpp), partagé ici. Bougies, clignement, pianiste, ivrogne : l'avance (`advanceInn`, accroche `tick`) est
 * séparée du dessin (`drawInn`, accroche `painters[...].pre`), comme le veut `docs/drascula/rooms.md` § 4. Les chapitres gardent
 * chez eux ce qui diffère : le premier plan `update_62` du chapitre 1, les cinématiques, les gestionnaires.
 */

/** Ticks d'écart entre deux images d'animation de l'auberge (`difference > 6`, soit 70 ms). */
const FRAME_TICKS = 6;

/** Clés de `GameState.anim` de l'auberge. */
export const InnAnim = { Candles: "candles", Pianist: "pianist", Drunk: "drunk", Blinking: "blinking", PianistTurn: "pianistTurn" } as const;

/** Drapeaux de l'auberge (mêmes numéros aux deux chapitres). */
export const InnFlag = {
  /** Le pianiste est parti (chapitre 2 : après le livre). */
  PianistGone: 5,
  /** Le pianiste est tourné vers le héros (le temps de sa conversation). */
  PianistTalking: 11,
  /** L'ivrogne fait son geste. */
  DrunkGesture: 12,
  /** L'ivrogne parle (`talk_drunk`). */
  DrunkTalking: 13,
} as const;

/**
 * Partie « avance » de `update_62_pre` / `update_14_pre` pour la pièce `room` : toutes les 70 ms, les bougies, le pianiste, l'ivrogne
 * et le clignement passent à l'image suivante.
 */
export function advanceInn(g: DrasculaEngine, room: number): void {
  const s = g.state;
  if (s.room?.number !== room || !g.gfx.roomSprites || g.gfx.owner !== "room") return;
  if (g.ticks - s.savedTime <= FRAME_TICKS) return;
  const { anim, flags } = s;
  if (flags[InnFlag.DrunkGesture] === 1) {
    anim[InnAnim.Drunk] = (anim[InnAnim.Drunk] ?? 0) + 1;
    if (anim[InnAnim.Drunk] === 8) {
      anim[InnAnim.Drunk] = 0;
      flags[InnFlag.DrunkGesture] = 0;
    }
  } else if (g.rng.inclusive(94) === 15 && flags[InnFlag.DrunkTalking] === 0) {
    flags[InnFlag.DrunkGesture] = 1;
  }
  anim[InnAnim.Candles] = ((anim[InnAnim.Candles] ?? 0) + 1) % 3;
  anim[InnAnim.Pianist] = ((anim[InnAnim.Pianist] ?? 0) + 1) % 9;
  anim[InnAnim.Blinking] = g.rng.inclusive(10);
  s.savedTime = g.ticks;
}

/** `update_62_pre` / `update_14_pre` (avant le héros) : bougies, clignement, pianiste (et son retournement), ivrogne. */
export function drawInn(r: DrasculaRenderer, s: GameState): void {
  const { screen, draw3, extra, dat } = r;
  const { anim, flags, hero } = s;
  const candle = dat.candles[anim[InnAnim.Candles] ?? 0];
  screen.copyBackground(draw3, 123, candle.y, 142, 14, 39, 13);
  screen.copyBackground(draw3, candle.x, 146, 311, 80, 4, 8);
  if (anim[InnAnim.Blinking] === 5) screen.copyBackground(draw3, 1, 149, 127, 52, 9, 5);
  if (hero.x > 101 && hero.x < 155) screen.copyBackground(draw3, 31, 138, 178, 51, 18, 16);
  if (flags[InnFlag.PianistTalking] === 0) screen.copyBackground(draw3, dat.pianistX[anim[InnAnim.Pianist] ?? 0], 157, 245, 130, 29, 42);
  else if (flags[InnFlag.PianistGone] === 0) screen.copyBackground(extra, 145, 139, 228, 112, 47, 60);
  else screen.copyBackground(draw3, 165, 140, 229, 117, 43, 59);
  if (flags[InnFlag.DrunkGesture] === 1) screen.copyBackground(draw3, dat.drunkX[anim[InnAnim.Drunk] ?? 0], 82, 170, 50, 40, 53);
  // `animation_4_1`, `animation_12_2`, `animation_26_2` : le pianiste se retourne, par-dessus son image ordinaire.
  const turn = anim[InnAnim.PianistTurn] ?? 0;
  if (turn > 0) screen.copyBackground(extra, turn === 1 ? 1 : 49, 139, 228, 112, 47, 60);
}
