import type { BaseSceneContext } from "../../../engine/mohawk/scene";
import type { CursorKind, Host } from "./host";
import type { ScreenId } from "./scene";

/**
 * Préférences de session (engine.md §7.2), en mémoire seulement : la persistance (enregistrement des parties, options) arrive
 * avec les écrans, en vague G. Les raccourcis qui les basculent (`Ctrl+V`, `Ctrl+Y`, `Ctrl+T`, `Ctrl+J`, `Ctrl+U`, `Ctrl+H`) aussi.
 */
export interface ZoombinisPrefs {
  /** File musique (`DS:a43b`, `Ctrl+V`). */
  music: boolean;
  /** Voix et effets (`DS:a43a`, `Ctrl+Y`). */
  effects: boolean;
  /** Transitions animées par l'écran `XFER` (`DS:854e` inversé, `Ctrl+T`). */
  transitions: boolean;
  /** Souris aimantée (`DS:a43c`, `Ctrl+J`) ; défaut faux (valeur initiale non relevée). */
  magneticMouse: boolean;
  /** Auto-aimantation (`DS:a43e`, `Ctrl+U`) ; défaut faux (valeur initiale non relevée). */
  autoMagnet: boolean;
  /** Pointeur masqué pendant le transport d'une pièce (`DS:a43d`, `Ctrl+H`) ; défaut vrai, comme la partie neuve. */
  hideCursorWhileCarrying: boolean;
}

export function defaultPrefs(): ZoombinisPrefs {
  return { music: true, effects: true, transitions: true, magneticMouse: false, autoMagnet: false, hideCursorWhileCarrying: true };
}

/**
 * Tout ce qu'un écran de Zoombinis peut utiliser : le contexte commun plus l'hôte du jeu (le `MohawkHost` commun ne connaît pas
 * `playVideo`, `textInput`, `pointerIsTouch`) et les préférences.
 */
export type ZoombinisContext = BaseSceneContext<ScreenId, CursorKind> & {
  readonly host: Host;
  readonly prefs: ZoombinisPrefs;
};
