export const PALETTE_BYTES = 768;

/** Palette VGA 6 bits (0..63) -> RGB 8 bits, 768 octets. */
export function palette6ToRgb(palette: Uint8Array): Uint8Array {
  const rgb = new Uint8Array(PALETTE_BYTES);
  for (let i = 0; i < PALETTE_BYTES; i++) {
    const v = palette[i] & 0x3f;
    rgb[i] = (v << 2) | (v >> 4);
  }
  return rgb;
}
