/** Ce que le navigateur dit de son mode d'affichage. */
export interface DisplayState {
  /** `navigator.standalone` (Safari iOS : vrai quand la page a été lancée depuis l'écran d'accueil). */
  navigatorStandalone?: boolean;
  /** `matchMedia("(display-mode: standalone)")` (ou `fullscreen`) : application installée, Android et ordinateur. */
  displayModeStandalone?: boolean;
}

/** iPhone ou iPod (pas l'iPad, qui se présente comme un Mac et offre déjà l'API Fullscreen). */
export function isIPhone(userAgent: string): boolean {
  return /\b(iPhone|iPod)\b/.test(userAgent);
}

/** La page est-elle lancée comme une application installée (sans barres du navigateur) ? */
export function isStandalone({ navigatorStandalone, displayModeStandalone }: DisplayState): boolean {
  return navigatorStandalone === true || displayModeStandalone === true;
}

/** Faut-il suggérer d'ajouter le site à l'écran d'accueil ? Seulement sur iPhone, dans le navigateur : c'est le seul moyen d'y avoir un plein écran. */
export function shouldSuggestInstall(userAgent: string, display: DisplayState): boolean {
  return isIPhone(userAgent) && !isStandalone(display);
}

/** Lit le mode d'affichage courant. */
export function currentDisplayState(): DisplayState {
  return {
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone: matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches,
  };
}
