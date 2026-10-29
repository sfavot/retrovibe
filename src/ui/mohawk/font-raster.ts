import type { HostFontSpec, HostText, HostTextMetrics, TextMask } from "../../engine/mohawk/host";

/**
 * Rastérisation de texte sans lissage pour les jeux qui écrivent en TrueType (GDI sur écran 256 couleurs : pas d'anticrénelage).
 *
 * Une police est chargée une fois (`loadFontFace`, avant le démarrage du jeu) ; une chaîne est ensuite dessinée en noir sur un canvas 2D
 * transparent puis seuillée sur l'alpha (>= 128) : le résultat est un masque 0/1 (`TextMask`). Le navigateur applique son propre
 * lissage et son propre hinting, donc les contours ne sont pas identiques pixel pour pixel à ceux de GDI.
 *
 * Hauteur `LOGFONT` -> taille CSS (règle de GDI, `CreateFont`) :
 *  - `height < 0` : hauteur de caractère, c'est-à-dire la taille em : `font-size = -height` px (cas de Zoombinis, qui passe `-13` et `-16`) ;
 *  - `height > 0` : hauteur de cellule (ascendante + descendante) : on mesure la cellule à une taille de référence et on met la police à
 *    l'échelle pour que `ascent + descent` vaille `height` ;
 *  - `height = 0` : taille par défaut de GDI (12 px).
 * Les métriques viennent de `fontBoundingBox*` (hhea / OS/2) arrondies à l'entier, là où GDI lit `winAscent` / `winDescent` ; l'écart
 * possible est d'un pixel.
 */

/** Taille de référence pour mesurer la cellule d'une police (précision de la mise à l'échelle d'une hauteur positive). */
const REFERENCE_SIZE = 200;
/** Seuil de l'alpha au-delà duquel un pixel est de l'encre. */
const ALPHA_THRESHOLD = 128;

/** Charge `bytes` (fichier .ttf) sous le nom `family` et l'ajoute aux polices du document. */
export async function loadFontFace(family: string, bytes: Uint8Array): Promise<void> {
  const face = new FontFace(family, bytes.slice().buffer);
  await face.load();
  document.fonts.add(face);
}

/** Taille em (px CSS) d'une hauteur `LOGFONT`, `cell` étant la hauteur de cellule de la police à `REFERENCE_SIZE`. */
export function emSize(height: number, cell: number): number {
  if (height < 0) return -height;
  if (height === 0) return 12;
  return (height * REFERENCE_SIZE) / cell;
}

/** Seuille un tampon RGBA (alpha) en octets 0/1. */
export function thresholdAlpha(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const bits = new Uint8Array(width * height);
  for (let i = 0; i < bits.length; i++) bits[i] = rgba[i * 4 + 3]! >= ALPHA_THRESHOLD ? 1 : 0;
  return bits;
}

/** `HostText` sur un canvas 2D. La police doit déjà être chargée (`loadFontFace`). */
export class CanvasText implements HostText {
  private readonly context: CanvasRenderingContext2D;
  private readonly sizes = new Map<string, number>();

  constructor() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas 2D indisponible");
    this.context = context;
  }

  metrics(font: HostFontSpec): HostTextMetrics {
    const context = this.use(font);
    const measured = context.measureText("Hg");
    const ascent = Math.round(measured.fontBoundingBoxAscent);
    const descent = Math.round(measured.fontBoundingBoxDescent);
    return { ascent, descent, lineHeight: ascent + descent };
  }

  measure(font: HostFontSpec, text: string): number {
    return Math.round(this.use(font).measureText(text).width);
  }

  rasterize(font: HostFontSpec, text: string): TextMask {
    const { ascent, lineHeight } = this.metrics(font);
    const width = this.measure(font, text);
    if (width <= 0 || lineHeight <= 0) return { width: 0, height: lineHeight, ascent, bits: new Uint8Array(0) };
    // Marge à droite : une graisse qui déborde de l'avance ne doit pas être coupée.
    const margin = Math.ceil(lineHeight / 4);
    const full = width + margin;
    const { canvas } = this.context;
    canvas.width = full;
    canvas.height = lineHeight;
    // Redimensionner réinitialise le contexte : on réapplique la police.
    const context = this.use(font);
    context.clearRect(0, 0, full, lineHeight);
    context.fillStyle = "#000";
    context.textBaseline = "alphabetic";
    context.fillText(text, 0, ascent);
    const bits = thresholdAlpha(context.getImageData(0, 0, full, lineHeight).data, full, lineHeight);
    return { width: full, height: lineHeight, ascent, bits };
  }

  /** Applique la police au contexte et le renvoie. */
  private use(font: HostFontSpec): CanvasRenderingContext2D {
    const context = this.context;
    context.font = `${this.size(font)}px "${font.family}"`;
    context.fontKerning = "none";
    context.textRendering = "optimizeSpeed";
    return context;
  }

  private size(font: HostFontSpec): number {
    const key = `${font.family}/${font.height}`;
    let size = this.sizes.get(key);
    if (size === undefined) {
      let cell = REFERENCE_SIZE;
      if (font.height > 0) {
        this.context.font = `${REFERENCE_SIZE}px "${font.family}"`;
        const measured = this.context.measureText("Hg");
        cell = measured.fontBoundingBoxAscent + measured.fontBoundingBoxDescent || REFERENCE_SIZE;
      }
      size = emSize(font.height, cell);
      this.sizes.set(key, size);
    }
    return size;
  }
}
