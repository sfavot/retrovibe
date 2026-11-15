/**
 * Menus de sélection dessinés par le moteur : verbes, inventaire, choix d'un objet, menu système, confirmation.
 *
 * Référence : ScummVM engines/cine/gfx.cpp (`SelectionMenu::drawMenu`, `FWRenderer::drawFrame` pour l'ordre de la pile) (GPL v3 ou
 * ultérieure). docs/voyageurs/engine.md § 3.
 *
 * Règles reprises : boîte de `width` × (lignes × 9 + 10) ramenée dans l'écran (x + largeur ≤ 319, y + hauteur ≤ 199), fond `messageBg`,
 * bordure double de couleur 2 ; première ligne de texte à y + 4, marge de 4 px ; ligne choisie sur fond 0 (x + 2, ligne - 1, largeur - 3, 9) ;
 * les menus empilés sont dessinés du plus ancien au plus récent.
 *
 * Écarts volontaires : l'aspect « boîtes transparentes » (Amiga, option de ScummVM) n'est pas porté ; la synthèse vocale non plus.
 */

import { encodeCp437 } from "../../../data/cp437";
import type { Font } from "../data/font";
import type { MenuView } from "../engine/services";
import { drawDoubleBorder, drawPlainBox } from "./draw";
import { drawChar } from "./text";

/** Position réelle d'un menu (`drawMenu` ramène la boîte dans l'écran). */
export function menuBox(menu: MenuView): { x: number; y: number; width: number; height: number } {
  const height = menu.items.length * 9 + 10;
  let { x, y } = menu;
  if (x + menu.width > 319) x = 319 - menu.width;
  if (y + height > 199) y = 199 - height;
  return { x, y, width: menu.width, height };
}

/** `SelectionMenu::drawMenu`. */
export function drawMenu(page: Uint8Array, font: Font, menu: MenuView, messageBg: number): void {
  const { x, y, width, height } = menuBox(menu);
  drawPlainBox(page, x, y, width, height, messageBg);
  drawDoubleBorder(page, x, y, width, height, 2);
  let lineY = y + 4;
  menu.items.forEach((item, i) => {
    if (i === menu.selection) drawPlainBox(page, x + 2, lineY - 1, width - 3, 9, 0);
    let charX = x + 4;
    for (const code of encodeCp437(item)) charX = drawChar(page, font, code, charX, lineY);
    lineY += 9;
  });
}
