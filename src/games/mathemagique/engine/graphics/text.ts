/**
 * Texte bitmap dans une police `.FON` (`fon.ts`) : `NCSclB10` / `12` / `14` / `18` / `24` (`docs/mathemagique/engine.md` §4.7).
 *
 * Les chaînes du jeu sont des octets Windows-1252. Une chaîne JavaScript est convertie par `encodeText` ; les codes passent ensuite
 * tels quels au glyphe de même code dans la police. **Le `÷` est le glyphe 0xD6 de la police elle-même** (vérifié : 0xD6 dessine « ÷ »,
 * alors qu'il vaut « Ö » en Windows-1252 ; le glyphe 0xF7, « ÷ » en Windows-1252, n'est pas un signe de division). `encodeText` envoie donc
 * `÷` (U+00F7) vers 0xD6 ; un `Ö` écrit tel quel prend lui aussi le glyphe ÷, comme dans l'original (`%d Ö %d =`).
 *
 * Largeur d'un texte = somme des avances des glyphes (police bitmap sans crénage : `GetTextExtent`). Position `y` = haut de la cellule.
 */
import type { FonFont } from "./fon";
import type { Surface } from "./surface";

/** Windows-1252 : caractères Unicode des codes 0x80 à 0x9f (hors de ce bloc, le code est égal au point de code Latin-1). */
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/** Convertit une chaîne en octets Windows-1252 (`?` pour un caractère inconnu), `÷` → 0xD6 (glyphe de la police). */
export function encodeText(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    let byte: number;
    if (code === 0xf7) byte = 0xd6;
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) byte = code;
    else {
      const high = CP1252_HIGH.indexOf(char);
      byte = high >= 0 ? 0x80 + high : 0x3f;
    }
    out[n++] = byte;
  }
  return out.subarray(0, n);
}

function codes(text: string | Uint8Array): Uint8Array {
  return typeof text === "string" ? encodeText(text) : text;
}

/** Largeur en pixels (somme des avances). */
export function measureText(font: FonFont, text: string | Uint8Array): number {
  let width = 0;
  for (const code of codes(text)) width += font.glyph(code).width;
  return width;
}

/** Dessine `text` en couleur `color` (index de palette), coin haut-gauche en `(x, y)`, découpé par la surface. Renvoie la largeur dessinée. */
export function drawText(dst: Surface, font: FonFont, text: string | Uint8Array, x: number, y: number, color: number): number {
  let pen = x;
  for (const code of codes(text)) {
    const glyph = font.glyph(code);
    if (pen < dst.clip.x + dst.clip.w && pen + glyph.width > dst.clip.x) {
      for (let row = 0; row < font.height; row++) {
        const dy = y + row;
        const { from, to } = dst.clipSpan(dy, pen, glyph.width);
        for (let dx = from; dx < to; dx++) {
          if (glyph.pixels[row * glyph.width + (dx - pen)] === 0) continue;
          if (!dst.visible(dx, dy)) continue;
          dst.pixels[dy * dst.width + dx] = color;
        }
      }
    }
    pen += glyph.width;
  }
  return pen - x;
}
