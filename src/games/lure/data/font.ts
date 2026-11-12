/**
 * Police du jeu : ressource 4 (`FONT_RESOURCE_ID`) de `DISK1.VGA`.
 *
 * Source : `Surface::initialize`, `Surface::writeChar`, `Surface::writeSubstring` (engines/lure/surface.cpp, ScummVM, GPL v3+).
 * Disposition : un glyphe par code à partir de **32**, 8 octets par glyphe (une ligne = un octet, bit de poids fort à gauche, 1 bit par
 * pixel), soit 115 glyphes (codes 32 à 146). Largeur d'un glyphe en mode proportionnel : colonne la plus à droite allumée + 1, plus 2 de
 * chasse ; un glyphe vide (espace) vaut 2 + 2 ; en mode fixe, 8.
 *
 * Écarts volontaires : la substitution de trois glyphes accentués dans la version italienne (`char8A`, `char8D`, `char95`) ne concerne pas
 * le français et n'est pas portée ; ScummVM lève une erreur sur un code hors police, ici `glyph` renvoie `undefined` (le rendu choisit).
 */

export const FONT_WIDTH = 8;
export const FONT_HEIGHT = 8;
export const FONT_FIRST_CHAR = 32;

export class LureFont {
  readonly numGlyphs: number;
  private readonly bitmaps: Uint8Array;
  private readonly sizes: Uint8Array;

  constructor(resource: Uint8Array) {
    if (resource.length % FONT_HEIGHT !== 0) throw new Error("police invalide : taille non multiple de 8");
    this.bitmaps = resource;
    this.numGlyphs = resource.length / FONT_HEIGHT;
    if (this.numGlyphs > 256) throw new Error("police invalide : plus de 256 glyphes");
    this.sizes = new Uint8Array(this.numGlyphs);
    for (let glyph = 0; glyph < this.numGlyphs; glyph++) {
      let size = 0;
      for (let y = 0; y < FONT_HEIGHT; y++) {
        const row = resource[glyph * FONT_HEIGHT + y]!;
        for (let x = 0; x < FONT_WIDTH; x++) {
          if ((row & (0x80 >> x)) !== 0 && x > size) size = x;
        }
      }
      this.sizes[glyph] = size === 0 ? 2 : size;
    }
  }

  /** Dernier code de caractère qui a un glyphe. */
  get lastChar(): number {
    return FONT_FIRST_CHAR + this.numGlyphs - 1;
  }

  has(code: number): boolean {
    return code >= FONT_FIRST_CHAR && code < FONT_FIRST_CHAR + this.numGlyphs;
  }

  /** 8 octets du glyphe (une ligne par octet, bit 7 à gauche), ou `undefined` si le code n'a pas de glyphe. */
  glyph(code: number): Uint8Array | undefined {
    if (!this.has(code)) return undefined;
    const at = (code - FONT_FIRST_CHAR) * FONT_HEIGHT;
    return this.bitmaps.subarray(at, at + FONT_HEIGHT);
  }

  /** Avance en pixels : 8 en mode fixe, sinon largeur du dessin + 2 (`writeSubstring` avec `varLength`). */
  advance(code: number, proportional: boolean): number {
    if (!proportional) return FONT_WIDTH;
    if (!this.has(code)) throw new RangeError(`caractère ${code} sans glyphe`);
    return this.sizes[code - FONT_FIRST_CHAR]! + 2;
  }
}
