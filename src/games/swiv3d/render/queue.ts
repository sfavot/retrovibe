/**
 * File des primitives triées (`gm_queue_insert`, `00423620`, `render.md` §7.4) : triangles de modèles et sprites, au plus 2995
 * entrées par image, tracées de la clé de profondeur la plus grande (le plus loin) à la plus petite ; à clés égales, dans
 * l'ordre d'insertion.
 */
import { VIEWPORT } from "./view";

export const QUEUE_CAPACITY = 0xbb3;

/** Types de primitive (octet bas du type de face ; les sprites reprennent les codes du jeu). */
export const KIND_SHADED = 0;
export const KIND_ROTOR = 1;
export const KIND_SHADED_DOUBLE = 2;
export const KIND_KEYED = 4;
export const KIND_SKIN = 5;
export const KIND_SHADOW = 0x28;
export const KIND_SPRITE_505 = 0x2d;
export const KIND_SPRITE_504 = 0x2e;

export class RenderQueue {
  count = 0;
  readonly kind = new Uint8Array(QUEUE_CAPACITY);
  readonly texture = new Int32Array(QUEUE_CAPACITY);
  /** Clé de tri : profondeur ; sert aussi à découper par les lignes d'horizon. */
  readonly key = new Int32Array(QUEUE_CAPACITY);
  /** Paramètre propre au type : image de peau (type 5), image de sprite, demi-taille d'un sprite 504. */
  readonly aux = new Int32Array(QUEUE_CAPACITY);
  readonly aux2 = new Int32Array(QUEUE_CAPACITY);
  /** Trois sommets par face : écran (x, y), texture (u, v) et lumière, en entiers. */
  readonly x = new Int32Array(QUEUE_CAPACITY * 3);
  readonly y = new Int32Array(QUEUE_CAPACITY * 3);
  readonly u = new Int32Array(QUEUE_CAPACITY * 3);
  readonly v = new Int32Array(QUEUE_CAPACITY * 3);
  readonly l = new Int32Array(QUEUE_CAPACITY * 3);
  private readonly order = new Int32Array(QUEUE_CAPACITY);

  reset(): void {
    this.count = 0;
  }

  /** Réserve une entrée, ou -1 si la file est pleine (les faces en trop sont perdues, comme dans le jeu). */
  claim(kind: number, key: number): number {
    if (this.count >= QUEUE_CAPACITY) return -1;
    const i = this.count++;
    this.kind[i] = kind;
    this.key[i] = key;
    return i;
  }

  /** Annule la dernière réservation (face rejetée). */
  release(): void {
    this.count--;
  }

  /** Vrai si les trois sommets de l'entrée `i` sont tous à gauche, à droite, au-dessus ou au-dessous du rectangle. */
  isOffscreen(i: number): boolean {
    const o = i * 3;
    const { x, y } = this;
    const x0 = x[o]!;
    const x1 = x[o + 1]!;
    const x2 = x[o + 2]!;
    const y0 = y[o]!;
    const y1 = y[o + 1]!;
    const y2 = y[o + 2]!;
    return (
      (x0 < VIEWPORT.left && x1 < VIEWPORT.left && x2 < VIEWPORT.left) ||
      (x0 > VIEWPORT.right && x1 > VIEWPORT.right && x2 > VIEWPORT.right) ||
      (y0 < VIEWPORT.clipTop && y1 < VIEWPORT.clipTop && y2 < VIEWPORT.clipTop) ||
      (y0 > VIEWPORT.bottom && y1 > VIEWPORT.bottom && y2 > VIEWPORT.bottom)
    );
  }

  /** Ordre de tracé : clé décroissante, puis ordre d'insertion. */
  sorted(): Int32Array {
    const order = this.order.subarray(0, this.count);
    for (let i = 0; i < this.count; i++) order[i] = i;
    const { key } = this;
    return order.sort((a, b) => key[b]! - key[a]! || a - b);
  }
}
