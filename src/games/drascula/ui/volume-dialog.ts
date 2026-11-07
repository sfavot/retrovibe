import { h } from "../../../ui/dom";
import { copy } from "../copy";

/** Clé de la préférence de volume de la musique (0 à 100), dans le stockage du navigateur. */
export const VOLUME_KEY = "retrovibe:drascula:music-volume";

/** Volume enregistré (0 à 1) ; 1 si rien de lisible. */
export function parseVolume(stored: string | null): number {
  if (stored === null) return 1;
  const percent = Number(stored);
  return Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) / 100 : 1;
}

/** Fenêtre du volume de la musique (touche F9) : un curseur de 0 à 100 appliqué en direct, Échap ou « Fermer » pour revenir au jeu. */
export function renderVolumeDialog(volume: number, change: (level: number) => void, close: () => void): HTMLElement {
  const titleId = "dra-dialog-volume-title";
  const output = h("output", { class: "dra-volume-value", for: "dra-volume" }, `${Math.round(volume * 100)} %`);
  const range = h("input", {
    id: "dra-volume",
    type: "range",
    min: 0,
    max: 100,
    step: 5,
    value: Math.round(volume * 100),
    "aria-label": copy.volumeLabel,
  });
  range.addEventListener("input", () => {
    const level = Number(range.value) / 100;
    output.textContent = `${range.value} %`;
    change(level);
  });
  const dialog = h(
    "section",
    { class: "dra-dialog dra-dialog-volume", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("h2", { id: titleId }, copy.volumeDialogTitle),
    h("div", { class: "dra-volume-row" }, range, output),
    h("button", { type: "button", class: "secondary", onclick: close }, copy.close),
  );
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  queueMicrotask(() => range.focus());
  return dialog;
}
