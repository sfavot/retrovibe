import "./style.css";
import { fetchGameFiles } from "../data/files";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";
import { Engine } from "../engine/engine";
import { createBootScene } from "../scenes/boot";
import { goMainMenu } from "../scenes/flow";
import { resumeGameScene } from "../scenes/game";
import { readSave } from "../scenes/save";
import { canvasMayTakeFocus, leaveGame, mountGameShell } from "../../../ui/game-shell";
import { MissingFilesError } from "../../../ui/files";
import { localStorageStore as createLocalStorageStore } from "../../../ui/local-storage";
import { BrowserHost } from "./browser-host";
import { SOUND_KEY, SoundPrefs } from "./prefs";

export { canvasMayTakeFocus };

const localStorageStore = createLocalStorageStore();

/**
 * Textes de l'interface (hors textes du jeu, qui viennent des fichiers de données).
 */
export const copy = {
  title: "Le Téléportaschtroumpf",
  description: "Le jeu de plateau et de mini-jeux des Schtroumpfs (Infogrames Multimedia, 1995).",
  // Écran de présentation et carte de l'accueil.
  coverAlt: "Jaquette du Téléportaschtroumpf : la Schtroumpfette sortant du téléporteur, devant le Grand Schtroumpf et un Schtroumpf.",
  play: "Jouer",
  // Bouton de l'écran de présentation quand une partie interrompue est sauvegardée (« Jouer » devient secondaire).
  resumeGame: "Reprendre la partie",
  // Manuel d'origine et contrôles, sur l'écran de présentation.
  manual: "Manuel d'origine",
  manualNote: "Notice Infogrames, en français (PDF, dans un nouvel onglet).",
  // Menu parents, en vue sur l'écran de présentation : son accès est caché dans le jeu (appui tenu 4 s).
  parentsTitle: "Menu parents",
  parentsText:
    "Durée d'une partie, pause obligatoire entre deux parties et message de fin se règlent dans le menu Parents. Pour l'ouvrir, au menu principal du jeu, gardez le doigt ou le clic appuyé 4 secondes sur le bouton Parents, ou sélectionnez-le avec les flèches puis maintenez la flèche droite 4 secondes.",
  controlsTitle: "Contrôles",
  controls: [
    "Flèches : se déplacer et choisir.",
    "Espace ou clic gauche : valider.",
    "Entrée ou clic droit : voix d'aide du Grand Schtroumpf.",
    "Échap : passer une séquence.",
    "P : pause, sur le plateau.",
    "F1 / F2 : baisser / monter le volume.",
  ],
  loading: "Chargement…",
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Le Téléportaschtroumpf",
  sound: "Son",
  missingFiles: "Les fichiers du jeu sont introuvables : Le Téléportaschtroumpf ne peut pas démarrer.",
};

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./teleportaschtroumpf`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Reprendre la partie sauvegardée au lieu de lancer le jeu depuis le début (sans effet s'il n'y en a plus de valide). */
  resume?: boolean;
}

/**
 * Sortie du jeu (`Host.exit`) : retour à l'accueil du site quand le jeu est monté depuis le site (lien de retour
 * présent), sinon, sur la page de dev, redémarrage du jeu.
 */
function leave(container: HTMLElement, options: AppOptions): void {
  leaveGame(options.backLabel, () => void mountApp(container, options));
}

/**
 * Monte le jeu dans la page commune des jeux sur canvas (`ui/game-shell.ts`) : canvas 320×200 mis à l'échelle entière,
 * boucle d'images, états de chargement et d'erreur. Les erreurs de chargement et d'exécution remplacent l'écran par un message.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
    copy,
    backLabel: options.backLabel,
    classes: { root: "tsm", stage: "tsm-stage", canvas: "tsm-canvas" },
  });

  let host: BrowserHost;
  let engine: Engine;
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    const files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    host = new BrowserHost(options.base, files, shell.canvas, () => leave(container, options));
    // Débloque le son tant que l'activation du clic (« Jouer », « Reprendre la partie ») est valable : logo et intro seront sonores.
    host.audio.unlock();
    engine = new Engine(host);
    // Reprise : directement sur le plateau, sans logo, introduction ni menu (une sauvegarde devenue invalide est effacée par `readSave`).
    const save = options.resume ? readSave(localStorageStore) : null;
    await engine.start(save ? resumeGameScene(save, goMainMenu) : createBootScene());
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
      // Le message de chargement n'apparaît que pour un chargement qui dure (les scènes se chargent en un clin d'œil en local).
      shell.setLoading(engine.loading);
    },
  });
}
