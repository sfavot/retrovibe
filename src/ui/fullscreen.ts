import { h } from "./dom";

export interface FullscreenOptions {
  /** Libellé du bouton (l'état se lit dans `aria-pressed`). */
  label: string;
  /** Écran tactile : verrouiller le paysage en plein écran (Android ; ailleurs le verrou est refusé sans gêne). */
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

/**
 * Bouton « Plein écran » d'un élément. API Fullscreen quand le navigateur l'offre (ordinateur, Android, iPad) ; sinon (iPhone,
 * ou demande refusée) l'élément couvre la fenêtre, les barres du navigateur restant visibles. Dans les deux cas l'élément porte
 * la classe `is-fullscreen` et la page `has-fullscreen` (défilement bloqué).
 */
export function createFullscreen(target: HTMLElement, options: FullscreenOptions): Fullscreen {
  const button = h("button", { type: "button", class: "fullscreen-button", "aria-pressed": "false" }, options.label);
  /** Plein écran sans l'API : l'élément couvre la fenêtre. */
  let covering = false;

  const active = (): boolean => covering || document.fullscreenElement === target;
  const sync = (): void => {
    // le vrai plein écran arrivé après le repli le remplace
    if (document.fullscreenElement === target) covering = false;
    const on = active();
    target.classList.toggle("is-fullscreen", on);
    document.documentElement.classList.toggle("has-fullscreen", on);
    button.setAttribute("aria-pressed", String(on));
  };
  const cover = (): void => {
    covering = true;
    window.scrollTo(0, 0);
    sync();
  };
  const enter = async (): Promise<void> => {
    if (!document.fullscreenEnabled || typeof target.requestFullscreen !== "function") {
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
    if (options.landscape && matchMedia("(pointer: coarse)").matches) {
      (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape").catch(() => {});
    }
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

  let disposed = false;
  return {
    button,
    exit,
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("fullscreenchange", sync);
      exit();
      covering = false;
      target.classList.remove("is-fullscreen");
      document.documentElement.classList.remove("has-fullscreen");
    },
  };
}
