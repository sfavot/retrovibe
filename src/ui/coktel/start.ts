import { copy as shared } from "../copy";
import { h } from "../dom";
import type { CoktelAppOptions } from "./app";
import { RemoteGameFiles } from "./browser-host";

/** Textes du chargement (dans le `copy.ts` du jeu). */
export interface CoktelStartCopy {
  loading: string;
  /** Fichier de départ introuvable : le jeu n'est pas installé, ce n'est pas un bogue. */
  missingFiles: string;
  loadError: string;
}

export interface CoktelStartOptions {
  /** Dossier des fichiers du jeu (servi depuis `original/<jeu>/`), avec la barre finale. */
  gameUrl: string;
  /** Fichiers lus avant de monter l'écran ; le premier (l'archive de départ) est indispensable. */
  preload: readonly [string, ...string[]];
  copy: CoktelStartCopy;
  /** Écran titre du jeu ; `play` (au clic « Jouer », qui débloque aussi le son) lance le jeu. */
  title(play: () => void): HTMLElement;
  /**
   * Module des paramètres de l'interface (`import("./ui/app")` : chargé avec le moteur, après l'accueil) ; `back` remet
   * l'écran titre (fin du jeu).
   */
  loadApp(): Promise<{ appOptions(back: () => void): CoktelAppOptions }>;
}

class MissingFileError extends Error {}

function showError(container: HTMLElement, message: string): void {
  container.replaceChildren(
    h("div", { class: "boot error", role: "alert" }, h("p", {}, message), h("a", { class: "back-link", href: "#/" }, shared.backToGames)),
  );
}

/**
 * Lancement commun des jeux du moteur Coktel : fichiers de départ, puis écran titre, puis le jeu à « Jouer ». Le moteur et
 * l'interface ne sont chargés qu'à ce moment (import dynamique) : la page d'accueil reste légère.
 */
export async function startCoktelGame(container: HTMLElement, options: CoktelStartOptions): Promise<void> {
  const { copy } = options;
  container.replaceChildren(h("p", { class: "boot", role: "status" }, copy.loading));
  const files = new RemoteGameFiles(options.gameUrl);
  let App: typeof import("./app").CoktelApp;
  let appOptions: (back: () => void) => CoktelAppOptions;
  try {
    const [[start], common, game] = await Promise.all([
      Promise.all(options.preload.map((name) => files.load(name))),
      import("./app"),
      options.loadApp(),
    ]);
    if (!start) throw new MissingFileError(options.preload[0]);
    App = common.CoktelApp;
    appOptions = game.appOptions;
  } catch (e) {
    showError(container, e instanceof MissingFileError ? copy.missingFiles : `${copy.loadError} ${e instanceof Error ? e.message : e}`);
    console.error(e);
    return;
  }
  const showTitle = (): void => {
    container.replaceChildren(options.title(() => new App(container, files, appOptions(showTitle)).run()));
  };
  showTitle();
}
