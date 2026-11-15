/**
 * Mise en forme des textes (messages, menus, bandeau « Objet:Verbe », pause) : césure, centrage par ligne, glyphes à deux plans.
 *
 * Référence : `engines/cruise/font.cpp` de ScummVM (GPL v3+, release 2026.4.0), lu puis réécrit : `getTextLineCount`,
 * `prepareWordRender`, `renderWord`, `renderText`, `drawString` ; police choisie comme `renderText` (`fontFileIndex`, sinon
 * `SYSTEM.FNT`) ; table octet → glyphe de `staticres.cpp` (`data/tables.ts`).
 *
 * Le résultat (`TextGfx`, le `gfxEntryStruct` de ScummVM) est une image `width × height` d'indices 0 (transparent), 1 (ombre, dessinée
 * en noir) et 2 (couleur du texte), posée ensuite par `drawMessage` (`render/draw.ts`). Sa hauteur sert aussi à la logique (menus).
 *
 * Particularités reproduites : le tampon de ScummVM fait quatre fois l'image (`stringWidth × stringHeight × 4`) et les glyphes y sont
 * écrits par adresse linéaire : un glyphe qui dépasse à droite déborde sur la ligne suivante, et ce qui dépasse en bas n'est pas affiché.
 * La césure garde le mot trop long sur la ligne s'il n'y a pas encore eu d'espace (le caractère qui dépasse est compté dans la ligne
 * sans avancer la position).
 * Écarts volontaires : une écriture hors du tampon quadruple (impossible avec les polices du jeu) est ignorée ; une césure qui ne
 * progresse plus (mot plus large que la ligne sans espace avant lui dans `getTextLineCount`, où ScummVM boucle sans fin) lève une erreur.
 */
import { parseFont, type FontFile } from "../data/font";
import { FONT_CHARACTER_TABLE } from "../data/tables";

/** Avance d'une espace (`SPACE_WIDTH`). */
const SPACE_WIDTH = 5;
/** Largeur maximale d'un texte (`renderText` borne la largeur demandée). */
const MAX_TEXT_WIDTH = 310;
const PIPE = 0x7c;
const SPACE = 0x20;

/** Image d'un texte rendu (`gfxEntryStruct`). */
export interface TextGfx {
  /** `rightBorder_X + 2`. */
  readonly width: number;
  /** `(vSpacing + lineHeight + 2) × lignes + 1`. */
  readonly height: number;
  /** `width × height` indices : 0 rien, 1 ombre (noir), 2 couleur du texte. */
  readonly pixels: Uint8Array;
}

/** Octets Latin-1 d'une chaîne du jeu, terminés par 0 (les chaînes de ScummVM sont des `char *`). */
function cString(text: string): Uint8Array {
  const out = new Uint8Array(text.length + 1);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) & 0xff;
    if (code === 0) return out.subarray(0, i + 1);
    out[i] = code;
  }
  return out;
}

function glyphOf(ch: number): number {
  return FONT_CHARACTER_TABLE[ch]!;
}

/** `getTextLineCount` : nombre de lignes du texte. */
function lineCount(right: number, spacing: number, font: FontFile, s: Uint8Array): number {
  if (!s[0]) return 0;
  let local = 0;
  let temp = 0;
  let total = 0;
  let length = 0;
  let ch = s[0]!;
  let guard = 0;
  do {
    const glyph = glyphOf(ch);
    if (ch === PIPE) {
      length = right;
      local = temp;
    } else if (glyph >= 0) {
      length += spacing + font.glyphs[glyph]!.charWidth;
    } else if (ch === SPACE) {
      length += spacing + SPACE_WIDTH;
      local = temp;
    }
    if (length >= right) {
      total += right;
      temp = local;
      length = 0;
    }
    ch = s[++temp] ?? 0;
    if (++guard > 1_000_000) throw new Error("renderText : césure sans fin");
  } while (ch);
  if (length > 0) total += right;
  return Math.trunc(total / right);
}

