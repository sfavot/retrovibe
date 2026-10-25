import { copy as shared } from "./copy";
import { h } from "./dom";
import { MissingFilesError } from "./files";
import { createFullscreen } from "./fullscreen";
import { isRotated, trackTouchLayout } from "./touch-layout";

/** Textes de la page du jeu (propres à chaque jeu ; la copy partagée reste dans `ui/copy.ts`). */
export interface GameShellCopy {
  canvasLabel: string;
  /** Libellé du bouton « Son ». */
  sound: string;
  /** Message de chargement ; sans valeur, la région d'état reste vide. */
  loading?: string;
  /** Préfixes des messages d'échec (suivis du détail de l'erreur). */
  loadError?: string;
  runtimeError?: string;
  /** Message propre aux fichiers manquants (`MissingFilesError`) : le jeu n'est pas installé, ce n'est pas un bogue. */
  missingFiles?: string;
}

/** Préférence « Son » telle que le bouton la lit (`SoundPrefs`). */
export interface ShellSoundPrefs {
  isEnabled(): boolean;
  toggle(): boolean;
  reload(): boolean;
}

export interface GameShellOptions {
  container: HTMLElement;
  logicalWidth: number;
  logicalHeight: number;
  /**
   * `integer` : le shell dimensionne le canvas à l'échelle entière la plus grande qui tient (fractionnaire en dessous de 1).
   *   Sur écran tactile, l'échelle devient fractionnaire : sur un téléphone, l'échelle entière laisserait l'écran à 1×.
   * `fractional` : le shell dimensionne le canvas à la plus grande échelle qui tient, même fractionnaire (écrans déjà grands,
   *   comme le 640×480 de Mathémagique, qu'une échelle entière laisserait à 1 sur la plupart des fenêtres).
   * `css` : la taille vient de la feuille de style du jeu (Lost in Time, 4:3 fluide) ; le shell n'y touche pas.
   */
  fit?: "integer" | "fractional" | "css";
  copy: GameShellCopy;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Classes propres au jeu, ajoutées aux classes `game-shell*`. */
  classes?: { root?: string; stage?: string; canvas?: string; footer?: string };
  /** Éléments dans le cadre de l'écran (champ de saisie invisible du clavier virtuel…). */
  stageChildren?: HTMLElement[];
  /** Éléments entre l'écran et le pied de page (barre tactile…). */
  afterStage?: HTMLElement[];
}

export interface GameShellRun {
  /** Une image : appelée à chaque `requestAnimationFrame` tant que le canvas est dans la page. Une exception arrête le jeu (`fail`). */
  onFrame(now: number): void;
  /** Onglet masqué (`true`) ou de nouveau visible (`false`) ; appelée aussi au démarrage si l'onglet est déjà masqué. */
  onPause?(hidden: boolean): void;
  /** Bouton « Son » : préférence, clé de stockage (pour suivre un autre onglet ; sans clé, tout changement du stockage relit la préférence) et déblocage audio au clic. */
  sound?: { prefs: ShellSoundPrefs; storageKey?: string; unlock?(): void };
  /** Écouteurs de plus, détachés avec les autres à la sortie. */
  listeners?: [EventTarget, string, EventListener][];
  /** À la sortie du jeu (page remplacée ou erreur d'exécution), une seule fois, après le détachement des écouteurs. */
  onDispose?(): void;
}

export interface GameShell {
  readonly main: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  readonly footer: HTMLElement;
  /** Conteneur des boutons du pied de page (le bouton « Son » y est ajouté ; d'autres peuvent l'être). */
  readonly toggles: HTMLElement;
  /** Affiche ou masque le message de chargement. */
  setLoading(loading: boolean): void;
  /** Remplace le message d'erreur (région d'alerte sous l'écran). */
  setError(message: string): void;
  /** Erreur de chargement (`load`, avant `start`) ou d'exécution : journalisée, jeu arrêté, message affiché. */
  fail(error: unknown, phase: "load" | "runtime"): void;
  /** Voile sur l'écran (fin de partie, erreur) avec un bouton optionnel. */
  showOverlay(message: string, action?: { label: string; onClick(): void }): void;
  /** Le canvas reprend le focus s'il ne le vole à personne. */
  focusCanvas(): void;
  /** Affiche l'écran et lance les écouteurs et la boucle d'images. */
  start(run: GameShellRun): void;
  /** Détache les écouteurs et arrête la boucle ; sans effet la seconde fois. */
  dispose(): void;
}

