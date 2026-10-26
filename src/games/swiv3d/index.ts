import { copy as shared } from "../../ui/copy";
import { fetchBytes } from "../../ui/files";
import type { GameDefinition } from "../types";
import { copy } from "./copy";
import "./ui/style.css";
import { COVER_SIZE, COVER_URL, GAME_URL, MANUAL_FILE, renderTitle } from "./ui/title";

export const swiv3d: GameDefinition = {
  id: "swiv3d",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverPixelated: true,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur « Jouer » (ce geste débloque aussi le son). Le moteur, le rendu et leurs
    // données ne sont chargés qu'à ce moment-là : la page d'accueil reste légère.
    const showTitle = (): void => {
      container.replaceChildren(
        renderTitle(
          (play, failure) => {
            play.disabled = true;
            failure.textContent = "";
            void import("./ui/app")
              .then(({ mountApp }) => mountApp(container, { base: GAME_URL, backLabel: shared.backToGames, autoStart: true }))
              .catch((error: unknown) => {
                console.error(error);
                play.disabled = false;
                failure.textContent = `${copy.loadError} ${error instanceof Error ? error.message : String(error)}`;
              });
          },
          (failure) => void showManual(failure),
        ),
      );
    };
    // Manuel d'origine : lu seulement sur demande.
    const showManual = async (failure: HTMLElement): Promise<void> => {
      failure.textContent = copy.manualLoading;
      try {
        const [{ decodeManual, parseManual, renderManual }, bytes] = await Promise.all([import("./ui/manual"), fetchBytes(GAME_URL, MANUAL_FILE)]);
        container.replaceChildren(renderManual(parseManual(decodeManual(bytes)), showTitle));
        window.scrollTo(0, 0);
      } catch (error) {
        console.error(error);
        failure.textContent = `${copy.manualLoadError} ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    showTitle();
  },
};
