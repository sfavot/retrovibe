import "./style.css";
import { fetchGameFiles } from "../../../data/game-files";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../engine/infogrames/data/mcg";
import { Engine } from "../../../engine/infogrames/engine";
import { BrowserHost } from "../../../engine/infogrames/ui/browser-host";
import { MissingFilesError } from "../../../ui/files";
import { canvasMayTakeFocus, leaveGame, mountGameShell } from "../../../ui/game-shell";
import { localStorageStore as createLocalStorageStore } from "../../../ui/local-storage";
import { resolveGameFile } from "../engine/paths";
import { readSave } from "../scenes/save";
import type { MinigameStart } from "../scenes/minigame";
import { GAME_CONFIG, createGame } from "../scenes/start";
import { copy } from "./copy";
import { SOUND_KEY, SoundPrefs } from "./prefs";

export { canvasMayTakeFocus, copy };

const localStorageStore = createLocalStorageStore();

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./asterix`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Reprendre la partie sauvegardée au lieu de lancer le jeu depuis le début (sans effet s'il n'y en a plus de valide). */
  resume?: boolean;
  /** Passer les logos et l'introduction (page de dev). */
  skipIntro?: boolean;
  /** Graine du hasard (page de dev : parties reproductibles). */
  seed?: number;
  /** Mini-jeu à jouer d'abord, hors partie (page de dev). */
  minigame?: MinigameStart;
}

/** Sortie du jeu (`Host.exit`, après le générique) : retour à l'accueil du site, ou redémarrage sur la page de dev. */
function leave(container: HTMLElement, options: AppOptions): void {
  leaveGame(options.backLabel, () => void mountApp(container, options));
}

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : canvas 320×200 à l'échelle entière, boucle
 * d'images, états de chargement et d'erreur.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
    copy,
    backLabel: options.backLabel,
    classes: { root: "asterix", stage: "asterix-stage", canvas: "asterix-canvas" },
  });

  let host: BrowserHost;
  let engine: Engine;
  let game: ReturnType<typeof createGame>;
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    const files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    host = new BrowserHost(options.base, (name) => resolveGameFile(files, name), shell.canvas, () => leave(container, options));
    // Débloque le son tant que l'activation du clic (« Jouer », « Continuer ») est valable : les logos seront sonores.
    host.audio.unlock();
    engine = new Engine(host, GAME_CONFIG, options.seed === undefined ? {} : { seed: options.seed });
    // Reprise : directement au début du tour sauvegardé (une sauvegarde devenue invalide est effacée par `readSave`).
    game = createGame({ resume: options.resume ? readSave(localStorageStore) : null, skipIntro: options.skipIntro, minigame: options.minigame });
    await engine.start(game.scene);
  } catch (error) {
    shell.fail(error, "load");
    return;
  }

  shell.start({
    // Onglet masqué : le jeu s'arrête (horloge et son) et repart au même point au retour.
    onPause: (hidden) => engine.setPaused(hidden),
    sound: { prefs: new SoundPrefs(localStorageStore, host.audio), storageKey: SOUND_KEY, unlock: () => host.audio.unlock() },
    onDispose: () => {
      host.audio.stop();
      host.audio.stopEffect();
    },
    onFrame: () => {
      engine.frame(host.now());
      // Le message de chargement n'apparaît que pour un chargement qui dure.
      shell.setLoading(engine.loading || game.scene.loading);
    },
  });
}
