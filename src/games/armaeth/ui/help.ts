import { h } from "../../../ui/dom";
import { copy } from "../copy";
import type { PlainMessages } from "../data/text";
import type { HelpNode } from "../data/tables";
import { type HelpOption, type HelpTarget, hintTexts, open, rootOptions } from "./help-tree";

/** Messages de `MSGUTL` utilisés par `SOS.EXE` (`docs/armaeth/screens.md` E15). */
const MSG_TITLE = 57;
const MSG_HINT = 59;
const MSG_UNAVAILABLE = 60;

/** Un niveau de la navigation : ce qu'on a ouvert, et combien d'indices sont déjà dévoilés s'il s'agit d'un menu d'indices. */
interface Level {
  title: string;
  target: HelpTarget;
  revealed: number;
}

/**
 * Page d'aide : l'arbre de `A1FSOS.SYS` comme menu navigable (chapitres, éléments, questions), les indices dévoilés un par un,
 * comme `SOS.EXE`. Tous les textes viennent des données (`nodes`, `MSGUTL` 57 à 61), sauf l'habillage de `copy`.
 * Échap remonte d'un niveau, puis revient d'où l'on vient (écran titre, ou jeu en cours : `backLabel`).
 */
export function renderHelp(nodes: readonly HelpNode[], messages: PlainMessages, onBack: () => void, backLabel: string = copy.helpBack): HTMLElement {
  const text = (id: number): string => messages.messages.get(id) ?? "";
  const hintLabel = text(MSG_HINT);
  const root: Level = { title: copy.helpTitle, target: { type: "menu", options: rootOptions(nodes) }, revealed: 0 };
  const trail: Level[] = [root];

  const body = h("div", { class: "aeth-help-body" });
  const page = h("section", { class: "aeth-help" });

  const optionLabel = (option: HelpOption, index: number): string => option.title || `${hintLabel} ${index + 1}`;
  const goTo = (depth: number): void => {
    trail.length = depth + 1;
    render();
  };
  const up = (): void => (trail.length > 1 ? goTo(trail.length - 2) : onBack());

  function render(): void {
    const level = trail[trail.length - 1];
    const crumbs = h(
      "nav",
      { class: "aeth-help-trail", "aria-label": copy.helpPath },
      h(
        "ol",
        {},
        ...trail.map((entry, depth) =>
          h(
            "li",
            {},
            depth === trail.length - 1
              ? h("span", { "aria-current": "page" }, entry.title)
              : h("button", { type: "button", class: "link", onclick: () => goTo(depth) }, entry.title),
          ),
        ),
      ),
    );
    body.replaceChildren(crumbs, levelView(level));
    const first = body.querySelector<HTMLElement>(".aeth-help-options button, .aeth-help-hint-next, .aeth-help-up");
    first?.focus({ preventScroll: true });
  }

  function levelView(level: Level): HTMLElement {
    const back = trail.length > 1 ? h("button", { type: "button", class: "secondary aeth-help-up", onclick: up }, copy.helpUp) : null;
    const { target } = level;
    if (target.type === "page") {
      return h("div", {}, h("p", { class: "aeth-help-text" }, target.text || text(MSG_UNAVAILABLE)), back);
    }
    const hints = hintTexts(nodes, target.options);
    if (hints) return hintsView(level, hints, back);
    return h(
      "div",
      {},
      h(
        "ul",
        { class: "aeth-help-options" },
        ...target.options.map((option, index) =>
          h(
            "li",
            {},
            h(
              "button",
              {
                type: "button",
                onclick: () => {
                  trail.push({ title: optionLabel(option, index), target: open(nodes, option.node), revealed: 0 });
                  render();
                },
              },
              optionLabel(option, index),
            ),
          ),
        ),
      ),
      back,
    );
  }

  /** Menu d'indices : on dévoile le suivant à la demande, le précédent reste affiché. */
  function hintsView(level: Level, hints: string[], back: HTMLElement | null): HTMLElement {
    const next = level.revealed < hints.length ? level.revealed : -1;
    return h(
      "div",
      {},
      ...hints.slice(0, level.revealed).map((hint, index) => h("div", { class: "aeth-help-hint" }, h("h3", {}, `${hintLabel} ${index + 1}`), h("p", { class: "aeth-help-text" }, hint))),
      next >= 0
        ? h(
            "button",
            {
              type: "button",
              class: "primary aeth-help-hint-next",
              onclick: () => {
                level.revealed++;
                render();
              },
            },
            `${hintLabel} ${next + 1}`,
          )
        : null,
      back,
    );
  }

  page.append(
    h(
      "header",
      { class: "aeth-help-bar" },
      h("button", { type: "button", class: "secondary", onclick: onBack }, backLabel),
      h("h1", {}, copy.helpTitle),
      h("p", { class: "muted" }, nodes[0]?.text ?? text(MSG_TITLE)),
      h("p", { class: "muted" }, copy.helpSpoiler),
    ),
    body,
  );
  page.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    up();
  });
  render();
  return page;
}
