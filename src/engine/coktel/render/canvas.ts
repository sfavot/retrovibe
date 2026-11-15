/**
 * Composition de l'image affichée, d'après ScummVM (`engines/gob/video.cpp` : retrace, défilement, palette 6 bits ; GPL v3+).
 */
import { palette6ToRgb } from "../data/palette";
import type { GraphicsSystems } from "../graphics";
import type { GraphicsCore } from "../graphics/core";

export interface Frame {
  width: number;
  height: number;
  /** RGBA, width * height * 4 octets. */
  rgba: Uint8ClampedArray;
}

/**
 * Indices de couleur de l'écran affiché (`screenWidth` x `screenHeight`) : la surface avant avec défilement et zone
 * fixe du bas, sans le curseur ni la palette. C'est ce que ScummVM expose à `OSystem::lockScreen` (comparé au banc).
 */
export function composeIndexed(core: GraphicsCore, reuse?: Uint8Array): Uint8Array {
  const { screenWidth: w, screenHeight: h } = core;
  const out = reuse && reuse.length === w * h ? reuse : new Uint8Array(w * h);
  out.fill(0);
  const front = core.front;
  const copy = (sx: number, sy: number, cw: number, ch: number, dx: number, dy: number): void => {
    for (let y = 0; y < ch; y++) {
      const srcY = sy + y;
      const dstY = dy + y;
      if (srcY < 0 || srcY >= front.height || dstY < 0 || dstY >= h) continue;
      for (let x = 0; x < cw; x++) {
        const srcX = sx + x;
        const dstX = dx + x;
        if (srcX < 0 || srcX >= front.width || dstX < 0 || dstX >= w) continue;
        out[dstY * w + dstX] = front.pixels[srcY * front.width + srcX];
      }
    }
  };
  const split = core.splitHeight2;
  copy(
    core.scrollX,
    core.scrollY,
    Math.min(core.surfWidth - core.scrollX, w),
    Math.min(core.surfHeight - split - core.scrollY, h - split),
    0,
    0,
  );
  if (split > 0) copy(0, core.splitStart, Math.min(core.surfWidth, w), split, 0, h - split);
  return out;
}

/**
 * Compose l'image à l'écran : la surface avant (avec défilement et zone fixe du bas), la palette affichée
 * (6 bits -> RGB) et le curseur à la position de la souris.
 */
export function composeFrame(gfx: GraphicsSystems, mouseX: number, mouseY: number, reuse?: Frame): Frame {
  const core = gfx.core;
  const { screenWidth: w, screenHeight: h } = core;
  const frame = reuse && reuse.width === w && reuse.height === h ? reuse : { width: w, height: h, rgba: new Uint8ClampedArray(w * h * 4) };
  const rgb = palette6ToRgb(core.shown);
  const out = frame.rgba;
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const indexed = composeIndexed(core);
  const put = (dx: number, dy: number, color: number): void => {
    const o = (dy * w + dx) * 4;
    out[o] = rgb[color * 3];
    out[o + 1] = rgb[color * 3 + 1];
    out[o + 2] = rgb[color * 3 + 2];
  };
  for (let i = 0; i < w * h; i++) {
    const c = indexed[i];
    const o = i * 4;
    out[o] = rgb[c * 3];
    out[o + 1] = rgb[c * 3 + 1];
    out[o + 2] = rgb[c * 3 + 2];
  }

  const cursor = core.cursorImage;
  if (cursor && (core.showCursor & 6) !== 0) {
    const ox = mouseX - cursor.hotX;
    const oy = mouseY - cursor.hotY;
    for (let y = 0; y < cursor.height; y++) {
      for (let x = 0; x < cursor.width; x++) {
        const c = cursor.pixels[y * cursor.width + x];
        const dx = ox + x;
        const dy = oy + y;
        if (c !== 0 && dx >= 0 && dy >= 0 && dx < w && dy < h) put(dx, dy, c);
      }
    }
  }
  return frame;
}

export interface MousePosition {
  mouseX: number;
  mouseY: number;
}

/** Présente l'image sur un canvas, uniquement quand l'affichage ou le curseur ont changé. */
export class CanvasPresenter {
  private readonly ctx: CanvasRenderingContext2D;
  private lastVersion = -1;
  private lastX = -1;
  private lastY = -1;
  private frame: Frame | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gfx: GraphicsSystems,
    private readonly mouse: MousePosition,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponible");
    this.ctx = ctx;
  }

  /** À appeler à chaque image du navigateur ; retourne vrai si le canvas a été redessiné. */
  present(): boolean {
    const core = this.gfx.core;
    const { mouseX, mouseY } = this.mouse;
    if (core.version === this.lastVersion && mouseX === this.lastX && mouseY === this.lastY) return false;
    this.lastVersion = core.version;
    this.lastX = mouseX;
    this.lastY = mouseY;
    const frame = composeFrame(this.gfx, mouseX, mouseY, this.frame);
    this.frame = frame;
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }
    this.ctx.putImageData(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, frame.width, frame.height), 0, 0);
    return true;
  }
}
