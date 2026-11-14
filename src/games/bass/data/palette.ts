/**
 * Palettes VGA : 256 couleurs de 3 octets, composantes de 6 bits (0 à 63).
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::convertPalette`, `Screen::setPalette`, `VGA_COLORS` = 256, `GAME_COLORS` = 240)
 * (GPL v3 ou ultérieure). Conversion : `(v << 2) + (v >> 4)` tronqué à un octet. Les 240 premières couleurs sont celles du jeu, les 16
 * dernières servent à l'interface (le moteur écrit seulement les `GAME_COLORS` premières dans la palette de la machine).
 *
 * Écart volontaire : couleurs rendues en RVB sur 3 octets, sans application à un écran.
 */

export const VGA_COLORS = 256;
export const GAME_COLORS = 240;
export const PALETTE_BYTES = VGA_COLORS * 3;

/** `convertPalette` : 768 octets VGA 6 bits vers 768 octets RVB 8 bits. Les fichiers de palette plus longs sont tronqués comme dans ScummVM. */
export function vgaPaletteToRgb(vga: Uint8Array): Uint8Array {
  if (vga.length < PALETTE_BYTES) throw new Error(`palette invalide : ${vga.length} octets, ${PALETTE_BYTES} attendus`);
  const rgb = new Uint8Array(PALETTE_BYTES);
  for (let i = 0; i < PALETTE_BYTES; i++) rgb[i] = ((vga[i]! << 2) + (vga[i]! >> 4)) & 0xff;
  return rgb;
}
