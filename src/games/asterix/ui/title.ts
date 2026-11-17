import { h } from "../../../ui/dom";
import { localStorageStore } from "../../../ui/local-storage";
import { titleScreen } from "../../../ui/title-screen";
import { readSave } from "../scenes/save";
import { copy } from "./copy";

/** Une partie interrompue peut être reprise (sauvegarde valide ; une illisible est effacée au passage). */
export function hasSavedGame(): boolean {
  return readSave(localStorageStore()) !== null;
}

/**
 * Écran de présentation, avant le jeu : titre, « Jouer », contrôles et règles (même composant que les autres jeux).
 * `onResume` ajoute « Continuer », bouton principal au-dessus de « Jouer », qui devient secondaire. La jaquette viendra
 * avec la publication (vague F) : `picture` est vide d'ici là.
 */
export function renderTitle(onStart: () => void, onResume?: () => void, picture: HTMLElement = h("div", {})): HTMLElement {
  const start = h("button", { class: onResume ? "secondary" : "primary", type: "button", onclick: onStart }, copy.play);
  const resume = onResume ? h("button", { class: "primary", type: "button", onclick: onResume }, copy.resumeGame) : null;
  queueMicrotask(() => (resume ?? start).focus());
  return titleScreen(
    picture,
    h("h1", {}, copy.title),
    resume,
    start,
    onResume ? h("p", { class: "muted asterix-title-note" }, copy.resumeNote) : null,
    h("h2", { class: "asterix-title-heading" }, copy.rulesTitle),
    h("ul", { class: "help-list" }, ...copy.rules.map((text) => h("li", {}, text))),
    h("h2", { class: "asterix-title-heading" }, copy.controlsTitle),
    h("ul", { class: "help-list" }, ...copy.controls.map((text) => h("li", {}, text))),
  );
}
