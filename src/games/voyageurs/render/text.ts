/**
 * Textes : caractère de la police, largeur d'une chaîne, découpage d'une ligne, boîte de message (bulle), ligne de commande, bandeau
 * (`drawString`, pause).
 *
 * Référence : ScummVM engines/cine/gfx.cpp (`FWRenderer::drawChar`, `getStringWidth`, `drawMessage`, `drawCommand`, `drawString`) et
 * texte.cpp (`fitLine`) (GPL v3 ou ultérieure). docs/voyageurs/engine.md § 3.
 *
 * Les chaînes sont des octets CP437 (codes de `fontParamTable`), lus comme des chaînes C : un octet nul ou la fin du tableau termine.
 *
 * Règles reprises :
 * - caractère : espace = 5 px ; sinon glyphe 16 × 8 (couleur 0 transparente) et avance de largeur + 1 ; un code de largeur 0 n'avance pas ;
 * - bulle : fond uni `color`, 4 px en haut et en bas, lignes de 9 px, marge de 4 px, texte justifié (l'espace d'une ligne pleine vaut
 *   `(largeur utile - largeur des mots) / mots`, le reste va au premier espace ; dernière ligne ou ligne finie par `|` : 5 px), bordure
 *   double de couleur 2 ; une bulle qui dépasse le bas de l'écran est remontée (rustine #11708 de ScummVM) ; couleur négative = texte seul ;
 * - `getStringWidth` rend la largeur de la **dernière** ligne (bogue de ScummVM conservé : seul `drawString` s'en sert) ;
 * - ligne de commande : boîte 301 × 11 de fond 0 en (10, `cmdY`), bordure 2, texte en (12, `cmdY` + 2), absente si le menu système est
 *   bloqué.
 *
 * Écart volontaire : quand il ne reste que des espaces en fin de chaîne, la ligne (vide) est comptée puis le texte s'arrête ; ScummVM
 * passe alors l'octet nul et lit au-delà de la chaîne.
 */

import { FONT_HEIGHT, FONT_WIDTH, fontCharacterEntry, type Font } from "../data/font";
import { drawDoubleBorder, drawPlainBox, drawBorder, drawSpriteRaw } from "./draw";

const SPACE = 0x20;
const PIPE = 0x7c;

/** Octet `i` d'une chaîne C (0 au-delà). */
function at(str: Uint8Array, i: number): number {
  return i < str.length ? str[i]! : 0;
}

/** `drawChar` : dessine (si `draw`) et rend le x suivant. */
export function drawChar(page: Uint8Array, font: Font, code: number, x: number, y: number, draw = true): number {
  if (code === SPACE) return x + 5;
  const entry = fontCharacterEntry(code);
  if (!entry.width) return x;
  const glyph = font.glyphs[entry.glyph];
  if (draw && glyph) drawSpriteRaw(page, glyph.pixels, glyph.mask, FONT_WIDTH, FONT_HEIGHT, x, y);
  return x + entry.width + 1;
}

/** `getStringWidth` (FW : 1 px entre deux caractères). */
export function stringWidth(str: Uint8Array): number {
  let width = 0;
  for (let i = 0; at(str, i); i++) {
    const code = str[i]!;
    if (code === PIPE) width = 0;
    else if (code === SPACE) width += 5;
    else width += fontCharacterEntry(code).width + 1;
  }
  return width;
}

/** `fitLine` : nombre d'octets de la ligne qui tient dans `maxWidth`, nombre d'espaces à justifier et largeur des mots. */
export function fitLine(str: Uint8Array, start: number, maxWidth: number): { length: number; words: number; width: number } {
  let bkpWords = 0;
  let bkpWidth = 0;
  let bkpLen = 0;
  let charWidth = 0;
  let fullWidth = 0;
  let words = 0;
  let width = 0;
  let i = 0;
  for (; at(str, start + i); i++) {
    const code = str[start + i]!;
    if (code === PIPE) {
      i++;
      break;
    } else if (code === SPACE) {
      charWidth = 5;
      bkpWords = words++;
      bkpWidth = width;
      bkpLen = i + 1;
    } else {
      charWidth = fontCharacterEntry(code).width + 1;
      width += charWidth;
    }
    if (!charWidth) continue;
    if (fullWidth + charWidth < maxWidth) {
      fullWidth += charWidth;
    } else if (fullWidth) {
      words = bkpWords;
      width = bkpWidth;
      i = bkpLen;
      break;
    }
  }
  return { length: i, words, width };
}

/**
 * `drawMessage` : bulle de `width` px en (x, y) ; rend le y maximal utilisé (inclus). Sans `draw`, ne dessine rien (mesure seulement).
 */
export function drawMessage(page: Uint8Array, font: Font, str: Uint8Array, x: number, y0: number, width: number, color: number, draw = true): number {
  let y = y0;
  if (draw) {
    const maxY = drawMessage(page, font, str, x, y, width, color, false);
    if (maxY > 199) {
      y -= maxY - 199;
      if (y < 0) y = 0;
    }
  }
  const box = draw && color >= 0;
  if (box) drawPlainBox(page, x, y, width, 4, color);
  let tx = x + 4;
  let ty = at(str, 0) ? y - 5 : y + 4;
  const tw = width - 8;
  let line = 0;
  let space = 0;
  let extraSpace = 0;
  for (let i = 0; at(str, i); i++, line--) {
    if (!line) {
      while (at(str, i) === SPACE) i++;
      const fit = fitLine(str, i, tw);
      line = fit.length;
      const next = at(str, i + line);
      if (next !== 0 && next !== PIPE && fit.words) {
        space = Math.trunc((tw - fit.width) / fit.words);
        extraSpace = (tw - fit.width) % fit.words;
      } else {
        space = 5;
        extraSpace = 0;
      }
      ty += 9;
      if (box) drawPlainBox(page, x, ty, width, 9, color);
      tx = x + 4;
      // Plus que des espaces : ScummVM passe l'octet nul et lit au-delà de la chaîne ; on s'arrête là.
      if (!at(str, i)) break;
    }
    const code = str[i]!;
    if (code === SPACE) {
      tx += space + extraSpace;
      extraSpace = 0;
    } else {
      tx = drawChar(page, font, code, tx, ty, draw);
    }
  }
  ty += 9;
  if (box) {
    drawPlainBox(page, x, ty, width, 4, color);
    drawDoubleBorder(page, x, y, width, ty - y + 4, 2);
  }
  return ty + 4;
}

/** `drawCommand` : ligne de commande (sans effet si `disableSystemMenu`). */
export function drawCommand(page: Uint8Array, font: Font, command: Uint8Array, cmdY: number, disableSystemMenu: number): void {
  if (disableSystemMenu !== 0) return;
  drawPlainBox(page, 10, cmdY, 301, 11, 0);
  drawBorder(page, 9, cmdY - 1, 302, 12, 2);
  let x = 12;
  for (let i = 0; i < command.length; i++) x = drawChar(page, font, command[i]!, x, cmdY + 2);
}

/** `drawString` : bandeau centré (y = 80, 20 si `param` = 1, 140 si 2), fond 4. */
export function drawString(page: Uint8Array, font: Font, str: Uint8Array, param = 0): void {
  const y = param === 1 ? 20 : param === 2 ? 140 : 80;
  let width = stringWidth(str);
  if (width === 0) return;
  width = Math.min(width + 20, 300);
  drawMessage(page, font, str, Math.trunc((320 - width) / 2), y, width, 4);
}
