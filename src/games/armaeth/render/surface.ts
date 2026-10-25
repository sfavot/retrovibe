/** Taille de l'écran VGA en mode 13h : fenêtre de dessin du pilote (`CS:04FC/04FE` de `VGA.EXE`). */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/** Rectangle en pixels (`x`, `y` = coin haut gauche). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rectangle rogné à `width x height` ; `null` s'il ne reste rien. */
export function clipRect(
  rect: Rect,
  width = SCREEN_WIDTH,
  height = SCREEN_HEIGHT,
): Rect | null {
  const x0 = Math.max(rect.x, 0);
  const y0 = Math.max(rect.y, 0);
  const x1 = Math.min(rect.x + rect.width, width);
  const y1 = Math.min(rect.y + rect.height, height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Page de 320 x 200 pixels indexés avec son plan de priorité (le « plan de profondeur » que le moteur fournit au
 * pilote, `vga_set_depth_buffer` `+0x4e`). Les pages du pilote (A000 et tampon d'arrière-plan) n'ont pas de plan
 * de priorité propre : seule la page d'arrière-plan en a un, `priority` ne sert donc qu'à elle.
 */
export class Surface {
  readonly pixels: Uint8Array;
  readonly priority: Uint8Array;

  constructor(
    readonly width = SCREEN_WIDTH,
    readonly height = SCREEN_HEIGHT,
  ) {
    this.pixels = new Uint8Array(width * height);
    this.priority = new Uint8Array(width * height);
  }

  /** Remet pixels et priorités à `color` et `priority`. */
  clear(color = 0, priority = 0): void {
    this.pixels.fill(color);
    this.priority.fill(priority);
  }

  /** Remplit un rectangle (rogné) ; la priorité n'est touchée que si `priority` est donnée. */
  fillRect(rect: Rect, color: number, priority?: number): void {
    const r = clipRect(rect, this.width, this.height);
    if (!r) return;
    for (let y = r.y; y < r.y + r.height; y++) {
      const row = y * this.width;
      this.pixels.fill(color, row + r.x, row + r.x + r.width);
      if (priority !== undefined)
        this.priority.fill(priority, row + r.x, row + r.x + r.width);
    }
  }

  /** Écrit un pixel s'il est dans la page (rogne sans rien dire, comme tout le dessin). */
  setPixel(x: number, y: number, color: number): void {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height)
      this.pixels[y * this.width + x] = color;
  }

  /** Lecture d'un rectangle entièrement dans la page (`vga_read_rect`, `+0x42`) : `width * height` pixels, ligne par ligne. */
  readRect(rect: Rect): Uint8Array {
    this.assertInside(rect);
    const out = new Uint8Array(rect.width * rect.height);
    for (let y = 0; y < rect.height; y++) {
      const from = (rect.y + y) * this.width + rect.x;
      out.set(this.pixels.subarray(from, from + rect.width), y * rect.width);
    }
    return out;
  }

  /** Écriture d'un rectangle entièrement dans la page (`vga_write_rect`, `+0x3e`). Si `priority` est donné, il remplace le plan de priorité du même rectangle. */
  writeRect(rect: Rect, data: Uint8Array, priority?: Uint8Array): void {
    this.assertInside(rect);
    if (
      data.length !== rect.width * rect.height ||
      (priority && priority.length !== data.length)
    )
      throw new RangeError("writeRect : taille de données incohérente");
    for (let y = 0; y < rect.height; y++) {
      const to = (rect.y + y) * this.width + rect.x;
      const line = data.subarray(y * rect.width, (y + 1) * rect.width);
      this.pixels.set(line, to);
      if (priority)
        this.priority.set(
          priority.subarray(y * rect.width, (y + 1) * rect.width),
          to,
        );
    }
  }

  /** Copie du rectangle (rogné) d'une autre page à la même position (`vga_copy_rect`, `+0x32`). */
  copyRect(from: Surface, rect: Rect, withPriority = false): void {
    const r = clipRect(rect, this.width, this.height);
    if (!r) return;
    for (let y = r.y; y < r.y + r.height; y++) {
      const at = y * this.width + r.x;
      this.pixels.set(from.pixels.subarray(at, at + r.width), at);
      if (withPriority)
        this.priority.set(from.priority.subarray(at, at + r.width), at);
    }
  }

  private assertInside(rect: Rect): void {
    if (
      rect.width < 0 ||
      rect.height < 0 ||
      rect.x < 0 ||
      rect.y < 0 ||
      rect.x + rect.width > this.width ||
      rect.y + rect.height > this.height
    )
      throw new RangeError("rectangle hors de la page");
  }
}

/**
 * Rectangles modifiés à recopier sur l'écran. Le pilote n'en fusionne pas : il recopie chaque rectangle sauvegardé
 * (`vga_present`, `+0x2a`), ou toute la page si le drapeau `CS:0530` est levé. Même principe ici : une liste simple.
 */
export class DirtyRects {
  private readonly rects: Rect[] = [];
  private everything = false;

  /** Vrai si toute la page doit être recopiée. */
  get all(): boolean {
    return this.everything;
  }

  get list(): readonly Rect[] {
    return this.rects;
  }

  add(rect: Rect): void {
    this.rects.push({ ...rect });
  }

  markAll(): void {
    this.everything = true;
  }

  clear(): void {
    this.rects.length = 0;
    this.everything = false;
  }
}
