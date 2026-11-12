import { type SlotSummary } from "../engine/save-slots";
import { h } from "./dom";

/**
 * Fenêtres des jeux de pointer-et-cliquer sur canvas (emplacements de sauvegarde, menu, volume, retour à l'écran titre), communes à
 * Drascula et à Flight of the Amazon Queen (règle des deux usages : `docs/fotaq/plan.md`, M8). Les textes viennent du jeu
 * (`DialogCopy`), les styles de `point-click.css` (préfixe `pc-`). Chaque fenêtre prend le focus en s'ouvrant (le premier bouton
 * utile) et se ferme avec Échap ; le jeu la pose dans `dialogOverlay`, qui la ferme aussi d'un clic sur le fond.
 */

/** Textes des fenêtres : le `copy` de chaque jeu en est une extension. */
export interface DialogCopy {
  menu: string;
  save: string;
  saveTitle: string;
  load: string;
  loadTitle: string;
  volume: string;
  volumeTitle: string;
  subtitles: string;
  subtitlesTitle: string;
  pause: string;
  pauseLabel: string;
  resume: string;
  helpLink: string;
  titleScreen: string;
  titleScreenTitle: string;
  leaveTitle: string;
  leaveText: string;
  close: string;
  cancel: string;
  overwrite: string;
  saveDialogTitle: string;
  loadDialogTitle: string;
  slotsLabel: string;
  saveSlot(slot: number): string;
  saveEmpty: string;
  saveOverwrite(slot: number): string;
  volumeDialogTitle: string;
  volumeLabel: string;
}

/** Échap ferme la fenêtre (et n'atteint pas le jeu). */
function closeOnEscape(dialog: HTMLElement, close: () => void): void {
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
}

/** Voile qui porte une fenêtre par-dessus toute la page ; un clic sur le fond (hors de la fenêtre) la ferme, comme Échap. */
export function dialogOverlay(dialog: HTMLElement, close: () => void): HTMLElement {
  const backdrop = h("div", { class: "pc-overlay" }, dialog);
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) close();
  });
  return backdrop;
}

// --- Emplacements de sauvegarde --------------------------------------------------------------------------------------------

/** Ce que fait le choix d'un emplacement : `ok` ferme la fenêtre, sinon `message` s'affiche dedans. */
export interface ChooseResult {
  ok: boolean;
  message: string;
}

export interface SlotDialogOptions {
  copy: DialogCopy;
  mode: "save" | "load";
  /** Les emplacements, dans l'ordre (`SaveSlots.summaries`), relus à chaque affichage. */
  summaries(): SlotSummary[];
  /** Sauvegarde ou charge l'emplacement `slot` (la confirmation avant d'écraser est déjà passée). */
  choose(slot: number): ChooseResult | Promise<ChooseResult>;
  /** Fermeture demandée (bouton, Échap). */
  close(): void;
  /** Message à montrer en ouvrant la fenêtre. */
  notice?: string;
}

/** Libellé lu d'un emplacement : son numéro puis son contenu (vide ou description). */
export function slotLabel(copy: DialogCopy, summary: SlotSummary): string {
  return summary.empty ? `${copy.saveSlot(summary.slot)} : ${copy.saveEmpty.toLowerCase()}` : `${copy.saveSlot(summary.slot)} : ${summary.description}`;
}

/** Un emplacement peut-il être choisi ? Charger un emplacement vide n'a pas de sens ; sauvegarder dans n'importe lequel, oui. */
export function slotSelectable(mode: "save" | "load", summary: SlotSummary): boolean {
  return mode === "save" || !summary.empty;
}

/**
 * Fenêtre des emplacements de sauvegarde : sauvegarder (confirmation avant d'écraser un emplacement plein, avec sa description)
 * ou charger (les emplacements vides sont grisés). Le premier emplacement choisissable prend le focus (sans emplacement rempli en
 * chargement, la fenêtre) ; Échap ferme.
 */
