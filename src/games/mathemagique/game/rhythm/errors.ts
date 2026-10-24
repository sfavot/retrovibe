/**
 * Réactions d'Algebird du Rhythm Shop (`1058:087c`, rhythm.md §1.8) : tables d'ids `\0SCR` de `RHYTHM.DAT` par type d'erreur et tirage.
 * Pur : le tirage prend le hasard du jeu (`MsvcRandom`).
 *
 * Tirage : `FUN_10a8_13af`, que la fiche appelle « tirage entier » mais que le reste du moteur identifie au tirage sans remise (`NoRepeatPool`).
 * On garde un historique par type (une réplique ne revient pas avant que les autres soient passées). `noRepeat: false` donne un `rand1(n)` simple.
 */
import { MsvcRandom, NoRepeatPool } from "../../engine/rng";

/** Type d'erreur / de réaction (premier argument de `1058:087c`). */
export type ErrorType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export const ERROR_LINES: Readonly<Record<ErrorType, readonly number[]>> = {
  /** Changer d'outil en laissant des pièces non fusionnées. */
  1: [4800, 4900, 5000, 5100, 5600],
  /** Melder : somme trop petite. */
  2: [4400, 4500, 4600, 4700, 6400],
  /** Résultat trop petit ou trop grand (voir `tooSmallLine`). */
  3: [7100, 7200, 7300, 7400, 11300, 4100],
  /** Cutter : non divisible / résultat hors table. */
  4: [4000, 4100, 4200, 4300],
  /** Cutter avec plusieurs pièces. */
  5: [6500, 6600, 6700, 6800, 6900, 7000],
  /** Gluer : pièces de tailles différentes. */
  6: [5700, 5800, 5900, 6000],
  /** Gluer : une seule pièce. */
  7: [6100, 6200, 6300, 6400],
  /** Non relevé en appel direct. */
  8: [5600, 5100, 5000, 4900, 4800],
  /** Non relevé en appel direct. */
  9: [5300, 5400, 5500, 5600, 4900],
  /** Sortie (bouton Exit). */
  10: [8600, 8700, 8800, 8900, 9000, 9100, 9200, 9300, 7800, 7900, 8000, 8200, 8300, 8400],
  /** Clic sur Algebird en mode aide (voix 18770-18778). */
  11: [8500],
};

/** Réplique au hasard quand on clique sur Algebird hors aide (`DS:1132`). */
export const ALGEBIRD_CLICK_LINES: readonly number[] = [7500, 7700, 8100, 9400, 9500, 11200];

/** Animation finale après la victoire (`DS:115a`, tirage `rand 0-4`). */
export const FINAL_ANIMATIONS: readonly number[] = [10600, 10700, 10800, 10900, 11000];

/** Rapport `taille × 10 / param` (division entière) qui sert à choisir la réaction de type 3. */
export function sizeRatio(size: number, param: number): number {
  return Math.trunc((size * 10) / param);
}

/** Type 3 : un rapport de 4,5 / 6 / 8 unités (45, 60, 80) a sa réplique propre (9800, 9700, 9600), sinon `null` (tirage dans la table). */
export function tooSmallLine(ratio: number): number | null {
  if (ratio === 45) return 9800;
  if (ratio === 60) return 9700;
  if (ratio === 80) return 9600;
  return null;
}

export interface ErrorLinesOptions {
  /** Tirage sans remise par type (défaut) ou `rand1(n)` simple. */
  noRepeat?: boolean;
}

/** Tire les réactions d'Algebird ; garde l'historique de chaque table pour la durée de la scène. */
export class ErrorLines {
  private readonly pools = new Map<number, NoRepeatPool>();
  private readonly noRepeat: boolean;

  constructor(
    private readonly rng: MsvcRandom,
    options: ErrorLinesOptions = {},
  ) {
    this.noRepeat = options.noRepeat ?? true;
  }

  /** Une réplique de la table `type` ; `ratio` (type 3) peut imposer la réplique propre à 45 / 60 / 80. */
  pick(type: ErrorType, ratio?: number): number {
    if (type === 3 && ratio !== undefined) {
      const fixed = tooSmallLine(ratio);
      if (fixed !== null) return fixed;
    }
    return this.draw(type, ERROR_LINES[type]);
  }

  /** Réplique au hasard pour un clic sur Algebird (hors aide). */
  pickAlgebirdClick(): number {
    return this.draw(100, ALGEBIRD_CLICK_LINES);
  }

  /** Animation finale de victoire (`rand 0-4`, sans mémoire). */
  pickFinalAnimation(): number {
    return FINAL_ANIMATIONS[this.rng.rand1(FINAL_ANIMATIONS.length)]!;
  }

  private draw(key: number, table: readonly number[]): number {
    if (table.length === 1) return table[0]!;
    if (!this.noRepeat) return table[this.rng.rand1(table.length)]!;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new NoRepeatPool(table.length);
      this.pools.set(key, pool);
    }
    return table[pool.pick(this.rng)]!;
  }
}
