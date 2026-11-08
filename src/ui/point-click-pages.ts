import { SaveSlots, type SlotSummary, type StoredSave } from "../engine/save-slots";
import { h } from "./dom";
import { type DialogCopy, renderSlotDialog } from "./point-click-dialogs";
import { titleScreen } from "./title-screen";

/**
 * Écran de présentation et page d'aide des jeux de pointer-et-cliquer sur canvas, communs à Drascula et à Flight of the Amazon Queen
 * (M8). Les textes viennent du jeu, les styles de `point-click.css`.
 */

// --- Écran titre -----------------------------------------------------------------------------------------------------------

export interface TitleCopy extends DialogCopy {
  title: string;
  description: string;
  coverAlt: string;
  newGame: string;
  continueGame: string;
  continueNote(description: string): string;
  loadGame: string;
  help: string;
  controlsTitle: string;
  controls: readonly string[];
  loadEmpty: string;
}

export interface TitleActions<T> {
  /** Démarre le jeu ; `restore` : la sauvegarde à reprendre, sans quoi une nouvelle partie. `failure` : région d'erreur sous les boutons. */
  start(restore: StoredSave<T> | null, failure: HTMLElement, buttons: HTMLButtonElement[]): void;
  help(): void;
}

export interface TitleOptions<T> {
  copy: TitleCopy;
  /** Jaquette : image du jeu (pixel art) et sa taille. */
  cover: { url: string; size: readonly [number, number] };
  slots: SaveSlots<T>;
  /** Texte d'un emplacement plein (le lieu et la date). */
  describe(stored: StoredSave<T>): string;
  summaries(): SlotSummary[];
  actions: TitleActions<T>;
}

/**
 * Écran de présentation, avant le jeu : jaquette, titre, « Continuer » (la sauvegarde la plus récente) et « Nouvelle partie »,
 * « Charger une partie » (la liste des emplacements) quand il y a des sauvegardes, lien vers l'aide et commandes.
 */
export function renderTitle<T>(options: TitleOptions<T>): HTMLElement {
  const { copy, slots, actions } = options;
  const latest = slots.latest();
  const picture = h("img", { class: "pc-title-picture", src: options.cover.url, alt: copy.coverAlt, width: options.cover.size[0], height: options.cover.size[1] });
  const failure = h("p", { class: "pc-error", role: "alert" });
  const newGame = h("button", { class: latest ? "secondary" : "primary", type: "button" }, copy.newGame);
  const buttons: HTMLButtonElement[] = [newGame];
  const root = h("div", { class: "pc-title-root" });
  const begin = (restore: StoredSave<T> | null): void => {
    failure.textContent = "";
    actions.start(restore, failure, buttons);
  };
  newGame.addEventListener("click", () => begin(null));

  const continueButton = latest ? h("button", { class: "primary", type: "button", onclick: () => begin(latest) }, copy.continueGame) : null;
  const loadButton = latest ? h("button", { class: "secondary", type: "button", onclick: () => showSlots() }, copy.loadGame) : null;
  if (continueButton) buttons.push(continueButton);
  if (loadButton) buttons.push(loadButton);

  const menu = titleScreen(
    picture,
    h("h1", {}, copy.title),
    h("p", { class: "muted pc-title-note" }, copy.description),
    continueButton,
    latest ? h("p", { class: "muted pc-title-note" }, copy.continueNote(options.describe(latest))) : null,
    newGame,
    loadButton,
    failure,
    h("button", { class: "secondary", type: "button", onclick: actions.help }, copy.help),
    h("h2", { class: "pc-title-controls" }, copy.controlsTitle),
    h("ul", { class: "help-list" }, ...copy.controls.map((text) => h("li", {}, text))),
  );
  root.append(menu);
  queueMicrotask(() => (continueButton ?? newGame).focus());

  /** « Charger une partie » : la liste des emplacements à la place de l'écran titre. */
  function showSlots(): void {
    const close = (): void => {
      root.replaceChildren(menu);
      loadButton?.focus();
    };
    root.replaceChildren(
      h(
        "div",
        { class: "pc-title-slots" },
        renderSlotDialog({
          copy,
          mode: "load",
          summaries: options.summaries,
          close,
          choose(slot) {
            const stored = slots.read(slot);
            if (!stored) return { ok: false, message: copy.loadEmpty };
            close();
            begin(stored);
            return { ok: false, message: "" };
          },
        }),
      ),
    );
  }
  return root;
}

// --- Page d'aide -----------------------------------------------------------------------------------------------------------

/** Une section de l'aide : des paragraphes, une liste de touches (ou de verbes) et des liens, dans cet ordre. */
export interface HelpSection {
  title: string;
  paragraphs?: readonly string[];
  /** Couples (touche, effet). */
  keys?: readonly (readonly [string, string])[];
  /** Couples (adresse, libellé), ouverts dans un nouvel onglet. */
  links?: readonly (readonly [string, string])[];
}

/**
 * Page d'aide et de crédits. `onBack` : retour à l'écran titre, ou au jeu en cours (`backLabel`). Le focus va au bouton de retour.
 */
export function renderHelpPage(title: string, sections: readonly HelpSection[], onBack: () => void, backLabel: string): HTMLElement {
  const back = h("button", { type: "button", class: "secondary", onclick: onBack }, backLabel);
  const page = h(
    "article",
    { class: "pc-help" },
    h("header", { class: "pc-help-bar" }, h("h1", {}, title), back),
    ...sections.map((section) =>
      h(
        "section",
        { class: "pc-help-section" },
        h("h2", {}, section.title),
        ...(section.paragraphs ?? []).map((text) => h("p", {}, text)),
        section.keys && h("dl", { class: "pc-help-keys" }, ...section.keys.flatMap(([keys, effect]) => [h("dt", {}, h("kbd", {}, keys)), h("dd", {}, effect)])),
        section.links &&
          h(
            "ul",
            { class: "pc-help-links" },
            ...section.links.map(([href, label]) => h("li", {}, h("a", { href, target: "_blank", rel: "noopener" }, label))),
          ),
      ),
    ),
    h("footer", { class: "pc-help-foot" }, h("button", { type: "button", class: "secondary", onclick: onBack }, backLabel)),
  );
  queueMicrotask(() => back.focus({ preventScroll: true }));
  return page;
}
