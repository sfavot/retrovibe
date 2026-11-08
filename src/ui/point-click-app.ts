import "./point-click.css";
import { type HostStorage, prefixedStorage } from "../engine/storage";
import type { SlotSummary } from "../engine/save-slots";
import { h } from "./dom";
import { MissingFilesError, fetchBytes } from "./files";
import { type GameShellCopy, type ShellSoundPrefs, leaveGame, mountGameShell } from "./game-shell";
import { withIcons } from "./icons";
import { IndexedPresenter } from "./indexed-canvas";
import { localStorageStore } from "./local-storage";
import { bindCanvasPointer, bindKeyboard } from "./pointer";
import { type ChooseResult, type DialogCopy, dialogOverlay, parseVolume, renderLeaveDialog, renderMenuDialog, renderSlotDialog, renderVolumeDialog, volumeKey } from "./point-click-dialogs";
import { syncSkipButton } from "./point-click-touch";
import { soundPrefKey } from "./sound-prefs";
import { TickScheduler } from "./tick-scheduler";

/**
 * Page d'un jeu de pointer-et-cliquer sur canvas (Drascula, Flight of the Amazon Queen), commune aux deux (règle des deux usages :
 * `docs/fotaq/plan.md`, M8). Le jeu fournit ce qui diffère réellement (`PointClickGame` : textes, taille de l'écran, chargement des
 * fichiers et construction du moteur et de l'hôte, touches, toucher, aide, hooks de l'image) ; ce module fait la colle : page sur
 * `mountGameShell`, chargement avec progression et erreur, pause (onglet masqué, bouton, fenêtre ouverte, aide), message passager,
 * fenêtres (sauvegarde, chargement, volume, menu, retour à l'écran titre), barre tactile Menu / Passer / Pause, aide par-dessus le
 * jeu, entrées et boucle `TickScheduler` + `render`.
 */

