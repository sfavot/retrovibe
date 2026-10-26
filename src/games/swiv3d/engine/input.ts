/**
 * Entrées du joueur pour un tick : l'ensemble d'actions de `docs/swiv3d/player.md` §5.2 (les 11 touches du profil, la
 * sélection directe d'arme, la pause), plus des axes analogiques optionnels (souris, manette : §5.3-5.4).
 *
 * Les booléens sont des **états maintenus** (tourner, avancer, tir) sauf `weaponNext`, `weaponPrev`, `weaponDirect` et
 * `fireSpecial`, qui sont des appuis brefs : l'exe efface la touche après usage (`FUN_004582dc`), l'appelant ne doit donc
 * les lever qu'au tick de l'appui (`HeldInput` de `src/ui/held-input.ts` fournit cette distinction).
 */
export interface PlayerInput {
  turnLeft: boolean;
  turnRight: boolean;
  forward: boolean;
  back: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
  /** « Strafe On/Brake » (Ctrl gauche) : tourner devient déplacement latéral (hélicoptère) ; frein (véhicules). */
  brake: boolean;
  firePrimary: boolean;
  /** Appui bref : tir spécial. */
  fireSpecial: boolean;
  /** Appui bref : arme suivante (« Select Up »). */
  weaponNext: boolean;
  /** Appui bref : arme précédente (« Select Down »). */
  weaponPrev: boolean;
  /** Appui bref : sélection directe, 1 à 10 (touches `1`..`0`), ou `null`. */
  weaponDirect: number | null;
  /** `true` : le tick est sauté (la pause de l'exe est un menu bloquant, pas un drapeau de simulation). */
  pause: boolean;
  /**
   * Axes analogiques optionnels, valeurs d'origine : souris ±190, manette ±128 (voir `player.md` §5.3-5.4). Un axe absent ou nul
   * laisse la main aux touches. `turn` : droite positif ; `forward` : avant positif ; `strafe` : droite positif.
   */
  axes?: { turn?: number; forward?: number; strafe?: number };
}

export function emptyInput(): PlayerInput {
  return {
    turnLeft: false,
    turnRight: false,
    forward: false,
    back: false,
    strafeLeft: false,
    strafeRight: false,
    brake: false,
    firePrimary: false,
    fireSpecial: false,
    weaponNext: false,
    weaponPrev: false,
    weaponDirect: null,
    pause: false,
  };
}

/** Entrée partielle (les autres champs à `false`) : pratique pour les tests et les scénarios. */
export function input(partial: Partial<PlayerInput> = {}): PlayerInput {
  return { ...emptyInput(), ...partial };
}
