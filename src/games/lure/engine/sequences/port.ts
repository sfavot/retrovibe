/**
 * Ce que les séquences plein écran lisent du moteur (hors `LureContext`) : l'écran qu'elles dessinent, les événements d'entrée, l'horloge
 * et la sortie du jeu. Implémenté par `LureEngine` (`game.ts`).
 */

import type { MenuEvent } from "../menu";
import type { SequenceScreen } from "./screen";

export interface SequencePort {
  /** Écran dessiné par la séquence en cours (lu par le rendu). */
  readonly screen: SequenceScreen;
  /** Événements d'entrée reçus depuis la dernière lecture (retirés), comme `Events::pollEvent`. */
  takeEvents(): MenuEvent[];
  /** Temps du moteur en millisecondes (ticks de 80 ms) : il ne passe pas quand l'hôte suspend le moteur. */
  nowMs(): number;
  /** `LureEngine::quitGame` : la partie est finie. */
  exit(): void;
  /** La séquence a fini de montrer son écran : le rendu retrouve la pièce. */
  setActive(active: boolean): void;
}
