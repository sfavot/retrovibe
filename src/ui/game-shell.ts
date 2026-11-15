import { copy as shared } from "./copy";
import { h } from "./dom";
import { MissingFilesError } from "./files";
import { createFullscreen } from "./fullscreen";
import { withIcons } from "./icons";
import { type ControlHandle, type ControlSize, type ControlSpec, type ShellMenuEntry, createShellControls } from "./shell-controls";
import { TOUCH_GAP, TOUCH_LAYOUT_CLASS, createTouchMenu, isTouchDevice, layoutTouch, trackInputMode } from "./touch-page";

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
   * `integer` : le shell dimensionne le canvas à l'échelle entière la plus grande qui tient quand elle vaut au moins 2 ;
   *   en dessous, l'échelle est fractionnaire (l'écran remplit la place plutôt que de rester à 1×).
   *   Sur écran tactile, l'échelle devient fractionnaire : sur un téléphone, l'échelle entière laisserait l'écran à 1×.
   * `fractional` : le shell dimensionne le canvas à la plus grande échelle qui tient, même fractionnaire (écrans déjà grands,
   *   comme le 640×480 de Mathémagique, qu'une échelle entière laisserait à 1 sur la plupart des fenêtres).
   */
  fit?: "integer" | "fractional";
  /**
   * Taille du tampon de dessin quand elle diffère du cadre logique (pixels non carrés : un tampon 320×400 affiché en 4:3 avec
   * `logicalWidth` × `logicalHeight` = 320×240). Sans valeur, le tampon a la taille du cadre logique. Le cadre sert à l'échelle ; le jeu
   * convertit le pointeur avec la taille du tampon (`toLogical` reçoit le rectangle affiché, donc l'affichage n'a rien à corriger).
   */
  buffer?: { width: number; height: number };
  copy: GameShellCopy;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Classes propres au jeu, ajoutées aux classes `game-shell*`. */
  classes?: { root?: string; stage?: string; canvas?: string; footer?: string };
  /** Éléments dans le cadre de l'écran (champ de saisie invisible du clavier virtuel…). */
  stageChildren?: HTMLElement[];
}

export interface GameShellRun {
  /** Une image : appelée à chaque `requestAnimationFrame` tant que le canvas est dans la page. Une exception arrête le jeu (`fail`). */
  onFrame(now: number): void;
  /** Onglet masqué (`true`) ou de nouveau visible (`false`) ; appelée aussi au démarrage si l'onglet est déjà masqué. */
  onPause?(hidden: boolean): void;
  /** Bouton « Son » : préférence, clé de stockage (pour suivre un autre onglet ; sans clé, tout changement du stockage relit la préférence) et déblocage audio au clic. */
  sound?: { prefs: ShellSoundPrefs; storageKey?: string; unlock?(): void };
  /**
   * Menu du jeu, ouvert par le bouton « Menu » de la barre tactile. Sans lui, le shell ouvre son menu par défaut (actions système et
   * `menuEntries`), qui met le jeu en pause (`onPause`) tant qu'il est ouvert. Le menu du jeu gère sa propre pause.
   */
  menu?: { open(): void };
  /** Entrées de plus du menu par défaut du shell (avant les actions système) ; relues à chaque ouverture. */
  menuEntries?(): ShellMenuEntry[];
  /** Écouteurs de plus, détachés avec les autres à la sortie. */
  listeners?: [EventTarget, string, EventListener][];
  /** À la sortie du jeu (page remplacée ou erreur d'exécution), une seule fois, après le détachement des écouteurs. */
  onDispose?(): void;
}

/**
 * Actions système du shell, pour que les menus des jeux les intègrent (son, plein écran, retour à l'accueil). Le menu par défaut du
 * shell les liste ; un jeu qui a son propre menu (`GameShellRun.menu`) les ajoute au sien.
 */
export interface ShellSystem {
  /** Préférence « Son » ; `null` avant `start` ou quand le jeu n'a pas de son (`GameShellRun.sound`). `toggle` renvoie le nouvel état. */
  readonly sound: { isEnabled(): boolean; toggle(): boolean } | null;
  readonly fullscreen: { isActive(): boolean; toggle(): void };
  /** Retour à l'accueil ; `null` sans `backLabel` (page de dev). */
  readonly quit: (() => void) | null;
}

