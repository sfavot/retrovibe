/**
 * Présentation d'une `Frame` (indices + palette) dans un canvas 640×480 logique : bordure noire de 32×24 px, zone de jeu 576×432 au centre
 * (`docs/mathemagique/engine.md` §4.1). Le canvas garde sa taille logique ; la mise à l'échelle entière et `image-rendering: pixelated`
 * sont à la charge du CSS de l'appelant. Code navigateur uniquement.
 */
import { PLAY_HEIGHT, PLAY_WIDTH, type Frame } from "../engine/graphics/frame";

export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;
export const PLAY_ORIGIN_X = (SCREEN_WIDTH - PLAY_WIDTH) / 2;
export const PLAY_ORIGIN_Y = (SCREEN_HEIGHT - PLAY_HEIGHT) / 2;

export class CanvasPresenter {
  private readonly context: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;
  private readonly lut = new Uint32Array(256);
  private readonly little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D indisponible");
    this.context = context;
    this.image = context.createImageData(PLAY_WIDTH, PLAY_HEIGHT);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.context.fillStyle = "#000";
    this.context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  /** Convertit les indices en RVBA via la palette de l'image et dessine la zone de jeu (la bordure reste noire). */
  present(frame: Frame): void {
    const { lut, little } = this;
    // Ordre des octets du Uint32 selon le boutisme de la machine (RGBA en mémoire).
    for (let i = 0; i < 256; i++) {
      const r = frame.palette[i * 3]!;
      const g = frame.palette[i * 3 + 1]!;
      const b = frame.palette[i * 3 + 2]!;
      lut[i] = little ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
    }
    const src = frame.pixels;
    const dst = this.pixels;
    for (let i = 0; i < dst.length; i++) dst[i] = lut[src[i]!]!;
    this.context.putImageData(this.image, PLAY_ORIGIN_X, PLAY_ORIGIN_Y);
  }
}
