import { copy as shared } from "../../ui/copy";
import type { GameDefinition } from "../types";
import { copy, mountApp } from "./ui/app";
import { hasSavedGame, renderTitle } from "./ui/title";

/**
 * Astérix : le défi de César. Le jeu n'est pas encore inscrit dans `src/games/registry.ts` (publication : vague F, avec
 * la jaquette) ; d'ici là il se lance par la page de dev `ui/dev.html`.
 */
export const asterix: GameDefinition = {
  id: "asterix",
  title: copy.title,
  description: copy.description,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur « Jouer » (ce geste débloque aussi le son).
    const launch = (resume: boolean): void => {
      void mountApp(container, { base: `${import.meta.env.BASE_URL}asterix`, backLabel: shared.backToGames, resume });
    };
    // Partie interrompue : « Continuer » passe devant « Jouer » (qui repart du début et remplace la sauvegarde).
    container.replaceChildren(renderTitle(() => launch(false), hasSavedGame() ? () => launch(true) : undefined));
  },
};
