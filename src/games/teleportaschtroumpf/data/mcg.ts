import { BinaryReader } from "../../../data/reader";

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
export const PALETTE_BYTES = 768;

const HEADER_BYTES = 2;
const MCG_BYTES = HEADER_BYTES + PALETTE_BYTES + SCREEN_WIDTH * SCREEN_HEIGHT;

/**
 * Écran `.MCG` : u16 little-endian d'en-tête, palette RGB 8 bits (pas 6 bits VGA, 768 octets),
 * puis 320x200 pixels 8 bpp ligne par ligne.
 *
 * `palette` et `pixels` sont des vues (`subarray`) sur les octets fournis, pas des copies.
 */
export interface Mcg {
  /**
   * En-tête lu en u16 little-endian : 0x0000 (107 fichiers), 0x00ff (octets `ff 00`, 10 fichiers)
   * ou 0xff00 (octets `00 ff`, S38A001D.MCG seul).
   * Rôle inconnu, à confirmer par la RE de SMURF.EXE (tâche 0.3) : ni la palette, ni les index
   * utilisés (souvent <= 127 mais pas toujours), ni la parenté avec les .PAL de la scène
   * n'expliquent clairement la valeur.
   */
  header: number;
  palette: Uint8Array;
  pixels: Uint8Array;
}

export function parseMcg(bytes: Uint8Array): Mcg {
  if (bytes.length !== MCG_BYTES) {
    throw new Error(`MCG invalide : ${bytes.length} octets au lieu de ${MCG_BYTES}`);
  }
  const reader = new BinaryReader(bytes);
  const header = reader.u16();
  return {
    header,
    palette: bytes.subarray(HEADER_BYTES, HEADER_BYTES + PALETTE_BYTES),
    pixels: bytes.subarray(HEADER_BYTES + PALETTE_BYTES),
  };
}

/** Palette `.PAL` : 768 octets RGB 8 bits. Renvoie une vue sur `bytes`. */
export function parsePal(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== PALETTE_BYTES) {
    throw new Error(`PAL invalide : ${bytes.length} octets au lieu de ${PALETTE_BYTES}`);
  }
  return bytes;
}
