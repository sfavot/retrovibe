import { h } from "./dom";

export interface FullscreenOptions {
  /** Libellé du bouton (l'état se lit dans `aria-pressed`). */
  label: string;
  /**
   * Écran tactile : mettre le jeu en paysage dès le plein écran. On tente d'abord le verrou d'orientation (Android) ; s'il manque
   * ou est refusé (iPhone, iPad) et que l'appareil est en portrait, l'élément pivote de 90° (classe `is-rotated`).
   */
  landscape?: boolean;
  /** Clic sur le bouton, après le changement demandé (rendre le focus au jeu…). */
  onClick?(event: MouseEvent): void;
}

export interface Fullscreen {
  readonly button: HTMLButtonElement;
  /** Sort du plein écran (l'élément quitte la page : sans l'API, la page défilerait encore bloquée). */
  exit(): void;
  /** Sort du plein écran et détache l'écouteur ; sans effet la seconde fois. */
  dispose(): void;
}

/** Délai au-delà duquel une demande de plein écran restée sans réponse cède la place au repli. */
const FALLBACK_MS = 1000;

type LockableOrientation = ScreenOrientation & { lock?(orientation: string): Promise<void> };

/** Classe de l'élément pivoté de 90° en plein écran (la feuille de style le dimensionne à la fenêtre tournée). */
export const ROTATED_CLASS = "is-rotated";

/** L'élément est-il dans un plein écran pivoté ? Les coordonnées de la page n'y sont plus alignées sur celles de l'élément. */
export function isRotated(element: Element): boolean {
  return element.closest(`.${ROTATED_CLASS}`) !== null;
}

export interface RotationState {
  /** Écran tactile et jeu demandant le paysage. */
  coarse: boolean;
  /** L'appareil est tenu en portrait. */
  portrait: boolean;
  /** Le verrou d'orientation a réussi : l'appareil est déjà en paysage. */
  lockOk: boolean;
  /** Plein écran de repli : l'élément couvre la fenêtre (seul un élément ordinaire peut pivoter, pas un vrai plein écran). */
  covering: boolean;
}

/** Faut-il faire pivoter l'élément de 90° pour que le jeu s'affiche en paysage ? */
export function shouldRotate({ coarse, portrait, lockOk, covering }: RotationState): boolean {
  return covering && coarse && portrait && !lockOk;
}

/** La fenêtre est-elle en portrait ? Même critère que les règles CSS en paysage : les deux se renversent ensemble. */
export function isPortrait(): boolean {
  return matchMedia("(orientation: portrait)").matches;
}

/**
 * Bouton « Plein écran » d'un élément. API Fullscreen quand le navigateur l'offre (ordinateur, Android, iPad) ; sinon (iPhone,
 * ou demande refusée) l'élément couvre la fenêtre, les barres du navigateur restant visibles. Dans les deux cas l'élément porte
 * la classe `is-fullscreen` et la page `has-fullscreen` (défilement bloqué).
 *
 * Écran tactile en portrait (`landscape`) : verrou d'orientation quand le navigateur l'offre ; sinon l'élément, en repli, pivote
 * de 90° (`is-rotated`) pour se montrer en paysage, et reprend sa place si on tourne l'appareil. Un vrai plein écran ne pouvant
 * pas pivoter (le navigateur impose `transform: none`), on passe au repli quand le verrou manque.
 */
export function createFullscreen(target: HTMLElement, options: FullscreenOptions): Fullscreen {
  const button = h("button", { type: "button", class: "fullscreen-button", "aria-pressed": "false" }, options.label);
  /** Plein écran sans l'API : l'élément couvre la fenêtre. */
  let covering = false;
  /** Verrou d'orientation obtenu pour ce plein écran. */
  let lockOk = false;
  const wantsLandscape = (): boolean => options.landscape === true && matchMedia("(pointer: coarse)").matches;
  const lockable = (): LockableOrientation | undefined => screen.orientation as LockableOrientation | undefined;

  const active = (): boolean => covering || document.fullscreenElement === target;
  const sync = (): void => {
    // le vrai plein écran arrivé après le repli le remplace
    if (document.fullscreenElement === target) covering = false;
    const on = active();
    if (!on) lockOk = false;
    target.classList.toggle("is-fullscreen", on);
    target.classList.toggle(ROTATED_CLASS, shouldRotate({ coarse: wantsLandscape(), portrait: isPortrait(), lockOk, covering }));
    document.documentElement.classList.toggle("has-fullscreen", on);
    button.setAttribute("aria-pressed", String(on));
  };
  const cover = (): void => {
    covering = true;
    window.scrollTo(0, 0);
    sync();
  };
  /** Quitte le vrai plein écran pour le repli, le seul qui puisse pivoter. */
  const coverInstead = async (): Promise<void> => {
    await document.exitFullscreen().catch(() => {});
    cover();
  };
  const enter = async (): Promise<void> => {
    const landscape = wantsLandscape();
    // Sans verrou possible et en portrait, le vrai plein écran resterait en portrait : on passe directement au repli (iPad).
    if (
      !document.fullscreenEnabled ||
      typeof target.requestFullscreen !== "function" ||
      (landscape && isPortrait() && typeof lockable()?.lock !== "function")
    ) {
      cover();
      return;
    }
    // Certains navigateurs intégrés (vues web d'applications) laissent la demande sans réponse : on se replie au bout d'une seconde.
    const fallback = window.setTimeout(cover, FALLBACK_MS);
    try {
      await target.requestFullscreen({ navigationUI: "hide" });
    } catch {
      window.clearTimeout(fallback);
      cover();
      return;
    }
    window.clearTimeout(fallback);
    if (landscape) {
      try {
        await lockable()?.lock?.("landscape");
        lockOk = true;
      } catch {
        // verrou refusé : si l'appareil est en portrait, le repli pivoté prend le relais
        if (isPortrait() && document.fullscreenElement === target) await coverInstead();
      }
    }
  };
  /** L'appareil a tourné : le repli pivote ou reprend sa place ; un vrai plein écran resté en portrait sans verrou passe au repli. */
  const onOrientation = (): void => {
    if (document.fullscreenElement === target && !lockOk && wantsLandscape() && isPortrait()) void coverInstead();
    else sync();
  };
  const exit = (): void => {
    if (covering) {
      covering = false;
      sync();
    } else if (document.fullscreenElement === target) {
      document.exitFullscreen().catch(() => {});
    }
  };

  button.addEventListener("click", (event) => {
    if (active()) exit();
    else void enter();
    options.onClick?.(event);
  });
  document.addEventListener("fullscreenchange", sync);
  window.addEventListener("resize", onOrientation);
  window.addEventListener("orientationchange", onOrientation);
  screen.orientation?.addEventListener?.("change", onOrientation);

  let disposed = false;
  return {
    button,
    exit,
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("resize", onOrientation);
      window.removeEventListener("orientationchange", onOrientation);
      screen.orientation?.removeEventListener?.("change", onOrientation);
      exit();
      covering = false;
      target.classList.remove("is-fullscreen", ROTATED_CLASS);
      document.documentElement.classList.remove("has-fullscreen");
    },
  };
}
