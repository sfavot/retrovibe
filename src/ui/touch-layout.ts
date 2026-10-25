/** Classe de l'élément pivoté de 90° en plein écran (la feuille de style le dimensionne à la fenêtre tournée). */
export const ROTATED_CLASS = "is-rotated";

/** Classe de la page d'un jeu en disposition tactile paysage (colonnes de boutons de part et d'autre de l'écran, `ui/style.css`). */
export const TOUCH_LANDSCAPE_CLASS = "is-touch-landscape";

/** L'élément est-il dans un plein écran pivoté ? Les coordonnées de la page n'y sont plus alignées sur celles de l'élément. */
export function isRotated(element: Element): boolean {
  return element.closest(`.${ROTATED_CLASS}`) !== null;
}

export interface TouchLayoutState {
  /** Écran tactile (`(pointer: coarse)`). */
  coarse: boolean;
  /** La fenêtre est en paysage. */
  landscape: boolean;
  /** L'élément est dans un plein écran pivoté : la fenêtre est en portrait, mais le jeu s'y affiche en paysage. */
  rotated: boolean;
}

/**
 * Faut-il la disposition tactile paysage ? Sur écran tactile en paysage, ou dans le plein écran pivoté. Une requête de média ne
 * pouvant pas se combiner avec une classe, la feuille de style ne connaît que la classe `is-touch-landscape`.
 */
export function isTouchLandscape({ coarse, landscape, rotated }: TouchLayoutState): boolean {
  return (coarse && landscape) || rotated;
}

/** Pose ou retire `is-touch-landscape` selon l'état courant de la fenêtre et de l'élément. */
export function syncTouchLayout(element: Element): void {
  const on = isTouchLandscape({
    coarse: matchMedia("(pointer: coarse)").matches,
    landscape: matchMedia("(orientation: landscape)").matches,
    rotated: isRotated(element),
  });
  element.classList.toggle(TOUCH_LANDSCAPE_CLASS, on);
}

/**
 * Tient `is-touch-landscape` à jour sur la page d'un jeu : posée tout de suite (pas de saut au premier affichage), puis à chaque
 * changement de média, de taille ou d'orientation. La rotation du plein écran la met à jour d'elle-même (`syncTouchLayout`).
 * Renvoie la fonction qui détache les écouteurs ; ils se détachent aussi seuls quand l'élément, une fois affiché, a quitté la page.
 */
export function trackTouchLayout(element: Element): () => void {
  let seen = false;
  const queries = [matchMedia("(pointer: coarse)"), matchMedia("(orientation: landscape)")];
  const stop = (): void => {
    for (const query of queries) query.removeEventListener("change", update);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
  };
  function update(): void {
    if (element.isConnected) seen = true;
    else if (seen) return stop();
    syncTouchLayout(element);
  }
  for (const query of queries) query.addEventListener("change", update);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  syncTouchLayout(element);
  return stop;
}
