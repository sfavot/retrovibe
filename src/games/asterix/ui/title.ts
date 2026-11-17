import { h } from "../../../ui/dom";
import { localStorageStore } from "../../../ui/local-storage";
import { titleScreen } from "../../../ui/title-screen";
import { readSave } from "../scenes/save";
import { copy } from "./copy";

/** Dossier des fichiers du jeu (servi depuis `original/asterix/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}asterix`;
/** Jaquette : la pochette du CD, prise en couverture du manuel d'origine (`scripts/asterix/cover.mts`). */
export const COVER_URL = `${GAME_URL}/COVER.webp`;
export const COVER_SIZE: [number, number] = [280, 275];
/** Manuel d'origine (édition Macintosh), servi tel quel depuis `original/asterix/`. */
const MANUAL_URL = `${GAME_URL}/MANUEL.pdf`;

/** Une partie interrompue peut être reprise (sauvegarde valide ; une illisible est effacée au passage). */
export function hasSavedGame(): boolean {
  return readSave(localStorageStore()) !== null;
}

export interface TitleActions {
  onStart(): void;
  /** Reprise de la partie sauvegardée : ajoute « Continuer », bouton principal au-dessus de « Jouer », qui devient secondaire. */
  onResume?: () => void;
  onHelp(): void;
}

/**
 * Écran de présentation, avant le jeu (même composant que les autres jeux) : jaquette, titre, description, « Continuer »
 * et « Jouer », puis l'aide et le manuel d'origine.
 */
export function renderTitle({ onStart, onResume, onHelp }: TitleActions): HTMLElement {
  const picture = h("img", { class: "box-art", src: COVER_URL, alt: copy.coverAlt, width: COVER_SIZE[0], height: COVER_SIZE[1] });
  const start = h("button", { class: onResume ? "secondary" : "primary", type: "button", onclick: onStart }, copy.play);
  const resume = onResume ? h("button", { class: "primary", type: "button", onclick: onResume }, copy.resumeGame) : null;
  queueMicrotask(() => (resume ?? start).focus());
  return titleScreen(
    picture,
    h("h1", {}, copy.title),
    h("p", { class: "asterix-title-text" }, copy.description),
    resume,
    start,
    onResume ? h("p", { class: "muted asterix-title-text" }, copy.resumeNote) : null,
    h("button", { class: "secondary", type: "button", onclick: onHelp }, copy.help),
    h("a", { class: "button secondary", href: MANUAL_URL, target: "_blank", rel: "noopener" }, copy.manual),
    h("p", { class: "muted asterix-title-text" }, copy.manualNote),
  );
}
