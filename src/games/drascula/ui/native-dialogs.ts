import "./native-dialogs.css";
import { encodeCp850 } from "../../../data/cp850";
import { h } from "../../../ui/dom";
import type { StageSlotsOptions } from "../../../ui/point-click-app";
import { slotLabel } from "../../../ui/point-click-dialogs";
import { copy } from "../copy";
import type { GameState } from "../engine/state";
import { FONT_SHEET, type GameFont } from "../render/font";
import { GamePalette, HALF_PAL, TextColor, textColorRgb } from "../render/palette";
import { Plane, TRANSPARENT, WIDTH } from "../render/plane";
import type { DrasculaRenderer } from "../render/renderer";
import {
  LEVEL_MAX,
  type Rect,
  SAVE_SCREEN,
  type SlotCommand,
  SlotScreen,
  type SlotScreenMessage,
  VOLUME_BAR,
  VOLUME_PANEL,
  VOLUME_WELLS,
  type VolumeKind,
  barRect,
  fitGameText,
  levelAtY,
  percentRect,
  rowTextY,
  slotRowHeight,
} from "./native-screens";

/**
 * Écrans d'origine du volume (`volumeControls`, sound.cpp) et des sauvegardes (`saveLoadScreen`, saveload.cpp) de ScummVM, refaits
 * en HTML : l'image est celle du jeu, dessinée à l'ouverture à partir de ses fichiers et de sa palette (rien n'est extrait dans le
 * dépôt), et de vrais contrôles (curseurs, liste, boutons) sont posés dessus, invisibles, aux places de l'image (`native-screens.ts`
 * pour la géométrie et le déroulé). La page (`PointClickStageDialogs`) pose l'écran sur le canvas, à son échelle.
 */

/** Ce qu'il faut pour dessiner un écran : 320 x 200 pixels indexés et la palette affichée (RVB 8 bits). */
export interface ScreenArt {
  pixels: Uint8Array;
  palette: Uint8Array;
}

// --- Dessin ---------------------------------------------------------------------------------------------------------------------

