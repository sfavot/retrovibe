/** Classe de l'élément pivoté de 90° en plein écran (la feuille de style le dimensionne à la fenêtre tournée). */
export const ROTATED_CLASS = "is-rotated";

/** L'élément est-il dans un plein écran pivoté ? Les coordonnées de la page n'y sont plus alignées sur celles de l'élément. */
export function isRotated(element: Element): boolean {
  return element.closest(`.${ROTATED_CLASS}`) !== null;
}
