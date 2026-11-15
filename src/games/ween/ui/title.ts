import "../../../ui/point-click.css";
import { h } from "../../../ui/dom";
import { renderHelpPage } from "../../../ui/point-click-pages";
import { titleScreen } from "../../../ui/title-screen";
import { copy } from "../copy";

/** Dossier des fichiers du jeu (servi depuis `original/ween/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}ween/`;
/** Jaquette : un écran du jeu (pixel art 320×200), composé par le moteur (`scripts/ween-cover.mts`). */
export const COVER_URL = `${GAME_URL}COVER.png`;
export const COVER_SIZE: [number, number] = [320, 200];

/**
 * Écran titre, avant le jeu : image du jeu, « Jouer » (le jeu part de son introduction ; les parties se reprennent depuis le
 * menu de la disquette), lien vers l'aide et les crédits, commandes.
 */
export function renderTitle(container: HTMLElement, onStart: () => void): HTMLElement {
  const picture = h("img", { class: "pc-title-picture", src: COVER_URL, alt: copy.coverAlt, width: COVER_SIZE[0], height: COVER_SIZE[1] });
  const start = h("button", { class: "primary", type: "button", onclick: onStart }, copy.play);
  const showTitle = (): void => {
    container.replaceChildren(renderTitle(container, onStart));
  };
  const help = h("button", { class: "secondary", type: "button", onclick: () => container.replaceChildren(renderHelp(showTitle)) }, copy.help);
  queueMicrotask(() => start.focus());
  return titleScreen(
    picture,
    h("h1", {}, copy.title),
    start,
    h("p", { class: "muted pc-title-note" }, copy.loadHint),
    help,
    h("h2", { class: "pc-title-controls" }, copy.controlsTitle),
    h("ul", { class: "help-list" }, ...copy.controls.map((t) => h("li", {}, t))),
  );
}

/** Aide et crédits : comment jouer, clavier, sauvegardes, origine du jeu et de son moteur, statut des données. */
export function renderHelp(onBack: () => void): HTMLElement {
  return renderHelpPage(
    copy.helpTitle,
    [
      { title: copy.helpHowTitle, paragraphs: copy.helpHow },
      { title: copy.helpKeysTitle, keys: copy.helpKeys },
      { title: copy.helpSavesTitle, paragraphs: [copy.helpSaves] },
      {
        title: copy.helpAboutTitle,
        paragraphs: copy.helpAbout,
        links: [
          [copy.sourceUrl, copy.helpSource],
          ["https://www.scummvm.org", copy.helpScummvm],
        ],
      },
    ],
    onBack,
    copy.helpBack,
  );
}
