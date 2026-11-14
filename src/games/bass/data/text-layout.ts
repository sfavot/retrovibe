/**
 * Mise en page et dessin des textes : coupure des lignes, largeur, sprite de texte.
 *
 * Référence : ScummVM engines/sky/text.cpp (`Text::displayText`, `changeTextSpriteColor`), GPL v3 ou ultérieure.
 *
 * Règles reprises : la ligne est coupée au dernier espace quand `largeur >= pixelWidth` (sans espace sur la ligne : coupure au caractère
 * qui déborde) ; 10 lignes au plus ; l'affichage s'arrête au premier code inférieur à 0x20 (une ligne continue après un code de 10 à 31).
 * La largeur d'une ligne centrée ou alignée à droite est celle du texte jusqu'à son dernier espace (`centerTable`).
 *
 * Écarts volontaires :
 * - les contournements allemand (« MUND-BEATMUNG! ») et espagnol (« MANIFESTACION-ARTISTICA. ») de ScummVM ne sont pas repris : le portage
 *   ne vise que le français ; le chinois (Big5) et le sens de lecture de droite à gauche sont ignorés ;
 * - un code sans glyphe lève une erreur au lieu de lire au-delà de la police ; dépasser 10 lignes lève aussi une erreur (comme ScummVM) ;
 * - fidèle à ScummVM : avec la police des liens (1), les codes >= 0x80 comptent comme des espaces à la mise en page mais sont dessinés tels
 *   quels ; l'en-tête du sprite n'a que la largeur, la hauteur, la taille et les décalages (les autres champs restent à 0).
 * - écart : ScummVM n'écrit jamais `s_n_sprites` (et `drawSprite` ne le lit pas) ; ici `SpriteFile` borne l'image au nombre d'images de
 *   l'en-tête, donc un sprite de texte déclare une image (`numSprites = 1`), sinon `spriteOf` l'écarterait et le texte ne serait jamais dessiné.
 */

import type { SkyFont } from "./font";
import { FONT_NUMBER_LINK } from "./font";
import { DATA_FILE_HEADER_SIZE } from "./header";

export const MAX_TEXT_LINES = 10;
/** Largeur fixe des dialogues (pixels). */
export const DIALOG_TEXT_WIDTH = 128;
/** Octets ajoutés après les pixels du sprite (`numBytes`). */
const SPRITE_TAIL = 4;
/** Première couleur de texte remplaçable par `changeTextSpriteColor` (0 transparent, 240 contour). */
const FIRST_TEXT_COLOR = 241;

export const TextAlign = { left: 0, center: 1, right: 2 } as const;
export type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];

export interface TextLayout {
  /** Lignes (codes du jeu), coupures comprises. */
  readonly lines: readonly string[];
  /** Largeur de chaque ligne servant à l'alignement (jusqu'au dernier espace, ou largeur totale pour la dernière). */
  readonly lineWidths: readonly number[];
  /** Largeur de la dernière ligne (`textWidth` de `DisplayedText`). */
  readonly lastLineWidth: number;
  /** `_numLetters` de ScummVM : 2 plus un par tour de la boucle de coupure (relectures après une coupure comprises) ; durée d'une réplique sans voix. */
  readonly numLetters: number;
  /** Largeur du sprite = `pixelWidth`. */
  readonly width: number;
  /** Hauteur du sprite = hauteur de police × nombre de lignes. */
  readonly height: number;
}

