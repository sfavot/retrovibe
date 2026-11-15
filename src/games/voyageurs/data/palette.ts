/**
 * Palettes 9 bits de l'Atari ST (16 couleurs, 3 bits par composante) et conversion en RVB 8 bits.
 *
 * Référence : ScummVM engines/cine/gfx.cpp (`kLowPalFormat` = `PixelFormat(2, 3, 3, 3, 0, 8, 4, 0, 0)`, `FWRenderer::loadBg16`) et
 * engines/cine/pal.cpp (`Palette::load`, `Palette::save`) (GPL v3 ou ultérieure). Un mot 16 bits grand-boutiste `0x0RGB` : rouge bits 8-10,
 * vert bits 4-6, bleu bits 0-2. La conversion 8 bits est `c * 255 / 7`, quotient entier (`Palette::save`).
 *
 * Écarts volontaires : les composantes restent en 9 bits (0 à 7) dans `StPalette`, parce que les fondus du moteur
 * (`transformPaletteRange`, opcode 0x48) s'y calculent ; le `.PAL` des bundles (tables CGA/Tandy, `pal.cpp:loadPal`) est ignoré,
 * comme le rendu de ScummVM le fait (ses deux tables ne sont lues nulle part).
 */

export const ST_PALETTE_COLORS = 16;
export const ST_PALETTE_BYTES = ST_PALETTE_COLORS * 2;
/** Valeur maximale d'une composante 9 bits. */
export const ST_COMPONENT_MAX = 7;

/** Palette 16 couleurs en 9 bits : `[r, g, b]` par couleur, chaque composante de 0 à 7 (48 valeurs). */
export type StPalette = Uint8Array;

/** `Palette::load` : 16 mots `0x0RGB` grand-boutistes lus à `offset`. */
export function readStPalette(data: Uint8Array, offset = 0): StPalette {
  if (offset < 0 || offset + ST_PALETTE_BYTES > data.length) {
    throw new RangeError(`palette ST trop courte : ${ST_PALETTE_BYTES} octets attendus à partir de ${offset}`);
  }
  const palette = new Uint8Array(ST_PALETTE_COLORS * 3);
  for (let i = 0; i < ST_PALETTE_COLORS; i++) {
    const word = (data[offset + i * 2]! << 8) | data[offset + i * 2 + 1]!;
    palette[i * 3] = (word >> 8) & 7;
    palette[i * 3 + 1] = (word >> 4) & 7;
    palette[i * 3 + 2] = word & 7;
  }
  return palette;
}

/** Composante 9 bits (0 à 7) vers 8 bits : `c * 255 / 7`, quotient entier. */
export function component9To8(component: number): number {
  return Math.floor((component * 255) / ST_COMPONENT_MAX);
}

/** Palette 9 bits (3 valeurs par couleur) vers RVB 8 bits (3 octets par couleur). */
export function stPaletteToRgb(palette: StPalette): Uint8Array {
  const rgb = new Uint8Array(palette.length);
  for (let i = 0; i < palette.length; i++) rgb[i] = component9To8(palette[i]!);
  return rgb;
}
