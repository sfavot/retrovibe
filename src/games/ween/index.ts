import { startCoktelGame } from "../../ui/coktel/start";
import type { GameDefinition } from "../types";
import { copy } from "./copy";
import { COVER_SIZE, COVER_URL, GAME_URL, renderTitle } from "./ui/title";

export const ween: GameDefinition = {
  id: "ween",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverPixelated: true,
  coverAlt: copy.coverAlt,
  start(container) {
    // Tout le jeu est dans INTRO.STK (6,7 Mo), lu avant l'écran titre ; le jeu (INTRO.TOT) part à « Jouer ».
    return startCoktelGame(container, {
      gameUrl: GAME_URL,
      preload: ["INTRO.STK"],
      copy,
      title: (play) => renderTitle(container, play),
      loadApp: () => import("./ui/app"),
    });
  },
};
