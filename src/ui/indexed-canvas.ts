/**
 * Images indexées 256 couleurs (palettes VGA) vers canvas : conversion de palette, table de couleurs RGBA, peinture et présentation.
 * Code navigateur uniquement pour `makeCanvas` ; le reste ne dépend que d'un contexte 2D (`createImageData` / `putImageData`).
 */

export const PALETTE_ENTRIES = 256;
export const PALETTE_BYTES = PALETTE_ENTRIES * 3;

/** Boutisme de la machine : l'ordre des octets d'un `Uint32` dans un `ImageData` en dépend. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Palette VGA 6 bits (0..63) -> RGB 8 bits, 768 octets : `v << 2 | v >> 4` (63 -> 255). */
export function vga6ToRgb8(palette6: Uint8Array): Uint8Array {
  const rgb = new Uint8Array(PALETTE_BYTES);
  for (let i = 0; i < PALETTE_BYTES; i++) {
    const v = palette6[i] & 0x3f;
    rgb[i] = (v << 2) | (v >> 4);
  }
  return rgb;
}

/** Palette RGB 8 bits (768 octets) -> table de 256 couleurs opaques, écrites dans l'ordre mémoire RGBA d'un `Uint32Array` d'`ImageData`. */
export function paletteToLut(rgb768: Uint8Array): Uint32Array {
  const lut = new Uint32Array(PALETTE_ENTRIES);
  for (let i = 0; i < PALETTE_ENTRIES; i++) {
    const r = rgb768[i * 3];
    const g = rgb768[i * 3 + 1];
    const b = rgb768[i * 3 + 2];
    lut[i] = LITTLE_ENDIAN ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
  }
  return lut;
}

export function makeCanvas(width: number, height: number, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  return canvas;
}

export interface PaintOptions {
  /** Index rendu transparent (pixel `0x00000000`) ; absent = aucun. */
  transparent?: number;
  /** Position du coin haut-gauche de l'image dans le canvas (0 par défaut). */
  originX?: number;
  originY?: number;
}

/** Contexte 2D minimal nécessaire à la peinture (facilite les tests hors navigateur). */
export type IndexedContext = Pick<CanvasRenderingContext2D, "createImageData" | "putImageData">;

function toLut(palette: Uint8Array | Uint32Array): Uint32Array {
  return palette instanceof Uint32Array ? palette : paletteToLut(palette);
}

/** Copie `pixels` à travers `lut` dans `out` (une entrée de `out` par pixel). */
function fill(out: Uint32Array, pixels: Uint8Array, lut: Uint32Array, transparent: number | undefined): void {
  if (transparent === undefined) {
    for (let i = 0; i < out.length; i++) out[i] = lut[pixels[i]];
  } else {
    for (let i = 0; i < out.length; i++) {
      const index = pixels[i];
      out[i] = index === transparent ? 0 : lut[index];
    }
  }
}

/** Peint des pixels indexés (`width` x `height`) dans un canvas ou un contexte, via une table RGBA ou une palette RGB 768 octets. */
export function paintIndexed(
  target: HTMLCanvasElement | IndexedContext,
  pixels: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array | Uint32Array,
  options: PaintOptions = {},
): void {
  const ctx: IndexedContext = "getContext" in target ? target.getContext("2d")! : target;
  const image = ctx.createImageData(width, height);
  const out = new Uint32Array(image.data.buffer);
  fill(out.subarray(0, width * height), pixels, toLut(palette), options.transparent);
  ctx.putImageData(image, options.originX ?? 0, options.originY ?? 0);
}

/** Présente des images indexées dans un canvas en réutilisant un seul `ImageData` ; `origin` décale la zone dessinée (bordure fixe autour). */
export class IndexedPresenter {
  private readonly context: IndexedContext;
  private readonly image: ImageData;
  private readonly out: Uint32Array;

  constructor(
    context: IndexedContext,
    readonly width: number,
    readonly height: number,
    readonly originX = 0,
    readonly originY = 0,
  ) {
    this.context = context;
    this.image = context.createImageData(width, height);
    this.out = new Uint32Array(this.image.data.buffer);
  }

  /** Construit le présentateur d'un canvas (contexte opaque) ; le canvas garde la taille fournie. */
  static forCanvas(canvas: HTMLCanvasElement, width: number, height: number, originX = 0, originY = 0): IndexedPresenter {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D indisponible");
    return new IndexedPresenter(context, width, height, originX, originY);
  }

  /** Convertit les indices via la palette (RGB 768 octets ou table RGBA) et dessine l'image. */
  present(pixels: Uint8Array, palette: Uint8Array | Uint32Array, transparent?: number): void {
    fill(this.out, pixels, toLut(palette), transparent);
    this.context.putImageData(this.image, this.originX, this.originY);
  }
}
