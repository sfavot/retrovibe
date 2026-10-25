import { copy as shared } from "../../ui/copy";
import { h } from "../../ui/dom";
import { fetchBytes } from "../../ui/files";
import type { GameDefinition } from "../types";
import { copy } from "./copy";
import "./ui/style.css";
import { COVER_SIZE, COVER_URL, GAME_URL, renderTitle } from "./ui/title";

export const armaeth: GameDefinition = {
  id: "armaeth",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverPixelated: true,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur « Jouer » (ce geste débloque aussi le son). Le moteur, l'émulateur AdLib et
    // leurs données ne sont chargés qu'à ce moment-là : la page d'accueil reste légère.
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
          () => void showHelp(),
        ),
      );
    };
    // Page d'aide séparée, comme l'original (`SOS.EXE`) : ouverte seulement sur demande, car les indices dévoilent des solutions.
    const showHelp = async (): Promise<void> => {
      container.replaceChildren(h("p", { class: "aeth-help-status", role: "status" }, copy.helpLoading));
      try {
        const [{ renderHelp }, { parseHelp }, { parsePlainMessages }, sos, msgutl] = await Promise.all([
          import("./ui/help"),
          import("./data/tables"),
          import("./data/text"),
          fetchBytes(GAME_URL, "A1FSOS.SYS"),
          fetchBytes(GAME_URL, "MSGUTL"),
        ]);
        container.replaceChildren(renderHelp(parseHelp(sos), parsePlainMessages(msgutl), showTitle));
      } catch (error) {
        console.error(error);
        showTitle();
        container.querySelector(".aeth-error")!.textContent = `${copy.helpLoadError} ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    showTitle();
  },
};