/** Marge sous l'écran (en plus de ce que la page occupe déjà autour). */
export const BOTTOM_MARGIN = 16;

/**
 * Échelle la plus grande qui tient dans la place disponible : entière (fractionnaire seulement en dessous de 1), ou
 * fractionnaire partout avec `integer = false`.
 */
export function fitScale(
  availableWidth: number,
  availableHeight: number,
  logicalWidth: number,
  logicalHeight: number,
  integer = true,
): number {
  const fit = Math.min(availableWidth / logicalWidth, availableHeight / logicalHeight);
  return integer && fit >= 1 ? Math.floor(fit) : Math.max(fit, 0.1);
}

/** Mesures de la page utiles au calcul de l'échelle (pixels CSS). */
export interface ShellMetrics {
  /** Largeur du conteneur (`main.clientWidth`). */
  mainWidth: number;
  /** Haut du conteneur dans la page (`main.getBoundingClientRect().top + scrollY`). */
  mainTop: number;
  /** Hauteur du conteneur et de l'écran (`offsetHeight`) : la différence est ce qui entoure l'écran (pied de page, barre tactile, message d'erreur). */
  mainHeight: number;
  stageHeight: number;
  /** Hauteur de la fenêtre. */
  viewportHeight: number;
  /** Largeur des colonnes de côté (paysage tactile : boutons et pied de page à gauche et à droite de l'écran, voir `asideWidth`). */
  asideWidth?: number;
}

/**
 * Hauteur du contenu d'un conteneur en colonne flex : ses enfants affichés, les espacements entre eux et ses marges intérieures.
 * Contrairement à `offsetHeight`, elle ne compte pas l'étirement d'un `min-height` (plein écran : `min-height: 100dvh`), qui
 * ferait croire que l'écran est entouré de toute la hauteur de la fenêtre.
 */
export function contentHeight(childHeights: readonly number[], gap: number, paddingTop: number, paddingBottom: number): number {
  const total = childHeights.reduce((sum, height) => sum + height, 0);
  return total + gap * Math.max(childHeights.length - 1, 0) + paddingTop + paddingBottom;
}

/** Échelle du canvas pour les mesures données : largeur moins 32 px de marges et les colonnes de côté, hauteur moins ce qui précède, entoure l'écran, et la marge du bas. */
export function shellScale(metrics: ShellMetrics, logicalWidth: number, logicalHeight: number, integer = true): number {
  const around = metrics.mainHeight - metrics.stageHeight;
  return fitScale(
    metrics.mainWidth - 32 - (metrics.asideWidth ?? 0),
    metrics.viewportHeight - metrics.mainTop - around - BOTTOM_MARGIN,
    logicalWidth,
    logicalHeight,
    integer,
  );
}

/**
 * Largeur prise par les colonnes de côté quand le conteneur est en grille à trois colonnes (paysage tactile) : les deux colonnes
 * extérieures et leurs gouttières. `columns` est la valeur calculée de `grid-template-columns` (pistes en px). Hors grille : 0.
 */
export function asideWidth(display: string, columns: string, columnGap: string): number {
  if (display !== "grid") return 0;
  const tracks = columns.split(" ").map(parseFloat);
  if (tracks.length !== 3 || tracks.some(Number.isNaN)) return 0;
  return tracks[0] + tracks[2] + 2 * (parseFloat(columnGap) || 0);
}

/**
 * Le canvas peut-il reprendre le focus sans le voler ? Seulement si personne d'autre ne l'a (`body`) ou s'il l'a déjà :
 * un bouton ou un lien activé au clavier le garde.
 */
export function canvasMayTakeFocus(active: Element | null, body: Element, canvas: Element): boolean {
  return active === null || active === body || active === canvas;
}

