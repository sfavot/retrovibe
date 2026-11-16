/**
 * Texte du jeu : polices, mesure, retour à la ligne, et bitmaps de texte (`CreateTextBitmap`) que les scripts montrent
 * par la propriété `bitmap` d'un élément d'écran (`docs/gk1/formats.md` § 7).
 *
 * Référence : `engines/sci/graphics/text32.cpp` (`GfxText32::createFontBitmap`, `drawFrame`, `drawTextBox`, `drawText`,
 * `getLongest`, `getTextDimensions`, `getTextSize`, `getStringWidth`) et `scifont.cpp` (`GfxFontFromResource::drawToBuffer`)
 * de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - **Texte** : un octet par caractère (CP850), l'octet est l'indice du glyphe. Un caractère hors de la police (le « ° »
 *   0xF8 des polices de 226 glyphes) ne prend pas de place et ne dessine rien.
 * - **Codes** entre barres verticales : `|f3|` change de police, `|c5|` de couleur, `|a1|` d'alignement ; tout autre code
 *   est sauté jusqu'à la barre fermante. Seul `|f…|` compte dans les mesures.
 * - **Retour à la ligne** : une ligne se coupe à la dernière espace qui tient dans la largeur, les espaces qui suivent la
 *   coupure sont avalées ; un mot plus large que la ligne est coupé au caractère ; `\r`, `\n` et leurs paires forcent la
 *   coupure. Le pas vertical est la hauteur de ligne de la police courante.
 * - **Bitmap** : rempli de la couleur de fond, bordé d'un pixel si une couleur de bord est donnée, puis le texte est
 *   dessiné dans son rectangle (borné au bitmap), aligné à gauche, centré ou à droite. Texte « grisé » : un pixel sur deux,
 *   en damier.
 * - **Mesure** (`TextSize`) : largeur de la plus longue ligne et hauteur de toutes les lignes ; sans largeur maximale,
 *   192 pixels ; avec une largeur négative, la largeur du texte sur une seule ligne et une hauteur nulle.
 *
 * Écarts volontaires : un seul repère 320×200 (les conversions d'échelle de ScummVM valent l'identité, sauf l'arrondi
 * final de la mesure, gardé : un texte vide mesure 1×1) ; un glyphe qui déborde du bitmap est rogné proprement ; une
 * largeur trop petite pour un seul caractère avance quand même d'un caractère par ligne (ScummVM boucle) ; pas de texte
 * de droite à gauche, de caractères sur deux octets ni de synthèse vocale.
 */
import { ResourceType } from "../data/ids";
import { type Font, readFont } from "../data/font";
import type { SciBitmap } from "../engine/memory";
import type { ResourceManager } from "../engine/resources";
import { type Cel, drawCel } from "./cel";
import { FALLBACK_FONT, SCREEN_HEIGHT, SCREEN_WIDTH, TEXT_DEFAULT_WIDTH, TEXT_NO_BORDER, TextAlign } from "./ids";
import { clipRect, makeRect, type Rect, rectsIntersect } from "./rect";

const CR = 0x0d;
const LF = 0x0a;
const SPACE = 0x20;
const BAR = 0x7c;
const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;
const CODE_ALIGN = 0x61;
const CODE_COLOR = 0x63;
const CODE_FONT = 0x66;
/** « Tout le texte » pour une mesure sur une seule ligne. */
const WHOLE_TEXT = 10000;
const BORDER_SIZE = 1;
/** Masques du texte grisé : colonnes paires sur les lignes impaires, impaires sur les lignes paires. */
const DIM_ODD_ROW = 0xaa;
const DIM_EVEN_ROW = 0x55;

/** Polices du jeu, lues à la demande ; une police absente est remplacée par la police 0. */
export class FontStore {
  private readonly fonts = new Map<number, Font>();

  constructor(private readonly resources: ResourceManager) {}

  get(id: number): Font {
    let font = this.fonts.get(id);
    if (!font) {
      const data = this.resources.find(ResourceType.Font, id) ?? this.resources.find(ResourceType.Font, FALLBACK_FONT);
      if (!data) throw new Error(`GK1 : police ${id} absente, et pas de police ${FALLBACK_FONT}`);
      this.fonts.set(id, (font = readFont(data)));
    }
    return font;
  }
}

