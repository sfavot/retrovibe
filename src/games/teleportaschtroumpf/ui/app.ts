import "./style.css";
import { h } from "../../../ui/dom";
import { fetchGameFiles } from "../data/files";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../data/mcg";
import { Engine } from "../engine/engine";
import { createBootScene } from "../scenes/boot";
import { BrowserHost } from "./browser-host";

/**
 * Textes de l'interface (hors textes du jeu, qui viennent des fichiers de données).
 * ⚠ Copy à valider.
 */
export const copy = {
  title: "Le Téléportaschtroumpf",
  description: "Le jeu de plateau et de mini-jeux des Schtroumpfs, en cours de réimplémentation.",
  loading: "Chargement…",
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Le Téléportaschtroumpf",
};

export interface AppOptions {
  /** URL du dossier des fichiers du jeu, sans barre finale (ex. `./teleportaschtroumpf`). */
  base: string;
  /** Libellé du lien de retour à l'accueil ; sans valeur, pas de lien (page de dev). */
  backLabel?: string;
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

/** Marge réservée autour de l'écran (lien de retour, espacements), en pixels CSS. */
const CHROME_HEIGHT = 96;

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
  container.replaceChildren(h("main", { class: "tsm" }, status, back));
  const main = container.firstElementChild as HTMLElement;

  let host: BrowserHost;
  let engine: Engine;
  const canvas = h("canvas", { class: "tsm-canvas", width: SCREEN_WIDTH, height: SCREEN_HEIGHT, tabindex: 0, "aria-label": copy.canvasLabel });
  try {
    const files = await fetchGameFiles(options.base);
    host = new BrowserHost(options.base, files, canvas, () => leave(container, options));
    engine = new Engine(host);
    await engine.start(createBootScene());
  } catch (error) {
    console.error(error);
    status.setAttribute("role", "alert");
    status.textContent = `${copy.loadError} ${error instanceof Error ? error.message : String(error)}`;
    return;
  }

  const stage = h("div", { class: "tsm-stage" }, canvas);
  main.prepend(stage);
  const resize = (): void => {
    const scale = fitScale(main.clientWidth - 32, window.innerHeight - CHROME_HEIGHT);
    canvas.style.width = `${SCREEN_WIDTH * scale}px`;
    canvas.style.height = `${SCREEN_HEIGHT * scale}px`;
  };
  resize();
  window.addEventListener("resize", resize);
  canvas.focus();

  const fail = (error: unknown): void => {
    console.error(error);
    window.removeEventListener("resize", resize);
    status.setAttribute("role", "alert");
    status.hidden = false;
    status.textContent = `${copy.runtimeError} ${error instanceof Error ? error.message : String(error)}`;
  };
  const frame = (): void => {
    // La page a été remplacée (retour à l'accueil) : on arrête la boucle.
    if (!canvas.isConnected) {
      window.removeEventListener("resize", resize);
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
