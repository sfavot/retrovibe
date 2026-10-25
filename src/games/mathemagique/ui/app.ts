import "./style.css";
import { fitScale as sharedFitScale, leaveGame, mountGameShell } from "../../../ui/game-shell";
import { localStorageStore as createLocalStorageStore } from "../../../ui/local-storage";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { copy } from "../copy";
import { fetchGameFiles } from "../data/files";
import { Engine } from "../engine/engine";
import { installServices, type MathServices } from "../engine/services";
import { cssCursor, loadCursorImages } from "../engine/pointer";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/canvas-presenter";
import { SceneId } from "../engine/scene";
import { registerScenes } from "../scenes";
import type { HubScene } from "../scenes/hub";
import { MissingFilesError } from "../../../ui/files";
import { BrowserHost } from "./browser-host";
import { createCertificateDownload } from "./certificate-download";
import { createBrowserTextInput, type BrowserTextInput } from "./text-input";

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./mathemagique`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
  /** Expose `window.__mw` (`engine`, `host`, `services`) pour la console (page de dev). */
  debug?: boolean;
}

/** Identifiant du jeu pour la préférence « Son » (`retrovibe:mathemagique:sound`). */
const GAME_ID = "mathemagique";

/**
 * Échelle du canvas (voir `ui/game-shell.ts`), pour l'écran 640×480 du jeu : fractionnaire, sinon il resterait à 1 sur toute
 * fenêtre de moins de 1312×960 environ.
 */
export function fitScale(availableWidth: number, availableHeight: number): number {
  return sharedFitScale(availableWidth, availableHeight, SCREEN_WIDTH, SCREEN_HEIGHT, false);
}

/**
 * Sortie du jeu (`Host.exit`) : retour à l'accueil du site quand le jeu est monté depuis le site (lien de retour présent), sinon,
 * sur la page de dev, redémarrage du jeu.
 */
function leave(container: HTMLElement, options: AppOptions): void {
  leaveGame(options.backLabel, () => void mountApp(container, options));
}

/**
 * Monte le jeu : canvas 640×480 agrandi à la plus grande échelle qui tient, même fractionnaire, centré, boucle `requestAnimationFrame`,
 * états de chargement et d'erreur, pause quand l'onglet est masqué. Les erreurs de chargement et d'exécution remplacent l'écran
 * par un message.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const shell = mountGameShell({
    container,
    logicalWidth: SCREEN_WIDTH,
    logicalHeight: SCREEN_HEIGHT,
    fit: "fractional",
    copy,
    backLabel: options.backLabel,
    classes: { root: "mw", stage: "mw-stage", canvas: "mw-canvas" },
  });
  const canvas = shell.canvas;

  let host: BrowserHost;
  let engine: Engine;
  let services: MathServices;
  let textInput: BrowserTextInput;
  /** Appui long reçu de l'hôte, traité au début de l'image suivante (jamais en plein milieu d'un tick). */
  let pendingLongPress: { x: number; y: number } | null = null;
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    const files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    host = new BrowserHost(options.base, files, canvas, () => {
      // Quitter enregistre les joueurs (l'original n'écrit qu'aux moments listés dans `RosterState.save`).
      engine.ctx.roster.save();
      leave(container, options);
    });
    host.onLongPress = (x, y) => {
      pendingLongPress = { x, y };
    };
    textInput = createBrowserTextInput({ canvas, bindKeyboard: (target) => host.bindKeyboard(target) });
    // Débloque le son tant que l'activation du clic (« Jouer ») est valable.
    host.audio.unlock();
    engine = new Engine(host);
    services = installServices(engine);
    if (engine.ctx.roster.loadStatus === "invalid") console.warn("Math Workshop : les joueurs enregistrés sont illisibles ; une copie de secours sera gardée avant tout écrasement.");
    // Archives gardées toute la partie : curseurs d'origine (sablier, aide) et réglages d'initialisation du MIDI.
    const [milkyway, midiMap] = await Promise.all([engine.ctx.resources.open("MILKYWAY.DAT", "persistent"), engine.ctx.resources.open("MIDIMAP.DAT", "persistent")]);
    const cursors = loadCursorImages(milkyway);
    host.setCursorStyle("busy", cssCursor(cursors.busy, "progress"));
    host.setCursorStyle("help", cssCursor(cursors.help, "help"));
    services.sound.loadMidiMap(midiMap);
    // Les 11 scènes (titre, crédits, hub, puis les activités ; celles qui manquent encore ont un écran noir qui ramène au hub).
    registerScenes(engine, services, { textInput, certificates: createCertificateDownload() });
    engine.start();
  } catch (error) {
    shell.fail(error, "load");
    return;
  }
  // Musique demandée avant la fin du chargement de la soundfont : rejouée dès que le synthétiseur est prêt.
  const stopWatchingReady = host.audio.onReady(() => services.sound.restartMusic());
  if (options.debug) (window as unknown as { __mw: unknown }).__mw = { engine, host, services };
  shell.stage.append(textInput.element);

  // Fermeture ou masquage de la page : les joueurs sont enregistrés (sur mobile `pagehide` n'est pas toujours émis, d'où le masquage).
  const saveRoster = (): void => {
    engine.ctx.roster.save();
  };
  shell.start({
    // Onglet masqué : le jeu s'arrête (horloge et son) et repart au même point au retour.
    onPause: (hidden) => {
      if (hidden) saveRoster();
      engine.setPaused(hidden);
    },
    sound: { prefs: new SoundPrefs(createLocalStorageStore(), host.audio, GAME_ID), storageKey: soundPrefKey(GAME_ID), unlock: () => host.audio.unlock() },
    listeners: [[window, "pagehide", saveRoster]],
    onDispose: () => {
      saveRoster();
      stopWatchingReady();
      host.silence();
      host.close();
    },
    onFrame: () => {
      if (pendingLongPress) {
        // Appui long = Ctrl + clic : sur le bouton Sign-in du hub, les préférences.
        const { x, y } = pendingLongPress;
        pendingLongPress = null;
        if (engine.scenes.currentId === SceneId.hub) (engine.scenes.current as HubScene).longPress(x, y);
      }
      engine.frame(host.now());
      // Une scène n'a pas pu se charger (la première : rien à afficher ; une autre : l'ancienne reste figée, souvent sous un fondu tenu) :
      // même traitement qu'une erreur d'exécution, la boucle s'arrête.
      if (engine.error) throw engine.error.error;
      // Le message de chargement n'apparaît que pour un chargement qui dure (les scènes se chargent en un clin d'œil en local).
      shell.setLoading(engine.loading);
    },
  });
}
