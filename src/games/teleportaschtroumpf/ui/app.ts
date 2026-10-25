import "./style.css";
import { h } from "../../../ui/dom";
import { fetchGameFiles } from "../data/files";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";
import { Engine } from "../engine/engine";
import { createBootScene } from "../scenes/boot";
import { goMainMenu } from "../scenes/flow";
import { resumeGameScene } from "../scenes/game";
import { readSave } from "../scenes/save";
import { BrowserHost, MissingFilesError, localStorageStore } from "./browser-host";
import { SOUND_KEY, SoundPrefs } from "./prefs";

/**
 * Textes de l'interface (hors textes du jeu, qui viennent des fichiers de données).
 */
export const copy = {
  title: "Le Téléportaschtroumpf",
  description: "Le jeu de plateau et de mini-jeux des Schtroumpfs, en cours de réimplémentation.",
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
 * présent), sinon, sur la page de dev, redémarrage du jeu. L'ancienne boucle s'arrête d'elle-même : son canvas n'est
 * plus dans la page.
 */
function leave(container: HTMLElement, options: AppOptions): void {
  if (options.backLabel) location.hash = "#/";
  else void mountApp(container, options);
}

/** Espace vertical que prend le reste de la page (bandeau éventuel du site) sous l'écran et autour : mesuré, plus une marge. */
const BOTTOM_MARGIN = 16;

/** Message affiché pour une erreur de chargement ou d'exécution ; les fichiers manquants ont leur propre texte. */
function failureMessage(error: unknown, prefix: string): string {
  if (error instanceof MissingFilesError) return copy.missingFiles;
  return `${prefix} ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Le canvas peut-il reprendre le focus sans le voler ? Seulement si personne d'autre ne l'a (`body`) ou s'il l'a déjà :
 * un bouton ou un lien activé au clavier le garde.
 */
export function canvasMayTakeFocus(active: Element | null, body: Element, canvas: Element): boolean {
  return active === null || active === body || active === canvas;
}

/** Échelle entière la plus grande qui tient dans la place disponible ; fractionnaire en dessous de 1. */
export function fitScale(availableWidth: number, availableHeight: number): number {
  const fit = Math.min(availableWidth / SCREEN_WIDTH, availableHeight / SCREEN_HEIGHT);
  return fit >= 1 ? Math.floor(fit) : Math.max(fit, 0.1);
}

/**
 * Monte le jeu : canvas 320×200 mis à l'échelle entière (`image-rendering: pixelated`), centré, boucle
 * `requestAnimationFrame`, états de chargement et d'erreur. Les erreurs de chargement et d'exécution
 * remplacent l'écran par un message.
 */
export async function mountApp(container: HTMLElement, options: AppOptions): Promise<void> {
  const status = h("p", { class: "tsm-status", role: "status" }, copy.loading);
  const back = options.backLabel ? h("a", { class: "back-link", href: "#/" }, options.backLabel) : null;
  // Région d'erreur présente dès le départ (vide) pour que les lecteurs d'écran annoncent le message quand il arrive.
  const errors = h("p", { class: "tsm-error", role: "alert" });
  container.replaceChildren(h("main", { class: "tsm" }, status, errors, back));
  const main = container.firstElementChild as HTMLElement;

  let host: BrowserHost;
  let engine: Engine;
  const canvas = h("canvas", { class: "tsm-canvas", width: SCREEN_WIDTH, height: SCREEN_HEIGHT, tabindex: 0, "aria-label": copy.canvasLabel });
  try {
    // Manifeste absent, illisible ou remplacé par une page d'erreur : le jeu n'est pas installé.
    const files = await fetchGameFiles(options.base).catch((error: unknown) => {
      throw new MissingFilesError(error instanceof Error ? error.message : String(error));
    });
    host = new BrowserHost(options.base, files, canvas, () => leave(container, options));
    // Débloque le son tant que l'activation du clic (« Jouer », « Reprendre la partie ») est valable : logo et intro seront sonores.
    host.audio.unlock();
    engine = new Engine(host);
    // Reprise : directement sur le plateau, sans logo, introduction ni menu (une sauvegarde devenue invalide est effacée par `readSave`).
    const save = options.resume ? readSave(localStorageStore) : null;
    await engine.start(save ? resumeGameScene(save, goMainMenu) : createBootScene());
  } catch (error) {
    console.error(error);
    status.hidden = true;
    errors.textContent = failureMessage(error, copy.loadError);
    return;
  }

  const prefs = new SoundPrefs(localStorageStore, host.audio);
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
  const stage = h("div", { class: "tsm-stage" }, canvas);
  const footer = h("div", { class: "tsm-footer" }, back, h("div", { class: "tsm-toggles" }, soundButton));
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
  const onFocus = focusCanvas;
  // Autre onglet : la préférence de son suit.
  const onStorage = (event: StorageEvent): void => {
    if ((event.key === null || event.key === SOUND_KEY) && prefs.reload()) soundButton.setAttribute("aria-pressed", String(prefs.isEnabled()));
  };
  const listeners: [EventTarget, string, EventListener][] = [
    [window, "resize", resize],
    [window, "focus", onFocus],
    [window, "storage", onStorage as EventListener],
    [document, "visibilitychange", onVisibility],
  ];
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
  const dispose = (): void => {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
  };
  if (document.hidden) engine.setPaused(true);
  resize();
  focusCanvas();

  const fail = (error: unknown): void => {
    console.error(error);
    dispose();
    host.audio.stop();
    host.audio.stopEffect();
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
      engine.frame(host.now());
    } catch (error) {
      fail(error);
      return;
    }
    // Le message de chargement n'apparaît que pour un chargement qui dure (les scènes se chargent en un clin d'œil en local).
    status.hidden = !engine.loading;
    requestAnimationFrame(frame);
  };
  status.hidden = true;
  requestAnimationFrame(frame);
}
