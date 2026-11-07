import "./style.css";
import { fitScale as sharedFitScale, leaveGame, mountGameShell } from "../../../ui/game-shell";
import { MissingFilesError } from "../../../ui/files";
import { localStorageStore as createLocalStorageStore } from "../../../ui/local-storage";
import { withIcons } from "../../../ui/icons";
import { h } from "../../../ui/dom";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { fetchGameFiles } from "../data/files";
import { copy } from "../copy";
import { COMMON_ARCHIVE } from "../data/archives";
import { DIALOG } from "../engine/dialog";
import { createZoombinisEngine, type ZoombinisEngine } from "../engine/engine";
import { installServices, SCREEN_HEIGHT, SCREEN_WIDTH, type ZoombinisServices } from "../engine/services";
import { registerScenes } from "../scenes/index";
import { createZoombinisBrowserHost, loadCursors, loadText, type ZoombinisBrowserHost } from "./browser-host";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./zoombinis`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Expose `window.__zb` (`engine`, `host`, `services`) pour la console (page de dev). */
  debug?: boolean;
}

/** Identifiant du jeu pour la préférence « Son » (`retrovibe:zoombinis:sound`). */
const GAME_ID = "zoombinis";

/** Échelle du canvas 640×480 : fractionnaire, comme Mathémagique (voir `ui/game-shell.ts`). */
export function fitScale(availableWidth: number, availableHeight: number): number {
  return sharedFitScale(availableWidth, availableHeight, SCREEN_WIDTH, SCREEN_HEIGHT, false);
}

/** Sortie du jeu (`Host.exit`) : retour à l'accueil, ou, sur la page de dev, redémarrage. */
function leave(container: HTMLElement, options: AppOptions): void {
  leaveGame(options.backLabel, () => void mountApp(container, options));
}

/**
 * Monte le jeu : canvas 640×480 à la plus grande échelle qui tient, boucle `requestAnimationFrame`, son débloqué au premier geste,
 * pause quand l'onglet est masqué. Une erreur de chargement ou d'exécution remplace l'écran par un message.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
    fit: "fractional",
    copy,
    backLabel: options.backLabel,
    classes: { root: "zb", stage: "zb-stage", canvas: "zb-canvas" },
  });

  let host: ZoombinisBrowserHost;
  let engine: ZoombinisEngine;
  let services: ZoombinisServices;
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    const files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    host = createZoombinisBrowserHost(options.base, files, shell.canvas, () => leave(container, options));
    if (host.textInput) shell.stage.append(host.textInput.element);
    // Débloque le son tant que l'activation du clic est valable.
    host.audio.unlock();
    await loadText(host);
    engine = createZoombinisEngine(host);
    services = await installServices(engine);
    loadCursors(host, engine.ctx.resources.require(COMMON_ARCHIVE));
    registerScenes(engine);
    engine.start();
  } catch (error) {
    shell.fail(error, "load");
    return;
  }
  // Musique demandée avant la fin du chargement de la soundfont : rejouée dès que le synthétiseur est prêt.
  const stopWatchingReady = host.audio.onReady(() => {
    const id = services.sound.lastMusicId;
    if (id !== 0) services.sound.queue(0);
  });
  if (options.debug) (window as unknown as { __zb: unknown }).__zb = { engine, host, services };

  shell.start({
    // Onglet masqué : le jeu s'arrête (horloge et son) et repart au même point au retour.
    onPause: (hidden) => engine.setPaused(hidden),
    sound: { prefs: new SoundPrefs(createLocalStorageStore(), host.audio, GAME_ID), storageKey: soundPrefKey(GAME_ID), unlock: () => host.audio.unlock() },
    onDispose: () => {
      stopWatchingReady();
      host.silence();
      host.close();
    },
    onFrame: () => {
      engine.frame(host.now());
      // Un écran n'a pas pu se charger : même traitement qu'une erreur d'exécution, la boucle s'arrête.
      if (engine.error) throw engine.error.error;
      shell.setLoading(engine.loading);
    },
  });
  // Ajout du port pour le tactile (affiché seulement sur écran tactile, `style.css`) : hors de la carte, l'original n'ouvre le menu
  // (enregistrer, charger) qu'au clavier (`/`, `1198:05b3`). Même effet que la touche : `openMenu` refuse les écrans sans menu.
  const menuButton = h("button", { type: "button", class: "toggle zb-menu-button" }, ...withIcons(copy.menu, "menu"));
  menuButton.addEventListener("click", () => {
    engine.ctx.services.get(DIALOG).openMenu(engine.ctx);
    shell.focusCanvas();
  });
  shell.toggles.prepend(menuButton);
}
