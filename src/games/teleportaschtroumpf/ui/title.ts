import { copy } from "./app";
import { h } from "../../../ui/dom";
import { readSave } from "../scenes/save";
import { localStorageStore } from "./browser-host";
import { titleScreen } from "../../../ui/title-screen";

/** Jaquette du jeu, servie depuis `original/teleportaschtroumpf/` (comme sur la carte de l'accueil). */
export const COVER_URL = `${import.meta.env.BASE_URL}teleportaschtroumpf/COVER.webp`;
/** Manuel d'origine (notice Infogrames convertie en PDF), servi depuis `original/teleportaschtroumpf/`. */
const MANUAL_URL = `${import.meta.env.BASE_URL}teleportaschtroumpf/MANUEL.pdf`;
/** Dimensions réelles de la jaquette. */
export const COVER_SIZE: [number, number] = [949, 949];

/** Une partie interrompue peut être reprise (sauvegarde valide ; une illisible est effacée au passage). */
export function hasSavedGame(): boolean {
  return readSave(localStorageStore) !== null;
}

/**
 * Écran de présentation, avant le jeu : jaquette, titre et « Jouer » (même composant que les autres jeux). `onResume`
 * ajoute « Reprendre la partie », bouton principal au-dessus de « Jouer », qui devient secondaire (comme Indy).
 */
export function renderTitle(onStart: () => void, onResume?: () => void): HTMLElement {
  const picture = h("img", { class: "tsm-title-picture", src: COVER_URL, alt: copy.coverAlt, width: COVER_SIZE[0], height: COVER_SIZE[1] });
  const start = h("button", { class: onResume ? "secondary" : "primary", type: "button", onclick: onStart }, copy.play);
  const resume = onResume ? h("button", { class: "primary", type: "button", onclick: onResume }, copy.resumeGame) : null;
  queueMicrotask(() => (resume ?? start).focus());
  return titleScreen(
    picture,
    h("h1", {}, copy.title),
    resume,
    start,
    h("a", { class: "button secondary", href: MANUAL_URL, target: "_blank", rel: "noopener" }, copy.manual),
    h("p", { class: "muted tsm-title-note" }, copy.manualNote),
    h("h2", { class: "tsm-title-controls" }, copy.controlsTitle),
    h("ul", { class: "help-list" }, ...copy.controls.map((t) => h("li", {}, t))),
  );
}
