/**
 * Plan d'image 320 x 200 en pixels indexés : les « surfaces » de ScummVM (`bgSurface`, `frontSurface`, `screenSurface`…,
 * engines/drascula/drascula.h) et leurs copies (`copyBackground`, `copyRect`, `reduce_hare_chico`, graphics.cpp / drascula.cpp).
 *
 * Écarts : ScummVM écrit sans contrôle dans `copyBackground` (et lit hors du tampon dans `reduce_hare_chico`, qui `assert`) ;
 * ici toutes les copies sont rognées aux deux plans, sans erreur. `copyRect` ignore l'indice 255 (transparent), comme l'original.
 */

export const WIDTH = 320;
export const HEIGHT = 200;
export const PIXELS = WIDTH * HEIGHT;
/** Indice transparent des feuilles de sprites et de glyphes (`copyRect`). */
export const TRANSPARENT = 255;

const f32 = Math.fround;

export class Plane {
  readonly pixels: Uint8Array;

  constructor(pixels?: Uint8Array) {
    if (pixels && pixels.length !== PIXELS) throw new RangeError(`plan de ${pixels.length} pixels (attendu ${PIXELS})`);
    this.pixels = pixels ?? new Uint8Array(PIXELS);
  }

  /** Remplace le contenu par celui de `source` (chargement d'une image dans la surface). */
  load(source: Uint8Array): void {
    this.pixels.set(source);
  }

  clear(value = 0): void {
    this.pixels.fill(value);
  }

  /** Lecture rognée : indice 255 hors du plan (transparent). */
  at(x: number, y: number): number {
    return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT ? this.pixels[y * WIDTH + x] : TRANSPARENT;
  }

  /** `copyBackground(xorg, yorg, xdes, ydes, width, height, src, dest)` : copie opaque d'un rectangle. */
  copyBackground(src: Plane, xorg: number, yorg: number, xdes: number, ydes: number, width: number, height: number): void {
    this.copy(src, xorg, yorg, xdes, ydes, width, height, false);
  }

  /** `copyRect(...)` : copie d'un rectangle sans les pixels transparents (255). */
  copyRect(src: Plane, xorg: number, yorg: number, xdes: number, ydes: number, width: number, height: number): void {
    this.copy(src, xorg, yorg, xdes, ydes, width, height, true);
  }

  private copy(src: Plane, xorg: number, yorg: number, xdes: number, ydes: number, width: number, height: number, transparent: boolean): void {
    // Rognage au plan de destination (comme `copyRect` de ScummVM), puis au plan source.
    if (xdes < 0) {
      xorg -= xdes;
      width += xdes;
      xdes = 0;
    }
    if (ydes < 0) {
      yorg -= ydes;
      height += ydes;
      ydes = 0;
    }
    if (xorg < 0) {
      xdes -= xorg;
      width += xorg;
      xorg = 0;
    }
    if (yorg < 0) {
      ydes -= yorg;
      height += yorg;
      yorg = 0;
    }
    width = Math.min(width, WIDTH - xdes, WIDTH - xorg);
    height = Math.min(height, HEIGHT - ydes, HEIGHT - yorg);
    if (width <= 0 || height <= 0) return;
    for (let y = 0; y < height; y++) {
      const from = (yorg + y) * WIDTH + xorg;
      const to = (ydes + y) * WIDTH + xdes;
      if (!transparent) {
        this.pixels.set(src.pixels.subarray(from, from + width), to);
      } else {
        for (let x = 0; x < width; x++) {
          const value = src.pixels[from + x];
          if (value !== TRANSPARENT) this.pixels[to + x] = value;
        }
      }
    }
  }

  /**
   * `reduce_hare_chico(xx1, yy1, xx2, yy2, width, height, factor, src, dest)` : le rectangle source de `width` x `height`
   * est recopié en `(width * factor / 100)` x `(height * factor / 100)` (divisions entières) au point `(xx2, yy2)`, par
   * prélèvement d'un pixel sur `width / newWidth` (plus proche voisin, pas en `float` 32 bits comme l'original) ; 255 transparent.
   * Rend la taille réduite : l'original la garde dans `newWidth` et `newHeight`.
   */
  reduce(src: Plane, xx1: number, yy1: number, xx2: number, yy2: number, width: number, height: number, factor: number): { width: number; height: number } {
    const newWidth = Math.trunc((width * factor) / 100);
    const newHeight = Math.trunc((height * factor) / 100);
    if (newWidth <= 0 || newHeight <= 0) return { width: Math.max(newWidth, 0), height: Math.max(newHeight, 0) };
    const stepX = f32(width / newWidth);
    const stepY = f32(height / newHeight);
    let pixelY = f32(yy1);
    for (let n = 0; n < newHeight; n++) {
      let pixelX = f32(xx1);
      const y = yy2 + n;
      for (let m = 0; m < newWidth; m++) {
        const x = xx2 + m;
        const value = src.at(Math.trunc(pixelX), Math.trunc(pixelY));
        if (value !== TRANSPARENT && x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) this.pixels[y * WIDTH + x] = value;
        pixelX = f32(pixelX + stepX);
      }
      pixelY = f32(pixelY + stepY);
    }
    return { width: newWidth, height: newHeight };
  }
}
