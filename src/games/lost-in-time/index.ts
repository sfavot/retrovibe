import { copy } from "./copy";
import { startCoktelGame } from "../../ui/coktel/start";
import type { GameDefinition } from "../types";
import { COVER_URL, GAME_URL, renderTitle } from "./ui/title";

export const lostInTime: GameDefinition = {
  id: "lost-in-time",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: [280, 343],
  coverAlt: copy.coverAlt,
  start(container) {
    // L'archive de départ et la liste des plages du CD sont lues avant l'écran titre ; le jeu (INTRO.TOT) part à « Jouer ».
    return startCoktelGame(container, {
      gameUrl: GAME_URL,
      preload: ["INTRO.STK", "LOST.LIC"],
      copy,
      title: renderTitle,
      loadApp: () => import("./ui/app"),
    });
  },
};
