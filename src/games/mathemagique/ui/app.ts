import "./style.css";
import { SoundPrefs, soundPrefKey } from "../../../ui/sound-prefs";
import { h } from "../../../ui/dom";
import { copy } from "../copy";
import { fetchGameFiles } from "../data/files";
import { Engine } from "../engine/engine";
import { installServices, type MathServices } from "../engine/services";
import { cssCursor, loadCursorImages } from "../engine/pointer";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../render/canvas-presenter";
import { SceneId } from "../engine/scene";
import { registerScenes } from "../scenes";
import type { HubScene } from "../scenes/hub";
import { BrowserHost, MissingFilesError, localStorageStore } from "./browser-host";
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

/** Marge sous l'écran (en plus de ce que la page occupe déjà autour). */
const BOTTOM_MARGIN = 16;

/**
 * Sortie du jeu (`Host.exit`) : retour à l'accueil du site quand le jeu est monté depuis le site (lien de retour présent), sinon,
 * sur la page de dev, redémarrage du jeu. L'ancienne boucle s'arrête d'elle-même : son canvas n'est plus dans la page.
 */
function leave(container: HTMLElement, options: AppOptions): void {
  if (options.backLabel) location.hash = "#/";
  else void mountApp(container, options);
}

/** Message affiché pour une erreur de chargement ou d'exécution ; les fichiers manquants ont leur propre texte. */
function failureMessage(error: unknown, prefix: string): string {
  if (error instanceof MissingFilesError) return copy.missingFiles;
  return `${prefix} ${error instanceof Error ? error.message : String(error)}`;
}

/** Le canvas peut-il reprendre le focus sans le voler ? Seulement si personne d'autre ne l'a (`body`) ou s'il l'a déjà. */
export function canvasMayTakeFocus(active: Element | null, body: Element, canvas: Element): boolean {
  return active === null || active === body || active === canvas;
}

/** Échelle entière la plus grande qui tient dans la place disponible ; fractionnaire en dessous de 1. */
export function fitScale(availableWidth: number, availableHeight: number): number {
  const fit = Math.min(availableWidth / SCREEN_WIDTH, availableHeight / SCREEN_HEIGHT);
  return fit >= 1 ? Math.floor(fit) : Math.max(fit, 0.1);
}

