import "./style.css";
import { FixedStepClock } from "../../../engine/clock";
import { prefixedStorage } from "../../../engine/storage";
import { h } from "../../../ui/dom";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { leaveGame, mountGameShell } from "../../../ui/game-shell";
import { withIcons } from "../../../ui/icons";
import { IndexedPresenter } from "../../../ui/indexed-canvas";
import { localStorageStore } from "../../../ui/local-storage";
import { bindCanvasPointer, bindKeyboard } from "../../../ui/pointer";
import { soundPrefKey } from "../../../ui/sound-prefs";
import { DrasculaAudio, createSoundPrefs } from "../audio/audio";
import { copy } from "../copy";
import { type GameFiles, fetchGameFiles } from "../data/files";
import { MAX_CATCH_UP_TICKS, TICK_MS } from "../engine/cadence";
import { DrasculaEngine } from "../engine/loop";
import { drasculaScript } from "../engine/rooms";
import type { SaveData } from "../engine/save";
import { BrowserHost, createSoundFiles } from "./browser-host";
import { renderHelp } from "./help";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./input";
import { keyAction } from "./keys";
import { renderLeaveDialog, renderMenuDialog } from "./menu-dialog";
import { ChapterLoader, FileStore, baseFiles, chapterVideos, loadInto } from "./preload";
import { SAVE_PREFIX, SaveSlots, loadFromSlot, resultMessage, saveToSlot } from "./saves";
import { renderSlotDialog } from "./slot-dialog";
import { VOLUME_KEY, parseVolume, renderVolumeDialog } from "./volume-dialog";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./drascula`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Partie à reprendre (écran titre : « Continuer », « Charger ») ; sans elle, une nouvelle partie. */
  restore?: SaveData;
  /** Retour à l'écran titre (entrée « Écran titre » du menu) ; sans valeur, l'entrée mène à l'accueil du site ou redémarre la page de dev. */
  toTitle?: () => void;
  /** Expose `window.__drascula` (`engine`, `host`, `loader`) pour la console (page de dev). */
  debug?: boolean;
}

/** Préférence des sous-titres (`"0"` = masqués ; affichés par défaut, comme ScummVM). */
const SUBTITLES_KEY = "retrovibe:drascula:subtitles";
/** Durée d'affichage d'un message (ms). */
const NOTICE_MS = 3500;

/** Cadence du moteur sur les images de l'écran : ticks de 10 ms, rattrapage limité (`engine/cadence.ts`). */
class TickScheduler {
  private readonly clock = new FixedStepClock({ tickMs: TICK_MS, maxCatchUpTicks: MAX_CATCH_UP_TICKS });

  due(now: number): number {
    this.clock.update(now);
    let count = 0;
    while (this.clock.consume()) count++;
    return count;
  }

  resync(): void {
    this.clock.resync();
  }
}

/** Sortie du jeu (`exit()`, après le générique) : retour à l'accueil du site, ou redémarrage sur la page de dev. */
function leave(container: HTMLElement, options: AppOptions): void {
  leaveGame(options.backLabel, () => void mountApp(container, { ...options, restore: undefined }));
}

const sum = (files: GameFiles, paths: readonly string[]): number => paths.reduce((total, path) => total + (files.size(path) ?? 0), 0);

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : écran 320 x 200 à l'échelle entière, états de chargement
 * et d'erreur, bouton « Son », pause quand l'onglet est masqué. Le moteur tourne par ticks de 10 ms sur les images de l'écran, l'image
 * est composée et peinte une fois par image. Les fichiers (données, images, puis les vidéos des chapitres) sont chargés avant de
 * construire le moteur, qui les lit en synchrone ; les voix et la musique sont lues à la demande.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  let host: BrowserHost | undefined;
  /** Dernière position du doigt ou de la souris, pour les touchers (`tap` n'a pas de coordonnées). */
  let pointerX = 0;
  let pointerY = 0;

  // --- Page ----------------------------------------------------------------------------------------------------------------
  const pauseNotice = h(
    "div",
    { class: "dra-pause", role: "status", hidden: true },
    h("strong", {}, copy.paused),
    h("span", {}, copy.pausedHint),
    h("button", { type: "button", class: "primary", onclick: () => togglePause() }, copy.resume),
  );
  const notice = h("p", { class: "dra-notice", role: "status", "aria-live": "polite", hidden: true });
  const progress = h("progress", { max: 100, value: 0, "aria-label": copy.loading });
  const loadingText = h("span", {}, copy.loading);
  const loading = h("div", { class: "dra-loading", role: "status" }, loadingText, progress);

  /**
   * Bouton de la barre tactile. Il ne prend pas le focus au toucher ou au clic (le canvas le garde) ; au clavier, il le garde.
   */
  const touchButton = (label: string, ariaLabel: string, action: () => void): HTMLButtonElement => {
    const button = h("button", { type: "button", "aria-label": ariaLabel }, label);
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", (e) => {
      host?.unlock();
      action();
      if (e.detail > 0) shell.canvas.focus({ preventScroll: true });
    });
    return button;
  };
  const skipButton = touchButton(copy.skip, copy.skipLabel, () => host?.input.key("Escape"));
  const pauseButton = touchButton(copy.pause, copy.pauseLabel, () => togglePause());
  const menuButton = touchButton(copy.menu, copy.menuLabel, () => openMenu());
  const touchBar = h(
    "div",
    { class: "touch-bar dra-touch-bar" },
    h("div", { class: "dra-touch-group" }, menuButton, skipButton),
    h("div", { class: "dra-touch-group" }, pauseButton),
  );
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
    copy: { canvasLabel: copy.canvasLabel, sound: copy.sound, loadError: copy.loadError, runtimeError: copy.runtimeError, missingFiles: copy.missingFiles },
    backLabel: options.backLabel,
    classes: { root: "dra", stage: "dra-stage", canvas: "dra-canvas" },
    stageChildren: [notice, pauseNotice],
    afterStage: [touchBar],
  });
  // En portrait, la barre a la largeur de l'écran du jeu (que le shell dimensionne).
  new ResizeObserver(() => touchBar.style.setProperty("--dra-screen-width", `${shell.canvas.offsetWidth}px`)).observe(shell.canvas);
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
  const presenter = IndexedPresenter.forCanvas(shell.canvas, SCREEN_WIDTH, SCREEN_HEIGHT);

  // --- Chargement ----------------------------------------------------------------------------------------------------------
  let files: GameFiles;
  let engine: DrasculaEngine;
  let loader: ChapterLoader;
  let audio: DrasculaAudio;
  const fetcher = (path: string): Promise<Uint8Array> => fetchBytes(options.base, path);
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    const fileStore = new FileStore();
    loader = new ChapterLoader(fileStore, files, fetcher);
    // Le son se débloque dans le geste qui a lancé le jeu (le chargement peut durer plus que la validité du geste).
    audio = new DrasculaAudio({
      now: () => performance.now(),
      files: createSoundFiles(files, fetcher),
      trackUrl: (file) => `${options.base}/${file}`,
    });
    audio.unlock();
    const chapter = options.restore?.chapter ?? 1;
    const base = baseFiles(files);
    const videos = [...new Set(ChapterLoader.needed(chapter).flatMap((c) => chapterVideos(files, c)))];
    const total = Math.max(sum(files, base) + sum(files, videos), 1);
    const baseSize = sum(files, base);
    await loadInto(fileStore, files, base, fetcher, (done) => setPercent(done / total));
    await loader.prepare(chapter, (done) => setPercent((baseSize + done) / total));
    const slotsStorage = prefixedStorage(store, SAVE_PREFIX);
    host = new BrowserHost({
      files: fileStore,
      audio,
      storage: slotsStorage,
      present: (pixels, palette) => presenter.present(pixels, palette),
      onExit: () => leave(container, options),
    });
    host.setUserVolume(parseVolume(store.get(VOLUME_KEY)));
    try {
      engine = new DrasculaEngine(host, { script: drasculaScript, restore: options.restore });
    } catch (error) {
      // Une sauvegarde qui ne se rouvre pas (pièce absente de son chapitre) : message dédié, le détail va à la console.
      if (options.restore) console.error(error);
      throw options.restore ? new Error(copy.invalidSave) : error;
    }
    engine.subtitlesEnabled = store.get(SUBTITLES_KEY) !== "0";
  } catch (error) {
    loading.remove();
    // Une sauvegarde illisible n'a rien à voir avec le réseau ; les autres échecs de chargement se règlent souvent en rechargeant.
    const retry = error instanceof MissingFilesError || (error instanceof Error && error.message === copy.invalidSave);
    shell.fail(!retry && error instanceof Error ? new Error(`${error.message} ${copy.retryHint}`) : error, "load");
    return;
  }
  loading.remove();
  earlyBack?.remove();
  const game = host;
  const slots = new SaveSlots(game.storage);
  const prefs = createSoundPrefs(store, audio);
  if (options.debug) (window as unknown as { __drascula: unknown }).__drascula = { engine, host: game, loader, slots };

  // --- Pause et fenêtres ---------------------------------------------------------------------------------------------------
  const scheduler = new TickScheduler();
  let tabHidden = false;
  let userPaused = false;
  /** Fenêtre ouverte par-dessus le jeu (sauvegardes, volume, menu) ; l'aide a la sienne (`helpView`). */
  let modal: HTMLElement | null = null;
  let helpView: HTMLElement | null = null;
  const isPaused = (): boolean => tabHidden || userPaused || modal !== null || helpView !== null;
  const applyPause = (): void => {
    const paused = isPaused();
    game.setPaused(paused);
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
  const togglePause = (): void => {
    userPaused = !userPaused;
    pauseButton.textContent = userPaused ? copy.resume : copy.pause;
    applyPause();
    // Le bouton « Reprendre » (masqué à la reprise) avait le focus : le canvas le reprend de force.
    if (!userPaused) shell.canvas.focus({ preventScroll: true });
  };

  const closeModal = (): void => {
    modal?.parentElement?.remove();
    modal = null;
    applyPause();
    shell.focusCanvas();
  };
  const openModal = (dialog: HTMLElement): void => {
    if (modal) closeModal();
    modal = dialog;
    // Un clic sur le fond (hors de la fenêtre) la ferme, comme Échap.
    const backdrop = h("div", { class: "dra-overlay" }, dialog);
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) closeModal();
    });
    shell.main.append(backdrop);
    applyPause();
  };

  const openSave = (): void => {
    if (!engine.canSave) {
      say(copy.saveBusy);
      return;
    }
    openModal(
      renderSlotDialog({
        mode: "save",
        slots,
        close: closeModal,
        choose(slot) {
          const result = saveToSlot(engine, slots, slot, Date.now());
          if (result === "saved") say(copy.saveDone);
          return { ok: result === "saved", message: resultMessage(result, "save") };
        },
      }),
    );
  };
  const openLoad = (): void => {
    openModal(
      renderSlotDialog({
        mode: "load",
        slots,
        close: closeModal,
        async choose(slot) {
          const stored = slots.read(slot);
          if (!stored) return { ok: false, message: copy.loadEmpty };
          // Les vidéos du chapitre de la sauvegarde doivent être là avant de le rouvrir (le moteur les lit en synchrone).
          try {
            await loader.prepare(stored.save.chapter);
          } catch (error) {
            console.error(error);
            return { ok: false, message: copy.loadFailed };
          }
          const result = loadFromSlot(engine, slots, slot);
          if (result === "loaded") say(copy.loadDone);
          return { ok: result === "loaded", message: resultMessage(result, "load") };
        },
      }),
    );
  };
  const openVolume = (): void => {
    openModal(
      renderVolumeDialog(
        game.volume,
        (level) => {
          game.setUserVolume(level);
          store.set(VOLUME_KEY, String(Math.round(level * 100)));
        },
        closeModal,
      ),
    );
  };
  /** Retour à l'écran titre, après confirmation : le jeu s'arrête et la page est remplacée (`toTitle`). */
  const goToTitle = (): void => {
    const leaveNow = (): void => {
      closeModal();
      if (!options.toTitle) return leave(container, options);
      shell.dispose();
      options.toTitle();
    };
    openModal(renderLeaveDialog(leaveNow, closeModal));
  };
  const toggleSubtitles = (): void => {
    engine.subtitlesEnabled = !engine.subtitlesEnabled;
    store.set(SUBTITLES_KEY, engine.subtitlesEnabled ? "1" : "0");
    say(engine.subtitlesEnabled ? copy.subtitlesOn : copy.subtitlesOff);
  };
  const openMenu = (): void => {
    const again = (action: () => void) => (): void => {
      closeModal();
      action();
    };
    openModal(
      renderMenuDialog(
        {
          save: again(openSave),
          load: again(openLoad),
          volume: again(openVolume),
          toggleSubtitles: () => {
            toggleSubtitles();
            closeModal();
          },
          togglePause: again(togglePause),
          help: again(() => openHelp()),
          titleScreen: again(goToTitle),
          close: closeModal,
        },
        engine.subtitlesEnabled,
        userPaused,
      ),
    );
  };

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
    helpView = h("div", { class: "dra-help-overlay" }, renderHelp(options.base, closeHelp, copy.helpResume));
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
  const menuLink = h("button", { type: "button", class: "toggle dra-menu-link", "aria-label": copy.menuLabel, onclick: () => openMenu() }, ...withIcons(copy.menu, "menu"));
  const helpLink = h("button", { type: "button", class: "toggle dra-help-link", onclick: () => openHelp() }, ...withIcons(copy.helpLink, "help"));
  shell.toggles.append(menuLink, helpLink);

  // --- Entrées -------------------------------------------------------------------------------------------------------------
  const detach: (() => void)[] = [
    bindCanvasPointer(
      shell.canvas,
      { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
      {
        // Souris et stylet : boutons du jeu (gauche / droit). Doigt : `tap` (toucher = clic gauche, appui long = clic droit).
        move: (x, y) => {
          pointerX = x;
          pointerY = y;
          if (!isPaused()) game.input.move(x, y);
        },
        down: (button, x, y) => game.input.down(button, x, y),
        up: (button, x, y) => game.input.up(button, x, y),
        tap: (button) => {
          if (isPaused()) return;
          // Pendant une réplique, un toucher la coupe (ScummVM ne le fait qu'au clavier : une touche) ; hors réplique, c'est un clic.
          if (button === 0 && engine.subtitle !== null && engine.choices === null) game.input.key("Enter");
          else game.input.tap(button, pointerX, pointerY);
        },
      },
      { onGesture: () => game.unlock() },
    ),
    bindKeyboard(
      shell.canvas,
      {
        keyDown: (event) => {
          const action = keyAction(event);
          if (!action) return false;
          if (event.repeat) return true;
          if (action.type === "engine") {
            if (!isPaused()) game.input.key(action.key);
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
        blur: () => game.input.releaseAll(),
      },
      () => game.unlock(),
    ),
  ];

  // --- Boucle --------------------------------------------------------------------------------------------------------------
  /** Chapitre dont les vidéos sont en cours de chargement (pastille « chargement du chapitre suivant »). */
  let preparing = false;
  let loadFailure: unknown;
  const prepareFor = (chapter: number): void => {
    if (preparing) return;
    preparing = true;
    loader.prepare(chapter).then(
      () => {
        preparing = false;
        scheduler.resync();
      },
      (error: unknown) => {
        loadFailure = error;
      },
    );
  };
  // Les vidéos des chapitres suivants se chargent en fond dès le départ (8 Mo en tout) : le chapitre 1 et son introduction durent plus longtemps.
  void (async () => {
    try {
      for (let chapter = (options.restore?.chapter ?? 1) + 1; chapter <= 6; chapter++) await loader.prepare(chapter);
    } catch (error) {
      loadFailure = error;
    }
  })();

  shell.start({
    onPause: (hidden) => {
      tabHidden = hidden;
      applyPause();
    },
    sound: { prefs, storageKey: soundPrefKey("drascula"), unlock: () => game.unlock() },
    onDispose: () => {
      for (const off of detach) off();
      clearTimeout(noticeTimer);
      game.close();
      game.setPaused(true);
    },
    onFrame: (now) => {
      if (loadFailure !== undefined) throw loadFailure;
      if (isPaused()) return;
      if (!loader.runnable(engine.chapter)) {
        // Le chapitre suivant n'est pas encore là (réseau lent après un début de partie très rapide) : le jeu attend.
        prepareFor(engine.chapter);
        loadingText.textContent = copy.loadingChapter;
        progress.removeAttribute("value");
        if (!loading.isConnected) shell.stage.append(loading);
        return;
      }
      if (loading.isConnected) loading.remove();
      for (let ticks = scheduler.due(now); ticks > 0; ticks--) engine.tick();
      engine.render();
    },
  });
  if (options.restore) say(copy.loadDone);
}