/** `prepareWordRender` : caractères de la ligne qui commence en `start`, et sa largeur en pixels. */
function prepareLine(right: number, spacing: number, font: FontFile, s: Uint8Array, start: number): { count: number; pixels: number } {
  let counter = 0;
  let finish = false;
  let tempPc = 0;
  let tempCc = 0;
  let pixels = 0;
  let at = start;
  do {
    const ch = s[at++] ?? 0;
    const glyph = glyphOf(ch);
    if (ch === SPACE) {
      tempCc = counter;
      tempPc = pixels;
      if (pixels + spacing + SPACE_WIDTH >= right) finish = true;
      else pixels += spacing + SPACE_WIDTH;
    } else if (ch === PIPE || !ch) {
      finish = true;
    } else if (glyph >= 0) {
      const width = font.glyphs[glyph]!.charWidth;
      if (pixels + spacing + width >= right) {
        finish = true;
        if (tempPc) {
          pixels = tempPc;
          counter = tempCc;
        }
      } else {
        pixels += spacing + width;
      }
    }
    counter++;
  } while (!finish);
  return { count: counter, pixels: (pixels << 16) >> 16 };
}

/**
 * `renderText(inRightBorder_X, string)` avec la police donnée : `null` si le texte n'a aucune ligne (chaîne vide), comme ScummVM.
 */
export function renderTextWith(font: FontFile, rightBorder: number, text: string): TextGfx | null {
  const s = cString(text);
  const spacing = font.hSpacing;
  const right = rightBorder > MAX_TEXT_WIDTH ? MAX_TEXT_WIDTH : rightBorder;
  const lines = lineCount(right, spacing, font, s);
  if (!lines) return null;
  const lineHeight = font.lineHeight;
  const height = (font.vSpacing + lineHeight + 2) * lines + 1;
  const width = right + 2;
  const buffer = new Uint8Array(width * height * 4);

  let pos = 0;
  let heightOffset = 0;
  let finished = false;
  do {
    while (s[pos] === SPACE) pos++;
    const line = prepareLine(right, spacing, font, s, pos);
    const end = pos + line.count;
    let x = right > line.pixels ? Math.trunc((right - line.pixels) / 2) : 0;
    do {
      const ch = s[pos++] ?? 0;
      if (!ch) {
        finished = true;
      } else if (ch === SPACE || ch === PIPE) {
        x += spacing + SPACE_WIDTH;
      } else {
        const glyphIdx = glyphOf(ch);
        if (glyphIdx >= 0) {
          const glyph = font.glyphs[glyphIdx]!;
          renderGlyph(buffer, width, x, glyph.height2 - glyph.charHeight + lineHeight + heightOffset, glyph);
          x += spacing + glyph.charWidth;
        }
      }
    } while (pos < end && !finished);
    heightOffset += font.vSpacing + lineHeight;
  } while (!finished);
  return { width, height, pixels: buffer.subarray(0, width * height) };
}

/** `renderWord` : un glyphe, bit 15 à gauche ; 1 = ombre, 2 = couleur. */
function renderGlyph(buffer: Uint8Array, width: number, x: number, y: number, glyph: FontFile["glyphs"][number]): void {
  let at = y * width + x;
  for (let row = 0; row < glyph.charHeight; row++) {
    let mask = glyph.masks[row]!;
    let color = glyph.colors[row]!;
    for (let j = 0; j < glyph.charWidth; j++) {
      if ((mask >> 15) & 1 && at >= 0 && at < buffer.length) buffer[at] = ((color >> 15) & 1) + 1;
      at++;
      mask = (mask << 1) & 0xffff;
      color = (color << 1) & 0xffff;
    }
    at += width - glyph.charWidth;
  }
}

/** Polices déjà lues, par tampon d'origine. */
const fontCache = new WeakMap<Uint8Array, FontFile>();

/** Police d'un fichier `.FNT` complet (`SYSTEM.FNT`, avec sa signature). */
export function fontFromFile(bytes: Uint8Array): FontFile {
  let font = fontCache.get(bytes);
  if (!font) {
    font = parseFont(bytes);
    fontCache.set(bytes, font);
  }
  return font;
}

/** Police d'une entrée de la base de fichiers (`loadFNTSub` garde la structure qui suit `"FNT\0"`). */
export function fontFromEntry(data: Uint8Array): FontFile {
  let font = fontCache.get(data);
  if (!font) {
    const bytes = new Uint8Array(data.length + 4);
    bytes.set([0x46, 0x4e, 0x54, 0]);
    bytes.set(data, 4);
    font = parseFont(bytes);
    fontCache.set(data, font);
  }
  return font;
}
