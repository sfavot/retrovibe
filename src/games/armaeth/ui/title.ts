import { h } from "../../../ui/dom";
import { titleScreen } from "../../../ui/title-screen";
import { copy } from "../copy";

/** Dossier des fichiers du jeu (servi depuis `original/armaeth/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}armaeth`;
/** Jaquette : écran titre du jeu (pixel art 320×200). */
export const COVER_URL = `${GAME_URL}/COVER.png`;
export const COVER_SIZE: [number, number] = [320, 200];

/**
 * Écran de présentation, avant le jeu : jaquette, titre, « Jouer », lien vers la page d'aide et contrôles (même composant que les
 * autres jeux). `failure` : région d'erreur sous le bouton (échec du chargement du moteur).
 */
export function renderTitle(onPlay: (button: HTMLButtonElement, failure: HTMLElement) => void, onHelp: () => void): HTMLElement {
  const picture = h("img", { class: "aeth-title-picture", src: COVER_URL, alt: copy.coverAlt, width: COVER_SIZE[0], height: COVER_SIZE[1] });
  const failure = h("p", { class: "aeth-error", role: "alert" });
  const play = h("button", { class: "primary", type: "button" }, copy.play);
  play.addEventListener("click", () => onPlay(play, failure));
  queueMicrotask(() => play.focus());
  return titleScreen(
    picture,
    h("h1", {}, copy.title),
    h("p", { class: "muted aeth-title-note" }, copy.description),
    play,
    failure,
    h("button", { class: "secondary", type: "button", onclick: onHelp }, copy.help),
    h("p", { class: "muted aeth-title-note" }, copy.helpNote),
    h("h2", { class: "aeth-title-controls" }, copy.controlsTitle),
    h("ul", { class: "help-list" }, ...copy.controls.map((text) => h("li", {}, text))),
  );
}
