import { h } from "../../../ui/dom";
import { titleScreen } from "../../../ui/title-screen";
import { copy } from "../copy";

/** Dossier des fichiers du jeu (servi depuis `original/swiv3d/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}swiv3d`;
/** Jaquette : écran titre du jeu (`GLOBAL.BD` 1003), pixels non carrés mis au format 4:3 (`scripts/swiv3d/cover.mts`). */
export const COVER_URL = `${GAME_URL}/COVER.png`;
export const COVER_SIZE: [number, number] = [640, 480];
/** Manuel français d'origine (Windows-1252). */
export const MANUAL_FILE = "MANUEL.TXT";

/**
 * Écran de présentation, avant le jeu : jaquette, titre, « Jouer », manuel d'origine et commandes (même composant que les
 * autres jeux). `failure` : région d'erreur sous les boutons (échec du chargement du moteur ou du manuel).
 */
export function renderTitle(onPlay: (button: HTMLButtonElement, failure: HTMLElement) => void, onManual: (failure: HTMLElement) => void): HTMLElement {
  const picture = h("img", { class: "sw3-title-picture", src: COVER_URL, alt: copy.coverAlt, width: COVER_SIZE[0], height: COVER_SIZE[1] });
  const failure = h("p", { class: "sw3-error", role: "alert" });
  const play = h("button", { class: "primary", type: "button" }, copy.play);
  play.addEventListener("click", () => onPlay(play, failure));
  queueMicrotask(() => play.focus());
  return titleScreen(
    picture,
    h("h1", {}, copy.title),
    h("p", { class: "muted sw3-title-note" }, copy.description),
    play,
    failure,
    h("button", { class: "secondary", type: "button", onclick: () => onManual(failure) }, copy.manual),
    h("p", { class: "muted sw3-title-note" }, copy.manualNote),
    h("h2", { class: "sw3-title-controls" }, copy.controlsTitle),
    h("ul", { class: "help-list" }, ...copy.controls.map((text) => h("li", {}, text))),
  );
}
