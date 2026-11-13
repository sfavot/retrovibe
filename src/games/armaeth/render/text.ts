import type { GphFont } from "../data/font";
import type { Surface } from "./surface";

export interface TextStyle {
  /** Espacement ajouté à la largeur de chaque glyphe (1 pour les messages, 0 pour la ligne de saisie). */
  spacing?: number;
  /** Couleur de l'encre. */
  color: number;
  /** Couleur de l'ombre, un pixel à droite de chaque pixel d'encre ; sans ombre si absente. */
  shadow?: number;
}

/** Codes de caractère d'un texte ASCII ; les textes du jeu sont déjà en octets CP437 (leur décodage n'est pas ici). */
export function textBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Largeur en pixels d'un texte (`FUN_325a_01ac`) : somme des largeurs de glyphe + `spacing`, moins un `spacing` final. */
export function measureText(
  font: GphFont,
  text: Uint8Array | string,
  spacing = 0,
): number {
  return font.measure(
    typeof text === "string" ? textBytes(text) : text,
    spacing,
  );
}

/**
 * Texte en police à bits (`vga_draw_text`, `+0x6e`), écrit directement dans `surface` (l'écran `A000`) sans test de
 * priorité ni transparence. `(x, y)` = coin haut gauche de la cellule du premier caractère. Pour chaque pixel d'encre,
 * le pilote écrit un mot : encre en `x`, ombre en `x + 1` ; le pixel suivant de la ligne l'écrase donc s'il est
 * allumé et l'ombre ne reste que sur les pixels éteints. Un code sans glyphe prend celui du code 0. Rogné à la page
 * (le pilote, lui, déborderait sur la ligne suivante). Rend l'abscisse après le dernier caractère (sans l'espacement final).
 */
export function drawText(
  surface: Surface,
  font: GphFont,
  x: number,
  y: number,
  text: Uint8Array | string,
  style: TextStyle,
): number {
  const codes = typeof text === "string" ? textBytes(text) : text;
  const spacing = style.spacing ?? 0;
  let cursor = x;
  for (const code of codes) {
    const glyph = font.glyph(code);
    glyph.rows.forEach((bits, i) => {
      const row = y + glyph.firstRow + i;
      // Le pilote s'arrête dès que le reste de la ligne est vide.
      for (let col = 0; col < glyph.width && bits >> col !== 0; col++) {
        if (((bits >> col) & 1) === 0) continue;
        surface.setPixel(cursor + col, row, style.color);
        if (style.shadow !== undefined)
          surface.setPixel(cursor + col + 1, row, style.shadow);
      }
    });
    cursor += glyph.width + spacing;
  }
  return codes.length === 0 ? x : cursor - spacing;
}
