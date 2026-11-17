/**
 * Images `.MCC` d'Astérix : 320×200 en 8 bits indexés, compressées par séries (voir `docs/asterix/formats.md`).
 * Chargeur d'origine : `1481:01ff`.
 *
 * Une palette de 768 octets (RVB 8 bits), puis des paires `(couleur, longueur)` jusqu'à 64 000 pixels. Une longueur
 * nulle n'écrit rien. La dernière série est coupée à la fin de l'image, comme dans l'original (`M49DA005.MCC` déborde de
 * 14 pixels).
 */

import type { Picture } from "./mcg";

export const MCC_WIDTH = 320;
export const MCC_HEIGHT = 200;
const PALETTE_BYTES = 768;
const PIXELS = MCC_WIDTH * MCC_HEIGHT;

export interface Mcc extends Picture {
  /** Pixels de la dernière série qui dépassaient la fin de l'image (0 presque toujours). */
  overflow: number;
}

/** Décode un `.MCC`. Lève une erreur si les séries s'arrêtent avant la fin de l'image ou continuent après. */
export function parseMcc(bytes: Uint8Array): Mcc {
  if (bytes.length < PALETTE_BYTES + 2) throw new Error("MCC : fichier trop court");
  const pixels = new Uint8Array(PIXELS);
  let pos = PALETTE_BYTES;
  let filled = 0;
  let overflow = 0;
  while (filled < PIXELS) {
    if (pos + 2 > bytes.length) throw new Error(`MCC : séries épuisées après ${filled} pixels`);
    const color = bytes[pos];
    const length = bytes[pos + 1];
    pos += 2;
    const end = filled + length;
    if (end > PIXELS) overflow = end - PIXELS;
    pixels.fill(color, filled, Math.min(end, PIXELS));
    filled = end;
  }
  if (pos !== bytes.length) throw new Error(`MCC : ${bytes.length - pos} octets après la fin de l'image`);
  return { palette: bytes.slice(0, PALETTE_BYTES), pixels, overflow };
}
