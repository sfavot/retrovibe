/**
 * Passerelle entre le panneau de contrôle et l'écran réel : `BassScreenRenderer` n'a pas de méthode pour le panneau (ScummVM :
 * `Screen::renderControlPanel` envoie une image sans passer par la composition d'un tour) ; le panneau écrit donc dans la surface que
 * l'hôte lit (`frame`) et signale la présentation (`presented`). Sans écran réel (`NullScreen`), il n'y a rien à dessiner : le panneau vit
 * quand même (tests de logique).
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::renderControlPanel`, `setPalette(fileNum)`), GPL v3 ou ultérieure.
 */

import { GAME_COLORS } from "../../data/palette";
import { vgaPaletteToRgb } from "../../data/palette";
import type { PanelDisplay } from "./panel";

/** Ce que le panneau lit de l'écran réel (`BassScreenRenderer`). */
export interface ScreenLike {
  readonly frame?: { readonly pixels: Uint8Array; readonly palette: Uint8Array };
  presented?: number;
}

const SHOWN_BYTES = 320 * 192;

export function displayOf(screen: ScreenLike): PanelDisplay | null {
  const frame = screen.frame;
  if (!frame || typeof screen.presented !== "number") return null;
  return {
    setPalette(vga) {
      frame.palette.set(vgaPaletteToRgb(vga).subarray(0, GAME_COLORS * 3));
      screen.presented = (screen.presented ?? 0) + 1;
    },
    show(buffer) {
      frame.pixels.set(buffer.subarray(0, SHOWN_BYTES));
      screen.presented = (screen.presented ?? 0) + 1;
    },
  };
}
