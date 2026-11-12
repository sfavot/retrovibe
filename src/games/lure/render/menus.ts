/**
 * Barre de menus et menus déroulants (`Menu::execute`, `toggleHighlight`, `toggleHighlightItem`, engines/lure/menu.cpp, ScummVM, GPL v3+).
 *
 * La barre est l'image de la ressource 5 (320 x 8, décompressée) copiée sur les 8 premières lignes de l'écran ; l'en-tête touché est mis en
 * valeur en échangeant les couleurs 0 et `0xF7` dans sa zone ; le menu déroulé est une boîte (police fixe) posée sous la barre, et
 * l'entrée visée y est mise en valeur en échangeant les couleurs `0xE2` et `0xE3`. Le mode est celui du clic (D4) : le moteur (`MenuView`)
 * dit quel menu est ouvert et quelle entrée est visée.
 */

import { decodeScreen, SCREEN_SIZE } from "../data/picture";
import { DiskResId } from "../data/ids";
import type { LureData } from "../data/lure-data";
import { DIALOG_TEXT_X, DIALOG_TEXT_Y, FONT_HEIGHT, FULL_SCREEN_WIDTH, MENUBAR_Y_SIZE } from "../engine/ids";
import type { MenuBar } from "../engine/menu";
import { newDialog } from "./dialog";
import type { Surface } from "./surface";
import { DIALOG_TEXT_COLOR, DIALOG_WHITE_COLOR } from "./text";

/** `MENUBAR_SELECTED_COLOR`. */
export const MENUBAR_SELECTED_COLOR = 0xf7;

/** Image de la barre de menus : 320 x 8 indices. */
export function loadMenuBarImage(data: LureData): Uint8Array {
  const decoded = decodeScreen(data.resources.get(DiskResId.menu), SCREEN_SIZE);
  const out = new Uint8Array(FULL_SCREEN_WIDTH * MENUBAR_Y_SIZE);
  out.set(decoded.subarray(0, out.length));
  return out;
}

/** Échange deux couleurs dans un rectangle de la surface. */
function swapColors(s: Surface, x0: number, y0: number, width: number, height: number, a: number, b: number): void {
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) {
      const at = y * s.width + x;
      if (s.data[at] === a) s.data[at] = b;
      else if (s.data[at] === b) s.data[at] = a;
    }
  }
}

/** Dessine la barre ouverte sur le menu `menu` (null : aucun), entrée `index` (à partir de 1, 0 : aucune) visée. */
export function drawMenuBar(data: LureData, barImage: Uint8Array, bar: MenuBar, screen: Surface, menu: number | null, index: number): void {
  screen.data.set(barImage, 0);
  if (menu === null) return;
  const record = bar.menus[menu]!;
  swapColors(screen, record.hsxStart, 0, record.hsxEnd - record.hsxStart + 1, MENUBAR_Y_SIZE, 0, MENUBAR_SELECTED_COLOR);
  const dropdown = newDialog(data, record.width, record.entries, false, DIALOG_TEXT_COLOR, false);
  if (index > 0) {
    swapColors(dropdown, DIALOG_TEXT_X, DIALOG_TEXT_Y + (index - 1) * FONT_HEIGHT, dropdown.width - DIALOG_TEXT_X * 2, FONT_HEIGHT, DIALOG_TEXT_COLOR, DIALOG_WHITE_COLOR);
  }
  dropdown.copyTo(screen, record.xStart, MENUBAR_Y_SIZE);
}
