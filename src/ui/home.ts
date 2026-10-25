import type { GameDefinition } from "../games/types";
import { copy } from "./copy";
import { h } from "./dom";
import { currentDisplayState, shouldSuggestInstall } from "./standalone";

export function renderHome(container: HTMLElement, games: readonly GameDefinition[]): void {
  container.replaceChildren(
    h(
      "main",
      { class: "home" },
      h("h1", {}, copy.homeTitle),
      h(
        "ul",
        { class: "game-list" },
        ...games.map((game) =>
          h(
            "li",
            {},
            h(
              "a",
              { class: "game-card", href: `#/${game.id}` },
              game.cover
                ? h("img", {
                    class: game.coverPixelated ? "game-card-cover pixelated" : "game-card-cover",
                    src: game.cover,
                    alt: game.coverAlt ?? "",
                    width: game.coverSize?.[0],
                    height: game.coverSize?.[1],
                    loading: "lazy",
                    decoding: "async",
                  })
                : null,
              h("span", { class: "game-card-title" }, game.title),
              h("span", { class: "game-card-desc" }, game.description),
              h("span", { class: "game-card-cta", "aria-hidden": "true" }, copy.play),
            ),
          ),
        ),
      ),
      shouldSuggestInstall(navigator.userAgent, currentDisplayState()) ? h("p", { class: "home-hint" }, copy.installHintIPhone) : null,
    ),
  );
  container.querySelector<HTMLElement>(".game-card")?.focus();
}