/** Peint le rectangle `rect` d'une image indexée (largeur 320) dans `canvas`, à sa taille en pixels du jeu ; `transparent` : indice laissé vide. */
function paint(canvas: HTMLCanvasElement, pixels: Uint8Array, palette: Uint8Array, rect: Rect, transparent?: number): void {
  if (canvas.width !== rect.width) canvas.width = rect.width;
  if (canvas.height !== rect.height) canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(rect.width, rect.height);
  const data = image.data;
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const index = pixels[(rect.y + y) * WIDTH + rect.x + x];
      const out = (y * rect.width + x) * 4;
      if (index === transparent) continue;
      data[out] = palette[index * 3];
      data[out + 1] = palette[index * 3 + 1];
      data[out + 2] = palette[index * 3 + 2];
      data[out + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

const FULL: Rect = { x: 0, y: 0, width: 320, height: 200 };

/** Place un élément sur l'écran, en pourcentages de 320 x 200 : il suit l'échelle de la couche. */
function place(element: HTMLElement, rect: Rect): void {
  Object.assign(element.style, percentRect(rect));
}

/** Point d'un événement en pixels du jeu, d'après la taille affichée de l'écran. */
function gamePoint(screen: HTMLElement, event: PointerEvent | MouseEvent): { x: number; y: number } {
  const box = screen.getBoundingClientRect();
  return { x: ((event.clientX - box.left) / box.width) * 320, y: ((event.clientY - box.top) / box.height) * 200 };
}

/** Le caractère s'écrit-il avec la police du jeu ? (`encodeCp850` rend `?` pour un caractère hors de la page de codes.) */
function fontSupports(font: GameFont): (char: string) => boolean {
  return (char) => {
    const code = encodeCp850(char)[0];
    if (code === 0x3f && char !== "?") return false;
    return font.find(code) !== undefined;
  };
}

/** Palette dont la couleur du texte (254) est `color` (`color_abc`). */
function withTextColor(palette: Uint8Array, color: number): Uint8Array {
  const out = palette.slice();
  out.set(textColorRgb(color), 254 * 3);
  return out;
}

/** Échap ferme, Tab tourne dans l'écran (fenêtre modale). */
function screenKeys(screen: HTMLElement, close: () => void): void {
  screen.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      const focusables = [...screen.querySelectorAll<HTMLElement>("button, input, [tabindex='0']")];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === screen)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

// --- Volume ---------------------------------------------------------------------------------------------------------------------

/**
 * Image de fond du volume : la pièce telle que `updateRoom` la dessine (sans curseur, ni barre des verbes, ni inventaire), dans la
 * palette affichée. `compose` écrit dans `screen`, que l'image suivante du jeu recompose.
 */
export function volumeArt(gfx: DrasculaRenderer, state: GameState): ScreenArt {
  gfx.compose({ state, mouseX: 0, mouseY: 0, subtitle: null, main: false, cursorVisible: false, talk: null, choices: null });
  return { pixels: gfx.screen.pixels.slice(), palette: gfx.palette.shown.slice() };
}

export interface VolumeScreenOptions {
  art: ScreenArt;
  /** Feuille `95.ALG` : le panneau et la barre pleine. */
  sheet: Plane;
  /** Crans de départ (0 à 15). */
  levels: Record<VolumeKind, number>;
  /** Un cran a changé : l'appliquer et l'enregistrer. */
  change(kind: VolumeKind, level: number): void;
  close(): void;
}

const VOLUME_LABELS: Record<VolumeKind, string> = { master: copy.masterVolumeLabel, voice: copy.voiceVolumeLabel, music: copy.volumeLabel };
/** Coin vide du panneau (en haut à droite) où se dessine la case de fermeture, et sa zone d'appui (plus grande, pour le doigt). */
const CLOSE_BOX: Rect = { x: 242, y: 63, width: 8, height: 8 };
const CLOSE_HIT: Rect = { x: 236, y: 57, width: 18, height: 18 };
const PANEL: Rect = { x: VOLUME_PANEL.x, y: VOLUME_PANEL.y, width: VOLUME_PANEL.width, height: VOLUME_PANEL.height };
/** Couleurs de la case de fermeture : le gris et le noir du panneau. */
const PANEL_GREY = 158;
const BLACK = 0;

/** Case de fermeture (ajout du portage, l'original se ferme au clic droit) : bord noir, fond gris du panneau, croix. */
function drawCloseBox(plane: Plane): void {
  const { x, y, width, height } = CLOSE_BOX;
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const edge = dx === 0 || dy === 0 || dx === width - 1 || dy === height - 1;
      const cross = !edge && dx >= 1 && dx <= width - 2 && (dx === dy || dx === width - 1 - dy);
      plane.pixels[(y + dy) * WIDTH + x + dx] = edge || cross ? BLACK : PANEL_GREY;
    }
  }
}

/**
 * Écran du volume : le panneau de `95.ALG` sur la pièce, trois puits (général, voix et effets, musique) dont la barre suit le réglage.
 * Chaque puits porte un curseur (`input type=range`, 0 à 15) invisible : flèches au clavier, glisser à la souris ou au doigt (le haut
 * de la barre suit le pointeur). Échap, clic droit, appui hors du panneau ou sur la case en haut à droite : retour au jeu.
 */
