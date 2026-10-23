import { copy } from "./copy";
import { h, type Child } from "./dom";

/**
 * Écran de présentation commun aux jeux : l'image du jeu à gauche (au-dessus sur un écran étroit), et à droite le
 * lien de retour vers l'accueil puis le contenu propre au jeu (titre, boutons, réglages…). Styles : `src/ui/style.css`,
 * section « écran titre ».
 */
export function titleScreen(picture: HTMLElement, ...content: Child[]): HTMLElement {
  picture.classList.add("title-picture");
  return h(
    "section",
    { class: "title-screen" },
    picture,
    h("div", { class: "title-form" }, h("a", { class: "back-link", href: "#/" }, copy.backToGames), ...content),
  );
}
