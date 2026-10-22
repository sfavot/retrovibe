/**
 * Éléments communs aux écrans de préparation de partie (S08, S04).
 */

/** Bip de navigation des menus : `s07a001b.voc` (chargé par la boucle principale pour tous les menus, `348d:0b42`). */
export const CLICK_SOUND = "s07a001b.voc";

/** Convertit des centièmes de seconde (unité des attentes de l'original, `1f33:00fc`) en ticks de l'horloge de jeu. */
export function centisecondsToTicks(cs: number): number {
  return Math.round((cs * 60) / 100);
}
