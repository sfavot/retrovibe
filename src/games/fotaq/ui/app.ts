import { syncSkipButton } from "../../../ui/point-click-touch";
import "../../../ui/point-click.css";
import { prefixedStorage } from "../../../engine/storage";
import { h } from "../../../ui/dom";
import { FileStore, loadInto } from "../../../ui/file-store";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { leaveGame, mountGameShell } from "../../../ui/game-shell";
import { withIcons } from "../../../ui/icons";
import { IndexedPresenter } from "../../../ui/indexed-canvas";
import { localStorageStore } from "../../../ui/local-storage";
import { bindCanvasPointer, bindKeyboard } from "../../../ui/pointer";
import { dialogOverlay, parseVolume, renderLeaveDialog, renderMenuDialog, renderSlotDialog, renderVolumeDialog, volumeKey } from "../../../ui/point-click-dialogs";
import { soundPrefKey } from "../../../ui/sound-prefs";
import { TickScheduler } from "../../../ui/tick-scheduler";
import { FotaqAudio, createSoundPrefs } from "../audio/audio";
import { createWebMusicOutput } from "../audio/web-music";
import { copy } from "../copy";
import { type GameFiles, fetchGameFiles } from "../data/files";
import { MAX_CATCH_UP_TICKS, TICK_MS } from "../engine/cadence";
import { FotaqEngine } from "../engine/loop";
import type { SaveData } from "../engine/save";
import { roomFiles } from "../engine/room";
import { fotaqScript } from "../engine/specials";
import { BrowserHost, createSoundFiles } from "./browser-host";
import { renderHelp } from "./help";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./input";
import { keyAction } from "./keys";
import { RoomFiles, baseFiles, neighbourRooms } from "./preload";
import { SAVE_PREFIX, createSaveSlots, loadFromSlot, resultMessage, saveToSlot, summarizeSlots } from "./saves";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./fotaq`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Partie à reprendre (écran titre : « Continuer », « Charger ») ; sans elle, une nouvelle partie. */
  restore?: SaveData;
  /** Retour à l'écran titre (entrée « Écran titre » du menu) ; sans valeur, l'entrée mène à l'accueil du site ou redémarre la page de dev. */
  toTitle?: () => void;
  /** Expose `window.__fotaq` (`engine`, `host`, `rooms`, `slots`, `step(n)`) pour la console (page de dev). */
  debug?: boolean;
}

/** Préférence du volume de la musique. */
const VOLUME_KEY = volumeKey("fotaq");
/** Durée d'affichage d'un message (ms). */
const NOTICE_MS = 3500;

/** Sortie du jeu (`exit()`, après la fin de l'aventure) : retour à l'accueil du site, ou redémarrage sur la page de dev. */
function leave(container: HTMLElement, options: AppOptions): void {
  leaveGame(options.backLabel, () => void mountApp(container, { ...options, restore: undefined }));
}

const sum = (files: GameFiles, paths: readonly string[]): number => paths.reduce((total, path) => total + (files.size(path) ?? 0), 0);

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : écran 320 x 200 à l'échelle entière, états de chargement
 * et d'erreur, bouton « Son », pause quand l'onglet est masqué. Le moteur tourne par ticks de 100 ms sur les images de l'écran, l'image
 * est composée et peinte une fois par image. Les données (banques de sprites, dialogues, cinématiques) sont chargées avant de
 * construire le moteur, qui les lit en synchrone ; les décors se chargent par pièce (le moteur attend leur arrivée), les voix à la demande.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  let host: BrowserHost | undefined;
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
      host?.unlock();
      action();
      if (e.detail > 0) shell.canvas.focus({ preventScroll: true });
    });
    return button;
  };
  const skipButton = touchButton(copy.skip, copy.skipLabel, () => host?.input.action("skipCutaway"));
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
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
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
  const presenter = IndexedPresenter.forCanvas(shell.canvas, SCREEN_WIDTH, SCREEN_HEIGHT);

  // --- Chargement ----------------------------------------------------------------------------------------------------------
  let files: GameFiles;
  let engine: FotaqEngine;
  let rooms: RoomFiles;
  let audio: FotaqAudio;
  const fetcher = (path: string): Promise<Uint8Array> => fetchBytes(options.base, path);
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    const fileStore = new FileStore();
    rooms = new RoomFiles(fileStore, files, fetcher);
    const base = baseFiles(files);
    // La musique d'abord : le son se débloque dans le geste qui a lancé le jeu (le chargement peut durer plus que la validité du geste).
    const musicPath = files.resolve("AQBANK.MUS");
    if (musicPath === undefined) throw new MissingFilesError("AQBANK.MUS");
    await loadInto(fileStore, files, [musicPath], fetcher);
    audio = new FotaqAudio({
      now: () => performance.now(),
      files: createSoundFiles(files, fetcher),
      musicData: fileStore.get("AQBANK.MUS") as Uint8Array,
      music: createWebMusicOutput(),
    });
    audio.unlock();
    const total = Math.max(sum(files, base), 1);
    await loadInto(fileStore, files, base, fetcher, (done) => setPercent(done / total));
    const slotsStorage = prefixedStorage(store, SAVE_PREFIX);
    host = new BrowserHost({
      files: fileStore,
      gameFiles: files,
      rooms,
      audio,
      storage: slotsStorage,
      present: (pixels, palette) => presenter.present(pixels, palette),
      onExit: () => leave(container, options),
      onJournal: () => openMenu(),
    });
    host.setUserVolume(parseVolume(store.get(VOLUME_KEY)));
    try {
      engine = new FotaqEngine(host, { script: fotaqScript, restore: options.restore });
    } catch (error) {
      // Une sauvegarde qui ne se rouvre pas (elle ne correspond pas aux données) : message dédié, le détail va à la console.
      if (options.restore) console.error(error);
      throw options.restore ? new Error(copy.invalidSave) : error;
    }
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
  const slots = createSaveSlots(game.storage);
  const prefs = createSoundPrefs(store, audio);
  // Page de dev : `step(n)` avance de `n` ticks à la main et repeint (un onglet masqué ou ralenti ne reçoit pas toutes les images).
  const step = (ticks = 1): void => {
    for (let i = 0; i < ticks; i++) engine.tick();
    engine.render();
    game.update();
  };
  if (options.debug) (window as unknown as { __fotaq: unknown }).__fotaq = { engine, host: game, rooms, slots, step };

  // --- Pause et fenêtres ---------------------------------------------------------------------------------------------------
  const scheduler = new TickScheduler(TICK_MS, MAX_CATCH_UP_TICKS);
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
        summaries: () => summarizeSlots(slots),
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
        copy,
        mode: "load",
        summaries: () => summarizeSlots(slots),
        close: closeModal,
        choose(slot) {
          // Le moteur est à l'arrêt (fenêtre ouverte) : le chargement se fait bien entre deux ticks.
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
        copy,
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
    openModal(renderLeaveDialog(copy, leaveNow, closeModal));
  };
  const openMenu = (): void => {
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
          togglePause: again(togglePause),
          help: again(() => openHelp()),
          titleScreen: again(goToTitle),
          close: closeModal,
        },
        false,
        userPaused,
      ),
    );
  };

  // Aide (page de l'écran titre) : par-dessus le jeu, qui attend ; même mécanique que Drascula et Armaeth.
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
    helpView = h("div", { class: "pc-help-overlay" }, renderHelp(options.base, closeHelp, copy.helpResume));
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
          // Pendant une réplique parlée, un toucher la passe (le doigt n'a pas de touche Entrée) ; hors réplique, c'est un clic.
          if (button === 0 && engine.speechPending) game.input.action("skipText");
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
            if (!isPaused()) game.input.action(action.action);
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
  /** Pièce dont les voisines ont été demandées au chargement de fond. */
  let prefetchedRoom = 0;

  shell.start({
    onPause: (hidden) => {
      tabHidden = hidden;
      applyPause();
    },
    sound: { prefs, storageKey: soundPrefKey("fotaq"), unlock: () => game.unlock() },
    onDispose: () => {
      for (const off of detach) off();
      clearTimeout(noticeTimer);
      game.close();
      game.setPaused(true);
    },
    onFrame: (now) => {
      if (rooms.failure !== undefined) throw rooms.failure;
      if (isPaused()) return;
      game.waitingForRoom = false;
      for (let ticks = scheduler.due(now); ticks > 0; ticks--) engine.tick();
      engine.render();
      syncSkipButton(skipButton, engine.canSkip);
      game.update();
      // Le moteur attend le décor d'une pièce (réseau lent) : pastille de chargement ; sinon on prépare les pièces voisines.
      if (game.waitingForRoom) {
        loadingText.textContent = copy.loadingRoom;
        progress.removeAttribute("value");
        if (!loading.isConnected) shell.stage.append(loading);
      } else {
        if (loading.isConnected) loading.remove();
        if (engine.state.room !== prefetchedRoom) {
          prefetchedRoom = engine.state.room;
          rooms.prefetch(neighbourRooms(engine.data, prefetchedRoom).flatMap((room) => roomFiles(engine.data, room, (name) => files.has(name))));
        }
      }
    },
  });
  if (options.restore) say(copy.loadDone);
}