/** Message affiché pour une erreur de chargement ou d'exécution ; les fichiers manquants ont leur propre texte. */
export function failureMessage(error: unknown, prefix: string, missingFiles?: string): string {
  if (missingFiles !== undefined && error instanceof MissingFilesError) return missingFiles;
  return `${prefix} ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Sortie du jeu (`Host.exit`) : retour à l'accueil du site quand le jeu est monté depuis le site (lien de retour présent),
 * sinon, sur la page de dev, redémarrage. L'ancienne boucle s'arrête d'elle-même : son canvas n'est plus dans la page.
 */
export function leaveGame(backLabel: string | undefined, restart: () => void): void {
  if (backLabel) location.hash = "#/";
  else restart();
}

const join = (base: string, extra?: string): string => (extra ? `${base} ${extra}` : base);

/**
 * Page d'un jeu sur canvas : écran à l'échelle entière (ou dimensionné par la feuille de style), états de chargement et d'erreur,
 * lien de retour, boutons « Son » et « Plein écran », pause quand l'onglet est masqué, préférence de son suivie d'un onglet à
 * l'autre, boucle d'images arrêtée quand la page est remplacée.
 *
 * Écran tactile en paysage : la feuille de style range la barre tactile et le pied de page en colonnes de part et d'autre de
 * l'écran (`style.css`) ; l'échelle tient compte de leur largeur.
 *
 * `mountGameShell` pose le canvas (l'hôte du jeu en a besoin) et le message de chargement ; `start` affiche l'écran une fois le jeu chargé.
 */
export function mountGameShell(options: GameShellOptions): GameShell {
  const { container, logicalWidth, logicalHeight, copy, classes = {} } = options;
  const fit = options.fit ?? "integer";
  /** Taille du canvas calculée par le shell (`integer`, `fractional`) plutôt que par la feuille de style du jeu. */
  const sized = fit !== "css";
  const status = h("p", { class: "game-shell-status", role: "status" }, copy.loading);
  // Région d'erreur présente dès le départ (vide) pour que les lecteurs d'écran annoncent le message quand il arrive.
  const errors = h("p", { class: "game-shell-error", role: "alert" });
  const back = options.backLabel ? h("a", { class: "back-link", href: "#/" }, options.backLabel) : null;
  const main = h("main", { class: join(`game-shell game-shell--${sized ? "sized" : "css"}`, classes.root) }, status, errors);
  container.replaceChildren(main);
  // Disposition tactile paysage posée avant le premier affichage (la feuille de style ne connaît que cette classe).
  const untrackLayout = trackTouchLayout(main);
  const canvas = h("canvas", {
    class: join("game-shell-canvas", classes.canvas),
    width: logicalWidth,
    height: logicalHeight,
    tabindex: 0,
    "aria-label": copy.canvasLabel,
  });
  const stage = h("div", { class: join("game-shell-stage", classes.stage) }, canvas, ...(options.stageChildren ?? []));
  const toggles = h("div", { class: "game-shell-toggles" });
  const footer = h("div", { class: join("game-shell-footer", classes.footer) }, back, toggles);

  let disposeRun: (() => void) | null = null;
  let started = false;

  const focusCanvas = (): void => {
    if (canvasMayTakeFocus(document.activeElement, document.body, canvas)) canvas.focus();
  };
  const dispose = (): void => {
    untrackLayout();
    const run = disposeRun;
    disposeRun = null;
    run?.();
  };
  const setError = (message: string): void => {
    status.hidden = true;
    errors.textContent = message;
  };

  const shell: GameShell = {
    main,
    canvas,
    stage,
    footer,
    toggles,
    focusCanvas,
    dispose,
    setError,
    setLoading: (loading) => {
      status.hidden = !loading;
    },
    fail(error, phase) {
      console.error(error);
      dispose();
      const prefix = (phase === "load" ? copy.loadError : copy.runtimeError) ?? "";
      setError(failureMessage(error, prefix, copy.missingFiles));
    },
    showOverlay(message, action) {
      stage.append(
        h(
          "div",
          { class: "game-shell-overlay", role: "alert" },
          h("p", {}, message),
          action && h("button", { type: "button", class: "primary", onclick: action.onClick }, action.label),
        ),
      );
    },
    start(run) {
      if (started) return;
      started = true;
      let soundButton: HTMLButtonElement | null = null;
      const sound = run.sound;
      if (sound) {
        const button = h("button", { type: "button", class: "toggle", "aria-pressed": String(sound.prefs.isEnabled()) }, copy.sound);
        button.addEventListener("click", (event) => {
          button.setAttribute("aria-pressed", String(sound.prefs.toggle()));
          sound.unlock?.();
          // Clic souris (`detail` > 0) : le canvas reprend la main ; activation au clavier : le focus reste sur le bouton.
          if (event.detail > 0) canvas.focus();
        });
        toggles.prepend(button);
        soundButton = button;
      }
      // Toute la page du jeu passe en plein écran (barre tactile et pied de page compris), en paysage sur écran tactile.
      const fullscreen = createFullscreen(main, {
        label: shared.fullscreen,
        landscape: true,
        onClick: (event) => {
          if (event.detail > 0) canvas.focus();
        },
      });
      toggles.append(fullscreen.button);
      main.prepend(stage, ...(options.afterStage ?? []));
      main.append(footer);

      let lastScale = 0;
      const resize = (): void => {
        // Page masquée par le jeu (aide ouverte par-dessus) : rien à mesurer, l'échelle précédente reste.
        if (main.clientWidth === 0) return;
        // Écran masqué (vue posée par le jeu à sa place dans le conteneur) : même chose, sa hauteur nulle fausserait la mesure.
        if (stage.offsetHeight === 0) return;
        const style = getComputedStyle(main);
        const aside = asideWidth(style.display, style.gridTemplateColumns, style.columnGap);
        const paddingTop = parseFloat(style.paddingTop);
        const paddingBottom = parseFloat(style.paddingBottom);
        // Plein écran : le conteneur est fixé dans la fenêtre, le défilement de la page n'y change rien.
        const fixedToViewport = main.classList.contains("is-fullscreen");
        // Plein écran pivoté : le conteneur se mesure dans son repère (largeur = hauteur de la fenêtre), la hauteur disponible est la largeur de la fenêtre.
        const rotated = isRotated(main);
        const scale = shellScale(
          {
            mainWidth: main.clientWidth,
            mainTop: fixedToViewport ? 0 : main.getBoundingClientRect().top + window.scrollY,
            // En colonnes, la hauteur du conteneur suit la plus haute d'entre elles : seules ses marges entourent l'écran.
            // Sinon, la hauteur du contenu (et non `offsetHeight`, étiré à toute la fenêtre en plein écran).
            mainHeight: aside
              ? stage.offsetHeight + paddingTop + paddingBottom
              : contentHeight(
                  // Seuls les enfants dans le flux comptent : ni les masqués, ni les superpositions (`position: absolute` / `fixed`).
                  [...main.children]
                    .filter((child) => {
                      const childStyle = getComputedStyle(child);
                      return childStyle.display !== "none" && childStyle.position !== "absolute" && childStyle.position !== "fixed";
                    })
                    .map((child) => (child as HTMLElement).offsetHeight),
                  parseFloat(style.rowGap) || 0,
                  paddingTop,
                  paddingBottom,
                ),
            stageHeight: stage.offsetHeight,
            viewportHeight: rotated ? window.innerWidth : window.innerHeight,
            asideWidth: aside,
          },
          logicalWidth,
          logicalHeight,
          fit === "integer" && !matchMedia("(pointer: coarse)").matches,
        );
        if (scale === lastScale) return;
        lastScale = scale;
        canvas.style.width = `${logicalWidth * scale}px`;
        canvas.style.height = `${logicalHeight * scale}px`;
        footer.style.width = canvas.style.width;
      };
      // Onglet masqué : le jeu s'arrête (horloge et son) et repart au même point au retour ; le canvas reprend le focus.
      const onVisibility = (): void => {
        run.onPause?.(document.hidden);
        if (!document.hidden) focusCanvas();
      };
      // Autre onglet : la préférence de son suit.
      const onStorage = (event: Event): void => {
        const { key } = event as StorageEvent;
        if (sound && soundButton && (key === null || sound.storageKey === undefined || key === sound.storageKey) && sound.prefs.reload()) {
          soundButton.setAttribute("aria-pressed", String(sound.prefs.isEnabled()));
        }
      };
      const listeners: [EventTarget, string, EventListener][] = [
        [window, "focus", focusCanvas],
        [window, "storage", onStorage],
        [document, "visibilitychange", onVisibility],
        ...(sized ? ([[window, "resize", resize]] as [EventTarget, string, EventListener][]) : []),
        ...(run.listeners ?? []),
      ];
      for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
      // Ce qui entoure l'écran change de taille (barre tactile, pied de page qui passe à la ligne, message d'erreur) : on remesure.
      const observer = sized && typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
      observer?.observe(main);
      disposeRun = () => {
        fullscreen.dispose();
        observer?.disconnect();
        for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
        run.onDispose?.();
      };
      if (document.hidden) run.onPause?.(true);
      // Le message de chargement doit être masqué avant la mesure : sa hauteur ferait croire à moins de place qu'il n'y en a.
      status.hidden = true;
      if (sized) resize();
      focusCanvas();

      const frame = (now: number): void => {
        // La page a été remplacée (retour à l'accueil) : on arrête la boucle.
        if (!canvas.isConnected) {
          dispose();
          return;
        }
        try {
          run.onFrame(now);
        } catch (error) {
          shell.fail(error, "runtime");
          return;
        }
        if (disposeRun) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
  };
  return shell;
}
