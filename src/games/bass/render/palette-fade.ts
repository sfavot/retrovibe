/**
 * Fondus de palette : calcul des 32 pas de `fnFadeDown` (`palette_fadedown_helper`) et de `paletteFadeUp`, assombrissement de la pause.
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::fnFadeDown`, `palette_fadedown_helper`, `paletteFadeUp`, `halvePalette`), GPL v3 ou
 * ultérieure.
 *
 * Règles (palette RVB sur 8 bits `_palette`, 240 couleurs de jeu seulement ; les 16 dernières ne bougent pas) :
 * - fondu au noir : 32 pas ; à chaque pas, chaque composante perd 8 (plancher 0), **à partir de la palette courante** (les pas se cumulent :
 *   255 atteint 0 au pas 32) ;
 * - fondu en entrée : 32 pas numérotés `cnt = 1..32` ; au pas `cnt`, chaque composante vaut `(cible * cnt) >> 5`, calculé depuis la palette
 *   cible (convertie de la VGA 6 bits) et non depuis la précédente : le pas 32 donne exactement la cible ;
 * - un pas dure 20 ms (`delayTime += 20`) : 640 ms au total ;
 * - la pause (`halvePalette`) montre la palette courante divisée par deux (`>> 1`) sur les 240 couleurs, sans toucher `_palette`.
 *
 * Écart volontaire : fonctions pures sur des tampons ; l'enchaînement des pas dans le temps relève du moteur (séquence tick par tick).
 */

import { GAME_COLORS } from "../data/palette";

export const FADE_STEPS = 32;
export const FADE_STEP_MS = 20;
export const FADE_DOWN_DELTA = 8;

const GAME_BYTES = GAME_COLORS * 3;

/** Un pas de `palette_fadedown_helper` sur place (les `GAME_COLORS` premières couleurs). */
export function fadeDownStep(palette: Uint8Array): void {
  for (let i = 0; i < GAME_BYTES; i++) palette[i] = palette[i]! >= FADE_DOWN_DELTA ? palette[i]! - FADE_DOWN_DELTA : 0;
}

/** Palette courante après `step` pas de fondu au noir (0 à 32), sans modifier `from`. */
export function fadedDown(from: Uint8Array, step: number): Uint8Array {
  const out = new Uint8Array(from);
  for (let i = 0; i < step; i++) fadeDownStep(out);
  return out;
}

/** Palette du pas `step` (1 à 32) de `paletteFadeUp` vers `target` (RVB 8 bits, 768 octets) ; les 16 dernières couleurs de `out` sont conservées. */
export function fadeUpStep(target: Uint8Array, step: number, out: Uint8Array): void {
  if (!Number.isInteger(step) || step < 1 || step > FADE_STEPS) throw new RangeError(`pas de fondu ${step} hors de 1 à ${FADE_STEPS}`);
  for (let i = 0; i < GAME_BYTES; i++) out[i] = (target[i]! * step) >> 5;
}

/** `halvePalette` : moitié de la palette courante (copie), les 16 dernières couleurs recopiées telles quelles. */
export function halvedPalette(palette: Uint8Array): Uint8Array {
  const out = new Uint8Array(palette);
  for (let i = 0; i < GAME_BYTES; i++) out[i] = palette[i]! >> 1;
  return out;
}
