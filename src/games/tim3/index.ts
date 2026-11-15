import { copy as shared } from "../../ui/copy";
import type { GameDefinition } from "../types";
import { copy } from "./copy";
import { renderHelp } from "./help";
import { COVER_SIZE, COVER_URL, GAME_URL, renderTitle } from "./title";
import "./ui/style.css";

/** The Incredible Machine 3 (enregistrement dans `registry.ts` : vague J). */
export const tim3: GameDefinition = {
  id: "tim3",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur « Jouer » (ce geste débloque aussi le son) : moteur et données ne sont
    // chargés qu'à ce moment-là.
    const showTitle = (): void => {
      container.replaceChildren(
        renderTitle(
          (play, failure) => {
            play.disabled = true;
            failure.textContent = "";
            void import("./ui/app")
              .then(({ mountApp }) => mountApp(container, { base: GAME_URL, backLabel: shared.backToGames }))
              .catch((error: unknown) => {
                console.error(error);
                play.disabled = false;
                failure.textContent = `${copy.loadError} ${error instanceof Error ? error.message : String(error)}`;
              });
          },
          () => container.replaceChildren(renderHelp(showTitle)),
        ),
      );
    };
    showTitle();
  },
};