/**
 * Monte le jeu : canvas 640×480 mis à l'échelle entière (`image-rendering: pixelated`), centré, boucle `requestAnimationFrame`,
 * états de chargement et d'erreur, pause quand l'onglet est masqué. Les erreurs de chargement et d'exécution remplacent l'écran
 * par un message.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const status = h("p", { class: "mw-status", role: "status" }, copy.loading);
  const back = options.backLabel ? h("a", { class: "back-link", href: "#/" }, options.backLabel) : null;
  // Région d'erreur présente dès le départ (vide) pour que les lecteurs d'écran annoncent le message quand il arrive.
  const errors = h("p", { class: "mw-error", role: "alert" });
  container.replaceChildren(h("main", { class: "mw" }, status, errors, back));
  const main = container.firstElementChild as HTMLElement;

  let host: BrowserHost;
  let engine: Engine;
  let services: MathServices;
  let textInput: BrowserTextInput;
  /** Appui long reçu de l'hôte, traité au début de l'image suivante (jamais en plein milieu d'un tick). */
  let pendingLongPress: { x: number; y: number } | null = null;
  const canvas = h("canvas", { class: "mw-canvas", width: SCREEN_WIDTH, height: SCREEN_HEIGHT, tabindex: 0, "aria-label": copy.canvasLabel });
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
    console.error(error);
    status.hidden = true;
    errors.textContent = failureMessage(error, copy.loadError);
    return;
  }
  // Musique demandée avant la fin du chargement de la soundfont : rejouée dès que le synthétiseur est prêt.
  const stopWatchingReady = host.audio.onReady(() => services.sound.restartMusic());
  if (options.debug) (window as unknown as { __mw: unknown }).__mw = { engine, host, services };

  const prefs = new SoundPrefs(localStorageStore, host.audio, GAME_ID);
  const soundButton = h("button", { type: "button", class: "toggle", "aria-pressed": String(prefs.isEnabled()) }, copy.sound);
  const focusCanvas = (): void => {
    if (canvasMayTakeFocus(document.activeElement, document.body, canvas)) canvas.focus();
  };
  soundButton.addEventListener("click", (event) => {
    soundButton.setAttribute("aria-pressed", String(prefs.toggle()));
    host.audio.unlock();
    // Clic souris (`detail` > 0) : le canvas reprend la main ; activation au clavier : le focus reste sur le bouton.
    if (event.detail > 0) canvas.focus();
  });
  const stage = h("div", { class: "mw-stage" }, canvas, textInput.element);
  const footer = h("div", { class: "mw-footer" }, back, h("div", { class: "mw-toggles" }, soundButton));
  main.prepend(stage);
  main.append(footer);

  const resize = (): void => {
    // Place disponible : largeur du conteneur ; hauteur de la fenêtre moins ce qui n'est pas l'écran (pied de page, marges, bandeau).
    const above = main.getBoundingClientRect().top + window.scrollY;
    const around = main.offsetHeight - stage.offsetHeight;
    const scale = fitScale(main.clientWidth - 32, window.innerHeight - above - around - BOTTOM_MARGIN);
    canvas.style.width = `${SCREEN_WIDTH * scale}px`;
    canvas.style.height = `${SCREEN_HEIGHT * scale}px`;
    footer.style.width = canvas.style.width;
  };

  // Onglet masqué : le jeu s'arrête (horloge et son) et repart au même point au retour ; le canvas reprend le focus.
  const onVisibility = (): void => {
    engine.setPaused(document.hidden);
    if (!document.hidden) focusCanvas();
  };
  // Autre onglet : la préférence de son suit.
  const onStorage = (event: StorageEvent): void => {
    if ((event.key === null || event.key === soundPrefKey(GAME_ID)) && prefs.reload()) soundButton.setAttribute("aria-pressed", String(prefs.isEnabled()));
  };
  // Fermeture ou masquage de la page : les joueurs sont enregistrés (sur mobile `pagehide` n'est pas toujours émis, d'où le masquage).
  const saveRoster = (): void => {
    engine.ctx.roster.save();
  };
  const onHide = (): void => {
    if (document.hidden) saveRoster();
  };
  const listeners: [EventTarget, string, EventListener][] = [
    [window, "pagehide", saveRoster],
    [document, "visibilitychange", onHide],
    [window, "resize", resize],
    [window, "focus", focusCanvas],
    [window, "storage", onStorage as EventListener],
    [document, "visibilitychange", onVisibility],
  ];
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
  const dispose = (): void => {
    saveRoster();
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
    stopWatchingReady();
    host.silence();
    host.close();
  };
  if (document.hidden) engine.setPaused(true);
  resize();
  focusCanvas();

  const fail = (error: unknown): void => {
    console.error(error);
    dispose();
    status.hidden = true;
    errors.textContent = failureMessage(error, copy.runtimeError);
  };
  const frame = (): void => {
    // La page a été remplacée (retour à l'accueil) : on arrête la boucle.
    if (!canvas.isConnected) {
      dispose();
      return;
    }
    try {
      if (pendingLongPress) {
        // Appui long = Ctrl + clic : sur le bouton Sign-in du hub, les préférences.
        const { x, y } = pendingLongPress;
        pendingLongPress = null;
        if (engine.scenes.currentId === SceneId.hub) (engine.scenes.current as HubScene).longPress(x, y);
      }
      engine.frame(host.now());
    } catch (error) {
      fail(error);
      return;
    }
    // Une scène n'a pas pu se charger (la première : rien à afficher ; une autre : l'ancienne reste figée, souvent sous un fondu tenu) :
    // même traitement qu'une erreur d'exécution, la boucle s'arrête.
    if (engine.error) {
      fail(engine.error?.error);
      return;
    }
    // Le message de chargement n'apparaît que pour un chargement qui dure (les scènes se chargent en un clin d'œil en local).
    status.hidden = !engine.loading;
    requestAnimationFrame(frame);
  };
  status.hidden = true;
  requestAnimationFrame(frame);
}