/** `displayText`, première partie : coupe `text` (codes du jeu) en lignes pour une largeur de `pixelWidth` pixels. */
export function layoutText(text: string, font: SkyFont, pixelWidth: number): TextLayout {
  const buf: number[] = [];
  for (let i = 0; i < text.length; i++) buf.push(text.charCodeAt(i) & 0xff);
  buf.push(0);

  const centerTable: number[] = [];
  let lineWidth = 0;
  let numLines = 0;
  let curPos = 0;
  let lastSpace = 0;
  let textChar = buf[curPos++]!;
  let numLetters = 2;

  while (textChar >= 0x20) {
    numLetters++;
    const oldLineWidth = lineWidth;
    if (font.fontNumber === FONT_NUMBER_LINK && textChar >= 0x80) textChar = 0x20;
    textChar -= 0x20;
    if (textChar === 0) {
      lastSpace = curPos;
      centerTable[numLines] = lineWidth;
    }
    lineWidth += font.rawWidth(textChar + 0x20) + font.charSpacing;

    if (pixelWidth <= lineWidth) {
      if (lastSpace === 0 || buf[lastSpace - 1] === 10) {
        // Pas d'espace sur la ligne : coupure avant le caractère qui déborde (un code de 10 s'intercale).
        curPos = Math.max(curPos - 1, 0);
        buf.splice(curPos, 0, 10);
        lastSpace = curPos + 1;
        centerTable[numLines] = oldLineWidth;
      }
      buf[lastSpace - 1] = 10;
      lineWidth = 0;
      numLines++;
      if (numLines > MAX_TEXT_LINES) throw new RangeError("texte : plus de 10 lignes");
      curPos = lastSpace;
    }
    textChar = buf[curPos++]!;
  }

  const lastLineWidth = lineWidth;
  centerTable[numLines] = lineWidth;
  numLines++;
  if (numLines > MAX_TEXT_LINES) throw new RangeError("texte : plus de 10 lignes");

  // Découpage selon les codes de fin de ligne, comme la boucle de dessin.
  const lines: string[] = [];
  let at = 0;
  for (;;) {
    let line = "";
    let code = buf[at++] ?? 0;
    while (code >= 0x20) {
      line += String.fromCharCode(code);
      code = buf[at++] ?? 0;
    }
    lines.push(line);
    if (code < 10) break;
  }

  return { lines, lineWidths: centerTable.slice(0, numLines), lastLineWidth, numLetters, width: pixelWidth, height: font.charHeight * numLines };
}

export interface RenderedText {
  /** Sprite : `DataFileHeader` de 22 octets, puis `width × height` pixels indexés (0 transparent, 240 contour), puis 4 octets. */
  readonly data: Uint8Array;
  readonly layout: TextLayout;
}

/** `displayText` : met `text` en page et le dessine dans un sprite de texte (largeur `pixelWidth`, couleur `color`). */
export function renderText(text: string, font: SkyFont, align: TextAlign, pixelWidth: number, color: number): RenderedText {
  const layout = layoutText(text, font, pixelWidth);
  const pixels = pixelWidth * layout.height;
  const data = new Uint8Array(DATA_FILE_HEADER_SIZE + pixels + SPRITE_TAIL);
  const view = new DataView(data.buffer);
  view.setUint16(6, pixelWidth, true);
  view.setUint16(8, layout.height, true);
  view.setUint16(10, pixels & 0xffff, true);
  view.setUint16(14, 1, true);

  const pixelBase = DATA_FILE_HEADER_SIZE;
  layout.lines.forEach((line, row) => {
    let at = pixelBase + row * pixelWidth * font.charHeight;
    const width = layout.lineWidths[row] ?? 0;
    if (align === TextAlign.center) at += (pixelWidth - width) >> 1;
    else if (align === TextAlign.right) at += pixelWidth - width - 1;
    for (let i = 0; i < line.length; i++) at = font.draw(line.charCodeAt(i), data, at, pixelWidth, color);
  });
  return { data, layout };
}

/** `changeTextSpriteColor` : remplace les pixels de texte (>= 241) d'un sprite de texte par `newColor`. */
export function changeTextSpriteColor(sprite: Uint8Array, newColor: number): void {
  const spriteSize = sprite[10]! | (sprite[11]! << 8);
  for (let i = 0; i < spriteSize; i++) if (sprite[DATA_FILE_HEADER_SIZE + i]! >= FIRST_TEXT_COLOR) sprite[DATA_FILE_HEADER_SIZE + i] = newColor;
}
