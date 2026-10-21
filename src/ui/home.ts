import type { GameDefinition } from "../games/types";
import { copy } from "./copy";
import { h } from "./dom";

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
              h("span", { class: "game-card-title" }, game.title),
              h("span", { class: "game-card-desc" }, game.description),
              h("span", { class: "game-card-cta", "aria-hidden": "true" }, copy.play),
            ),
          ),
        ),
      ),
    ),
  );
  container.querySelector<HTMLElement>(".game-card")?.focus();
}
