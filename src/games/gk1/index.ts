import { copy as shared } from "../../ui/copy";
import type { GameDefinition } from "../types";
import { copy } from "./copy";
import "../../ui/point-click.css";
import { COVER_SIZE, COVER_URL, GAME_URL, renderTitle } from "./ui/title";

export const gk1: GameDefinition = {
  id: "gk1",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverPixelated: true,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur « Jouer » (ce geste débloque aussi le son). La machine virtuelle, le son et
    // les fichiers du jeu ne sont chargés qu'à ce moment-là : la page d'accueil reste légère.
    const showTitle = (): void => {
      container.replaceChildren(
        renderTitle({
          start(restore, failure, buttons) {
            for (const button of buttons) button.disabled = true;
            void import("./ui/app")
              // `window.__gk1` (machine virtuelle, compositeur, boucle) n'existe que sur le serveur de développement.
              .then(({ mountApp }) => mountApp(container, { base: GAME_URL, backLabel: shared.backToGames, restore: restore?.save, toTitle: showTitle, debug: import.meta.env.DEV }))
              .catch((error: unknown) => {
                console.error(error);
                for (const button of buttons) button.disabled = false;
                failure.textContent = `${copy.loadError} ${error instanceof Error ? error.message : String(error)} ${copy.retryHint}`;
              });
          },
          help() {
            void import("./ui/help").then(({ renderHelp }) => container.replaceChildren(renderHelp(GAME_URL, showTitle)));
          },
        }),
      );
    };
    showTitle();
  },
};
