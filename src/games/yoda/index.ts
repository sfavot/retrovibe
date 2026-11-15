import { parseDaw } from "../../engine/desktop-adventures/data/daw";
import { extractPalette } from "../../engine/desktop-adventures/data/palette";
import { readPeBitmaps, readPeCursors, readPeIcons, readPeStrings } from "../../engine/desktop-adventures/data/pe-resources";
import { App } from "../../ui/desktop-adventures/app";
import { copy as shared } from "../../ui/copy";
import { h } from "../../ui/dom";
import { copy } from "./copy";
import { yodaAdventure } from "./definition";
import type { GameDefinition } from "../types";

/** Dossier des fichiers du jeu (servi depuis `original/yoda/`). */
const GAME_URL = `${import.meta.env.BASE_URL}yoda/`;

class MissingFileError extends Error {}

async function fetchBinary(name: string): Promise<ArrayBuffer> {
  const response = await fetch(`${GAME_URL}${name}`);
  if (!response.ok) throw new MissingFileError(name);
  // Le serveur de dev renvoie index.html pour un fichier absent.
  if ((response.headers.get("content-type") ?? "").includes("text/html")) throw new MissingFileError(name);
  return response.arrayBuffer();
}

export const yoda: GameDefinition = {
  id: "yoda",
  title: copy.title,
  description: copy.description,
  /** Jaquette : la boîte d'origine (Wikipédia anglophone, image de l'infobox). */
  cover: `${GAME_URL}COVER.webp`,
  coverSize: [252, 352],
  coverAlt: copy.coverAlt,
  async start(container) {
    container.replaceChildren(h("p", { class: "boot", role: "status" }, copy.loading));
    try {
      const [dta, exe] = await Promise.all([fetchBinary("YODESK.DTA"), fetchBinary("YODESK.EXE")]);
      const data = parseDaw(dta, "yoda");
      const app = new App(container, yodaAdventure(data.sounds, GAME_URL, readPeStrings(exe)), {
        data,
        palette: extractPalette(exe, "yoda"),
        loadManual: () => fetchBinary("YODESK.HLP"),
        loadManualContents: () => fetchBinary("YODESK.CNT"),
        cursors: readPeCursors(exe),
        icons: readPeIcons(exe),
        bitmaps: readPeBitmaps(exe),
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
