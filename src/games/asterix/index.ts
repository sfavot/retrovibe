import { copy as shared } from "../../ui/copy";
import type { GameDefinition } from "../types";
import { copy, mountApp } from "./ui/app";
import { COVER_SIZE, COVER_URL, GAME_URL, hasSavedGame, renderTitle } from "./ui/title";

/**
 * Astérix : le défi de César. Le jeu est prêt à être publié mais n'est pas inscrit dans `src/games/registry.ts`
 * (`docs/asterix/plan.md`, vague F) : d'ici là il se lance par la page de dev `ui/dev.html`.
 */
export const asterix: GameDefinition = {
  id: "asterix",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur « Jouer » ou « Continuer » (ce geste débloque aussi le son).
    const launch = (resume: boolean): void => {
      void mountApp(container, { base: GAME_URL, backLabel: shared.backToGames, resume });
    };
    const showTitle = (): void => {
      container.replaceChildren(
        renderTitle({
          onStart: () => launch(false),
          // Partie interrompue : « Continuer » passe devant « Jouer » (qui repart du début et remplace la sauvegarde).
          onResume: hasSavedGame() ? () => launch(true) : undefined,
          onHelp() {
            void import("./ui/help").then(({ renderHelp }) => container.replaceChildren(renderHelp(GAME_URL, showTitle)));
          },
        }),
      );
    };
    showTitle();
  },
};
