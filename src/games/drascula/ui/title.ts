import { localStorageStore } from "../../../ui/local-storage";
import { prefixedStorage } from "../../../engine/storage";
import { h } from "../../../ui/dom";
import { titleScreen } from "../../../ui/title-screen";
import { copy } from "../copy";
import { SAVE_PREFIX, SaveSlots, type StoredSave, describeSave } from "./saves";
import { renderSlotDialog } from "./slot-dialog";

/** Dossier des fichiers du jeu (servi depuis `original/drascula/`). */
export const GAME_URL = `${import.meta.env.BASE_URL}drascula`;
/** Jaquette : une image du jeu (pixel art 320×200), générée par `scripts/drascula-cover.mts`. */
export const COVER_URL = `${GAME_URL}/COVER.png`;
export const COVER_SIZE: [number, number] = [320, 200];

/** Les emplacements de sauvegarde du navigateur (`drascula:slot01`…). */
export function browserSaveSlots(): SaveSlots {
  return new SaveSlots(prefixedStorage(localStorageStore(), SAVE_PREFIX));
}

/** La sauvegarde la plus récente (`savedAt`), ou `null` s'il n'y en a aucune de lisible. */
export function latestSave(slots: SaveSlots): StoredSave | null {
  let latest: StoredSave | null = null;
  for (const { slot, empty } of slots.summaries()) {
    if (empty) continue;
    const stored = slots.read(slot);
    if (stored && (!latest || stored.savedAt > latest.savedAt)) latest = stored;
  }
  return latest;
}

export interface TitleActions {
  /** Démarre le jeu ; `restore` : la sauvegarde à reprendre, sans quoi une nouvelle partie. `failure` : région d'erreur sous les boutons. */
  start(restore: StoredSave | null, failure: HTMLElement, buttons: HTMLButtonElement[]): void;
  help(): void;
}

/**
 * Écran de présentation, avant le jeu : jaquette, titre, « Nouvelle partie », « Continuer » (la sauvegarde la plus récente) et
 * « Charger une partie » (la liste des emplacements) quand il y a des sauvegardes, lien vers l'aide et commandes. Même composant que les
 * autres jeux.
 */
export function renderTitle(actions: TitleActions): HTMLElement {
  const slots = browserSaveSlots();
  const latest = latestSave(slots);
  const picture = h("img", { class: "dra-title-picture", src: COVER_URL, alt: copy.coverAlt, width: COVER_SIZE[0], height: COVER_SIZE[1] });
  const failure = h("p", { class: "dra-error", role: "alert" });
  const newGame = h("button", { class: latest ? "secondary" : "primary", type: "button" }, copy.newGame);
  const buttons: HTMLButtonElement[] = [newGame];
  const root = h("div", { class: "dra-title-root" });
  const begin = (restore: StoredSave | null): void => {
    failure.textContent = "";
    actions.start(restore, failure, buttons);
  };
  newGame.addEventListener("click", () => begin(null));

  const continueButton = latest ? h("button", { class: "primary", type: "button", onclick: () => begin(latest) }, copy.continueGame) : null;
  const loadButton = latest
    ? h("button", { class: "secondary", type: "button", onclick: () => showSlots() }, copy.loadGame)
    : null;
  if (continueButton) buttons.push(continueButton);
  if (loadButton) buttons.push(loadButton);

  const menu = titleScreen(
    picture,
    h("h1", {}, copy.title),
    h("p", { class: "muted dra-title-note" }, copy.description),
    continueButton,
    latest ? h("p", { class: "muted dra-title-note" }, copy.continueNote(describeSave(latest))) : null,
    newGame,
    loadButton,
    failure,
    h("button", { class: "secondary", type: "button", onclick: actions.help }, copy.help),
    h("h2", { class: "dra-title-controls" }, copy.controlsTitle),
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
        { class: "dra-title-slots" },
        renderSlotDialog({
          mode: "load",
          slots,
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