export function renderVolumeScreen(options: VolumeScreenOptions): HTMLElement {
  const { art, sheet } = options;
  const levels = { ...options.levels };
  const canvas = h("canvas", { class: "dr-art", "aria-hidden": "true" });
  const draw = (): void => {
    const plane = new Plane(art.pixels.slice());
    plane.copyRect(sheet, VOLUME_PANEL.sheetX, VOLUME_PANEL.sheetY, VOLUME_PANEL.x, VOLUME_PANEL.y, VOLUME_PANEL.width, VOLUME_PANEL.height);
    for (const { kind, barX } of VOLUME_WELLS) {
      const bar = barRect(barX, levels[kind]);
      plane.copyBackground(sheet, VOLUME_BAR.sheetX, VOLUME_BAR.sheetY, bar.x, bar.y, bar.width, bar.height);
    }
    drawCloseBox(plane);
    paint(canvas, plane.pixels, art.palette, FULL);
  };

  const screen = h("section", { class: "dr-screen dr-volume", role: "dialog", "aria-modal": "true", "aria-label": copy.volumeDialogTitle, tabindex: "-1" }, canvas);
  const ranges = new Map<VolumeKind, HTMLInputElement>();
  const set = (kind: VolumeKind, level: number): void => {
    const clamped = Math.min(Math.max(Math.round(level), 0), LEVEL_MAX);
    const range = ranges.get(kind);
    if (range) {
      range.value = String(clamped);
      range.setAttribute("aria-valuetext", copy.volumeLevel(clamped));
    }
    if (clamped === levels[kind]) return;
    levels[kind] = clamped;
    draw();
    options.change(kind, clamped);
  };

  for (const { kind, well } of VOLUME_WELLS) {
    const range = h("input", {
      type: "range",
      min: 0,
      max: LEVEL_MAX,
      step: 1,
      value: levels[kind],
      "aria-label": VOLUME_LABELS[kind],
      "aria-valuetext": copy.volumeLevel(levels[kind]),
    });
    range.addEventListener("input", () => set(kind, Number(range.value)));
    ranges.set(kind, range);
    const zone = h("div", { class: "dr-well" }, range);
    place(zone, well);
    // Glisser dans le puits : le cran suit l'ordonnée du pointeur (clic gauche ou doigt ; le clic droit ferme l'écran).
    zone.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      zone.setPointerCapture?.(event.pointerId);
      range.focus({ preventScroll: true });
      set(kind, levelAtY(gamePoint(screen, event).y));
    });
    zone.addEventListener("pointermove", (event) => {
      if (zone.hasPointerCapture?.(event.pointerId)) set(kind, levelAtY(gamePoint(screen, event).y));
    });
    screen.append(zone);
  }

  const closeButton = h("button", { type: "button", class: "dr-hit dr-close", "aria-label": copy.closeVolume, title: copy.close, onclick: () => options.close() });
  place(closeButton, CLOSE_HIT);
  screen.append(closeButton);

  // Appui hors du panneau (sur la pièce) : retour au jeu ; clic droit n'importe où : idem, comme l'original.
  screen.addEventListener("pointerdown", (event) => {
    if (event.target !== canvas || event.button !== 0) return;
    const { x, y } = gamePoint(screen, event);
    if (x < PANEL.x || y < PANEL.y || x >= PANEL.x + PANEL.width || y >= PANEL.y + PANEL.height) {
      event.preventDefault();
      options.close();
    }
  });
  screen.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    options.close();
  });
  screenKeys(screen, options.close);
  draw();
  queueMicrotask(() => ranges.get("master")?.focus({ preventScroll: true }));
  return screen;
}

// --- Sauvegardes ----------------------------------------------------------------------------------------------------------------

/** Image de l'écran des sauvegardes : `loadPic("savescr.alg", bgSurface, HALF_PAL)` puis `color_abc(kColorLightGreen)`. */
export function saveScreenArt(gfx: DrasculaRenderer): ScreenArt {
  const image = gfx.image("savescr.alg");
  const palette = new GamePalette();
  palette.game.set(gfx.palette.game);
  palette.setRgb(image.palette, HALF_PAL);
  palette.setTextColor(TextColor.LightGreen);
  return { pixels: image.pixels, palette: palette.shown.slice() };
}

/** Textes d'un emplacement plein, en police du jeu : la ligne de la liste et le cadre du nom. */
export interface SlotTexts {
  row: string;
  name: string;
}

export interface SaveScreenOptions {
  art: ScreenArt;
  /** Police (`GameFont`) et sa feuille (`95.ALG`). */
  font: GameFont;
  sheet: Plane;
  /** Textes d'un emplacement plein (`null` : vide). */
  describe(slot: number): SlotTexts | null;
  slots: StageSlotsOptions;
}

