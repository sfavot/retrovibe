/**
 * Boîtes de texte : `Surface::getDialogBounds`, `createDialog`, `refreshDialog`, `newDialog`, `Dialog::show`, la boîte de confirmation
 * (`Game::getYN`) et la fenêtre d'un menu surgissant (`PopupMenu::Show`) (engines/lure/surface.cpp, menu.cpp, game.cpp, ScummVM, GPL v3+).
 * Le cadre est celui de `0x3F03` (`dialog-frame.ts`) ; la bulle de conversation est dans `talk-bubble.ts`.
 *
 * Écarts volontaires : seule la variante VGA est portée ; une boîte est rendue d'un coup (ScummVM la dessine dans une surface puis la copie à
 * l'écran) ; le menu surgissant est celui du mode cliquable (D4 : toutes les entrées, celle sous le pointeur en blanc).
 */

import { expandDialogFrame } from "../data/dialog-frame";
import type { LureData } from "../data/lure-data";
import { DIALOG_TEXT_X, DIALOG_TEXT_Y, FONT_HEIGHT, FONT_WIDTH, FULL_SCREEN_HEIGHT, FULL_SCREEN_WIDTH, INFO_DIALOG_WIDTH, INFO_DIALOG_X, INFO_DIALOG_Y } from "../engine/ids";
import { Surface } from "./surface";
import { DIALOG_TEXT_COLOR, DIALOG_WHITE_COLOR, drawString, wordWrap } from "./text";

/** `getDialogBounds(size, charWidth, numLines, squashedLines)`. */
export function dialogBounds(charWidth: number, numLines: number, squashedLines = false): { width: number; height: number } {
  return { width: DIALOG_TEXT_X * 2 + FONT_WIDTH * charWidth, height: DIALOG_TEXT_Y * 2 + (squashedLines ? FONT_HEIGHT - 1 : FONT_HEIGHT) * numLines };
}

/** `Surface::vgaCreateDialog` : une boîte vide de `width x height`. */
export function createDialog(data: LureData, width: number, height: number): Surface {
  return new Surface(width, height, expandDialogFrame(data.dialogFrame, width, height));
}

/** `Surface::newDialog(width, numLines, lines, varLength, color, squashedLines)`. */
export function newDialog(
  data: LureData,
  width: number,
  lines: readonly string[],
  varLength = true,
  color = DIALOG_TEXT_COLOR,
  squashedLines = true,
): Surface {
  const { height } = dialogBounds(0, lines.length, squashedLines);
  const s = createDialog(data, width, height);
  let y = DIALOG_TEXT_Y;
  for (const line of lines) {
    drawString(data.font, s, DIALOG_TEXT_X, y, line, true, color, varLength);
    y += squashedLines ? FONT_HEIGHT - 1 : FONT_HEIGHT;
  }
  return s;
}

/** `Surface::newDialog(width, line, color)` : le texte est coupé à la largeur de la boîte moins les marges. */
export function newTextDialog(data: LureData, width: number, text: string, color = DIALOG_TEXT_COLOR): Surface {
  return newDialog(data, width, wordWrap(data.font, text, width - DIALOG_TEXT_X * 2), true, color);
}

/** Position de la boîte d'information (`Dialog::show` : `INFO_DIALOG_X`, `INFO_DIALOG_Y`). */
export function infoDialog(data: LureData, text: string, centered = false): { surface: Surface; x: number; y: number } {
  const surface = newTextDialog(data, INFO_DIALOG_WIDTH, text);
  // « Statut » (`doStatus`) : `copyToScreen(INFO_DIALOG_X, (FULL_SCREEN_HEIGHT - height) / 2)`.
  return { surface, x: INFO_DIALOG_X, y: centered ? Math.trunc((FULL_SCREEN_HEIGHT - surface.height) / 2) : INFO_DIALOG_Y };
}

/** Boîte « Vous êtes sûr (o/n) ? » (`Game::getYN` : largeur 190, centrée à l'écran). */
export function confirmDialog(data: LureData, text: string): { surface: Surface; x: number; y: number } {
  const surface = newTextDialog(data, 190, text);
  return { surface, x: (FULL_SCREEN_WIDTH - surface.width) >> 1, y: (FULL_SCREEN_HEIGHT - surface.height) >> 1 };
}

/**
 * Fenêtre d'un menu surgissant (`PopupMenu::Show`) : `entries` lignes en police fixe, celle de rang `selected` en blanc. `numLines` et
 * `first` choisissent les lignes montrées (toutes en mode cliquable ; en mode souris de ScummVM, un nombre impair autour de la sélection,
 * ce que le banc compare). La boîte est dessinée à gauche de l'écran, centrée en hauteur (`copyToScreen(0, yMiddle - height / 2)`).
 */
export function popupDialog(
  data: LureData,
  entries: readonly string[],
  selected: number,
  window?: { numLines: number; first: number },
): { surface: Surface; x: number; y: number } {
  const numCols = entries.reduce((max, e) => Math.max(max, e.length), 0);
  const numLines = window?.numLines ?? entries.length;
  const first = window?.first ?? 0;
  const { width, height } = dialogBounds(numCols, numLines);
  const s = createDialog(data, width, height);
  for (let index = 0; index < numLines; index++) {
    const actionIndex = first + index;
    if (actionIndex < 0 || actionIndex >= entries.length) continue;
    const color = actionIndex === selected ? DIALOG_WHITE_COLOR : DIALOG_TEXT_COLOR;
    drawString(data.font, s, DIALOG_TEXT_X, DIALOG_TEXT_Y + index * FONT_HEIGHT, entries[actionIndex]!, true, color, false);
  }
  return { surface: s, x: 0, y: (FULL_SCREEN_HEIGHT >> 1) - (height >> 1) };
}
