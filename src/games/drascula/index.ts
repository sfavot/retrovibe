import { copy as shared } from "../../ui/copy";
import type { GameDefinition } from "../types";
import { copy } from "./copy";
import "./ui/style.css";
import { COVER_SIZE, COVER_URL, GAME_URL, renderTitle } from "./ui/title";

export const drascula: GameDefinition = {
  id: "drascula",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverPixelated: true,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur un des boutons (ce geste débloque aussi le son). Le moteur, le son et leurs
    // fichiers ne sont chargés qu'à ce moment-là : la page d'accueil reste légère.
    const showTitle = (): void => {
      container.replaceChildren(
        renderTitle({
          start(restore, failure, buttons) {
            for (const button of buttons) button.disabled = true;
            void import("./ui/app")
              .then(({ mountApp }) => mountApp(container, { base: GAME_URL, backLabel: shared.backToGames, restore: restore?.save, toTitle: showTitle }))
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
