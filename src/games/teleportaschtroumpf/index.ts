import { copy as shared } from "../../ui/copy";
import type { GameDefinition } from "../types";
import { copy, mountApp } from "./ui/app";
import { COVER_SIZE, COVER_URL, hasSavedGame, renderTitle } from "./ui/title";

export const teleportaschtroumpf: GameDefinition = {
  id: "teleportaschtroumpf",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur « Jouer » (ce geste débloque aussi le son).
    const launch = (resume: boolean): void => {
      void mountApp(container, { base: `${import.meta.env.BASE_URL}teleportaschtroumpf`, backLabel: shared.backToGames, resume });
    };
    // Partie interrompue : « Reprendre la partie » passe devant « Jouer » (qui repart du début et remplace la sauvegarde).
    container.replaceChildren(renderTitle(() => launch(false), hasSavedGame() ? () => launch(true) : undefined));
  },
};
