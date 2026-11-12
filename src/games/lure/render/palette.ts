/**
 * Palette de travail et fondus : `Palette`, `Screen::setPalette`, `paletteFadeIn`, `paletteFadeOut` (engines/lure/screen.cpp, palette.cpp,
 * ScummVM, GPL v3+) ; `Room::setRoomNumber` pour la palette d'une pièce. Les composantes sont sur 8 bits (la conversion 6 bits est dans
 * `data/palette.ts`) et la palette système a 256 entrées.
 *
 * Fondu : à chaque pas, chaque composante monte (ou descend) de 4 (`PALETTE_FADE_INC_SIZE`), un pas toutes les 20 ms. Le fondu sortant
 * porte sur les 255 premières entrées (l'indice 255 montre le curseur disque), l'entrant sur celles de la palette cible.
 *
 * Écarts volontaires : ScummVM bloque pendant le fondu ; ici il se déroule sur plusieurs images (`LureRenderer.fading` dit à l'hôte de
 * suspendre le moteur) et `fadeStepMs` donne la durée d'un pas.
 */

import type { LureData } from "../data/lure-data";
import { composeRoomPalette, GAME_COLORS, parsePalette, RES_PALETTE_ENTRIES, type Palette } from "../data/palette";

/** `PALETTE_FADE_INC_SIZE` et durée d'un pas (`delayMillis(20)`). */
export const PALETTE_FADE_INC_SIZE = 4;
export const FADE_STEP_MS = 20;

/** Palette RGB sur 768 octets (complétée par du noir) pour `paletteToLut`. */
export function rgb768(palette: Palette): Uint8Array {
  const out = new Uint8Array(GAME_COLORS * 3);
  out.set(palette.rgb.subarray(0, GAME_COLORS * 3));
  return out;
}

/** Identifiant de la palette d'un écran de pièce : `(id & 0xFFE0) - 1`. */
export function screenPaletteId(screenId: number): number {
  return (screenId & 0xffe0) - 1;
}

/**
 * Palette de travail d'un écran (`Room::setRoomNumber`, `Resources::insertPaletteSubset`) : palette du calque `(id & 0xFFE0) - 1` sur celle
 * du jeu, puis la sous-palette de remplacement ; sans palette propre (écran d'indice < 0x100 ou ressource absente), celle du jeu.
 */
export function screenPalette(data: LureData, screenId: number): { palette: Palette; source: string } {
  const paletteId = screenPaletteId(screenId);
  if (screenId < 0x100 || !data.resources.has(paletteId)) return { palette: data.gamePalette, source: "palette du jeu (0x3F01)" };
  try {
    const room = parsePalette(data.resources.get(paletteId));
    return { palette: composeRoomPalette(data.gamePalette, room, data.altPalette), source: `palette 0x${paletteId.toString(16).toUpperCase()} sur celle du jeu` };
  } catch {
    return { palette: data.gamePalette, source: "palette du jeu (0x3F01)" };
  }
}

/** Palette affichée pour la pièce dont le calque de fond est `backgroundScreenId` : 256 entrées. */
export function roomPalette(data: LureData, backgroundScreenId: number): Uint8Array {
  return rgb768(screenPalette(data, backgroundScreenId).palette);
}

/** `Screen::setPaletteEmpty(numEntries)` : met à zéro les `numEntries` premières entrées. */
export function emptyPalette(rgb: Uint8Array, numEntries = GAME_COLORS): void {
  rgb.fill(0, 0, numEntries * 3);
}

/** Un pas de `paletteFadeOut(numEntries)` ; vrai si une composante a changé. */
export function fadeOutStep(rgb: Uint8Array, numEntries = GAME_COLORS - 1): boolean {
  let changed = false;
  for (let i = 0; i < numEntries * 3; i++) {
    const v = rgb[i]!;
    if (v > 0) {
      rgb[i] = v < PALETTE_FADE_INC_SIZE ? 0 : v - PALETTE_FADE_INC_SIZE;
      changed = true;
    }
  }
  return changed;
}

/** Un pas de `paletteFadeIn(target)` ; vrai si une composante a changé (une composante déjà au-dessus de la cible ne bouge pas). */
export function fadeInStep(rgb: Uint8Array, target: Uint8Array, numEntries = GAME_COLORS): boolean {
  let changed = false;
  for (let i = 0; i < numEntries * 3; i++) {
    const v = rgb[i]!;
    const final = target[i]!;
    if (v < final) {
      rgb[i] = final - v < PALETTE_FADE_INC_SIZE ? final : v + PALETTE_FADE_INC_SIZE;
      changed = true;
    }
  }
  return changed;
}

export { RES_PALETTE_ENTRIES };