export interface TextBitmapStyle {
  /** Texte, un caractère par octet. */
  text: string;
  /** Rectangle du texte dans le bitmap, bords droit et bas exclus. */
  textRect: Rect;
  foreColor: number;
  backColor: number;
  skipColor: number;
  font: number;
  /** `TEXT_NO_BORDER` : pas de bord. */
  borderColor: number;
  dimmed: boolean;
}

/** Dessinateur de texte : garde, comme l'original, la police et l'alignement courants d'un appel à l'autre. */
export class TextRenderer {
  private fontId = -1;
  private font!: Font;
  private text = "";
  private alignment: number = TextAlign.Left;
  private foreColor = 0;
  private dimmed = false;
  private pixels = new Uint8Array(0);
  private width = 0;
  private height = 0;
  private textRect: Rect = makeRect();
  private drawX = 0;
  private drawY = 0;

  constructor(private readonly fonts: FontStore) {}

  // -------------------------------------------------------------------------------------------------------------------------------
  // Mesure
  // -------------------------------------------------------------------------------------------------------------------------------

  /** `TextSize` : rectangle (0, 0, largeur, hauteur) du texte coupé à `maxWidth` (0 : largeur par défaut ; négatif : une seule ligne). */
  textSize(text: string, fontId: number, maxWidth: number, doScaling = true): Rect {
    this.setFont(fontId);
    this.setText(text);
    const result = makeRect();
    if (maxWidth >= 0) {
      if (maxWidth === 0) maxWidth = TEXT_DEFAULT_WIDTH;
      result.right = maxWidth;
      let textWidth = 0;
      for (const line of this.lines(maxWidth)) {
        textWidth = Math.max(textWidth, this.textWidth(line.start, line.length));
        result.bottom += this.font.lineHeight;
      }
      if (textWidth < maxWidth) result.right = textWidth;
    } else result.right = this.textWidth(0, WHOLE_TEXT);
    if (doScaling) {
      // Arrondi de la conversion entre repères, à l'identité près : 0 devient 1.
      result.right = Math.trunc(((result.right - 1) * SCREEN_WIDTH + SCREEN_WIDTH - 1) / SCREEN_WIDTH) + 1;
      result.bottom = Math.trunc(((result.bottom - 1) * SCREEN_HEIGHT + SCREEN_HEIGHT - 1) / SCREEN_HEIGHT) + 1;
    }
    return result;
  }

  /** Hauteur de ligne de la police `fontId` (pour le curseur d'un champ de saisie). */
  lineHeight(fontId: number): number {
    this.setFont(fontId);
    return this.font.lineHeight;
  }

  /** `TextWidth` : largeur du texte sur une seule ligne. */
  stringWidth(text: string, fontId: number): number {
    this.setFont(fontId);
    this.setText(text);
    return this.textWidth(0, WHOLE_TEXT);
  }

  /** Lignes du texte coupé à `width` : début et longueur de chacune (pour les tests et la mesure). */
  wrap(text: string, fontId: number, width: number): string[] {
    this.setFont(fontId);
    this.setText(text);
    return [...this.lines(width)].map((line) => this.text.slice(line.start, line.start + line.length));
  }

  private *lines(width: number): IterableIterator<{ start: number; length: number }> {
    if (width <= 0) return;
    let start = 0;
    while (this.code(start) !== 0) {
      const line = this.longest(start, width);
      // Garde-fou : une largeur plus petite qu'un caractère n'avancerait jamais ; la ligne prend alors un caractère.
      const stuck = line.next <= start;
      yield { start, length: stuck ? Math.max(line.length, 1) : line.length };
      start = stuck ? start + Math.max(line.length, 1) : line.next;
    }
  }