export interface GameShell {
  readonly main: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  readonly footer: HTMLElement;
  /** Conteneur des boutons du pied de page (le bouton « Son » y est ajouté ; d'autres peuvent l'être). */
  readonly toggles: HTMLElement;
  /**
   * Contrôles tactiles du jeu : le jeu les déclare, le shell les rend en barre d'icônes (écran tactile seulement) et les place sous
   * l'écran ou de côté. Utilisable avant `start`. Le bouton « Menu » du shell est toujours le dernier du groupe `end`.
   */
  readonly controls: { add(spec: ControlSpec): ControlHandle; addPad(element: HTMLElement, group?: "start" | "end", sizes?: { bottom: ControlSize; sides: ControlSize }): void };
  readonly system: ShellSystem;
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

/** Échelle entière minimale : en dessous, l'échelle entière laisserait l'écran minuscule (1× dans une fenêtre qui en permettrait presque 2×). */
export const MIN_INTEGER_SCALE = 2;

/**
 * Échelle la plus grande qui tient dans la place disponible : entière à partir de 2× (pixels nets et réguliers), fractionnaire
 * en dessous (l'écran remplit la place au lieu de rester à 1× ou de rapetisser), ou fractionnaire partout avec `integer = false`.
 */
export function fitScale(
  availableWidth: number,
  availableHeight: number,
  logicalWidth: number,
  logicalHeight: number,
  integer = true,
): number {
  const fit = Math.min(availableWidth / logicalWidth, availableHeight / logicalHeight);
  return integer && fit >= MIN_INTEGER_SCALE ? Math.floor(fit) : Math.max(fit, 0.1);
}

/** Mesures de la page utiles au calcul de l'échelle (pixels CSS). */
export interface ShellMetrics {
  /** Largeur du conteneur (`main.clientWidth`). */
  mainWidth: number;
  /** Haut du conteneur dans la page (`main.getBoundingClientRect().top + scrollY`). */
  mainTop: number;
  /** Hauteur du conteneur et de l'écran (`offsetHeight`) : la différence est ce qui entoure l'écran (pied de page, message d'erreur). */
  mainHeight: number;
  stageHeight: number;
  /** Hauteur de la fenêtre. */
  viewportHeight: number;
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

/** Échelle du canvas pour les mesures données (ordinateur) : largeur moins les marges, hauteur moins ce qui précède, entoure l'écran, et la marge du bas. */
export function shellScale(metrics: ShellMetrics, logicalWidth: number, logicalHeight: number, integer = true): number {
  const around = metrics.mainHeight - metrics.stageHeight;
  return fitScale(
    metrics.mainWidth - 32,
    metrics.viewportHeight - metrics.mainTop - around - BOTTOM_MARGIN,
    logicalWidth,
    logicalHeight,
    integer,
  );
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
 * Page d'un jeu sur canvas : écran à l'échelle entière (ou fractionnaire), états de chargement et d'erreur,
 * lien de retour, boutons « Son » et « Plein écran », pause quand l'onglet est masqué, préférence de son suivie d'un onglet à
 * l'autre, boucle d'images arrêtée quand la page est remplacée.
 *
 * Écran tactile (`pointer: coarse`), portrait ou paysage : l'écran prend le maximum de place (échelle fractionnaire, ratio du jeu
 * conservé) et les contrôles du jeu (`controls.add`) forment une barre d'icônes sous l'écran ou en colonnes de côté, selon ce qui
 * laisse la plus grande échelle (`placeControls`). Le pied de page n'y apparaît plus : retour, son, plein écran et aide passent par
 * le bouton « Menu » de la barre. Ordinateur : pied de page et échelle entière, inchangés.
 *
 * `mountGameShell` pose le canvas (l'hôte du jeu en a besoin) et le message de chargement ; `start` affiche l'écran une fois le jeu chargé.
 */
export function mountGameShell(options: GameShellOptions): GameShell {
  const { container, logicalWidth, logicalHeight, copy, classes = {} } = options;
  const fit = options.fit ?? "integer";
  const status = h("p", { class: "game-shell-status", role: "status" }, copy.loading);
  // Région d'erreur présente dès le départ (vide) pour que les lecteurs d'écran annoncent le message quand il arrive.
  const errors = h("p", { class: "game-shell-error", role: "alert" });
  const back = options.backLabel
    ? h("a", { class: "back-link desktop-only", href: "#/" }, ...withIcons(options.backLabel, "close"))
    : null;
  const main = h("main", { class: join(`game-shell ${TOUCH_LAYOUT_CLASS} controls-bottom`, classes.root) }, status, errors);
  container.replaceChildren(main);
  const canvas = h("canvas", {
    class: join("game-shell-canvas", classes.canvas),
    width: options.buffer?.width ?? logicalWidth,
    height: options.buffer?.height ?? logicalHeight,
    tabindex: 0,
    "aria-label": copy.canvasLabel,
  });
  const stage = h("div", { class: join("game-shell-stage", classes.stage) }, canvas, ...(options.stageChildren ?? []));
  const toggles = h("div", { class: "game-shell-toggles" });
  const footer = h("div", { class: join("game-shell-footer", classes.footer) }, back, toggles);

  let disposeRun: (() => void) | null = null;
  let started = false;
  let currentRun: GameShellRun | null = null;
  let fullscreen: ReturnType<typeof createFullscreen> | null = null;
  let soundPrefs: GameShellRun["sound"] | null = null;
  let soundButton: HTMLButtonElement | null = null;
  /** Remesure la page (assigné au démarrage) ; appelé quand la liste des contrôles change. */
  let relayout: () => void = () => {};

  const focusCanvas = (): void => {
    if (canvasMayTakeFocus(document.activeElement, document.body, canvas)) canvas.focus();
  };
  const menu = createTouchMenu({
    main,
    title: shared.menu,
    closeLabel: shared.menuClose,
    // Le jeu est en pause tant que le menu est ouvert ; onglet masqué entre-temps : il le reste.
    onOpen: () => currentRun?.onPause?.(true),
    onClose: () => {
      currentRun?.onPause?.(document.hidden);
      focusCanvas();
    },
  });
  /** Bascule du son : préférence, bouton du pied de page, déblocage audio. */
  const toggleSound = (): boolean => {
    const sound = soundPrefs;
    if (!sound) return false;
    const enabled = sound.prefs.toggle();
    soundButton?.setAttribute("aria-pressed", String(enabled));
    sound.unlock?.();
    return enabled;
  };
  const system: ShellSystem = {
    get sound() {
      return soundPrefs ? { isEnabled: () => soundPrefs?.prefs.isEnabled() ?? false, toggle: toggleSound } : null;
    },
    fullscreen: { isActive: () => fullscreen?.isActive() ?? false, toggle: () => fullscreen?.toggle() },
    quit: options.backLabel ? () => leaveGame(options.backLabel, () => {}) : null,
  };
  /** Menu par défaut : les entrées du jeu, puis les actions système. */
  const openDefaultMenu = (): void => {
    const run = currentRun;
    if (!run) return;
    const entries: ShellMenuEntry[] = [...(run.menuEntries?.() ?? [])];
    if (system.sound) entries.push({ label: copy.sound, pressed: system.sound.isEnabled(), onPress: () => void system.sound?.toggle() });
    entries.push({ label: shared.fullscreen, onPress: () => system.fullscreen.toggle() });
    if (system.quit) entries.push({ label: shared.quit, onPress: () => system.quit?.() });
    menu.open(entries);
  };
  const controls = createShellControls({
    // Le canvas reprend le focus après un appui à la souris ou au doigt, sauf si le menu vient de s'ouvrir ou si le jeu a donné le focus à
    // autre chose (champ de saisie du clavier virtuel).
    afterPress: () => {
      if (!menu.isOpen && canvasMayTakeFocus(document.activeElement, document.body, canvas)) canvas.focus({ preventScroll: true });
    },
    menu: { label: shared.menu, onPress: () => (currentRun?.menu ? currentRun.menu.open() : openDefaultMenu()) },
    onChange: () => relayout(),
  });
  const dispose = (): void => {
    menu.close();
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
    controls: { add: (spec) => controls.add(spec), addPad: (element, group, sizes) => controls.addPad(element, group, sizes) },
    system,
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
      currentRun = run;
      const sound = run.sound;
      soundPrefs = sound ?? null;
      if (sound) {
        const button = h(
          "button",
          { type: "button", class: "toggle desktop-only", "aria-pressed": String(sound.prefs.isEnabled()) },
          ...withIcons(copy.sound, "sound-on", "sound-off"),
        );
        button.addEventListener("click", (event) => {
          toggleSound();
          // Clic souris (`detail` > 0) : le canvas reprend la main ; activation au clavier : le focus reste sur le bouton.
          if (event.detail > 0) canvas.focus();
        });
        toggles.prepend(button);
        soundButton = button;
      }
      // Toute la page du jeu passe en plein écran (barre de contrôles et pied de page compris), en paysage sur écran tactile.
      const fullscreenControl = createFullscreen(main, {
        label: shared.fullscreen,
        landscape: true,
        onClick: (event) => {
          if (event.detail > 0) canvas.focus();
        },
        onChange: () => relayout(),
      });
      fullscreen = fullscreenControl;
      fullscreenControl.button.classList.add("desktop-only");
      toggles.append(fullscreenControl.button);
      // Barre de contrôles du shell, sous l'écran ou de côté (`style.css`) ; masquée sur ordinateur.
      main.prepend(stage, controls.element);
      main.append(footer);
      // En jeu, le chargement est une pastille posée sur l'écran : dans le flux, il décalerait le pied de page et l'échelle du canvas.
      stage.append(status);

      let lastLayout = "";
      /** Écran tactile : barre de contrôles, échelle fractionnaire, placement calculé (`layoutTouch`). */
      const resizeTouch = (): void => {
        // Des boutons que le jeu a posés dans le pied de page (hors boutons du shell, masqués ici) gardent leur place sous l'écran.
        const footerHeight = footer.offsetHeight > 0 ? footer.offsetHeight + TOUCH_GAP : 0;
        const layout = layoutTouch({ main, controls, logicalWidth, logicalHeight, extraHeight: footerHeight });
        const key = `${layout.placement}:${layout.scale}:${layout.rowWidth}`;
        if (key === lastLayout) return;
        lastLayout = key;
        canvas.style.width = `${logicalWidth * layout.scale}px`;
        canvas.style.height = `${logicalHeight * layout.scale}px`;
        footer.style.width = canvas.style.width;
      };
      /** Ordinateur : l'échelle (entière dès 2×) se déduit de ce qui entoure l'écran dans la page. */
      const resizeDesktop = (): void => {
        const style = getComputedStyle(main);
        const paddingTop = parseFloat(style.paddingTop);
        const paddingBottom = parseFloat(style.paddingBottom);
        // Plein écran : le conteneur est fixé dans la fenêtre, le défilement de la page n'y change rien.
        const fixedToViewport = main.classList.contains("is-fullscreen");
        const scale = shellScale(
          {
            mainWidth: main.clientWidth,
            mainTop: fixedToViewport ? 0 : main.getBoundingClientRect().top + window.scrollY,
            // La hauteur du contenu (et non `offsetHeight`, étiré à toute la fenêtre en plein écran).
            mainHeight: contentHeight(
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
            viewportHeight: window.innerHeight,
          },
          logicalWidth,
          logicalHeight,
          fit === "integer",
        );
        const key = `desktop:${scale}`;
        if (key === lastLayout) return;
        lastLayout = key;
        canvas.style.width = `${logicalWidth * scale}px`;
        canvas.style.height = `${logicalHeight * scale}px`;
        footer.style.width = canvas.style.width;
      };
      const resize = (): void => {
        // Page masquée par le jeu (aide ouverte par-dessus) : rien à mesurer, l'échelle précédente reste.
        if (main.clientWidth === 0) return;
        // Écran masqué (vue posée par le jeu à sa place dans le conteneur) : même chose, sa hauteur nulle fausserait la mesure.
        if (stage.offsetHeight === 0) return;
        if (isTouchDevice()) resizeTouch();
        else resizeDesktop();
      };
      relayout = () => {
        lastLayout = "";
        resize();
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
        [window, "resize", resize],
        ...(run.listeners ?? []),
      ];
      for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
      const untrackInput = trackInputMode(main);
      // Ce qui entoure l'écran change de taille (barre tactile, pied de page qui passe à la ligne, message d'erreur) : on remesure.
      const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
      observer?.observe(main);
      observer?.observe(footer);
      disposeRun = () => {
        untrackInput();
        fullscreenControl.dispose();
        fullscreen = null;
        currentRun = null;
        relayout = () => {};
        observer?.disconnect();
        for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
        run.onDispose?.();
      };
      if (document.hidden) run.onPause?.(true);
      // Le message de chargement doit être masqué avant la mesure : sa hauteur ferait croire à moins de place qu'il n'y en a.
      status.hidden = true;
      resize();
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
