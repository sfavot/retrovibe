/**
 * « Indy Quotient » de l'original (DESKADV.EXE 4:e514, résultat dans game+0x54, plafonné à 1000 en 4:227f).
 * Reconstitué à la main depuis le désassemblage : confiance moyenne sur la nature exacte de `pace`
 * (voir `paceOf`), haute sur le reste. Le maximum atteignable est 300 + 400 = 700, alors que le manuel annonce 1000.
 */

/** Plafond appliqué en 4:227f. */
const MAX_QUOTIENT = 1000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * « W » de l'original (game+0x48, calculé en 3:9adc) : 2·(n1 + n2) + game+0x13a.
 * n1 et n2 sont les compteurs renvoyés par la disposition de la carte (3:6c5c) : départs de voyage et barrages posés.
 * game+0x13a est la taille de la liste des puzzles de l'histoire : un par secteur de puzzle (objectif compris)
 * plus l'entrée d'index 0 que la boucle de 3:9229 saute (le briefing de départ de Marcus, hypothèse).
 */
export function paceOf(layout: { travels: number; blockades: number; puzzleCount: number }): number {
  return 2 * (layout.travels + layout.blockades) + layout.puzzleCount + 1;
}

/**
 * - Temps T (4:e520 à 4:e60b) : 300 − |secondes / W − 10·W| / 4, borné à [0, 600] (donc 300 au mieux).
 *   `secondes` est le temps réel écoulé depuis la génération (time() − game+0x58), pause comprise : l'original ne
 *   l'ajuste qu'au chargement d'une sauvegarde, où il retranche le temps déjà joué. Divisions entières tronquées.
 * - Difficulté D (4:e615 à 4:e6b2) : 4 × moyenne des difficultés enregistrées (plafonnée à 100), bornée à [1, 400].
 *   Chaque PlaySound(0) (3:e4af) ajoute la difficulté courante (game+0x109a) à la liste game+0x16a, taille en +0x172 ;
 *   le diviseur est donc le nombre de ces sons. Sans aucun son, D vaut 4.
 */
export function indyQuotient(seconds: number, pace: number, difficultySum: number, difficultyCount: number): number {
  const w = Math.max(1, Math.trunc(pace));
  const offset = Math.trunc(Math.trunc(Math.abs(seconds)) / w) - 10 * w;
  const time = clamp(300 - Math.trunc(Math.abs(offset) / 4), 0, 600);
  const average = difficultyCount > 0 ? Math.min(100, Math.trunc(difficultySum / difficultyCount)) : 1;
  const difficulty = clamp(4 * average, 1, 400);
  return Math.min(MAX_QUOTIENT, time + difficulty);
}