export function renderSlotDialog(options: SlotDialogOptions): HTMLElement {
  const { copy, mode } = options;
  const titleId = `pc-dialog-${mode}-title`;
  const status = h("p", { class: "pc-dialog-status", role: "status" }, options.notice ?? "");
  const list = h("ul", { class: "pc-slots", "aria-label": copy.slotsLabel });
  const closeButton = h("button", { type: "button", class: "secondary", onclick: () => options.close() }, copy.close);
  const dialog = h(
    "section",
    { class: "pc-dialog", tabindex: "-1", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, mode === "save" ? copy.saveDialogTitle : copy.loadDialogTitle),
    list,
    status,
    closeButton,
  );
  let busy = false;

  const run = async (slot: number): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const result = await options.choose(slot);
      if (result.ok) options.close();
      else {
        status.textContent = result.message;
        render(slot);
      }
    } finally {
      busy = false;
    }
  };

  /** Ligne de confirmation à la place de l'emplacement (en attente d'une réponse). */
  const confirmRow = (summary: SlotSummary): HTMLElement => {
    const question = copy.saveOverwrite(summary.slot);
    const yes = h("button", { type: "button", class: "primary", onclick: () => void run(summary.slot) }, copy.overwrite);
    const no = h("button", { type: "button", class: "secondary", onclick: () => render(summary.slot) }, copy.cancel);
    queueMicrotask(() => yes.focus());
    return h(
      "li",
      { class: "pc-slot-confirm", role: "group", "aria-label": `${question} ${slotLabel(copy, summary)}` },
      h("span", { class: "pc-slot-question" }, question),
      h("span", { class: "pc-slot-current" }, summary.description),
      h("span", { class: "pc-slot-actions" }, yes, no),
    );
  };

  /** Remplit la liste ; `focusSlot` : emplacement à refocaliser, `confirming` : emplacement dont on demande confirmation. */
  function render(focusSlot?: number, confirming?: number): void {
    const rows = options.summaries().map((summary) => {
      if (summary.slot === confirming) return confirmRow(summary);
      const button = h(
        "button",
        {
          type: "button",
          class: `pc-slot${summary.empty ? " is-empty" : ""}`,
          "aria-label": slotLabel(copy, summary),
          disabled: !slotSelectable(mode, summary),
          "data-slot": summary.slot,
          onclick: () => {
            if (mode === "save" && !summary.empty) render(undefined, summary.slot);
            else void run(summary.slot);
          },
        },
        h("span", { class: "pc-slot-number" }, String(summary.slot)),
        h("span", { class: "pc-slot-text" }, summary.empty ? copy.saveEmpty : summary.description),
      );
      return h("li", {}, button);
    });
    list.replaceChildren(...rows);
    const target =
      focusSlot !== undefined
        ? list.querySelector<HTMLElement>(`[data-slot="${focusSlot}"]`)
        : confirming === undefined
          ? list.querySelector<HTMLElement>("button:not(:disabled)")
          : null;
    // Au premier affichage la fenêtre n'est pas encore dans la page : le focus attend la fin de la tâche en cours.
    if (target) queueMicrotask(() => target.focus({ preventScroll: true }));
  }

  closeOnEscape(dialog, options.close);
  render();
  if (!list.querySelector("button:not(:disabled)")) queueMicrotask(() => dialog.focus({ preventScroll: true }));
  return dialog;
}

// --- Menu et retour à l'écran titre ----------------------------------------------------------------------------------------

export interface MenuActions {
  save(): void;
  load(): void;
  volume(): void;
  /** Absent pour un jeu sans sous-titres à régler : l'entrée n'est pas proposée. */
  toggleSubtitles?(): void;
  togglePause(): void;
  help(): void;
  titleScreen(): void;
  close(): void;
}

