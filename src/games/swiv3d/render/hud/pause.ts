/**
 * Écran de pause de l'exécutable (`gm_screen_pause`, `00419058`) : le décor 3D sans radar ni HUD, le titre « Pause » en texte 3D
 * (table 4, id 0, type 11, teinte `0x400`), et un menu d'une seule ligne (table 4, id 1) à `Y = 260`, encadrée de deux espaceurs de
 * 4 px de la ligne `0x76`. Une touche quelconque rend la main.
 */
import { Menu, MenuLine, ROW, splitLines } from "../../screens/menu";
import { TextRenderer } from "../../screens/text";
import type { Font } from "../../data/font";

/** Ordonnée de la première ligne du menu (`0x104`). */
export const PAUSE_MENU_Y = 260;
/** Identifiant de l'unique choix (`gm_menu_add(…, 1)`). */
const CHOICE_ID = 1;

/** Lignes du menu : espaceur, une ligne par segment `|` du texte, espaceur. */
export function pauseMenuLines(hint: string): MenuLine[] {
  const spacer: MenuLine = { type: "spacer", height: 4, row: ROW.banner };
  return [spacer, ...splitLines(hint).map((text): MenuLine => ({ type: "choice", id: CHOICE_ID, text })), spacer];
}

export interface PauseScreen {
  draw(fb: Uint8Array): void;
}

export function createPauseScreen(font: Font, blend: Uint8Array, page: number, hint: string): PauseScreen {
  const menu = new Menu(pauseMenuLines(hint), { y: PAUSE_MENU_Y }, new TextRenderer(font, blend, page));
  return { draw: (fb) => menu.draw(fb) };
}
