/**
 * Palettes (engines/lure/palette.cpp, `Resources::insertPaletteSubset` res.cpp et `Room::loadRoomData` room.cpp, ScummVM, GPL v3+).
 *
 * Une ressource de palette est une suite de couleurs de 3 octets, composantes de 6 bits (0 à 63, format VGA « RGB64 ») : 220 couleurs
 * (660 octets) pour une palette de pièce ou d'écran, 256 pour celle du jeu (`0x3F01`), 128 pour `0x9BFF`. `convertRgb64Palette` passe de 6 à 8
 * bits par `(v << 2) + (v >> 4)`. Une « collection » (`PaletteCollection`, ressource `0x32` de l'introduction) regroupe des sous-palettes de
 * 64 couleurs. La palette de travail d'une pièce (`Room::loadRoomData`) est la palette du jeu, recouverte au début par celle du calque de
 * fond, puis par la sous-palette de remplacement `0x3F02` (60 couleurs en 129, 8 couleurs en 220).
 *
 * Écarts volontaires : couleurs rendues en RVB sur 3 octets (ScummVM en garde 4, dont un à zéro) ; la variante EGA n'est pas portée ; la
 * correction de la première palette de l'introduction (`WORKAROUND`, ressource `0x32` : cinq couleurs de texte trop claires) est appliquée par
 * `parsePaletteCollection` quand on lui donne l'identifiant `0x32` ; elle ne se déclenche pas sur la palette française, qui a déjà les gris.
 */

/** `RES_PALETTE_ENTRIES`, `MAIN_PALETTE_SIZE`, `SUB_PALETTE_SIZE`, `GAME_COLORS`. */
export const RES_PALETTE_ENTRIES = 220;
export const MAIN_PALETTE_SIZE = 228;
export const SUB_PALETTE_SIZE = 64;
export const GAME_COLORS = 256;
/** Premier indice recouvert par la sous-palette `0x3F02` (60 couleurs) puis indice du second bloc (8 couleurs). */
const SUBSET_FIRST_DEST = 129;
const SUBSET_FIRST_COUNT = 60;
const SUBSET_SECOND_DEST = 220;
const SUBSET_SECOND_COUNT = 8;
/** Identifiant de la première collection de l'introduction (correction de ScummVM). */
export const INTRO_PALETTE_COLLECTION_ID = 0x32;

export interface Palette {
  readonly numEntries: number;
  /** `numEntries * 3` octets : R, V, B de 0 à 255. */
  readonly rgb: Uint8Array;
}

/** `Palette::convertRgb64Palette` : composantes de 6 bits vers 8 bits, `(v << 2) + (v >> 4)` tronqué à un octet. */
export function parsePalette(src: Uint8Array): Palette {
  if (src.length % 3 !== 0 || src.length / 3 > GAME_COLORS) throw new Error(`palette invalide : ${src.length} octets`);
  const rgb = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) rgb[i] = ((src[i]! << 2) + (src[i]! >> 4)) & 0xff;
  return { numEntries: src.length / 3, rgb };
}

/** `PaletteCollection` : sous-palettes de 64 couleurs. */
export function parsePaletteCollection(src: Uint8Array, resourceId?: number): Palette[] {
  const size = SUB_PALETTE_SIZE * 3;
  if (src.length % size !== 0) throw new Error(`collection de palettes invalide : ${src.length} octets`);
  const palettes: Palette[] = [];
  for (let at = 0; at < src.length; at += size) palettes.push(parsePalette(src.subarray(at, at + size)));

  // WORKAROUND de ScummVM : la première palette de l'introduction a des couleurs de texte blanches au lieu de gris.
  const first = palettes[0];
  if (resourceId === INTRO_PALETTE_COLLECTION_ID && first && [0, 1, 2].every((c) => first.rgb[0x22 * 3 + c] === 0xff)) {
    for (const [index, value] of [[0x22, 0xe3], [0x24, 0xc3], [0x26, 0x92], [0x27, 0x71], [0x28, 0x00]] as const) {
      first.rgb.fill(value, index * 3, index * 3 + 3);
    }
  }
  return palettes;
}

/**
 * Palette de travail d'une pièce (`Room::loadRoomData`, `Resources::insertPaletteSubset`) : `game` (`0x3F01`, 256 couleurs) recouverte au
 * début par `room` (palette du calque de fond, `(id & 0xFFE0) - 1`), puis par `subset` (`0x3F02`, 68 couleurs).
 */
export function composeRoomPalette(game: Palette, room: Palette, subset: Palette): Palette {
  const rgb = game.rgb.slice();
  rgb.set(room.rgb.subarray(0, Math.min(room.rgb.length, rgb.length)), 0);
  rgb.set(subset.rgb.subarray(0, SUBSET_FIRST_COUNT * 3), SUBSET_FIRST_DEST * 3);
  rgb.set(subset.rgb.subarray(SUBSET_FIRST_COUNT * 3, (SUBSET_FIRST_COUNT + SUBSET_SECOND_COUNT) * 3), SUBSET_SECOND_DEST * 3);
  return { numEntries: game.numEntries, rgb };
}
