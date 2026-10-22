import { hasSavedGame } from "../engine/saves";
import { copy } from "../copy";
import { copy as shared } from "../../../ui/copy";
import { h } from "../../../ui/dom";

/** Jaquette et manuel d'origine, servis depuis `original/lost-in-time/`. */
const COVER_URL = `${import.meta.env.BASE_URL}lost-in-time/COVER.png`;
const MANUAL_URL = `${import.meta.env.BASE_URL}lost-in-time/MANUEL.pdf`;

/** Écran titre, avant le jeu : jaquette du jeu, nouvelle partie et manuel. */
export function renderTitle(onStart: () => void): HTMLElement {
  const picture = h("img", { class: "title-picture lit-title-picture", src: COVER_URL, alt: copy.coverAlt, width: 280, height: 343 });
  const start = h("button", { class: "primary", type: "button", onclick: onStart }, copy.play);
  queueMicrotask(() => start.focus());
  return h(
    "section",
    { class: "title-screen" },
    picture,
    h(
      "div",
      { class: "title-form" },
      h("a", { class: "back-link", href: "#/" }, shared.backToGames),
      h("h1", {}, copy.title),
      start,
      // Rappel pour reprendre une partie, seulement s'il y en a une
      ...(hasSavedGame() ? [h("p", { class: "muted lit-title-note lit-title-hint" }, copy.loadHint)] : []),
      h("a", { class: "button secondary", href: MANUAL_URL, target: "_blank", rel: "noopener" }, copy.manual),
      h("p", { class: "muted lit-title-note" }, copy.manualNote),
    ),
  );
}
