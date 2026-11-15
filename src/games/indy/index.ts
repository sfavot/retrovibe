import { parseDaw } from "../../engine/desktop-adventures/data/daw";
import { extractPalette } from "../../engine/desktop-adventures/data/palette";
import { readBitmaps, readCursors, readIcons } from "../../engine/desktop-adventures/data/resources";
import { App } from "../../ui/desktop-adventures/app";
import { copy as shared } from "../../ui/copy";
import { h } from "../../ui/dom";
import { copy } from "./copy";
import { indyAdventure } from "./definition";
import type { GameDefinition } from "../types";

/** Dossier des fichiers du jeu (servi depuis `original/indy/`). */
const GAME_URL = `${import.meta.env.BASE_URL}indy/`;

async function fetchBinary(name: string): Promise<ArrayBuffer> {
  const response = await fetch(`${GAME_URL}${name}`);
  if (!response.ok) throw new MissingFileError(name);
  const type = response.headers.get("content-type") ?? "";
  // Le serveur de dev renvoie index.html pour un fichier absent.
  if (type.includes("text/html")) throw new MissingFileError(name);
  return response.arrayBuffer();
}

class MissingFileError extends Error {}

export const indy: GameDefinition = {
  id: "indy",
  title: copy.title,
  description: copy.description,
  cover: `${GAME_URL}COVER.png`,
  coverSize: [576, 576],
  coverPixelated: true,
  coverAlt: copy.coverAlt,
  async start(container) {
    container.replaceChildren(h("p", { class: "boot", role: "status" }, copy.loading));
    try {
      const [daw, exe] = await Promise.all([fetchBinary("DESKTOP.DAW"), fetchBinary("DESKADV.EXE")]);
      const data = parseDaw(daw);
      const app = new App(container, indyAdventure(data.sounds, GAME_URL, exe), {
        data,
        palette: extractPalette(exe),
        loadManual: () => fetchBinary("DESKADV.HLP"),
        cursors: readCursors(exe),
        icons: readIcons(exe),
        bitmaps: readBitmaps(exe),
      });
      app.showTitle();
      // Développement : ?seed=1234 lance directement une partie avec cette graine.
      const seed = new URLSearchParams(location.search).get("seed");
      if (import.meta.env.DEV && seed !== null) void app.startGame(Number(seed), { record: false });
    } catch (e) {
      const message = e instanceof MissingFileError ? copy.missingFiles : `${copy.loadError} ${e instanceof Error ? e.message : e}`;
      container.replaceChildren(
        h("div", { class: "boot error", role: "alert" }, h("p", {}, message), h("a", { class: "back-link", href: "#/" }, shared.backToGames)),
      );
      console.error(e);
    }
  },
};
