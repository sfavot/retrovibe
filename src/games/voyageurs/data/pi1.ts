/**
 * Fonds d'écran `.PI1` (DEGAS Elite, 320x200, 16 couleurs).
 *
 * Référence : ScummVM engines/cine/bg.cpp (`loadBg`) et gfx.cpp (`FWRenderer::loadBg16`) (GPL v3 ou ultérieure).
 * Format : mot de résolution (0 = 16 couleurs), palette ST de 16 mots, 32 000 octets planaires, puis (32 066 octets seulement) 32 octets
 * de limites d'animation de couleurs DEGAS. Formats : docs/voyageurs/formats.md § 2.1.
 *
 * Écarts volontaires : le mot de résolution est rendu tel quel et les fonds 256 couleurs (`bpp == 8`, propres à Opération Stealth) sont
 * refusés ; les 32 octets de fin sont ignorés (ScummVM ne les lit pas) ; le `.PAL` du bundle (`loadRelatedPalette`) est ignoré.
 */
import { planarToIndexed } from "./planar";
import { readStPalette, ST_PALETTE_BYTES, type StPalette } from "./palette";

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
export const SCREEN_SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;
/** Octets planaires par ligne (`gfxConvertSpriteToRaw(…, 160, 200)`). */
export const SCREEN_ROW_BYTES = SCREEN_WIDTH / 2;
const PI1_PIXELS_OFFSET = 2 + ST_PALETTE_BYTES;

export interface Pi1Image {
  /** Mot de résolution DEGAS (0 = 16 couleurs). */
  readonly resolution: number;
  /** Palette 9 bits (48 valeurs de 0 à 7). */
  readonly palette: StPalette;
  /** 320 x 200 indices de couleur (0 à 15). */
  readonly pixels: Uint8Array;
}

export function readPi1(data: Uint8Array): Pi1Image {
  if (data.length < PI1_PIXELS_OFFSET + SCREEN_SIZE / 2) throw new RangeError(`PI1 trop court : ${data.length} octets`);
  const resolution = (data[0]! << 8) | data[1]!;
  if (resolution === 8) throw new Error("PI1 256 couleurs : propre à Opération Stealth, non géré");
  return {
    resolution,
    palette: readStPalette(data, 2),
    pixels: planarToIndexed(data, PI1_PIXELS_OFFSET, SCREEN_ROW_BYTES, SCREEN_HEIGHT),
  };
}