export interface PointClickAppOptions<TSave> {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./drascula`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Partie à reprendre (écran titre : « Continuer », « Charger ») ; sans elle, une nouvelle partie. */
  restore?: TSave;
  /** Retour à l'écran titre (entrée « Écran titre » du menu) ; sans valeur, l'entrée mène à l'accueil du site ou redémarre la page de dev. */
  toTitle?: () => void;
  /** Expose `window.__<id>` (ce que le jeu met dans `PointClickLoaded.debug`) pour la console (page de dev). */
  debug?: boolean;
}

/** Textes de la page : les fenêtres (`DialogCopy`), la page du jeu (`GameShellCopy`) et les messages de la colle. */
export interface PointClickCopy extends DialogCopy, Required<Pick<GameShellCopy, "canvasLabel" | "sound" | "loadError" | "runtimeError" | "missingFiles">> {
  paused: string;
  pausedHint: string;
  loading: string;
  loadingFiles(percent: number): string;
  skip: string;
  skipLabel: string;
  menuLabel: string;
  /** Bouton de l'aide ouverte par-dessus le jeu. */
  helpResume: string;
  /** Sauvegarde qui ne se rouvre pas ; le détail va à la console. */
  invalidSave: string;
  /** Suite du message d'une erreur de chargement qu'un rechargement peut régler. */
  retryHint: string;
  saveBusy: string;
  saveDone: string;
  loadDone: string;
}

/** Ce que la page lit du moteur. */
export interface PointClickEngine {
  tick(): void;
  render(): void;
  readonly canSave: boolean;
  /** Un appui sur « Passer » aurait un effet. */
  readonly canSkip: boolean;
}

/** Ce que la page lit de l'hôte (`BrowserHost` du jeu). */
export interface PointClickHost {
  readonly volume: number;
  readonly input: {
    move(x: number, y: number): void;
    down(button: number, x: number, y: number): void;
    up(button: number, x: number, y: number): void;
    releaseAll(): void;
  };
  unlock(): void;
  setPaused(paused: boolean): void;
  setUserVolume(level: number): void;
  close(): void;
}

/** Ce que fait une touche du clavier : une commande de la page, ou une action que le jeu envoie à son moteur. */
export type PointClickKey = { command: "save" | "load" | "volume" | "subtitles" | "pause" } | { engine: () => void };

/** Prises de la page, pour les hooks de l'image. */
export interface PointClickFrameUi {
  /** Pastille de chargement par-dessus l'écran (sans progression). */
  showLoading(text: string): void;
  hideLoading(): void;
  /** Repart du temps présent : le prochain `due` ne rattrape pas l'attente (après un chargement). */
  resync(): void;
}

/** Ce que le chargement du jeu fournit à la page. */
export interface PointClickLoaded {
  engine: PointClickEngine;
  host: PointClickHost;
  prefs: ShellSoundPrefs;
  slots: {
    summaries(): SlotSummary[];
    /** Sauvegarde dans l'emplacement ; la page annonce `saveDone` si `ok`. */
    save(slot: number): ChooseResult;
    /** Charge l'emplacement ; la page annonce `loadDone` si `ok`. */
    load(slot: number): ChooseResult | Promise<ChooseResult>;
  };
  /** Bouton « Passer » de la barre tactile. */
  skip(): void;
  /** Toucher du doigt (0) ou appui long (2) en (x, y), hors pause : une réplique à passer, ou un clic. */
  tap(button: 0 | 2, x: number, y: number): void;
  key(event: KeyboardEvent): PointClickKey | undefined;
  /** Jeu à sous-titres réglables : état, et bascule qui renvoie le message à annoncer. Sans valeur, ni entrée de menu ni raccourci. */
  subtitles?: { enabled(): boolean; toggle(): string };
  /** Ce que `window.__<id>` expose en mode `debug`. */
  debug?: Record<string, unknown>;
  /** Échec de chargement en fond, levé à l'image suivante (arrête le jeu) ; `undefined` s'il n'y en a pas. */
  failure?(): unknown;
  /** Avant les ticks d'une image (hors pause) ; `false` : le jeu attend (pastille de chargement), pas de tick ni de rendu. */
  beforeTicks?(ui: PointClickFrameUi): boolean;
  /** Après les ticks et le rendu d'une image. */
  afterTicks?(ui: PointClickFrameUi): void;
}

/** Ce que le chargement du jeu reçoit de la page. */
export interface PointClickLoadContext<TSave> {
  options: PointClickAppOptions<TSave>;
  store: HostStorage;
  presenter: IndexedPresenter;
  /** Charge un fichier du jeu (`options.base`). */
  fetcher(path: string): Promise<Uint8Array>;
  /** Progression du chargement initial (0 à 1). */
  setPercent(fraction: number): void;
  /** Ouvre le menu du jeu (l'hôte l'appelle pour le journal). */
  openMenu(): void;
  /** Sortie du jeu (`exit()` du moteur, après la fin) : accueil du site, ou redémarrage sur la page de dev. */
  exit(): void;
  /** Le manifeste du jeu ; absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé (`MissingFilesError`). */
  manifest<F>(fetch: (base: string) => Promise<F>): Promise<F>;
  /** Construit le moteur ; une sauvegarde à reprendre qui ne se rouvre pas donne l'erreur `copy.invalidSave` (le détail va à la console). */
  buildEngine<E>(create: () => E): E;
  /** Applique à l'hôte le volume enregistré. */
  restoreVolume(host: PointClickHost): void;
  /** Stockage des emplacements du jeu, préfixé. */
  slotsStorage(prefix: string): HostStorage;
}

/** Ce qui diffère d'un jeu à l'autre. */
export interface PointClickGame<TSave> {
  /** Identifiant (`"drascula"`) : clés du volume et du son, `window.__<id>`. */
  id: string;
  copy: PointClickCopy;
  width: number;
  height: number;
  /** Durée d'un tick du moteur (ms) et nombre maximal de ticks rattrapés par image. */
  tickMs: number;
  maxCatchUpTicks: number;
  /** Page d'aide (`backLabel` : le bouton de retour au jeu). */
  renderHelp(base: string, onBack: () => void, backLabel: string): HTMLElement;
  /** Charge les fichiers (progression par `ctx.setPercent`), construit l'hôte et le moteur. Une exception affiche l'erreur de chargement. */
  load(ctx: PointClickLoadContext<TSave>): Promise<PointClickLoaded>;
}

/** Durée d'affichage d'un message (ms). */
const NOTICE_MS = 3500;

/** Taille cumulée de fichiers (pour la progression du chargement) ; un fichier inconnu compte pour zéro. */
export function sumSizes(files: { size(path: string): number | undefined }, paths: readonly string[]): number {
  return paths.reduce((total, path) => total + (files.size(path) ?? 0), 0);
}

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : écran à l'échelle entière, états de chargement et
 * d'erreur, bouton « Son », pause quand l'onglet est masqué. Le moteur tourne par ticks sur les images de l'écran (`TickScheduler`
 * à la cadence du jeu), l'image est composée et peinte une fois par image.
 */
export async function mountPointClickApp<TSave>(
  container: HTMLElement,
  options: PointClickAppOptions<TSave>,
  game: PointClickGame<TSave>,
): Promise<void> {
  const { copy } = game;
  const leave = (): void => leaveGame(options.backLabel, () => void mountPointClickApp(container, { ...options, restore: undefined }, game));
  let loaded: PointClickLoaded | undefined;
  /** Dernière position du doigt ou de la souris, pour les touchers (`tap` n'a pas de coordonnées). */
  let pointerX = 0;
  let pointerY = 0;

  // --- Page ----------------------------------------------------------------------------------------------------------------
  const pauseNotice = h(
    "div",
    { class: "pc-pause", role: "status", hidden: true },
    h("strong", {}, copy.paused),
    h("span", {}, copy.pausedHint),
    h("button", { type: "button", class: "primary", onclick: () => togglePause() }, copy.resume),
  );
  const notice = h("p", { class: "pc-notice", role: "status", "aria-live": "polite", hidden: true });
  const progress = h("progress", { max: 100, value: 0, "aria-label": copy.loading });
  const loadingText = h("span", {}, copy.loading);
  const loading = h("div", { class: "pc-loading", role: "status" }, loadingText, progress);

  /**
   * Bouton de la barre tactile. Il ne prend pas le focus au toucher ou au clic (le canvas le garde) ; au clavier, il le garde.
   */
  const touchButton = (label: string, ariaLabel: string, action: () => void): HTMLButtonElement => {
    const button = h("button", { type: "button", "aria-label": ariaLabel }, label);
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => {
      loaded?.host.unlock();
      action();
      if (e.detail > 0) shell.canvas.focus({ preventScroll: true });
    });
    return button;
  };
  const skipButton = touchButton(copy.skip, copy.skipLabel, () => loaded?.skip());
  skipButton.disabled = true;
  skipButton.setAttribute("aria-disabled", "true");
  const pauseButton = touchButton(copy.pause, copy.pauseLabel, () => togglePause());
  const menuButton = touchButton(copy.menu, copy.menuLabel, () => openMenu());
  const touchBar = h(
    "div",
    { class: "touch-bar pc-touch-bar" },
    h("div", { class: "pc-touch-group" }, menuButton, skipButton),
    h("div", { class: "pc-touch-group" }, pauseButton),
  );
  const shell = mountGameShell({
    container,
    logicalWidth: game.width,
    logicalHeight: game.height,
    copy: { canvasLabel: copy.canvasLabel, sound: copy.sound, loadError: copy.loadError, runtimeError: copy.runtimeError, missingFiles: copy.missingFiles },
    backLabel: options.backLabel,
    classes: { root: "pc-game", stage: "pc-stage", canvas: "pc-canvas" },
    stageChildren: [notice, pauseNotice],
    afterStage: [touchBar],
  });
  // En portrait, la barre a la largeur de l'écran du jeu (que le shell dimensionne).
  new ResizeObserver(() => touchBar.style.setProperty("--pc-screen-width", `${shell.canvas.offsetWidth}px`)).observe(shell.canvas);
  shell.main.append(loading);
  // Le pied de page (avec le lien de retour) n'existe qu'une fois le jeu lancé : pendant le chargement, et si celui-ci échoue, le lien est posé ici.
  const earlyBack = options.backLabel ? h("a", { class: "back-link", href: "#/" }, options.backLabel) : null;
  if (earlyBack) shell.main.append(earlyBack);
  const setPercent = (fraction: number): void => {
    const percent = Math.min(100, Math.round(fraction * 100));
    progress.value = percent;
    loadingText.textContent = copy.loadingFiles(percent);
  };

  const store = localStorageStore();
  const presenter = IndexedPresenter.forCanvas(shell.canvas, game.width, game.height);
  const volumePref = volumeKey(game.id);
  const scheduler = new TickScheduler(game.tickMs, game.maxCatchUpTicks);

  // --- Chargement ----------------------------------------------------------------------------------------------------------
  try {
    loaded = await game.load({
      options,
      store,
      presenter,
      fetcher: (path) => fetchBytes(options.base, path),
      setPercent,
      openMenu: () => openMenu(),
      exit: leave,
      // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
      manifest: (fetch) =>
        fetch(options.base).catch((error: unknown) => {
          throw new MissingFilesError(error instanceof Error ? error.message : String(error));
        }),
      buildEngine: (create) => {
        try {
          return create();
        } catch (error) {
          // Une sauvegarde qui ne se rouvre pas : message dédié, le détail va à la console.
          if (options.restore) console.error(error);
          throw options.restore ? new Error(copy.invalidSave) : error;
        }
      },
      restoreVolume: (host) => host.setUserVolume(parseVolume(store.get(volumePref))),
      slotsStorage: (prefix) => prefixedStorage(store, prefix),
    });
  } catch (error) {
    loading.remove();
    // Une sauvegarde illisible n'a rien à voir avec le réseau ; les autres échecs de chargement se règlent souvent en rechargeant.
    const retry = error instanceof MissingFilesError || (error instanceof Error && error.message === copy.invalidSave);
    shell.fail(!retry && error instanceof Error ? new Error(`${error.message} ${copy.retryHint}`) : error, "load");
    return;
  }
  loading.remove();
  earlyBack?.remove();
  const { engine, host, slots, prefs } = loaded;
  const subtitles = loaded.subtitles;
  if (options.debug && loaded.debug) (window as unknown as Record<string, unknown>)[`__${game.id}`] = loaded.debug;

  // --- Pause et fenêtres ---------------------------------------------------------------------------------------------------
  let tabHidden = false;
  let userPaused = false;
  /** Fenêtre ouverte par-dessus le jeu (sauvegardes, volume, menu) ; l'aide a la sienne (`helpView`). */
  let modal: HTMLElement | null = null;
  let helpView: HTMLElement | null = null;
  const isPaused = (): boolean => tabHidden || userPaused || modal !== null || helpView !== null;
  const applyPause = (): void => {
    const paused = isPaused();
    host.setPaused(paused);
    pauseNotice.hidden = !userPaused;
    if (!paused) scheduler.resync();
  };
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (message: string): void => {
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.hidden = true), NOTICE_MS);
  };
  function togglePause(): void {
    userPaused = !userPaused;
    pauseButton.textContent = userPaused ? copy.resume : copy.pause;
    applyPause();
    // Le bouton « Reprendre » (masqué à la reprise) avait le focus : le canvas le reprend de force.
    if (!userPaused) shell.canvas.focus({ preventScroll: true });
  }

  const closeModal = (): void => {
    modal?.parentElement?.remove();
    modal = null;
    applyPause();
    shell.focusCanvas();
  };
  const openModal = (dialog: HTMLElement): void => {
    if (modal) closeModal();
    modal = dialog;
    shell.main.append(dialogOverlay(dialog, closeModal));
    applyPause();
  };

  const openSave = (): void => {
    if (!engine.canSave) {
      say(copy.saveBusy);
      return;
    }
    openModal(
      renderSlotDialog({
        copy,
        mode: "save",
        summaries: slots.summaries,
        close: closeModal,
        choose(slot) {
          const result = slots.save(slot);
          if (result.ok) say(copy.saveDone);
          return result;
        },
      }),
    );
  };
  const openLoad = (): void => {
    openModal(
      renderSlotDialog({
        copy,
        mode: "load",
        summaries: slots.summaries,
        close: closeModal,
        async choose(slot) {
          const result = await slots.load(slot);
          if (result.ok) say(copy.loadDone);
          return result;
        },
      }),
    );
  };
  const openVolume = (): void => {
    openModal(
      renderVolumeDialog(
        copy,
        host.volume,
        (level) => {
          host.setUserVolume(level);
          store.set(volumePref, String(Math.round(level * 100)));
        },
        closeModal,
      ),
    );
  };
  /** Retour à l'écran titre, après confirmation : le jeu s'arrête et la page est remplacée (`toTitle`). */
  const goToTitle = (): void => {
    const leaveNow = (): void => {
      closeModal();
      if (!options.toTitle) return leave();
      shell.dispose();
      options.toTitle();
    };
    openModal(renderLeaveDialog(copy, leaveNow, closeModal));
  };
  const toggleSubtitles = (): void => {
    if (subtitles) say(subtitles.toggle());
  };
  function openMenu(): void {
    const again = (action: () => void) => (): void => {
      closeModal();
      action();
    };
    openModal(
      renderMenuDialog(
        copy,
        {
          save: again(openSave),
          load: again(openLoad),
          volume: again(openVolume),
          toggleSubtitles: subtitles
            ? () => {
                toggleSubtitles();
                closeModal();
              }
            : undefined,
          togglePause: again(togglePause),
          help: again(() => openHelp()),
          titleScreen: again(goToTitle),
          close: closeModal,
        },
        subtitles?.enabled() ?? false,
        userPaused,
      ),
    );
  }

  // Aide (page de l'écran titre) : par-dessus le jeu, qui attend ; même mécanique qu'Armaeth.
  const closeHelp = (): void => {
    helpView?.remove();
    helpView = null;
    shell.main.style.display = "";
    shell.stage.style.display = "";
    applyPause();
    shell.focusCanvas();
  };
  const openHelp = (): void => {
    if (helpView) return;
    helpView = h("div", { class: "pc-help-overlay" }, game.renderHelp(options.base, closeHelp, copy.helpResume));
    if (shell.main.classList.contains("is-fullscreen")) {
      // En plein écran, c'est `main` qui occupe l'écran : l'aide s'ouvre dedans, par-dessus l'écran du jeu masqué.
      helpView.classList.add("is-inside");
      shell.stage.style.display = "none";
      shell.main.append(helpView);
    } else {
      shell.main.style.display = "none";
      container.append(helpView);
    }
    applyPause();
  };
  const menuLink = h("button", { type: "button", class: "toggle pc-menu-link", "aria-label": copy.menuLabel, onclick: () => openMenu() }, ...withIcons(copy.menu, "menu"));
  const helpLink = h("button", { type: "button", class: "toggle pc-help-link", onclick: () => openHelp() }, ...withIcons(copy.helpLink, "help"));
  shell.toggles.append(menuLink, helpLink);

  // --- Entrées -------------------------------------------------------------------------------------------------------------
  const detach: (() => void)[] = [
    bindCanvasPointer(
      shell.canvas,
      { width: game.width, height: game.height },
      {
        // Souris et stylet : boutons du jeu (gauche / droit). Doigt : `tap` (toucher = clic gauche, appui long = clic droit).
        move: (x, y) => {
          pointerX = x;
          pointerY = y;
          if (!isPaused()) host.input.move(x, y);
        },
        down: (button, x, y) => host.input.down(button, x, y),
        up: (button, x, y) => host.input.up(button, x, y),
        tap: (button) => {
          if (!isPaused()) loaded?.tap(button, pointerX, pointerY);
        },
      },
      { onGesture: () => host.unlock() },
    ),
    bindKeyboard(
      shell.canvas,
      {
        keyDown: (event) => {
          const action = loaded?.key(event);
          if (!action) return false;
          if (event.repeat) return true;
          if ("engine" in action) {
            if (!isPaused()) action.engine();
            return true;
          }
          switch (action.command) {
            case "save":
              openSave();
              break;
            case "load":
              openLoad();
              break;
            case "volume":
              openVolume();
              break;
            case "subtitles":
              toggleSubtitles();
              break;
            case "pause":
              togglePause();
              break;
          }
          return true;
        },
        // Perdre le focus relâche la souris : sinon un bouton tenu au moment du clic ailleurs resterait enfoncé.
        blur: () => host.input.releaseAll(),
      },
      () => host.unlock(),
    ),
  ];

  // --- Boucle --------------------------------------------------------------------------------------------------------------
  const frameUi: PointClickFrameUi = {
    showLoading(text) {
      loadingText.textContent = text;
      progress.removeAttribute("value");
      if (!loading.isConnected) shell.stage.append(loading);
    },
    hideLoading() {
      if (loading.isConnected) loading.remove();
    },
    resync: () => scheduler.resync(),
  };

  shell.start({
    onPause: (hidden) => {
      tabHidden = hidden;
      applyPause();
    },
    sound: { prefs, storageKey: soundPrefKey(game.id), unlock: () => host.unlock() },
    onDispose: () => {
      for (const off of detach) off();
      clearTimeout(noticeTimer);
      host.close();
      host.setPaused(true);
    },
    onFrame: (now) => {
      const failure = loaded?.failure?.();
      if (failure !== undefined) throw failure;
      if (isPaused()) return;
      if (loaded?.beforeTicks?.(frameUi) === false) return;
      for (let ticks = scheduler.due(now); ticks > 0; ticks--) engine.tick();
      engine.render();
      syncSkipButton(skipButton, engine.canSkip);
      loaded?.afterTicks?.(frameUi);
    },
  });
  if (options.restore) say(copy.loadDone);
}
