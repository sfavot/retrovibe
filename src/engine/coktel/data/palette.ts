import { PALETTE_BYTES, vga6ToRgb8 } from "../../../ui/indexed-canvas";

export { PALETTE_BYTES };

/** Palette VGA 6 bits (0..63) -> RGB 8 bits, 768 octets. */
export const palette6ToRgb = vga6ToRgb8;
