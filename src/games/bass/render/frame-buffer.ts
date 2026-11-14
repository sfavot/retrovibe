/**
 * Écran d'origine : 320 x 200 en indices (192 lignes de jeu + 8 lignes du bas) et palette de 256 couleurs RVB sur 8 bits.
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::Screen`, `_top16Colors`, `setPalette`, `halvePalette`), skydefs.h (`GAME_SCREEN_*`,
 * `FULL_SCREEN_*`, `GRID_*`, `TOP_LEFT_*`) (GPL v3 ou ultérieure).
 *
 * Palette : seules les 240 premières couleurs (`GAME_COLORS`) sont écrites par les fichiers de palette et par les fondus ; les 16 dernières
 * sont fixées à la création de l'écran (`_top16Colors`, composantes sur 6 bits) et ne changent plus (elles servent au texte et à l'interface).
 *
 * Écart volontaire : l'écran n'envoie rien à une machine ; `toRgba` produit les octets destinés à un `ImageData` (le canvas de l'hôte).
 */

import { GAME_COLORS, PALETTE_BYTES, VGA_COLORS, vgaPaletteToRgb } from "../data/palette";

export const SCREEN_WIDTH = 320;
/** `FULL_SCREEN_HEIGHT`. */
export const SCREEN_HEIGHT = 200;
/** `GAME_SCREEN_HEIGHT` : lignes de jeu ; les 8 dernières sont réservées (noires, texte d'introduction). */
export const GAME_SCREEN_HEIGHT = 192;
export const SCREEN_SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;
export const GAME_SCREEN_SIZE = SCREEN_WIDTH * GAME_SCREEN_HEIGHT;

/** Grille de recomposition : 20 x 24 blocs de 16 x 8 pixels. */
export const GRID_X = 20;
export const GRID_Y = 24;
export const GRID_W = 16;
export const GRID_H = 8;
export const GRID_W_SHIFT = 4;
export const GRID_H_SHIFT = 3;
export const GRID_BLOCK_SIZE = GRID_W * GRID_H;
/** Octets d'un décor de jeu (`GRID_X * GRID_Y` blocs de 128 octets). */
export const BACKGROUND_SIZE = GAME_SCREEN_SIZE;

/** `TOP_LEFT_X`, `TOP_LEFT_Y` : origine des coordonnées de jeu (les compacts sont décalés de cette valeur). */
export const TOP_LEFT_X = 128;
export const TOP_LEFT_Y = 136;

/** `Screen::_top16Colors` : couleurs 240 à 255, composantes VGA sur 6 bits. */
export const TOP16_COLORS_VGA: readonly number[] = [
  0, 0, 0, 38, 38, 38, 63, 63, 63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 54, 54, 54, 45, 47, 49, 32, 31, 41, 29, 23, 37, 23, 18, 30, 49, 11, 11, 39, 5, 5, 29, 1, 1, 63, 63, 63,
];

/** Palette de départ de `Screen::Screen` : 240 couleurs noires, puis les 16 couleurs d'interface. */
export function initialPalette(): Uint8Array {
  const vga = new Uint8Array(PALETTE_BYTES);
  vga.set(TOP16_COLORS_VGA, GAME_COLORS * 3);
  return vgaPaletteToRgb(vga);
}

export class FrameBuffer {
  /** Indices de couleur, `SCREEN_WIDTH x SCREEN_HEIGHT`. */
  readonly pixels = new Uint8Array(SCREEN_SIZE);
  /** 256 couleurs RVB sur 8 bits (`Screen::_palette`). */
  readonly palette = initialPalette();

  /** `Screen::clearScreen` : tout à l'indice 0. */
  clear(): void {
    this.pixels.fill(0);
  }

  /** `Screen::setPalette(uint8 *)` : applique un fichier de palette VGA 6 bits (les 240 premières couleurs seulement, les 16 dernières restent). */
  setVgaPalette(vga: Uint8Array): void {
    this.setRgbPalette(vgaPaletteToRgb(vga));
  }

  /** Remplace les 240 couleurs de jeu par celles de `rgb` (768 octets RVB 8 bits, comme `_palette`). */
  setRgbPalette(rgb: Uint8Array): void {
    if (rgb.length < GAME_COLORS * 3) throw new Error(`palette invalide : ${rgb.length} octets`);
    this.palette.set(rgb.subarray(0, GAME_COLORS * 3));
  }

  /** Octets RGBA (largeur x hauteur x 4, alpha 255) pour un `ImageData` ; `out` peut être fourni pour réutiliser un tampon. */
  toRgba(out: Uint8Array | Uint8ClampedArray = new Uint8ClampedArray(SCREEN_SIZE * 4), palette: Uint8Array = this.palette): Uint8Array | Uint8ClampedArray {
    return indicesToRgba(this.pixels, palette, out);
  }
}

/** Conversion indices + palette RVB (768 octets) vers RGBA. */
export function indicesToRgba(
  pixels: Uint8Array,
  palette: Uint8Array,
  out: Uint8Array | Uint8ClampedArray = new Uint8ClampedArray(pixels.length * 4),
): Uint8Array | Uint8ClampedArray {
  if (palette.length < VGA_COLORS * 3) throw new Error("palette invalide : 768 octets attendus");
  if (out.length < pixels.length * 4) throw new RangeError("tampon RGBA trop petit");
  for (let i = 0, o = 0; i < pixels.length; i++, o += 4) {
    const c = pixels[i]! * 3;
    out[o] = palette[c]!;
    out[o + 1] = palette[c + 1]!;
    out[o + 2] = palette[c + 2]!;
    out[o + 3] = 255;
  }
  return out;
}