/** Confirmation avant de revenir à l'écran titre : la partie non sauvegardée est perdue. Échap annule. */
export function renderLeaveDialog(copy: DialogCopy, confirm: () => void, cancel: () => void): HTMLElement {
  const titleId = "pc-dialog-leave-title";
  const yes = h("button", { type: "button", class: "primary", onclick: confirm }, copy.titleScreen);
  const no = h("button", { type: "button", class: "secondary", onclick: cancel }, copy.cancel);
  const dialog = h(
    "section",
    { class: "pc-dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, copy.leaveTitle),
    h("p", {}, copy.leaveText),
    h("div", { class: "pc-slot-actions" }, yes, no),
  );
  closeOnEscape(dialog, cancel);
  queueMicrotask(() => no.focus());
  return dialog;
}

/** Question à deux réponses posée par le jeu lui-même (fin de partie : recommencer ou restituer). Échap équivaut à `cancel`. */
export interface ChoiceDialogOptions {
  title: string;
  text: string;
  /** Réponse proposée en premier (bouton principal). */
  primary: string;
  secondary: string;
  choose(answer: "primary" | "secondary"): void;
  cancel(): void;
}

export function renderChoiceDialog(options: ChoiceDialogOptions): HTMLElement {
  const titleId = "pc-dialog-choice-title";
  const primary = h("button", { type: "button", class: "primary", onclick: () => options.choose("primary") }, options.primary);
  const secondary = h("button", { type: "button", class: "secondary", onclick: () => options.choose("secondary") }, options.secondary);
  const dialog = h(
    "section",
    { class: "pc-dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, options.title),
    h("p", {}, options.text),
    h("div", { class: "pc-slot-actions" }, primary, secondary),
  );
  closeOnEscape(dialog, options.cancel);
  queueMicrotask(() => primary.focus());
  return dialog;
}

/**
 * Menu du jeu (bouton « Menu » du pied de page et de la barre tactile) : les commandes de l'hôte réunies, utilisables au doigt comme
 * à la souris (les raccourcis clavier font la même chose). `subtitles` : état des sous-titres (sans objet si `toggleSubtitles` manque).
 */
export function renderMenuDialog(copy: DialogCopy, actions: MenuActions, subtitles: boolean, paused: boolean): HTMLElement {
  const titleId = "pc-dialog-menu-title";
  const item = (label: string, title: string, run: () => void, props: Record<string, string | boolean> = {}): HTMLElement =>
    h("li", {}, h("button", { type: "button", title, onclick: run, ...props }, label));
  const toggleSubtitles = actions.toggleSubtitles;
  const dialog = h(
    "section",
    { class: "pc-dialog pc-dialog-menu", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, copy.menu),
    h(
      "ul",
      { class: "pc-menu-list" },
      item(copy.save, copy.saveTitle, actions.save),
      item(copy.load, copy.loadTitle, actions.load),
      item(copy.volume, copy.volumeTitle, actions.volume),
      toggleSubtitles ? item(copy.subtitles, copy.subtitlesTitle, toggleSubtitles, { class: "toggle", "aria-pressed": String(subtitles) }) : null,
      item(paused ? copy.resume : copy.pause, copy.pauseLabel, actions.togglePause),
      item(copy.helpLink, copy.helpLink, actions.help),
      item(copy.titleScreen, copy.titleScreenTitle, actions.titleScreen),
    ),
    h("button", { type: "button", class: "secondary", onclick: actions.close }, copy.close),
  );
  closeOnEscape(dialog, actions.close);
  queueMicrotask(() => dialog.querySelector<HTMLElement>("button")?.focus());
  return dialog;
}

// --- Volume ----------------------------------------------------------------------------------------------------------------

/** Clé de la préférence de volume de la musique (0 à 100) d'un jeu, dans le stockage du navigateur. */
export function volumeKey(game: string): string {
  return `retrovibe:${game}:music-volume`;
}

/** Volume enregistré (0 à 1) d'une préférence de 0 à 100 ; 1 si rien de lisible. */
export function parseVolume(stored: string | null): number {
  if (stored === null) return 1;
  const percent = Number(stored);
  return Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) / 100 : 1;
}

/** Fenêtre du volume de la musique : un curseur de 0 à 100 appliqué en direct, Échap ou « Fermer » pour revenir au jeu. */
export function renderVolumeDialog(copy: DialogCopy, volume: number, change: (level: number) => void, close: () => void): HTMLElement {
  const titleId = "pc-dialog-volume-title";
  const output = h("output", { class: "pc-volume-value", for: "pc-volume" }, `${Math.round(volume * 100)} %`);
  const range = h("input", {
    id: "pc-volume",
    type: "range",
    min: 0,
    max: 100,
    step: 5,
    value: Math.round(volume * 100),
    "aria-label": copy.volumeLabel,
  });
  range.addEventListener("input", () => {
    output.textContent = `${range.value} %`;
    change(Number(range.value) / 100);
  });
  const dialog = h(
    "section",
    { class: "pc-dialog pc-dialog-volume", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, copy.volumeDialogTitle),
    h("div", { class: "pc-volume-row" }, range, output),
    h("button", { type: "button", class: "secondary", onclick: close }, copy.close),
  );
  closeOnEscape(dialog, close);
  queueMicrotask(() => range.focus());
  return dialog;
}
