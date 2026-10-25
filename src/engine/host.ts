import type { HostStorage } from "./storage";

/**
 * Sous-ensemble commun des hôtes de jeu (frontière entre le moteur et le navigateur / les tests) : temps, stockage, sortie.
 * Les hôtes de Téléportaschtroumpf et de Mathémagique l'étendent. Celui d'Armaeth (`ArmaethHost`) garde sa forme propre
 * (`quit()` au lieu de `exit()`, sauvegardes binaires `read` / `write` par emplacement) : il n'en dérive pas.
 */
export interface BaseHost {
  /** Millisecondes monotones (`performance.now()`). */
  now(): number;
  readonly storage: HostStorage;
  /** Sort du jeu. Les scènes ne doivent rien faire d'autre après cet appel. */
  exit(): void;
}
