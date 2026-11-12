/**
 * Surface indexée (`Surface`, engines/lure/surface.cpp et surface.h, ScummVM, GPL v3+) : un tampon d'indices `largeur x hauteur`, les copies
 * de rectangles avec ou sans couleur transparente et le remplissage. Le texte est dans `text.ts`, les boîtes dans `dialog.ts`.
 *
 * Écarts volontaires : toute lecture ou écriture hors de la surface est ignorée (en C++ elle déborde en mémoire) ; la copie d'un rectangle
 * lit une ligne source au-delà de la dernière colonne comme ScummVM (les octets de la ligne suivante), mais jamais au-delà du tampon.
 */

/** Rectangle à bornes comprises (`Common::Rect` tel que Lure l'emploie : `right` et `bottom` sont inclus). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class Surface {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8Array,
  ) {
    if (data && data.length !== width * height) throw new Error("surface : la taille des données ne correspond pas aux dimensions");
    this.data = data ?? new Uint8Array(width * height);
  }

  /** `Surface::empty`. */
  empty(): void {
    this.data.fill(0);
  }

  /** `Surface::fillRect` (bornes comprises, rognée à la surface). */
  fillRect(r: Rect, color: number): void {
    for (let y = Math.max(0, r.top); y <= Math.min(this.height - 1, r.bottom); y++) {
      const from = Math.max(0, r.left);
      const to = Math.min(this.width - 1, r.right);
      if (to >= from) this.data.fill(color, y * this.width + from, y * this.width + to + 1);
    }
  }

  /**
   * `Surface::copyTo(dest, srcBounds, destX, destY, transparentColor)` : copie le rectangle `src` de cette surface en (`destX`, `destY`) ;
   * avec `transparent` (>= 0), les pixels égaux à cette valeur ne sont pas copiés.
   */
  copyRectTo(dest: Surface, src: Rect, destX: number, destY: number, transparent = -1): void {
    let numBytes = src.right - src.left + 1;
    if (destX + numBytes > dest.width) numBytes = dest.width - destX;
    if (numBytes <= 0) return;
    for (let y = 0; y <= src.bottom - src.top; y++) {
      const dy = destY + y;
      if (dy < 0 || dy >= dest.height) continue;
      const srcPos = (src.top + y) * this.width + src.left;
      const destPos = dy * dest.width + destX;
      for (let x = 0; x < numBytes; x++) {
        const pixel = this.data[srcPos + x];
        if (pixel === undefined || srcPos + x < 0) continue;
        if (transparent >= 0 && pixel === transparent) continue;
        dest.data[destPos + x] = pixel;
      }
    }
  }

  /** `Surface::copyTo(dest, x, y)` : la surface entière en (`x`, `y`). */
  copyTo(dest: Surface, x: number, y: number): void {
    this.copyRectTo(dest, { left: 0, top: 0, right: this.width - 1, bottom: this.height - 1 }, x, y);
  }

  /** `Surface::transparentCopyTo` : copie les pixels non nuls d'une surface de même largeur. */
  transparentCopyTo(dest: Surface): void {
    if (dest.width !== this.width) throw new Error("copie transparente : largeurs différentes");
    const count = Math.min(this.height, dest.height) * this.width;
    for (let i = 0; i < count; i++) if (this.data[i] !== 0) dest.data[i] = this.data[i]!;
  }

  /** Pixel en (`x`, `y`), 0 hors de la surface. */
  at(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? 0 : this.data[y * this.width + x]!;
  }
}
