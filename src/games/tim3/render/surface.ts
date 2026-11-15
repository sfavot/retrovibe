/**
 * Surface 8 bits indexée : le tampon sur lequel le jeu d'origine dessine (WinG, `GFXDevWinG`) et que le port convertit en RGBA.
 * Les primitives reprennent celles de TIMWIN.EXE : remplissage et contour de rectangle (457d18), ligne (4570c8, Bresenham),
 * copie d'image avec retournements (456270 → 4555c8). Le rectangle de découpage (« clip », 0x490f18 … 0x490f24 dans l'exe)
 * s'applique à tout. Aucune dépendance au navigateur : les tests composent des images en mémoire.
 */

/** Image indexée source (une image d'un BMP). */
export interface IndexedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface Clip {
  /** Bornes incluses à gauche et en haut, exclues à droite et en bas. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Index de palette transparent des sprites (`docs/tim3/formats.md` § 4). */
export const TRANSPARENT = 0;

export class Surface {
  readonly pixels: Uint8Array;
  readonly clip: Clip;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height);
    this.clip = { x0: 0, y0: 0, x1: width, y1: height };
  }

  /** Nouveau rectangle de découpage, ramené à la surface ; renvoie l'ancien pour le rétablir. */
  setClip(x: number, y: number, w: number, h: number): Clip {
    const old = { ...this.clip };
    this.clip.x0 = Math.max(0, x);
    this.clip.y0 = Math.max(0, y);
    this.clip.x1 = Math.min(this.width, x + w);
    this.clip.y1 = Math.min(this.height, y + h);
    return old;
  }

  restoreClip(clip: Clip): void {
    Object.assign(this.clip, clip);
  }

  clear(color = 0): void {
    this.pixels.fill(color);
  }

  plot(x: number, y: number, color: number): void {
    const c = this.clip;
    if (x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1) this.pixels[y * this.width + x] = color;
  }

  /** Rectangle plein de (x, y) à (x + w − 1, y + h − 1). */
  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    const c = this.clip;
    const xa = Math.max(x, c.x0);
    const xb = Math.min(x + w, c.x1);
    const ya = Math.max(y, c.y0);
    const yb = Math.min(y + h, c.y1);
    for (let yy = ya; yy < yb; yy++) this.pixels.fill(color, yy * this.width + xa, yy * this.width + xb);
  }

  /** Contour d'un rectangle (mêmes bornes que `fillRect`). */
  strokeRect(x: number, y: number, w: number, h: number, color: number): void {
    if (w <= 0 || h <= 0) return;
    this.fillRect(x, y, w, 1, color);
    this.fillRect(x, y + h - 1, w, 1, color);
    this.fillRect(x, y, 1, h, color);
    this.fillRect(x + w - 1, y, 1, h, color);
  }

  /** Ligne de Bresenham, extrémités comprises. */
  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    // Extrémités entières : avec une valeur fractionnaire, la condition d'arrêt ne serait jamais atteinte.
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
    x1 = Math.floor(x1);
    y1 = Math.floor(y1);
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.plot(x, y, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Copie une image à (x, y). `flipX` : miroir gauche-droite, `flipY` : haut-bas, dans le rectangle de l'image.
   * L'index 0 est transparent sauf si `opaque`.
   */
  blit(src: IndexedImage, x: number, y: number, flipX = false, flipY = false, opaque = false): void {
    const c = this.clip;
    const { width: sw, height: sh, pixels: sp } = src;
    const ya = Math.max(y, c.y0);
    const yb = Math.min(y + sh, c.y1);
    const xa = Math.max(x, c.x0);
    const xb = Math.min(x + sw, c.x1);
    for (let yy = ya; yy < yb; yy++) {
      const sy = flipY ? sh - 1 - (yy - y) : yy - y;
      const row = sy * sw;
      const out = yy * this.width;
      for (let xx = xa; xx < xb; xx++) {
        const v = sp[row + (flipX ? sw - 1 - (xx - x) : xx - x)]!;
        if (opaque || v !== TRANSPARENT) this.pixels[out + xx] = v;
      }
    }
  }

  /** Copie une zone d'une autre surface (sans transparence). */
  copyFrom(src: Surface, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tx = dx + x;
        const ty = dy + y;
        const fx = sx + x;
        const fy = sy + y;
        if (fx < 0 || fy < 0 || fx >= src.width || fy >= src.height) continue;
        this.plot(tx, ty, src.pixels[fy * src.width + fx]!);
      }
    }
  }

  /** Remplace chaque pixel non transparent du rectangle par `table[pixel]` (bouton grisé, `RenderAssets.fadeTable`). */
  remap(x: number, y: number, w: number, h: number, table: Uint8Array): void {
    const c = this.clip;
    const x0 = Math.max(x, c.x0);
    const y0 = Math.max(y, c.y0);
    const x1 = Math.min(x + w, c.x1);
    const y1 = Math.min(y + h, c.y1);
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const i = ty * this.width + tx;
        const v = this.pixels[i]!;
        if (v !== TRANSPARENT) this.pixels[i] = table[v]!;
      }
    }
  }

  /** Conversion en RGBA : `lut` donne un pixel RGBA (ordre mémoire) par index ; avec `readPalette`, l'index 0 est transparent. */
  toRgba(lut: Uint32Array, out = new Uint32Array(this.width * this.height)): Uint32Array {
    const p = this.pixels;
    for (let i = 0; i < p.length; i++) out[i] = lut[p[i]!]!;
    return out;
  }
}