const SHORT_MESSAGES: Record<SlotScreenMessage, string> = {
  confirm: copy.saveScreenConfirmName,
  cannotSave: copy.saveScreenCannotSaveName,
  empty: copy.saveScreenEmptyName,
  busy: copy.saveScreenBusyName,
  saveFailed: copy.saveScreenSaveFailedName,
  loadFailed: copy.saveScreenLoadFailedName,
};

const LIST: Rect = SAVE_SCREEN.list;

/**
 * Écran des sauvegardes (F10 et F7, un seul écran comme l'original) : `SAVESCR.ALG`, les dix emplacements dans le cadre de la liste
 * (une vraie liste : flèches, début, fin, Entrée), le cadre du nom qui montre l'emplacement choisi ou un message, et les boutons
 * Load, Save et Play de l'image (Play : retour au jeu, comme Échap). Sauvegarder sur un emplacement plein demande un second appui.
 */
export function renderSaveScreen(options: SaveScreenOptions): HTMLElement {
  const { art, font, sheet, slots } = options;
  const supports = fontSupports(font);
  const normal = withTextColor(art.palette, TextColor.LightGreen);
  const selectedPalette = withTextColor(art.palette, TextColor.Yellow);
  const state = new SlotScreen(slots.summaries(), slots.intent, slots.canSave);
  let rowHeight: number = SAVE_SCREEN.rowHeight;

  const canvas = h("canvas", { class: "dr-art", "aria-hidden": "true" });
  const live = h("p", { class: "dr-sr", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "dr-slots", role: "listbox", "aria-label": copy.slotsLabel });
  place(list, LIST);
  const button = (rect: Rect, label: string, onPress: () => void): HTMLButtonElement => {
    const element = h("button", { type: "button", class: "dr-hit", "aria-label": label, onclick: onPress });
    place(element, rect);
    return element;
  };
  const loadButton = button(SAVE_SCREEN.load, copy.saveScreenLoad, () => void run(state.pressLoad()));
  const saveButton = button(SAVE_SCREEN.save, copy.saveScreenSave, () => void run(state.pressSave()));
  const playButton = button(SAVE_SCREEN.play, copy.saveScreenPlay, () => {
    if (!state.busy) slots.close();
  });
  const screen = h(
    "section",
    { class: "dr-screen dr-saves", role: "dialog", "aria-modal": "true", "aria-label": copy.saveScreenTitle, tabindex: "-1" },
    canvas,
    list,
    loadButton,
    saveButton,
    playButton,
    live,
  );

  const rows = new Map<number, { option: HTMLElement; canvas: HTMLCanvasElement }>();
  const scratch = new Plane();

  /** Texte en police du jeu dans `scratch` (fond transparent). */
  const write = (text: string, x: number, y: number): void => {
    scratch.clear(TRANSPARENT);
    font.print(scratch, sheet, fitGameText(text, supports, SAVE_SCREEN.rowGlyphs), x, y);
  };

  const nameText = (): string => {
    if (state.message) return SHORT_MESSAGES[state.message];
    return options.describe(state.selected)?.name ?? copy.saveScreenEmptyName;
  };
  const liveText = (): string => {
    switch (state.message) {
      case "confirm":
        return copy.saveScreenConfirm(state.selected);
      case "cannotSave":
        return copy.saveBusy;
      case "empty":
        return copy.loadEmpty;
      case "busy":
        return copy.saveScreenBusy;
      case "saveFailed":
      case "loadFailed":
        return state.detail ?? SHORT_MESSAGES[state.message];
      default:
        return "";
    }
  };

  const drawBackground = (): void => {
    const plane = new Plane(art.pixels.slice());
    font.print(plane, sheet, fitGameText(nameText(), supports, SAVE_SCREEN.nameGlyphs), SAVE_SCREEN.nameText.x, SAVE_SCREEN.nameText.y);
    paint(canvas, plane.pixels, normal, FULL);
  };

  const drawRow = (slot: number): void => {
    const row = rows.get(slot);
    if (!row) return;
    write(options.describe(slot)?.row ?? "", SAVE_SCREEN.rowTextX, rowTextY(rowHeight));
    paint(row.canvas, scratch.pixels, slot === state.selected ? selectedPalette : normal, { x: 0, y: 0, width: LIST.width, height: rowHeight }, TRANSPARENT);
  };

  const buildRows = (): void => {
    rows.clear();
    list.replaceChildren(
      ...state.slots.map((summary) => {
        const rowCanvas = h("canvas", { "aria-hidden": "true" });
        const option = h("div", { class: "dr-slot", role: "option", id: `dr-slot-${summary.slot}`, "data-slot": summary.slot }, rowCanvas);
        option.addEventListener("click", () => {
          state.select(summary.slot);
          update();
          option.focus({ preventScroll: true });
        });
        rows.set(summary.slot, { option, canvas: rowCanvas });
        return option;
      }),
    );
  };

  /** Fait défiler la liste jusqu'à l'emplacement choisi (lignes hautes, au doigt). */
  const reveal = (option: HTMLElement): void => {
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  };

  function update(): void {
    drawBackground();
    for (const summary of state.slots) {
      const row = rows.get(summary.slot);
      if (!row) continue;
      const selected = summary.slot === state.selected;
      row.option.setAttribute("aria-selected", String(selected));
      row.option.setAttribute("aria-label", slotLabel(copy, summary));
      row.option.tabIndex = selected ? 0 : -1;
      drawRow(summary.slot);
    }
    loadButton.setAttribute("aria-disabled", String(!state.loadEnabled));
    saveButton.setAttribute("aria-disabled", String(!state.saveEnabled));
    screen.setAttribute("aria-busy", String(state.busy));
    const text = liveText();
    if (live.textContent !== text) live.textContent = text;
  }

  async function run(command: SlotCommand): Promise<void> {
    if (command.type === "none") return update();
    if (command.type === "save") {
      const result = slots.save(command.slot);
      if (!result.ok) {
        state.finish("save", result, slots.summaries());
        update();
      }
      return;
    }
    state.startBusy();
    update();
    const result = await slots.load(command.slot);
    if (!result.ok) {
      state.finish("load", result, slots.summaries());
      update();
    }
  }

  list.addEventListener("keydown", (event) => {
    const moves: Record<string, "previous" | "next" | "first" | "last"> = { ArrowUp: "previous", ArrowDown: "next", Home: "first", End: "last" };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      state.move(move);
      update();
      const option = rows.get(state.selected)?.option;
      if (option) {
        option.focus({ preventScroll: true });
        reveal(option);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void run(state.activate());
    }
  });

  // Lignes plus hautes au doigt sur un petit écran (`slotRowHeight`) : remesurées quand l'écran change de taille.
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const resize = (): void => {
    const next = slotRowHeight(screen.clientWidth / 320, coarse);
    if (next === rowHeight) return;
    rowHeight = next;
    list.style.setProperty("--dr-row", `${(rowHeight / LIST.height) * 100}%`);
    for (const summary of state.slots) drawRow(summary.slot);
    const option = rows.get(state.selected)?.option;
    if (option) reveal(option);
  };
  list.style.setProperty("--dr-row", `${(rowHeight / LIST.height) * 100}%`);
  if (typeof ResizeObserver === "function") new ResizeObserver(resize).observe(screen);

  screen.addEventListener("contextmenu", (event) => event.preventDefault());
  screenKeys(screen, () => {
    if (!state.busy) slots.close();
  });
  buildRows();
  update();
  queueMicrotask(() => {
    resize();
    const option = rows.get(state.selected)?.option;
    if (option) {
      option.focus({ preventScroll: true });
      reveal(option);
    }
  });
  return screen;
}

/** Feuille de la police et du panneau du volume (`95.ALG`), en lecture seule. */
export function fontSheet(gfx: DrasculaRenderer): Plane {
  return gfx.sheet(FONT_SHEET);
}
