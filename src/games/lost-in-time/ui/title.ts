import { copy } from "../copy";
import { h } from "../../../ui/dom";
import { titleScreen } from "../../../ui/title-screen";

/** Jaquette et manuel d'origine, servis depuis `original/lost-in-time/`. */
const COVER_URL = `${import.meta.env.BASE_URL}lost-in-time/COVER.png`;
const MANUAL_URL = `${import.meta.env.BASE_URL}lost-in-time/MANUEL.pdf`;

/** Écran titre, avant le jeu : jaquette du jeu, nouvelle partie, reprise d'une partie, manuel et contrôles. */
export function renderTitle(onStart: () => void): HTMLElement {
  const picture = h("img", { class: "lit-title-picture", src: COVER_URL, alt: copy.coverAlt, width: 280, height: 343 });
  const start = h("button", { class: "primary", type: "button", onclick: onStart }, copy.play);
  queueMicrotask(() => start.focus());
  return titleScreen(
    picture,
    h("h1", {}, copy.title),
    start,
    // Comment reprendre une partie : toujours affiché, la sauvegarde se charge depuis le jeu.
    h("p", { class: "muted lit-title-note lit-title-hint" }, copy.loadHint),
    h("a", { class: "button secondary", href: MANUAL_URL, target: "_blank", rel: "noopener" }, copy.manual),
    h("p", { class: "muted lit-title-note" }, copy.manualNote),
    h("ul", { class: "help-list" }, ...copy.helpText.map((t) => h("li", {}, t))),
  );
}
