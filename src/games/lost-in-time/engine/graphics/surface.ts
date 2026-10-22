import type { IndexedSurface } from "../../data/surface";

/**
 * Surface 8 bits indexée (Surface de ScummVM, sans les modes haute couleur).
 * Les opérations suivent celles du moteur d'origine, y compris leurs particularités de découpage.
 */
export class Surface implements IndexedSurface {
  width: number;
  height: number;
  pixels: Uint8Array;

  constructor(width: number, height: number, pixels?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.pixels = pixels ?? new Uint8Array(width * height);
  }

  /** Surface de sprite : la largeur est arrondie au multiple de 8 supérieur (Video::initSurfDesc). */
  static sprite(width: number, height: number): Surface {
    return new Surface((width + 7) & ~7, height);
  }

  /** Redimensionne en effaçant le contenu (Surface::resize). */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  clear(): void {
    this.pixels.fill(0);
  }

  putPixel(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y * this.width + x] = color;
  }

  /** Remplit un rectangle (bornes incluses) ; les bornes sont ramenées dans la surface comme l'original. */
  fillRect(left: number, top: number, right: number, bottom: number, color: number): void {
    if (left > right) [left, right] = [right, left];
    if (top > bottom) [top, bottom] = [bottom, top];
    if (left >= this.width || top >= this.height) return;
    left = clamp(left, 0, this.width - 1);
    top = clamp(top, 0, this.height - 1);
    right = clamp(right, 0, this.width - 1);
    bottom = clamp(bottom, 0, this.height - 1);
    const width = right - left + 1;
    if (width <= 0 || bottom < top) return;
    for (let y = top; y <= bottom; y++) {
      const start = y * this.width + left;
      this.pixels.fill(color, start, start + width);
    }
  }

  /** Ligne de Bresenham, bornes incluses. */
  drawLine(x0: number, y0: number, x1: number, y1: number, color: number): void {
    if (x0 === x1 && y0 === y1) {
      this.putPixel(x0, y0, color);
      return;
    }
    if (x0 === x1) {
      this.fillRect(x0, Math.min(y0, y1), x0, Math.max(y0, y1), color);
      return;
    }
    if (y0 === y1) {
      this.fillRect(Math.min(x0, x1), y0, Math.max(x0, x1), y0, color);
      return;
    }
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.putPixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Cercle (Surface::drawCircle avec le motif 0 : contour d'un pixel). */
  drawCircle(x0: number, y0: number, radius: number, color: number): void {
    let f = 1 - radius;
    let ddFx = 0;
    let ddFy = -2 * radius;
    let x = 0;
    let y = radius;
    this.putPixel(x0, y0 + radius, color);
    this.putPixel(x0, y0 - radius, color);
    this.putPixel(x0 + radius, y0, color);
    this.putPixel(x0 - radius, y0, color);
    while (x < y) {
      if (f >= 0) {
        y--;
        ddFy += 2;
        f += ddFy;
      }
      x++;
      ddFx += 2;
      f += ddFx + 1;
      this.putPixel(x0 + x, y0 + y, color);
      this.putPixel(x0 - x, y0 + y, color);
      this.putPixel(x0 + x, y0 - y, color);
      this.putPixel(x0 - x, y0 - y, color);
      this.putPixel(x0 + y, y0 + x, color);
      this.putPixel(x0 - y, y0 + x, color);
      this.putPixel(x0 + y, y0 - x, color);
      this.putPixel(x0 - y, y0 - x, color);
    }
  }

  /**
   * Copie un rectangle de `from` (bornes incluses) en (x, y). `transp` = indice transparent (-1 : aucun),
   * `mirror` : miroir horizontal. Découpage identique à Surface::clipBlitRect.
   */
  blit(
    from: Surface,
    left: number,
    top: number,
    right: number,
    bottom: number,
    x: number,
    y: number,
    transp = -1,
    mirror = false,
  ): void {
    const dWidth = this.width;
    const dHeight = this.height;
    const sWidth = from.width;
    const sHeight = from.height;

    if (x >= dWidth || y >= dHeight) return;
    if (left > right) [left, right] = [right, left];
    if (top > bottom) [top, bottom] = [bottom, top];
    if (left >= sWidth || top >= sHeight || right < 0 || bottom < 0) return;

    if (left < 0) {
      x -= left;
      left = 0;
    }
    if (top < 0) {
      y -= top;
      top = 0;
    }
    if (x < 0) {
      left -= x;
      x = 0;
    }
    if (y < 0) {
      top -= y;
      y = 0;
    }
    right = Math.min(right, Math.min(sWidth, dWidth - x + left) - 1);
    bottom = Math.min(bottom, Math.min(sHeight, dHeight - y + top) - 1);
    if (right < left || bottom < top) return;
    right = Math.max(right, 0);
    bottom = Math.max(bottom, 0);

    const width = right - left + 1;
    const height = bottom - top + 1;
    if (width <= 0 || height <= 0) return;

    const src = from.pixels;
    const dst = this.pixels;
    const plain = transp === -1 && !mirror;
    // Même mémoire : on copie dans l'ordre qui évite d'écraser la source (memmove).
    const backwards = from === this && y > top;
    for (let j = 0; j < height; j++) {
      const row = backwards ? height - 1 - j : j;
      const s = (top + row) * sWidth + left;
      const d = (y + row) * dWidth + x;
      if (plain) {
        if (from === this) dst.copyWithin(d, s, s + width);
        else dst.set(src.subarray(s, s + width), d);
        continue;
      }
      if (from === this && transp !== -1) {
        // Source et destination confondues avec transparence : passe par une copie de la ligne.
        const line = src.slice(s, s + width);
        for (let i = 0; i < width; i++) {
          const p = line[mirror ? width - 1 - i : i];
          if (p !== transp) dst[d + i] = p;
        }
        continue;
      }
      for (let i = 0; i < width; i++) {
        const p = src[s + (mirror ? width - 1 - i : i)];
        if (p !== transp) dst[d + i] = p;
      }
    }
  }

  /** Copie toute la surface source en (0, 0). */
  blitAll(from: Surface): void {
    this.blit(from, 0, 0, from.width - 1, from.height - 1, 0, 0);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
