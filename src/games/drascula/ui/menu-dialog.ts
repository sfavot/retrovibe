import { h } from "../../../ui/dom";
import { copy } from "../copy";

export interface MenuActions {
  save(): void;
  load(): void;
  volume(): void;
  toggleSubtitles(): void;
  togglePause(): void;
  help(): void;
  titleScreen(): void;
  close(): void;
}

/** Confirmation avant de revenir à l'écran titre : la partie non sauvegardée est perdue. Échap annule. */
export function renderLeaveDialog(confirm: () => void, cancel: () => void): HTMLElement {
  const titleId = "dra-dialog-leave-title";
  const yes = h("button", { type: "button", class: "primary", onclick: confirm }, copy.titleScreen);
  const no = h("button", { type: "button", class: "secondary", onclick: cancel }, copy.cancel);
  const dialog = h(
    "section",
    { class: "dra-dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, copy.leaveTitle),
    h("p", {}, copy.leaveText),
    h("div", { class: "dra-slot-actions" }, yes, no),
  );
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  });
  queueMicrotask(() => no.focus());
  return dialog;
}

/**
 * Menu du jeu (bouton « Menu » du pied de page) : les commandes de l'hôte réunies, utilisables au doigt comme à la souris
 * (les raccourcis F7, F9, F10, T et Espace font la même chose au clavier). `subtitles` : état des sous-titres.
 */
export function renderMenuDialog(actions: MenuActions, subtitles: boolean, paused: boolean): HTMLElement {
  const titleId = "dra-dialog-menu-title";
  const item = (label: string, title: string, run: () => void, props: Record<string, string | boolean> = {}): HTMLElement =>
    h("li", {}, h("button", { type: "button", title, onclick: run, ...props }, label));
  const dialog = h(
    "section",
    { class: "dra-dialog dra-dialog-menu", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, copy.menu),
    h(
      "ul",
      { class: "dra-menu-list" },
      item(copy.save, copy.saveTitle, actions.save),
      item(copy.load, copy.loadTitle, actions.load),
      item(copy.volume, copy.volumeTitle, actions.volume),
      item(copy.subtitles, copy.subtitlesTitle, actions.toggleSubtitles, { class: "toggle", "aria-pressed": String(subtitles) }),
      item(paused ? copy.resume : copy.pause, copy.pauseLabel, actions.togglePause),
      item(copy.helpLink, copy.helpLink, actions.help),
      item(copy.titleScreen, copy.titleScreenTitle, actions.titleScreen),
    ),
    h("button", { type: "button", class: "secondary", onclick: actions.close }, copy.close),
  );
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      actions.close();
    }
  });
  queueMicrotask(() => dialog.querySelector<HTMLElement>("button")?.focus());
  return dialog;
}
