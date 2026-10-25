import { makeCanvas, paintIndexed, paletteToLut } from "../../../ui/indexed-canvas";
import type { Bounds, PlacedImage } from "../engine/sprites";

/** Palette de niveaux de gris (index = intensité), utilisée quand le jeu n'a pas de palette. */
const GRAY_PALETTE = Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));

/** Palette 768 octets RGB 8 bits (ou niveaux de gris si absente) -> table de 256 couleurs RGBA. L'index 0 est transparent si demandé. */
export function paletteTable(palette: Uint8Array | null, transparentZero: boolean): Uint32Array {
  const table = paletteToLut(palette ?? GRAY_PALETTE);
  if (transparentZero) table[0] = 0;
  return table;
}

export { makeCanvas, paintIndexed };

export function indexedCanvas(
  pixels: Uint8Array,
  width: number,
  height: number,
  table: Uint32Array,
  scale = 1,
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height, scale);
  paintIndexed(canvas, pixels, width, height, table);
  return canvas;
}

/** Dessine des images posées dans un tampon RGBA ; l'origine du tampon est (-bounds.minX, -bounds.minY). */
export function paintPlaced(canvas: HTMLCanvasElement, placed: PlacedImage[], bounds: Bounds, table: Uint32Array): void {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(width, height);
  const out = new Uint32Array(data.data.buffer);
  for (const { image, left, top, mirror } of placed) {
    for (let y = 0; y < image.height; y++) {
      const dy = top + y - bounds.minY;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < image.width; x++) {
        const value = image.pixels[y * image.width + (mirror ? image.width - 1 - x : x)];
        if (value === 0) continue;
        const dx = left + x - bounds.minX;
        if (dx >= 0 && dx < width) out[dy * width + dx] = table[value];
      }
    }
  }
  ctx.putImageData(data, 0, 0);
}
