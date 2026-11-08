/**
 * Masque et table de lumière dynamique d'une pièce (`<pièce>.MSK`, `<pièce>.LUM`).
 *
 * Source : `Display::dynalumInit` et `Display::dynalumUpdate` (engines/queen/display.cpp, ScummVM).
 * - `.MSK` : 8 000 octets = 160 colonnes x 50 lignes de cellules de 4 x 4 pixels du décor ; chaque octet est un
 *   numéro de ligne de la table. Pour la position (x, y) de Joe, ScummVM lit l'octet `(y / 4) * 160 + (x / 4)`
 *   (x borné à `[0, largeur du décor]`, y à `[0, 149]`).
 * - `.LUM` : 24 octets = 8 triplets d'entiers **signés** ; l'éclairage ajoute `triplet * 4` aux trois
 *   composantes des couleurs 144 à 159 (les couleurs de Joe) de la palette de la pièce, bornées à 0..255.
 * Les deux fichiers doivent exister : sans l'un, pas de lumière dynamique (deux pièces, `T4` et `V5`, ont un
 * masque sans table). Les pièces d'introduction n'en ont pas (`isPalFadingDisabled`, côté moteur).
 * Écart signalé : le masque de `T6` contient 1 912 cellules à 255, hors de la table de 8 lignes ; ScummVM lit
 * alors au-delà du tampon. `lightDelta` rend `null` pour un numéro hors table (le moteur laisse la palette).
 */

export const MASK_SIZE = 8000;
export const MASK_COLUMNS = 160;
export const LIGHT_TABLE_ROWS = 8;
export const LIGHT_TABLE_SIZE = LIGHT_TABLE_ROWS * 3;
/** Hauteur de la zone de jeu (`ROOM_ZONE_HEIGHT`). */
export const ROOM_ZONE_HEIGHT = 150;
/** Première couleur de la palette que la lumière modifie, et leur nombre. */
export const LIGHT_FIRST_COLOR = 144;
export const LIGHT_COLOR_COUNT = 16;

export interface RoomLight {
  mask: Uint8Array;
  /** 8 triplets (r, g, b) signés. */
  table: Int8Array;
}

export function parseRoomLight(mask: Uint8Array, table: Uint8Array): RoomLight {
  if (mask.length !== MASK_SIZE) throw new Error(`MSK invalide : ${mask.length} octets au lieu de ${MASK_SIZE}`);
  if (table.length !== LIGHT_TABLE_SIZE) throw new Error(`LUM invalide : ${table.length} octets au lieu de ${LIGHT_TABLE_SIZE}`);
  return { mask, table: new Int8Array(table.buffer, table.byteOffset, table.length) };
}

/** Numéro de ligne de la table pour la position (x, y) d'un décor de largeur `backdropWidth` (formule de ScummVM). */
export function lightRowAt(light: RoomLight, x: number, y: number, backdropWidth: number): number {
  const cx = Math.min(Math.max(x, 0), backdropWidth);
  const cy = Math.min(Math.max(y, 0), ROOM_ZONE_HEIGHT - 1);
  return light.mask[Math.trunc(cy / 4) * MASK_COLUMNS + Math.trunc(cx / 4)];
}

/** Variation (r, g, b) à ajouter aux couleurs 144 à 159 pour une ligne de la table ; `null` hors table. */
export function lightDelta(light: RoomLight, row: number): [number, number, number] | null {
  if (row < 0 || row >= LIGHT_TABLE_ROWS) return null;
  return [light.table[row * 3] * 4, light.table[row * 3 + 1] * 4, light.table[row * 3 + 2] * 4];
}