  /** Plus longue tranche du texte, à partir de `start`, qui tient dans `width` ; `next` : début de la ligne suivante. */
  private longest(start: number, width: number): { length: number; next: number } {
    let testLength = 0;
    let length = 0;
    let charIndex = start;
    let lastWordBreak = start;
    for (let p = start; ; ) {
      const current = this.code(p++);
      if (current === 0) break;
      if (current === CR || current === LF) {
        // « \r\n » et « \n\r » (sauf devant un second « \n ») comptent pour une seule coupure.
        if ((current === CR && this.code(p) === LF) || (current === LF && this.code(p) === CR && this.code(p + 1) !== LF)) charIndex++;
        if (length !== 0 && this.textWidth(start, testLength) > width) return { length, next: lastWordBreak };
        return { length: testLength, next: charIndex + 1 };
      }
      if (current === SPACE) {
        if (this.textWidth(start, testLength) > width) {
          let next = lastWordBreak;
          while (this.code(next) === SPACE) next++;
          return { length, next };
        }
        length = testLength;
        lastWordBreak = charIndex + 1;
      }
      charIndex++;
      testLength++;
      // Pas encore d'espace et déjà trop large : le mot est coupé au caractère.
      if (length === 0 && this.textWidth(start, testLength) > width) return { length: testLength - 1, next: testLength - 1 + lastWordBreak };
    }
    if (length === 0 || this.textWidth(start, testLength) <= width) return { length: testLength, next: charIndex };
    return { length, next: lastWordBreak };
  }

