import { h } from "../../ui/dom";
import { copy } from "./copy";

/**
 * Page d'aide : contrôles, but, barre d'outils (un point par bouton), crédits (mention de copyright du jeu, attribution d'OpenTIM, GPL-3.0).
 * Ouverte depuis l'écran titre (`backLabel` : retour à l'écran titre) ou pendant le jeu (retour au jeu). Échap revient.
 */
export function renderHelp(onBack: () => void, backLabel: string = copy.helpBack): HTMLElement {
  const back = h("button", { type: "button", class: "secondary tim3-help-back" }, backLabel);
  back.addEventListener("click", onBack);
  const page = h(
    "section",
    { class: "tim3-help", "aria-labelledby": "tim3-help-title" },
    back,
    h("h1", { id: "tim3-help-title" }, copy.helpTitle),
    h("h2", {}, copy.helpGoalTitle),
    h("p", {}, copy.helpGoal),
    h("h2", {}, copy.controlsTitle),
    h("ul", { class: "help-list" }, ...copy.controls.map((t) => h("li", {}, t))),
    h("h2", {}, copy.toolbarTitle),
    h("ul", { class: "help-list" }, ...copy.toolbarHelp.map((t) => h("li", {}, t))),
    h("h2", {}, copy.helpCreditsTitle),
    h("p", {}, copy.copyright),
    h("p", {}, copy.abandonware),
    h("p", {}, copy.openTim, " ", h("a", { href: copy.openTimLink, rel: "noopener", target: "_blank" }, "OpenTIM")),
  );
  page.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onBack();
    }
  });
  queueMicrotask(() => back.focus());
  return page;
}
