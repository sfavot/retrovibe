/**
 * Présentation d'une `Frame` (indices + palette) dans un canvas logique de `screenWidth × screenHeight` : la zone de jeu (taille de
 * la `Frame`) est posée à `(originX, originY)`, le reste du canvas est noir (Mathémagique : 640×480, zone de 576×432 à l'origine
 * 32,24, `docs/mathemagique/engine.md` §4.1 ; Zoombinis : 640×480 sans bordure). Le canvas garde sa taille logique ; la mise à
 * l'échelle entière et `image-rendering: pixelated` sont à la charge du CSS de l'appelant. Code navigateur uniquement.
 */
import type { Frame } from "../../engine/mohawk/graphics/frame";

export interface CanvasGeometry {
  /** Taille logique du canvas. */
  screenWidth: number;
  screenHeight: number;
  /** Position de la zone de jeu dans le canvas. */
  originX: number;
  originY: number;
}

export class CanvasPresenter {
  private readonly context: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private pixels = new Uint32Array(0);
  private readonly lut = new Uint32Array(256);
  private readonly little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly geometry: CanvasGeometry,
  ) {
    canvas.width = geometry.screenWidth;
    canvas.height = geometry.screenHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D indisponible");
    this.context = context;
    this.context.fillStyle = "#000";
    this.context.fillRect(0, 0, geometry.screenWidth, geometry.screenHeight);
  }

  /** Convertit les indices en RVBA via la palette de l'image et dessine la zone de jeu (la bordure reste noire). */
  present(frame: Frame): void {
    if (!this.image || this.image.width !== frame.width || this.image.height !== frame.height) {
      this.image = this.context.createImageData(frame.width, frame.height);
      this.pixels = new Uint32Array(this.image.data.buffer);
    }
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
    this.context.putImageData(this.image, this.geometry.originX, this.geometry.originY);
  }
}
