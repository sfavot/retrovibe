/**
 * Palette du jeu (`TIM_NEW.PAL`) et correspondance des numéros de couleur de TIMWIN.EXE vers l'index de palette.
 */
import { readPalette } from "../data/palette";

/** Palette du jeu (« TIM_NEW.PAL », 220 couleurs distinctes ; index 0 = transparent des sprites). */
export const GAME_PALETTE = "TIM_NEW.PAL";

/** Boutisme de la machine : l'ordre des octets d'un `Uint32` dans un `ImageData` en dépend. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * 413388 : numéro de couleur « logique » → index de palette. Un numéro négatif est l'index lui-même (opposé) ; de 1 à 15, c'est
 * un numéro de la table de couleurs du jeu, décalé de 15 (16 à 30) ; 0 vaut 20. Hors de 0..255 : couleur inchangée (−1).
 */
export function mapColor(color: number): number {
  let c = color;
  if (c < 0) c = -c;
  else if (c > 0 && c < 16) c += 15;
  if (c === 0) c = 20;
  return c >= 0 && c <= 255 ? c : -1;
}

/**
 * `GetNearestPaletteIndex` de Windows sur la palette du jeu (`rgba` : octets R, G, B, A × 256) : l'index de la couleur la plus proche
 * (somme des carrés des écarts), le premier à égalité.
 */
export function nearestColor(rgba: Uint8Array, r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < 256; i++) {
    const dr = rgba[i * 4]! - r;
    const dg = rgba[i * 4 + 1]! - g;
    const db = rgba[i * 4 + 2]! - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

/** Palette RGBA (octets R, G, B, A × 256, comme `readPalette`) → 256 pixels `Uint32` dans l'ordre mémoire RGBA d'un `ImageData`. */
export function paletteLut(rgba: Uint8Array): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const a = rgba[i * 4 + 3]!;
    lut[i] = LITTLE_ENDIAN ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  }
  return lut;
}

export function readGameLut(bytes: Uint8Array): Uint32Array {
  return paletteLut(readPalette(bytes));
}

/** Gris vers lequel `fadeTable` tire les couleurs (0 à 255) et part de la couleur d'origine qu'il garde. */
const FADE_GRAY = 168;
const FADE_KEEP = 0.4;

/**
 * Atténuation d'un bouton grisé (choix du port : le jeu cache ses boutons, il ne les grise pas) : chaque index de la palette
 * (`readPalette`) vers la couleur de la palette la plus proche de sa luminance ramenée vers un gris clair. L'index 0
 * (transparent) reste 0.
 */
export function fadeTable(rgba: Uint8Array): Uint8Array {
  const table = new Uint8Array(256);
  for (let i = 1; i < 256; i++) {
    const lum = 0.3 * rgba[i * 4]! + 0.59 * rgba[i * 4 + 1]! + 0.11 * rgba[i * 4 + 2]!;
    const target = lum * FADE_KEEP + FADE_GRAY * (1 - FADE_KEEP);
    let best = i;
    let bestDist = Infinity;
    for (let j = 1; j < 256; j++) {
      const dr = rgba[j * 4]! - target;
      const dg = rgba[j * 4 + 1]! - target;
      const db = rgba[j * 4 + 2]! - target;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = j;
      }
    }
    table[i] = best;
  }
  return table;
}