  /** Largeur de `length` caractères à partir de `index`, codes de police compris. */
  private textWidth(index: number, length: number): number {
    let width = 0;
    let font = this.font;
    let p = index;
    let current = this.code(p++);
    while (length > 0 && current !== 0) {
      if (current === BAR) {
        current = this.code(p++);
        length--;
        if (length > 0 && current === CODE_FONT) {
          let fontId = 0;
          while (length > 0 && isDigit(this.code(p))) {
            fontId = fontId * 10 + this.code(p++) - DIGIT_0;
            length--;
          }
          if (length > 0) font = this.fonts.get(fontId);
        }
        while (length > 0 && this.code(p) !== BAR && this.code(p) !== 0) {
          p++;
          length--;
        }
        if (length > 0) {
          p++;
          length--;
        }
      } else width += font.glyphs[current]?.width ?? 0;
      if (length > 0) {
        current = this.code(p++);
        length--;
      }
    }
    return width;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Bitmaps
  // -------------------------------------------------------------------------------------------------------------------------------

  /** `CreateTextBitmap(0, …)` : bitmap de `width × height` rempli de la couleur de fond, bordé, avec le texte. */
  createBitmap(width: number, height: number, alignment: number, style: TextBitmapStyle): SciBitmap {
    this.alignment = alignment;
    this.begin(width, height, style);
    this.pixels.fill(style.backColor);
    if (style.borderColor > TEXT_NO_BORDER) this.drawFrame(style.borderColor);
    this.drawTextBox();
    return this.finish(style.skipColor);
  }

  /**
   * `CreateTextBitmap(1, …)` : bitmap de la taille d'un cel de vue, le cel dessiné dessous. Renvoie `undefined` si le texte
   * devait être écrit dans la couleur transparente (non géré, comme ScummVM). La couleur transparente est celle du cel.
   */
  createBitmapOnCel(cel: Cel, style: TextBitmapStyle): SciBitmap | undefined {
    this.begin(cel.width, cel.height, style);
    this.pixels.fill(cel.skipColor);
    drawCel(this.pixels, this.width, cel, makeRect(0, 0, cel.width, cel.height), 0, 0, false);
    if (style.backColor !== style.skipColor && style.foreColor !== style.skipColor) this.fill(this.textRect, style.backColor);
    if (this.text.length > 0) {
      if (style.foreColor === style.skipColor) return undefined;
      if (style.borderColor !== TEXT_NO_BORDER) this.drawFrame(style.borderColor);
      this.drawTextBox();
    }
    return this.finish(cel.skipColor);
  }

  private begin(width: number, height: number, style: TextBitmapStyle): void {
    this.setText(style.text);
    this.setFont(style.font);
    this.foreColor = style.foreColor;
    this.dimmed = style.dimmed;
    this.width = Math.max(width, 0);
    this.height = Math.max(height, 0);
    this.pixels = new Uint8Array(this.width * this.height);
    const bounds = makeRect(0, 0, this.width, this.height);
    this.textRect = rectsIntersect(style.textRect, bounds) ? clipRect(style.textRect, bounds) : makeRect();
  }

  private finish(skipColor: number): SciBitmap {
    return { width: this.width, height: this.height, skipColor, pixels: this.pixels };
  }

  private fill(rect: Rect, color: number): void {
    for (let y = rect.top; y < rect.bottom; y++) this.pixels.fill(color, y * this.width + rect.left, y * this.width + rect.right);
  }

  /** Cadre d'un pixel sur le tour du bitmap. */
  private drawFrame(color: number): void {
    const { width, height } = this;
    this.fill(makeRect(0, 0, width, Math.min(BORDER_SIZE, height)), color);
    this.fill(makeRect(0, Math.max(height - BORDER_SIZE, 0), width, height), color);
    this.fill(makeRect(0, 0, Math.min(BORDER_SIZE, width), height), color);
    this.fill(makeRect(Math.max(width - BORDER_SIZE, 0), 0, width, height), color);
  }

  private drawTextBox(): void {
    const width = this.textRect.right - this.textRect.left;
    this.drawY = this.textRect.top;
    for (const line of this.lines(width)) {
      this.drawX = this.textRect.left;
      const textWidth = this.textWidth(line.start, line.length);
      if (this.alignment === TextAlign.Center) this.drawX += Math.trunc((width - textWidth) / 2);
      else if (this.alignment === TextAlign.Right) this.drawX += width - textWidth;
      this.drawText(line.start, line.length);
      this.drawY += this.font.lineHeight;
    }
  }

  /** Dessine `length` caractères ; un code tronqué par la fin de la ligne arrête le dessin de celle-ci. */
  private drawText(index: number, length: number): void {
    let p = index;
    while (length-- > 0) {
      const current = this.code(p++);
      if (current !== BAR) {
        this.drawChar(current);
        continue;
      }
      const control = this.code(p++);
      length--;
      if (length <= 0) return;
      let value = 0;
      if (control === CODE_ALIGN || control === CODE_COLOR || control === CODE_FONT) {
        while (length > 0 && isDigit(this.code(p))) {
          value = value * 10 + this.code(p++) - DIGIT_0;
          length--;
        }
        if (length <= 0) return;
      }
      while (length > 0 && this.code(p) !== BAR) {
        p++;
        length--;
      }
      if (length > 0) {
        p++;
        length--;
      }
      if (control === CODE_ALIGN) this.alignment = value;
      else if (control === CODE_COLOR) this.foreColor = value & 0xff;
      else if (control === CODE_FONT) this.setFont(value);
    }
  }

  private drawChar(code: number): void {
    const glyph = this.font.glyphs[code];
    if (!glyph) return;
    for (let y = 0; y < glyph.height; y++) {
      const ty = this.drawY + y;
      if (ty < 0 || ty >= this.height) continue;
      const mask = !this.dimmed ? 0xff : ty % 2 !== 0 ? DIM_ODD_ROW : DIM_EVEN_ROW;
      for (let x = 0; x < glyph.width; x++) {
        const tx = this.drawX + x;
        if (tx < 0 || tx >= this.width) continue;
        if (glyph.pixels[y * glyph.width + x] && mask & (0x80 >> (x & 7))) this.pixels[ty * this.width + tx] = this.foreColor;
      }
    }
    this.drawX += glyph.width;
  }

  private setFont(id: number): void {
    if (id === this.fontId) return;
    this.fontId = id;
    this.font = this.fonts.get(id);
  }

  private setText(text: string): void {
    const end = text.indexOf("\0");
    this.text = end < 0 ? text : text.slice(0, end);
  }

  /** Octet du caractère `index` ; 0 après la fin du texte. */
  private code(index: number): number {
    return index < this.text.length ? this.text.charCodeAt(index) & 0xff : 0;
  }
}

function isDigit(code: number): boolean {
  return code >= DIGIT_0 && code <= DIGIT_9;
}
