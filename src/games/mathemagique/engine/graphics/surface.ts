/**
 * Surface indexée (8 bits, un octet = un index de palette) : port de travail de 576×432 de l'original (`docs/mathemagique/engine.md` §4.2).
 *
 * Tout le dessin (`blit.ts`, `text.ts`) passe par `clipSpan` / `visible` : rectangle de découpe courant (pile `pushClip` / `popClip`,
 * équivalent de `e2ClipRect`) **et**, en plus, un masque facultatif (union de rectangles, voir `ClipMask`) pour les zones non
 * rectangulaires de Hidden. Les rectangles sont `{ x, y, w, h }` (origine + taille).
 */
import { PLAY_HEIGHT, PLAY_WIDTH } from "./frame";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Intersection de deux rectangles (largeur ou hauteur 0 si disjoints). */
export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * Masque de découpe : union de rectangles, rendue en bitmap (un octet par pixel de la surface) pour un test en O(1).
 * Sert à restreindre le dessin à un ensemble de cellules (Hidden, `docs/mathemagique/screens/hidden.md`).
 */
export class ClipMask {
  private readonly bits: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    rects: readonly Rect[],
  ) {
    this.bits = new Uint8Array(width * height);
    for (const rect of rects) {
      const r = intersectRect(rect, { x: 0, y: 0, w: width, h: height });
      for (let y = r.y; y < r.y + r.h; y++) this.bits.fill(1, y * width + r.x, y * width + r.x + r.w);
    }
  }

  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.bits[y * this.width + x] === 1;
  }
}

/** Zone sauvegardée par `Surface.saveRect` (équivalent de `e2SaveRect`). */
export interface SavedRect {
  rect: Rect;
  pixels: Uint8Array;
}

export class Surface {
  readonly pixels: Uint8Array;
  private readonly clips: Rect[] = [];
  private current: Rect;
  private maskValue: ClipMask | null = null;

  constructor(
    readonly width = PLAY_WIDTH,
    readonly height = PLAY_HEIGHT,
  ) {
    this.pixels = new Uint8Array(width * height);
    this.current = { x: 0, y: 0, w: width, h: height };
  }

  /** Rectangle de découpe courant (toujours inclus dans la surface). */
  get clip(): Rect {
    return this.current;
  }

  /** Restreint la découpe à l'intersection avec `rect`. À équilibrer par `popClip`. */
  pushClip(rect: Rect): void {
    this.clips.push(this.current);
    this.current = intersectRect(this.current, rect);
  }

  popClip(): void {
    const previous = this.clips.pop();
    if (!previous) throw new Error("Surface : popClip sans pushClip");
    this.current = previous;
  }

  /** Masque de découpe en plus du rectangle (`null` pour le retirer). Indépendant de la pile. */
  get mask(): ClipMask | null {
    return this.maskValue;
  }

  set mask(mask: ClipMask | null) {
    this.maskValue = mask;
  }

  /** Le pixel (x, y) est-il dessinable (surface, rectangle de découpe et masque) ? */
  visible(x: number, y: number): boolean {
    const c = this.current;
    return x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h && (this.maskValue === null || this.maskValue.contains(x, y));
  }

  /** Portion `[from, to)` de la ligne `y` dans le rectangle de découpe (vide si `from >= to`) ; le masque reste à tester pixel par pixel. */
  clipSpan(y: number, x: number, w: number): { from: number; to: number } {
    const c = this.current;
    if (y < c.y || y >= c.y + c.h) return { from: 0, to: 0 };
    return { from: Math.max(x, c.x), to: Math.min(x + w, c.x + c.w) };
  }

  get(x: number, y: number): number {
    return this.pixels[y * this.width + x]!;
  }

  /** Remplit `rect` (toute la surface par défaut) d'un index, découpe appliquée. */
  fill(color: number, rect: Rect = { x: 0, y: 0, w: this.width, h: this.height }): void {
    const r = intersectRect(rect, this.current);
    for (let y = r.y; y < r.y + r.h; y++) {
      if (this.maskValue === null) {
        this.pixels.fill(color, y * this.width + r.x, y * this.width + r.x + r.w);
      } else {
        for (let x = r.x; x < r.x + r.w; x++) if (this.maskValue.contains(x, y)) this.pixels[y * this.width + x] = color;
      }
    }
  }

  /**
   * Copie `src` (rectangle `srcRect`, toute la source par défaut) vers cette surface à `(dx, dy)`, découpe appliquée.
   * `transparent` : les octets source à 0 ne sont pas copiés (mode 8 de l'original).
   */
  copyFrom(src: Surface, srcRect: Rect = { x: 0, y: 0, w: src.width, h: src.height }, dx = srcRect.x, dy = srcRect.y, transparent = false): void {
    const s = intersectRect(srcRect, { x: 0, y: 0, w: src.width, h: src.height });
    // Le rectangle source rogné décale la destination d'autant.
    const ox = dx + (s.x - srcRect.x);
    const oy = dy + (s.y - srcRect.y);
    for (let row = 0; row < s.h; row++) {
      const y = oy + row;
      const { from, to } = this.clipSpan(y, ox, s.w);
      for (let x = from; x < to; x++) {
        if (this.maskValue !== null && !this.maskValue.contains(x, y)) continue;
        const v = src.pixels[(s.y + row) * src.width + s.x + (x - ox)]!;
        if (transparent && v === 0) continue;
        this.pixels[y * this.width + x] = v;
      }
    }
  }

  /** Sauvegarde le rectangle (rogné à la surface, sans tenir compte de la découpe). */
  saveRect(rect: Rect): SavedRect {
    const r = intersectRect(rect, { x: 0, y: 0, w: this.width, h: this.height });
    const pixels = new Uint8Array(r.w * r.h);
    for (let row = 0; row < r.h; row++) {
      const from = (r.y + row) * this.width + r.x;
      pixels.set(this.pixels.subarray(from, from + r.w), row * r.w);
    }
    return { rect: r, pixels };
  }

  /** Réécrit une zone sauvegardée (sans découpe : c'est une restauration exacte). */
  restoreRect(saved: SavedRect): void {
    const { rect, pixels } = saved;
    for (let row = 0; row < rect.h; row++) {
      this.pixels.set(pixels.subarray(row * rect.w, (row + 1) * rect.w), (rect.y + row) * this.width + rect.x);
    }
  }
}
