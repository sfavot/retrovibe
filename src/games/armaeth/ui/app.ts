import "./style.css";
import { baseName, fetchGameFiles } from "../../../data/game-files";
import { prefixedStorage } from "../../../engine/storage";
import { MissingFilesError, fetchBytes } from "../../../ui/files";
import { leaveGame, mountGameShell } from "../../../ui/game-shell";
import { localStorageStore } from "../../../ui/local-storage";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { h } from "../../../ui/dom";
import { copy } from "../copy";
import { parseHelp } from "../data/tables";
import { parsePlainMessages } from "../data/text";
import { ArmaethEngine } from "../engine/engine";
import { BrowserHost } from "./browser-host";
import { renderHelp } from "./help";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./input";
import { TickScheduler } from "./scheduler";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./armaeth`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Expose `window.__armaeth` (`engine`, `host`) pour la console (page de dev). */
  debug?: boolean;
}

/** Identifiant du jeu : préférence « Son » (`retrovibe:armaeth:sound`) et préfixe des sauvegardes (`armaeth:`). */
const GAME_ID = "armaeth";

/**
 * Sortie du jeu (`quit()`) : retour à l'accueil du site quand le jeu est monté depuis le site (lien de retour présent), sinon,
 * sur la page de dev, redémarrage du jeu.
 */
function leave(container: HTMLElement, options: AppOptions): void {
  leaveGame(options.backLabel, () => void mountApp(container, options));
}

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : écran 320×200 à l'échelle entière, états de
 * chargement et d'erreur, bouton « Son », pause quand l'onglet est masqué. Le moteur tourne à 50 Hz sur les images de l'écran
 * (`TickScheduler`). Les erreurs de chargement et d'exécution remplacent l'écran par un message.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
    copy,
    backLabel: options.backLabel,
    classes: { root: "aeth", stage: "aeth-stage", canvas: "aeth-canvas" },
  });
  const store = localStorageStore();

  let host: BrowserHost;
  let engine: ArmaethEngine;
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    const manifest = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    // Le moteur lit les fichiers en synchrone : on les charge tous avant de le construire (2,8 Mo).
    const files = new Map(await Promise.all(manifest.entries.map(async ({ path }) => [baseName(path), await fetchBytes(options.base, path)] as const)));
    host = new BrowserHost(files, shell.canvas, prefixedStorage(store, `${GAME_ID}:`), () => leave(container, options));
    // Débloque le son tant que l'activation du clic (« Jouer ») est valable.
    host.unlock();
    engine = new ArmaethEngine(host);
  } catch (error) {
    shell.fail(error, "load");
    return;
  }
  const game = host;
  let openHelp = (): void => {};
  if (options.debug) (window as unknown as { __armaeth: unknown }).__armaeth = { engine, host: game };

  const scheduler = new TickScheduler();
  // Pause : onglet masqué ou aide ouverte par-dessus le jeu. Le son s'arrête et le jeu repart au même point (pas de rattrapage).
  let tabHidden = false;
  let helpView: HTMLElement | null = null;
  const applyPause = (): void => {
    const paused = tabHidden || helpView !== null;
    game.setPaused(paused);
    if (!paused) scheduler.resync();
  };
  const closeHelp = (): void => {
    helpView?.remove();
    helpView = null;
    shell.main.style.display = "";
    shell.stage.style.display = "";
    applyPause();
    shell.focusCanvas();
  };
  // Aide (indices de `SOS.EXE`) : même page que l'écran titre, par-dessus le jeu qui attend ; fichiers déjà en mémoire.
  openHelp = () => {
    if (helpView) return;
    try {
      helpView = h("div", { class: "aeth-help-overlay" }, renderHelp(parseHelp(game.readFile("A1FSOS.SYS")), parsePlainMessages(game.readFile("MSGUTL")), closeHelp, copy.helpResume));
    } catch (error) {
      console.error(error);
      shell.setError(`${copy.helpLoadError} ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
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
  const helpLink = h("button", { type: "button", class: "toggle aeth-help-link", onclick: () => openHelp() }, copy.helpLink);
  shell.toggles.append(helpLink);

  shell.start({
    onPause: (hidden) => {
      tabHidden = hidden;
      applyPause();
    },
    sound: { prefs: new SoundPrefs(store, game.opl, GAME_ID), storageKey: soundPrefKey(GAME_ID), unlock: () => game.unlock() },
    onDispose: () => {
      game.close();
      game.opl.close();
      game.setPaused(true);
    },
    onFrame: (now) => {
      if (helpView) return;
      for (let ticks = scheduler.due(now); ticks > 0; ticks--) engine.tick();
    },
  });
}
