import {
  FACING_RIGHT,
  FROM_LEFT,
  KIND_LOW,
  ROMAN_GUARD,
  ROMAN_KO_HIGH,
  ROMAN_LOW,
  heroIdle,
  type BagarreState,
  type Roman,
} from "../../../src/games/asterix/scenes/minigames/m32";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/** Le Romain est arrivé (en garde ou en train de frapper) : un coup de poing du bon côté l'assomme. */
export function arrived(roman: Roman): boolean {
  return roman.active && roman.anim >= ROMAN_GUARD && roman.anim < ROMAN_KO_HIGH;
}

/** Le joueur regarde ce Romain. */
export function facingRoman(state: BagarreState, roman: Roman): boolean {
  return roman.side !== state.facing;
}

/** Touche du demi-tour vers ce Romain. */
export function turnKey(roman: Roman): string {
  return roman.side === FROM_LEFT ? "ArrowLeft" : "ArrowRight";
}

/** Touche du coup qui pare aussi le coup de ce Romain : bas contre un coup bas, haut contre un coup haut. */
export function punchKey(roman: Roman): string {
  return roman.kind === KIND_LOW ? "ArrowDown" : "ArrowUp";
}

/** Urgence d'un Romain arrivé : celui qui frappe déjà, puis celui dont la garde finit le plus tôt. */
const urgency = (roman: Roman): number => (roman.anim >= ROMAN_LOW ? -100 + -roman.frame : roman.delay);

/**
 * Touche à donner maintenant, `null` s'il faut attendre : assommer le Romain arrivé le plus pressant (en se tournant
 * d'abord vers lui) ; sinon se tourner d'avance vers celui qui marche et arrivera le premier.
 */
export function decide(state: BagarreState): string | null {
  if (!heroIdle(state) || state.input !== 0) return null;
  const close = state.romans.filter(arrived).sort((a, b) => urgency(a) - urgency(b));
  if (close.length > 0) return facingRoman(state, close[0]) ? punchKey(close[0]) : turnKey(close[0]);
  const walking = state.romans.filter((roman) => roman.active && roman.anim < ROMAN_GUARD);
  if (walking.length === 0) return null;
  const distance = (roman: Roman): number => Math.abs(roman.x - 0xc0);
  const next = walking.sort((a, b) => distance(a) - distance(b))[0];
  return facingRoman(state, next) ? null : turnKey(next);
}

/** Vrai si le joueur regarde à droite (lisibilité des tests). */
export function facingRight(state: BagarreState): boolean {
  return state.facing === FACING_RIGHT;
}

/** Robot de la Bagarre : assomme chaque Romain dès qu'il arrive ; pour perdre, ne fait rien (le premier coup porte). */
export const playM32: MinigamePlayer = async (run: Launched, win) => {
  const state = minigameState<BagarreState>(run);
  while (run.screen === "minigame") {
    const key = win ? decide(state) : null;
    if (key) await run.tap(key);
    else await run.frame();
  }
};

/** Point à cliquer pour assommer ce Romain (D11) : son côté de l'écran, en haut pour un coup haut, en bas pour un coup bas. */
export function touchPoint(roman: Roman): [number, number] {
  return [roman.side === FROM_LEFT ? 40 : 280, roman.kind === KIND_LOW ? 170 : 100];
}

/** Même robot, au clic seul : un clic du côté du Romain arrivé le plus pressant (demi-tour compris s'il le faut). */
export async function playM32ByTouch(run: Launched): Promise<void> {
  const state = minigameState<BagarreState>(run);
  while (run.screen === "minigame") {
    const close = heroIdle(state) && state.input === 0 ? state.romans.filter(arrived).sort((a, b) => urgency(a) - urgency(b)) : [];
    if (close.length > 0) await run.click(...touchPoint(close[0]));
    else await run.frame();
  }
}
