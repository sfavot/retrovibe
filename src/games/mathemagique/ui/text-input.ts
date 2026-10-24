import type { TextInputPort } from "../scenes/monitor";

/** Ce que le champ doit savoir de la page : le canvas du jeu et la façon de brancher un clavier physique sur le moteur. */
export interface TextInputHost {
  readonly canvas: HTMLCanvasElement;
  /** Branche les touches de l'élément sur le moteur (`BrowserHost.bindKeyboard`). */
  bindKeyboard(target: HTMLElement): void;
}

export interface BrowserTextInput extends TextInputPort {
  /** Champ HTML invisible, à poser dans la page (près du canvas). */
  readonly element: HTMLInputElement;
}

/**
 * Pont vers le clavier des téléphones (`TextInputPort`) : le nom se tape dans le canvas, mais un canvas ne fait pas monter le clavier
 * virtuel. Pendant la saisie, ce champ invisible prend le focus.
 *
 * Pas de doublon : un clavier physique envoie des touches reconnues (`key` = « a », « Backspace »…). Celles-ci vont au moteur
 * (`bindKeyboard`) et le jeu les empêche (`preventDefault`), donc le navigateur n'insère rien dans le champ. Un clavier virtuel envoie
 * des touches « Unidentified » / en composition : le moteur les ignore, le navigateur insère le texte, et seul ce texte est relayé
 * (`beforeinput`). Le texte en cours de composition n'est relayé qu'à sa validation.
 */
export function createBrowserTextInput(host: TextInputHost): BrowserTextInput {
  const element = document.createElement("input");
  element.type = "text";
  element.className = "mw-text-input";
  element.tabIndex = -1;
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("autocomplete", "off");
  element.setAttribute("autocapitalize", "off");
  element.setAttribute("autocorrect", "off");
  element.setAttribute("spellcheck", "false");
  element.setAttribute("enterkeyhint", "done");
  host.bindKeyboard(element);

  const listeners = new Set<(text: string) => void>();
  const emit = (text: string): void => {
    for (const listener of [...listeners]) listener(text);
  };
  /** La saisie est attendue : le champ reprend le focus au prochain geste si un clic sur le canvas le lui a pris. */
  let wanted = false;

  element.addEventListener("beforeinput", (event) => {
    if (event.isComposing) return;
    if (event.inputType === "insertText" && event.data) emit(event.data);
    else if (event.inputType === "deleteContentBackward") emit("\b");
    else if (event.inputType === "insertLineBreak") emit("\n");
    // Le champ ne garde rien : il ne sert qu'à recevoir les événements.
    event.preventDefault();
  });
  element.addEventListener("compositionend", (event) => {
    if (event.data) emit(event.data);
    element.value = "";
  });
  // Appui sur le canvas : il prend le focus (pour les touches) ; le clavier virtuel revient au relâchement, qui est un geste du joueur.
  host.canvas.addEventListener("pointerup", () => {
    if (wanted) element.focus({ preventScroll: true });
  });

  return {
    element,
    focus() {
      wanted = true;
      element.focus({ preventScroll: true });
    },
    blur() {
      wanted = false;
      element.value = "";
      if (document.activeElement === element) {
        element.blur();
        host.canvas.focus({ preventScroll: true });
      }
    },
    onText(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
