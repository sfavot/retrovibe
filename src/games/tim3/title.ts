import { h } from "../../ui/dom";
import { titleScreen } from "../../ui/title-screen";
import { copy } from "./copy";

/** Dossier des fichiers du jeu (servi depuis `original/tim3/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}tim3`;
/** Jaquette : un puzzle dessiné par le moteur (`scripts/tim3-cover.mts`, vague J). */
export const COVER_URL = `${GAME_URL}/COVER.png`;
export const COVER_SIZE: [number, number] = [640, 480];

/**
 * Écran de présentation : jaquette, titre, « Jouer », aide et contrôles (composant commun). `failure` : région d'erreur sous
 * le bouton (échec du chargement du jeu). Tant que la jaquette n'existe pas, l'image est masquée.
 */
export function renderTitle(onPlay: (button: HTMLButtonElement, failure: HTMLElement) => void, onHelp: () => void): HTMLElement {
  const picture = h("img", { class: "tim3-title-picture", src: COVER_URL, alt: copy.coverAlt, width: COVER_SIZE[0], height: COVER_SIZE[1] });
  picture.addEventListener("error", () => (picture.hidden = true));
  const failure = h("p", { class: "tim3-error", role: "alert" });
  const play = h("button", { class: "primary", type: "button" }, copy.play);
  play.addEventListener("click", () => onPlay(play, failure));
  queueMicrotask(() => play.focus());
  return titleScreen(
    picture,
    h("h1", {}, copy.title),
    h("p", { class: "muted" }, copy.description),
    play,
    failure,
    h("button", { class: "secondary", type: "button", onclick: onHelp }, copy.help),
    h("h2", {}, copy.controlsTitle),
    h("ul", { class: "help-list" }, ...copy.controls.slice(0, 3).map((text) => h("li", {}, text))),
    h("p", { class: "muted tim3-note" }, copy.copyright),
  );
}
