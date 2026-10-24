/**
 * Texte bitmap dans une police `.FON` (`fon.ts`) : `NCSclB10` / `12` / `14` / `18` / `24` (`docs/mathemagique/engine.md` §4.7).
 *
 * **Les polices du jeu sont codées en Mac Roman** (glyphe 0x8E = « é », 0xCB = « À », 0xD6 = « ÷ » ; en Windows-1252, 0xD6 serait « Ö »).
 * `encodeText` convertit une chaîne JavaScript (Unicode, donc Latin-1 compris) en codes de glyphe Mac Roman ; ces codes passent ensuite
 * tels quels au glyphe de même code dans la police. Un caractère sans glyphe donne `?`. Les chaînes d'origine écrites en octets
 * (`%d Ö %d =` : le 0xD6 est déjà le code du glyphe ÷) se passent sous forme de `Uint8Array`, sans conversion.
 *
 * Largeur d'un texte = somme des avances des glyphes (police bitmap sans crénage : `GetTextExtent`). Position `y` = haut de la cellule.
 */
import type { FonFont } from "./fon";
import type { Surface } from "./surface";

/** Mac Roman : caractères Unicode des codes 0x80 à 0xFF (0xCA = espace insécable, 0xF0 = pomme, réservée). */
const MAC_ROMAN_HIGH =
  "ÄÅÇÉÑÖÜáàâäãåçéè" +
  "êëíìîïñóòôöõúùûü" +
  "†°¢£§•¶ß®©™´¨≠ÆØ" +
  "∞±≤≥¥µ∂∑∏π∫ªºΩæø" +
  "¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ" +
  "–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ" +
  "‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ" +
  "\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

const MAC_ROMAN_CODE = new Map<string, number>([...MAC_ROMAN_HIGH].map((char, i) => [char, 0x80 + i]));
// Signe monétaire d'avant l'euro, même code 0xDB.
MAC_ROMAN_CODE.set("¤", 0xdb);

/** Convertit une chaîne en codes de glyphe Mac Roman (`?` pour un caractère qui n'y est pas) ; `÷` donne 0xD6. */
export function encodeText(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    out[n++] = code < 0x80 ? code : (MAC_ROMAN_CODE.get(char) ?? 0x3f);
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
