import type { BaseHost } from "../../../engine/host";

/**
 * Frontière entre le moteur de *Lure of the Temptress* et son environnement (navigateur ou test), sur le modèle de `FotaqHost`
 * (`docs/lure/engine.md`, § 7). Le moteur n'attend jamais : `tick()` consomme ce que l'hôte a accumulé depuis le tick précédent, et
 * l'hôte fait avancer le temps (`FixedStepClock`, `TICK_MS` de `cadence.ts`).
 *
 * Vague G1 : entrées, journal, sortie. Les fichiers sont lus une fois par l'hôte et passés au moteur déjà décodés (`LureData`) ;
 * l'image (`present`) vient avec la vague R, le son passe par le service `LureSound` (`services.ts`, vague A).
 */

/** Boutons de la souris (`Mouse::lButton`, `rButton`). */
export const MouseButton = { Left: 1, Right: 2 } as const;

/**
 * Actions du clavier, nommées comme la carte de touches de ScummVM (`kAction*` d'engines/lure/metaengine.cpp) : l'hôte traduit les
 * touches (vague J), le moteur ne connaît que les actions. `indexPrevious` / `indexNext` / `indexSelect` parcourent un menu
 * surgissant ; `yes` / `no` répondent à « Vous êtes sûr (o/n) ? » ; `escape` ferme un menu ou demande de quitter.
 */
export type LureAction =
  | "saveGame"
  | "restoreGame"
  | "restartGame"
  | "escape"
  | "indexPrevious"
  | "indexNext"
  | "indexSelect"
  | "yes"
  | "no"
  // Touches des combats (`kActionFight*`) : flèches gauche et droite, pavé 7 4 1 9 6 3 (haut, milieu, bas ; gauche puis droite). Le moteur les
  // tient enfoncées jusqu'à `actionEnd`.
  | "fightMoveLeft"
  | "fightMoveRight"
  | "fightCursorLeftTop"
  | "fightCursorLeftMiddle"
  | "fightCursorLeftBottom"
  | "fightCursorRightTop"
  | "fightCursorRightMiddle"
  | "fightCursorRightBottom";

/**
 * Entrée de l'utilisateur. La souris est un **état** (position 320 x 200, masque de boutons `MouseButton`) dont le moteur tire les
 * appuis et les relâchements comme les événements `EVENT_LBUTTONDOWN`… de ScummVM ; `wheel` est la molette ; une action est un
 * événement.
 */
export type LureInput =
  | { type: "pointer"; x: number; y: number; buttons: number }
  | { type: "wheel"; delta: -1 | 1 }
  | { type: "action"; action: LureAction }
  /** Fin de l'appui d'une touche d'action (`EVENT_CUSTOM_ENGINE_ACTION_END` : seuls les combats s'en servent). */
  | { type: "actionEnd"; action: LureAction };

export interface LureHost extends BaseHost {
  /** Événements d'entrée reçus depuis l'appel précédent (la file est vidée). */
  pollInput(): readonly LureInput[];
  /**
   * Journal du moteur (méthodes natives et gestionnaires pas encore portés, avertissements de ScummVM `warning`). Facultatif : le
   * moteur garde de toute façon les dernières lignes (`LureEngine.journal`).
   */
  log?(message: string): void;
  /**
   * Fin de partie (le joueur est mort ou pris : `GS_RESTORE`) : l'hôte propose « Recommencer » ou « Restituer » (D5, dialogues
   * communs du site). Rend vrai pour recommencer ; sans réponse ou sans méthode, la partie recommence (`RestartRestoreDialog` n'est
   * pas porté).
   */
  restartOrRestore?(): boolean;
  /**
   * Même question, sans bloquer (`RestartRestoreDialog::show` de ScummVM attend le joueur) : l'hôte pose sa fenêtre et appelle `answer(true)`
   * pour recommencer (sans sauvegarde à restituer, ou fenêtre fermée), ou ne répond pas si une partie a été restituée (le moteur est alors
   * remis à neuf, la séquence d'attente abandonnée). Le moteur attend la réponse en séquence : le monde est figé. Prime sur `restartOrRestore`.
   */
  chooseRestartRestore?(answer: (restart: boolean) => void): void;
  /** Le joueur a choisi « Sauvegarder » ou « Restituer » (barre de menus ou touche) : dialogues communs du site (D5, vague S). */
  openSaveDialog?(save: boolean): void;
}
