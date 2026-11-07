import { copy as shared } from "../../ui/copy";
import { h } from "../../ui/dom";
import { titleScreen } from "../../ui/title-screen";
import type { GameDefinition } from "../types";
import { copy } from "./copy";
import "./ui/style.css";

/** Dossier des fichiers du jeu (servi depuis `original/zoombinis/`). */
const GAME_URL = `${import.meta.env.BASE_URL}zoombinis`;
/** Jaquette : décor de l'île du choix, générée par `scripts/zoombinis/cover.mts`. */
const COVER_URL = `${GAME_URL}/COVER.png`;
const COVER_SIZE: [number, number] = [640, 480];
/** Manuel (page web), servi depuis `original/zoombinis/`. */
const MANUAL_URL = `${GAME_URL}/MANUEL.html`;

export const zoombinis: GameDefinition = {
  id: "zoombinis",
  title: copy.title,
  description: copy.description,
  cover: COVER_URL,
  coverSize: COVER_SIZE,
  coverAlt: copy.coverAlt,
  async start(container) {
    // Écran de présentation, puis le jeu au clic sur « Jouer » (ce geste débloque aussi le son). Le moteur, le synthétiseur MIDI
    // et leurs dépendances ne sont chargés qu'à ce moment-là : la page d'accueil reste légère.
    const failure = h("p", { class: "zb-error", role: "alert" });
    const play = h("button", { class: "primary", type: "button" }, copy.play);
    play.addEventListener("click", () => {
      play.disabled = true;
      void import("./ui/app")
        .then(({ mountApp }) =>
          mountApp(container, {
            base: GAME_URL,
            backLabel: shared.backToGames,
          }),
        )
        .catch((error: unknown) => {
          console.error(error);
          play.disabled = false;
          failure.textContent = `${copy.loadError} ${error instanceof Error ? error.message : String(error)}`;
        });
    });
    queueMicrotask(() => play.focus());
    const picture = h("img", {
      class: "zb-title-picture",
      src: COVER_URL,
      alt: copy.coverAlt,
      width: COVER_SIZE[0],
      height: COVER_SIZE[1],
    });
    container.replaceChildren(
      titleScreen(
        picture,
        h("h1", {}, copy.title),
        play,
        failure,
        h(
          "a",
          {
            class: "button secondary",
            href: MANUAL_URL,
            target: "_blank",
            rel: "noopener",
          },
          copy.manual,
        ),
        h("p", { class: "muted" }, copy.manualNote),
        h("h2", { class: "zb-title-controls" }, copy.controlsTitle),
        h(
          "ul",
          { class: "help-list" },
          ...copy.controls.map((text) => h("li", {}, text)),
        ),
      ),
    );
  },
};
