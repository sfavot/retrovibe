/**
 * Historique des objectifs et compteur de victoires de l'original (DESKADV.INI : « Wyoming » et « Count »).
 * Tirage de l'objectif : DESKADV.EXE 3:7b58 (candidats) et 3:87dc (historique) ; compteur : 4:2115.
 */

/** Puzzle d'objectif « MysteryGO » (index 134 : le test `index × 4 == 0x218` de 3:7c8d). */
export const MYSTERY_GOAL = 134;
/** Longueur de l'historique au moment d'un tirage (3:87fe retire le plus ancien au-delà de 10). */
export const HISTORY_LENGTH = 10;
/** Victoires nécessaires pour que MysteryGO puisse être tiré (3:7c99). */
export const MYSTERY_VICTORIES = 10;
/** Plafond du compteur de victoires (4:2121). */
export const MAX_VICTORIES = 11;

/**
 * Historique tel qu'il sert au tirage : vide, il contient MysteryGO (3:87e4), qui reste ainsi exclu ;
 * trop long, il perd ses plus anciens objectifs.
 */
export function drawHistory(history: readonly number[]): number[] {
  if (history.length === 0) return [MYSTERY_GOAL];
  return history.slice(-HISTORY_LENGTH);
}

/** Historique à conserver une fois l'objectif choisi (3:8ea8 l'ajoute, doublon compris : Rejouer l'histoire le répète). */
export function recordGoal(history: readonly number[], goal: number): number[] {
  return [...drawHistory(history), goal];
}

/** Un objectif est tirable s'il n'est pas dans l'historique et, pour MysteryGO, après assez de victoires. */
export function isGoalDrawable(goal: number, history: readonly number[], victories: number): boolean {
  if (drawHistory(history).includes(goal)) return false;
  return goal !== MYSTERY_GOAL || victories >= MYSTERY_VICTORIES;
}

export const addVictory = (victories: number): number => Math.min(MAX_VICTORIES, victories + 1);
