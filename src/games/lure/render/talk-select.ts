/**
 * Le choix du joueur pendant une conversation : les options (au plus 4) sont écrites en haut de l'écran, une par ligne de 8 pixels sous la
 * barre de menus (lignes 1 à 4, à partir de y = 8), sur un fond noir de toute la largeur ; celle sous le pointeur est en blanc, les autres
 * en texte de boîte. ScummVM les écrit directement dans l'écran depuis `talkAnimHandler` (état `TALK_SELECT`) après la mise à jour de la pièce
 * ; le moteur garde ici les lignes et la ligne survolée (`talkSelectView`), le rendu les pose sur l'image de la pièce.
 *
 * Source (ScummVM, GPL v3+) : `HotspotTickHandlers::talkAnimHandler`, cas `TALK_SELECT` (engines/lure/hotspots.cpp).
 *
 * Écarts volontaires : seule la variante VGA est portée ; une option plus large que l'écran est coupée comme `Surface::writeString`.
 */

import type { LureData } from "../data/lure-data";
import type { LureContext } from "../engine/context";
import { FONT_HEIGHT, FULL_SCREEN_WIDTH, MENUBAR_Y_SIZE } from "../engine/ids";
import { MAX_TALK_SELECTIONS, talkSelectView, type TalkSelectView } from "../engine/talk";
import type { Surface } from "./surface";
import { DIALOG_TEXT_COLOR, DIALOG_WHITE_COLOR, drawString } from "./text";

/** Pose les lignes de choix dans `screen` (320 x 200). */
export function drawTalkSelectView(data: LureData, view: TalkSelectView, screen: Surface): void {
  for (let lineNum = 0; lineNum < MAX_TALK_SELECTIONS && lineNum < view.lines.length; lineNum++) {
    const top = (lineNum + 1) * MENUBAR_Y_SIZE;
    screen.fillRect({ left: 0, right: FULL_SCREEN_WIDTH - 1, top, bottom: top + MENUBAR_Y_SIZE - 1 }, 0);
    const color = lineNum + 1 === view.selected ? DIALOG_WHITE_COLOR : DIALOG_TEXT_COLOR;
    drawString(data.font, screen, 0, top, view.lines[lineNum]!, false, color);
  }
}

/** Pose le choix en cours, s'il y en a un ; rend vrai si quelque chose a été dessiné. */
export function drawTalkSelect(data: LureData, engine: LureContext, screen: Surface): boolean {
  const view = talkSelectView(engine);
  if (!view) return false;
  drawTalkSelectView(data, view, screen);
  return true;
}

/** Hauteur de la zone de choix (pour les captures et les tests) : une ligne de barre de menus, puis les lignes. */
export function talkSelectHeight(numLines: number): number {
  return (Math.min(numLines, MAX_TALK_SELECTIONS) + 1) * FONT_HEIGHT;
}
