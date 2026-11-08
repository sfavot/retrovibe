/**
 * Barre tactile des jeux de pointer-et-cliquer sur canvas (Drascula, Flight of the Amazon Queen) : état du bouton « Passer ».
 */

/** Ce que le bouton doit exposer : l'attribut `disabled` et `aria-disabled` vont ensemble. */
export interface ToggleableButton {
  disabled: boolean;
  setAttribute(name: string, value: string): void;
}

/**
 * Active le bouton « Passer » quand un appui sur Échap aurait un effet (`canSkip` du moteur), le grise sinon. Appelé à chaque
 * image : n'écrit dans le DOM que si l'état change.
 */
export function syncSkipButton(button: ToggleableButton, canSkip: boolean): void {
  if (button.disabled === !canSkip) return;
  button.disabled = !canSkip;
  button.setAttribute("aria-disabled", String(!canSkip));
}
