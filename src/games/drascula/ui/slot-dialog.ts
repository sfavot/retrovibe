import { h } from "../../../ui/dom";
import { copy } from "../copy";
import { type SaveSlots, type SlotSummary } from "./saves";

/** Ce que fait le choix d'un emplacement : `ok` ferme la fenêtre, sinon `message` s'affiche dedans. */
export interface ChooseResult {
  ok: boolean;
  message: string;
}

export interface SlotDialogOptions {
  mode: "save" | "load";
  slots: SaveSlots;
  /** Sauvegarde ou charge l'emplacement `slot` (la confirmation avant d'écraser est déjà passée). */
  choose(slot: number): ChooseResult | Promise<ChooseResult>;
  /** Fermeture demandée (bouton, Échap). */
  close(): void;
  /** Message à montrer en ouvrant la fenêtre (par exemple « impossible de sauvegarder pendant une scène »). */
  notice?: string;
}

/** Libellé lu d'un emplacement : son numéro puis son contenu (vide ou description). */
export function slotLabel(summary: SlotSummary): string {
  return summary.empty ? `${copy.saveSlot(summary.slot)} : ${copy.saveEmpty.toLowerCase()}` : `${copy.saveSlot(summary.slot)} : ${summary.description}`;
}

/** Un emplacement peut-il être choisi ? Charger un emplacement vide n'a pas de sens ; sauvegarder dans n'importe lequel, oui. */
export function slotSelectable(mode: "save" | "load", summary: SlotSummary): boolean {
  return mode === "save" || !summary.empty;
}

/**
 * Fenêtre des dix emplacements de sauvegarde (`SaveSlots.summaries`) : sauvegarder (confirmation avant d'écraser un emplacement plein)
 * ou charger (les emplacements vides sont grisés). Le premier emplacement choisissable prend le focus (sans emplacement rempli en chargement, la fenêtre) ; Échap ferme.
 */
export function renderSlotDialog(options: SlotDialogOptions): HTMLElement {
  const { mode, slots } = options;
  const titleId = `dra-dialog-${mode}-title`;
  const status = h("p", { class: "dra-dialog-status", role: "status" }, options.notice ?? "");
  const list = h("ul", { class: "dra-slots", "aria-label": copy.slotsLabel });
  const closeButton = h("button", { type: "button", class: "secondary", onclick: () => options.close() }, copy.close);
  const dialog = h(
    "section",
    { class: "dra-dialog", tabindex: "-1", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, mode === "save" ? copy.saveDialogTitle : copy.loadDialogTitle),
    list,
    status,
    closeButton,
  );
  let busy = false;

  const say = (message: string): void => {
    status.textContent = message;
  };

  const run = async (slot: number): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const result = await options.choose(slot);
      if (result.ok) options.close();
      else {
        say(result.message);
        render(slot);
      }
    } finally {
      busy = false;
    }
  };

  /** Ligne de confirmation à la place de l'emplacement (`slot` en attente d'une réponse). */
  const confirmRow = (summary: SlotSummary): HTMLElement => {
    const question = copy.saveOverwrite(summary.slot);
    const yes = h("button", { type: "button", class: "primary", onclick: () => void run(summary.slot) }, copy.overwrite);
    const no = h("button", { type: "button", class: "secondary", onclick: () => render(summary.slot) }, copy.cancel);
    queueMicrotask(() => yes.focus());
    return h(
      "li",
      { class: "dra-slot-confirm", role: "group", "aria-label": `${question} ${slotLabel(summary)}` },
      h("span", { class: "dra-slot-question" }, question),
      h("span", { class: "dra-slot-current" }, summary.description),
      h("span", { class: "dra-slot-actions" }, yes, no),
    );
  };

  /** Remplit la liste ; `confirming` : emplacement dont on demande confirmation. */
  function render(focusSlot?: number, confirming?: number): void {
    const rows = slots.summaries().map((summary) => {
      if (summary.slot === confirming) return confirmRow(summary);
      const selectable = slotSelectable(mode, summary);
      const button = h(
        "button",
        {
          type: "button",
          class: `dra-slot${summary.empty ? " is-empty" : ""}`,
          "aria-label": slotLabel(summary),
          disabled: !selectable,
          "data-slot": summary.slot,
          onclick: () => {
            if (mode === "save" && !summary.empty) render(undefined, summary.slot);
            else void run(summary.slot);
          },
        },
        h("span", { class: "dra-slot-number" }, String(summary.slot)),
        h("span", { class: "dra-slot-text" }, summary.empty ? copy.saveEmpty : summary.description),
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

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      options.close();
    }
  });
  render();
  if (!list.querySelector("button:not(:disabled)")) queueMicrotask(() => dialog.focus({ preventScroll: true }));
  return dialog;
}
