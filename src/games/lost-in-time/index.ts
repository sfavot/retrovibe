import { App } from "./ui/app";
import { BrowserHost } from "./ui/browser-host";
import { renderTitle } from "./ui/title";
import { copy } from "./copy";
import { copy as shared } from "../../ui/copy";
import { h } from "../../ui/dom";
import type { GameDefinition } from "../types";

/** Dossier des fichiers du jeu (servi depuis `original/lost-in-time/`). */
const GAME_URL = `${import.meta.env.BASE_URL}lost-in-time/`;

class MissingFileError extends Error {}

function showError(container: HTMLElement, message: string): void {
  container.replaceChildren(
    h("div", { class: "boot error", role: "alert" }, h("p", {}, message), h("a", { class: "back-link", href: "#/" }, shared.backToGames)),
  );
}

export const lostInTime: GameDefinition = {
  id: "lost-in-time",
  title: copy.title,
  description: copy.description,
  cover: `${GAME_URL}COVER.png`,
  coverSize: [280, 343],
  coverAlt: copy.coverAlt,
  async start(container) {
    container.replaceChildren(h("p", { class: "boot", role: "status" }, copy.loading));
    const host = new BrowserHost(GAME_URL);
    try {
      // L'archive de départ et la liste des plages du CD sont lues avant de monter l'écran.
      const [intro] = await Promise.all([host.loadFile("INTRO.STK"), host.loadFile("LOST.LIC")]);
      if (!intro) throw new MissingFileError("INTRO.STK");
    } catch (e) {
      showError(container, e instanceof MissingFileError ? copy.missingFiles : `${copy.loadError} ${e instanceof Error ? e.message : e}`);
      console.error(e);
      return;
    }
    // Écran titre, puis le jeu (INTRO.TOT) à « Nouvelle partie ».
    container.replaceChildren(renderTitle(() => new App(container, host, GAME_URL).run()));
  },
};
