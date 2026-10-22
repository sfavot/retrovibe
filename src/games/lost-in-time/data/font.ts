import type { IndexedSurface } from "./surface";

/** Police bitmap .LET : 4 octets d'en-tête, glyphes monochromes, largeurs optionnelles. */
export class Font {
  readonly charWidthDefault: number;
  readonly charHeight: number;
  readonly startChar: number;
  readonly endChar: number;
  private readonly glyphSize: number;
  private readonly widths: Uint8Array | null;

  constructor(private readonly data: Uint8Array) {
    if (data.length < 4) throw new Error("Police : fichier trop court");
    const hasWidths = (data[0] & 0x80) !== 0;
    this.charWidthDefault = data[0] & 0x7f;
    this.charHeight = data[1];
    this.startChar = data[2];
    this.endChar = data[3];
    this.glyphSize = (Math.floor((this.charWidthDefault - 1) / 8) + 1) * this.charHeight;
    const glyphsEnd = 4 + this.glyphSize * this.charCount;
    if (glyphsEnd > data.length) throw new Error("Police : glyphes hors du fichier");
    this.widths = hasWidths ? data.subarray(glyphsEnd, glyphsEnd + this.charCount) : null;
  }

  get charCount(): number {
    return this.endChar - this.startChar + 1;
  }

  get monospaced(): boolean {
    return this.widths === null;
  }

  hasChar(c: number): boolean {
    return c >= this.startChar && c <= this.endChar;
  }

  charWidth(c: number): number {
    if (!this.widths || this.endChar === 0 || !this.hasChar(c)) return this.charWidthDefault;
    return this.widths[c - this.startChar];
  }

  /** Bitmap du glyphe : lignes de ceil(largeur/8) octets, bit de poids fort à gauche. */
  glyph(c: number): Uint8Array | null {
    if (this.endChar === 0 || !this.hasChar(c)) return null;
    const start = 4 + (c - this.startChar) * this.glyphSize;
    return this.data.subarray(start, start + this.glyphSize);
  }

  /** Dessine un caractère ; `background` null = transparent. Clippe sur la surface. */
  drawChar(
    surface: IndexedSurface,
    c: number,
    x: number,
    y: number,
    foreground: number,
    background: number | null,
  ): void {
    const glyph = this.glyph(c);
    if (!glyph) return;
    const rowBytes = Math.floor((this.charWidthDefault - 1) / 8) + 1;
    for (let row = 0; row < this.charHeight; row++) {
      const py = y + row;
      if (py < 0 || py >= surface.height) continue;
      for (let col = 0; col < this.charWidthDefault; col++) {
        const px = x + col;
        if (px < 0 || px >= surface.width) continue;
        const bit = (glyph[row * rowBytes + (col >> 3)] >> (7 - (col & 7))) & 1;
        if (bit) surface.pixels[py * surface.width + px] = foreground;
        else if (background !== null) surface.pixels[py * surface.width + px] = background;
      }
    }
  }

  /** Dessine une chaîne (octets) en avançant de la largeur de chaque caractère. */
  drawString(
    surface: IndexedSurface,
    text: Uint8Array,
    x: number,
    y: number,
    foreground: number,
    background: number | null,
  ): void {
    for (const c of text) {
      this.drawChar(surface, c, x, y, foreground, background);
      x += this.charWidth(c);
    }
  }
}

export function parseFont(data: Uint8Array): Font {
  return new Font(data);
}
