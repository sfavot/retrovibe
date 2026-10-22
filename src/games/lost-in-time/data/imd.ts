import { PALETTE_BYTES } from "./palette";
import { unpackBlock } from "./lzss";
import { createSurface, type IndexedSurface } from "./surface";

export interface ImdRect {
  left: number;
  top: number;
  /** Exclusifs. */
  right: number;
  bottom: number;
}

export interface ImdSound {
  frequency: number;
  sliceSize: number;
  slicesCount: number;
}

export interface ImdHeader {
  version: number;
  features: number;
  frameCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  flags: number;
  firstFramePos: number;
  /** Palette initiale, 768 octets 6 bits. */
  palette: Uint8Array;
  stdCoords: ImdRect | null;
  sound: ImdSound | null;
  /** Offsets des images (pour les sauts), version >= 4. */
  framePos: Uint32Array | null;
  /** Rectangle propre à chaque image (right/bottom inclusifs, left = -1 si absent). */
  frameCoords: ImdRect[] | null;
}

export interface ImdFrame {
  /** Numéro de l'image décodée. */
  index: number;
  /** Zone de la surface modifiée, ou null si aucune image n'a été dessinée. */
  rect: ImdRect | null;
  paletteChanged: boolean;
  /** PCM 8 bits non signé de cette image (silence = 0x80), null si le film n'a pas de son. */
  audio: Uint8Array | null;
  /** Vrai pour le premier bloc audio (début de la lecture). */
  startsAudio: boolean;
}

const FEATURE_DATA_SIZE = 0x20;
const FEATURE_SOUND = 0x40;
const FEATURE_FRAME_COORDS = 0x80;

const CMD_NEXT_SOUND = 0xff00;
const CMD_START_SOUND = 0xff01;
const CMD_BREAK = 0xfff0;
const CMD_SKIP0 = 0xfff1;
const CMD_SKIP16 = 0xfff2;
const CMD_SKIP32 = 0xfff3;
const CMD_PALETTE = 0xfff4;
const CMD_VIDEO_DATA = 0xfffc;
const CMD_JUMP = 0xfffd;

export function parseImdHeader(data: Uint8Array): ImdHeader {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 0;
  const u8 = () => view.getUint8(p++);
  const u16 = () => {
    const v = view.getUint16(p, true);
    p += 2;
    return v;
  };
  const i16 = () => {
    const v = view.getInt16(p, true);
    p += 2;
    return v;
  };
  const u32 = () => {
    const v = view.getUint32(p, true);
    p += 4;
    return v;
  };

  const handle = u16();
  const version = u8();
  if (handle !== 0 || version < 2) throw new Error(`IMD : version incorrecte (${handle}, ${version})`);

  const features = u8() | 0x408;
  const frameCount = u16();
  const x = i16();
  const y = i16();
  const width = i16();
  const height = i16();
  const flags = u16();
  const firstFramePos = u16();
  const palette = data.slice(p, p + PALETTE_BYTES);
  p += PALETTE_BYTES;

  let stdCoords: ImdRect | null = null;
  if (version >= 3) {
    const count = u16();
    if (count > 1) throw new Error("IMD : plusieurs rectangles standard");
    if (count === 1) {
      const sx = i16();
      const sy = i16();
      const sw = i16();
      const sh = i16();
      stdCoords = { left: sx, top: sy, right: sx + sw, bottom: sy + sh };
    }
  }

  let framePosOffset = 0;
  if (version >= 4) framePosOffset = u32();
  let frameCoordsOffset = 0;
  if (features & FEATURE_FRAME_COORDS) frameCoordsOffset = u32();

  let sound: ImdSound | null = null;
  if (features & FEATURE_SOUND) {
    const frequency = Math.abs(i16());
    const sliceSize = i16();
    let slicesCount = i16();
    if (slicesCount < 0) slicesCount = -slicesCount - 1;
    if (slicesCount > 40) throw new Error(`IMD : trop de tranches audio (${slicesCount})`);
    sound = { frequency, sliceSize, slicesCount };
  }

  // Taille suggérée des tampons : inutile ici, on la saute.
  if (features & FEATURE_DATA_SIZE) {
    if (u16() === 0) p += 8;
    else p += 2;
  }

  let framePos: Uint32Array | null = null;
  if (framePosOffset) {
    framePos = new Uint32Array(frameCount);
    for (let i = 0; i < frameCount; i++) framePos[i] = view.getUint32(framePosOffset + i * 4, true);
  }

  let frameCoords: ImdRect[] | null = null;
  if (features & FEATURE_FRAME_COORDS) {
    frameCoords = [];
    for (let i = 0; i < frameCount; i++) {
      const o = frameCoordsOffset + i * 8;
      frameCoords.push({
        left: view.getInt16(o, true),
        top: view.getInt16(o + 2, true),
        right: view.getInt16(o + 4, true),
        bottom: view.getInt16(o + 6, true),
      });
    }
  }

  return {
    version,
    features,
    frameCount,
    x,
    y,
    width,
    height,
    flags,
    firstFramePos,
    palette,
    stdCoords,
    sound,
    framePos,
    frameCoords,
  };
}

/**
 * Décodeur IMD incrémental : chaque appel à `decodeNextFrame` applique une image
 * sur `surface` (320x200 par défaut, coordonnées absolues) et met à jour `palette`.
 */
export class ImdDecoder {
  readonly header: ImdHeader;
  /** Surface de destination ; peut être remplacée entre deux images. */
  surface: IndexedSurface;
  /** Palette courante, 768 octets 6 bits. */
  readonly palette: Uint8Array;
  /** Index de la dernière image décodée (-1 avant la première). */
  currentFrame = -1;
  /** Position du film (setXY) : l'origine des coordonnées de l'en-tête y est translatée. */
  x: number;
  y: number;

  private readonly data: Uint8Array;
  private readonly view: DataView;
  private pos: number;

  constructor(data: Uint8Array, surface: IndexedSurface = createSurface(320, 200)) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.header = parseImdHeader(data);
    this.surface = surface;
    this.palette = this.header.palette.slice();
    this.pos = this.header.firstFramePos;
    this.x = this.header.x;
    this.y = this.header.y;
  }

  /**
   * Déplace le film (CoktelDecoder::setXY) : -1 ou 0xFFFF laisse la coordonnée telle quelle.
   * Les rectangles des images sont translatés d'autant ; le dessin se fait directement sur `surface`.
   */
  setXY(x: number, y: number): void {
    if (x !== -1 && x !== 0xffff) this.x = x;
    if (y !== -1 && y !== 0xffff) this.y = y;
  }

  /**
   * Se place juste avant l'image `frame + 1` (IMDDecoder::seek avec `frame` = image courante voulue, -1 = début).
   * `restart` : sans table de positions, rejoue le film depuis le début. Faux si impossible.
   */
  seek(frame: number, restart = true): boolean {
    const count = this.header.frameCount;
    if (frame < -1 || frame >= count) return false;
    if (frame === this.currentFrame) return true;

    const first = this.header.firstFramePos;
    let target: number;
    if (frame === -1) {
      target = first;
    } else if (frame === 0) {
      target = first + this.view.getUint16(first, true) + 4;
    } else if (this.header.framePos) {
      target = this.header.framePos[frame + 1];
    } else if (restart) {
      // Pas de table : on rejoue depuis le début (avec dessin, comme l'original).
      this.currentFrame = -1;
      this.pos = first;
      while (this.currentFrame < frame && this.decodeNextFrame());
      return true;
    } else {
      return false;
    }
    this.pos = target;
    this.currentFrame = frame;
    return true;
  }

  get done(): boolean {
    return this.currentFrame >= this.header.frameCount - 1;
  }

  private u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  private u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  private take(count: number): Uint8Array {
    const bytes = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return bytes;
  }

  /** Décode l'image suivante ; null quand le film est terminé. */
  decodeNextFrame(): ImdFrame | null {
    if (this.done) return null;
    const { header } = this;
    this.currentFrame++;

    const frame: ImdFrame = {
      index: this.currentFrame,
      rect: null,
      paletteChanged: false,
      audio: null,
      startsAudio: false,
    };

    let hasNextCmd = false;
    do {
      let cmd = this.u16();

      if ((cmd & 0xfff8) === CMD_BREAK) {
        if (cmd === CMD_BREAK) {
          this.pos += 2;
          cmd = this.u16();
        }
        if (cmd === CMD_SKIP0) {
          hasNextCmd = false;
          continue;
        }
        if (cmd === CMD_SKIP16) {
          this.pos += this.u16();
          hasNextCmd = false;
          continue;
        }
        if (cmd === CMD_SKIP32) {
          this.pos += this.u32();
          hasNextCmd = false;
          continue;
        }
      }

      const sound = header.sound;
      if (cmd === CMD_NEXT_SOUND && sound) {
        const slice = this.take(sound.sliceSize);
        if (!hasNextCmd) frame.audio = slice;
        cmd = this.u16();
      } else if (cmd === CMD_START_SOUND && sound) {
        const slices = this.take(sound.sliceSize * sound.slicesCount);
        if (!hasNextCmd) {
          frame.audio = slices;
          frame.startsAudio = true;
        }
        cmd = this.u16();
      } else if (sound && !hasNextCmd) {
        frame.audio = new Uint8Array(sound.sliceSize).fill(0x80);
      }

      if (cmd === CMD_PALETTE) {
        this.pos += 2;
        this.palette.set(this.take(PALETTE_BYTES));
        frame.paletteChanged = true;
        cmd = this.u16();
      }

      hasNextCmd = false;

      if (cmd === CMD_JUMP) {
        const target = this.view.getInt16(this.pos, true);
        this.pos += 2;
        if (header.framePos) {
          this.currentFrame = target - 1;
          this.pos = header.framePos[target];
          hasNextCmd = true;
        }
      } else if (cmd === CMD_VIDEO_DATA || cmd !== 0) {
        const length = (cmd === CMD_VIDEO_DATA ? this.u32() : cmd) + 2;
        const block = this.take(length);
        const rect = this.renderFrame(block, this.frameRect(this.currentFrame), frame);
        if (rect) frame.rect = rect;
      }
    } while (hasNextCmd);

    frame.index = this.currentFrame;
    return frame;
  }

  private frameRect(frame: number): ImdRect {
    const { header } = this;
    const dx = this.x - header.x;
    const dy = this.y - header.y;
    const full = {
      left: this.x,
      top: this.y,
      right: this.x + header.width,
      bottom: this.y + header.height,
    };
    if (frame === 0) return full;
    const coords = header.frameCoords?.[frame];
    if (coords && coords.left !== -1) {
      return { left: coords.left + dx, top: coords.top + dy, right: coords.right + 1 + dx, bottom: coords.bottom + 1 + dy };
    }
    const std = header.stdCoords;
    return std ? { left: std.left + dx, top: std.top + dy, right: std.right + dx, bottom: std.bottom + dy } : full;
  }

  private renderFrame(block: Uint8Array, wanted: ImdRect, frame: ImdFrame): ImdRect | null {
    const { header } = this;
    // Zone demandée, limitée à la zone visible du film.
    const rect: ImdRect = {
      left: Math.max(wanted.left, this.x),
      top: Math.max(wanted.top, this.y),
      right: Math.min(wanted.right, this.x + header.width),
      bottom: Math.min(wanted.bottom, this.y + header.height),
    };
    if (wanted.right < wanted.left || wanted.bottom < wanted.top) return null;
    if (rect.right <= rect.left || rect.bottom <= rect.top) return null;

    let type = block[0];
    let q = 1;
    if (type & 0x10) {
      const index = block[q++];
      const count = Math.min(255 - index, 16);
      this.palette.set(block.subarray(q, q + count * 3), index * 3);
      q += 48;
      type ^= 0x10;
      frame.paletteChanged = true;
    }

    let src = block;
    if (type & 0x80) {
      type &= 0x7f;
      src = unpackBlock(block.subarray(q));
      q = 0;
    }

    const srcWidth = rect.right - rect.left;
    // Zone réellement écrite (clippée sur la surface).
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const width = Math.min(rect.right, this.surface.width) - left;
    const height = Math.min(rect.bottom, this.surface.height) - top;
    const { pixels, width: pitch } = this.surface;

    if (type === 0x01) {
      for (let y = 0; y < height; y++) {
        let written = 0;
        let dst = (top + y) * pitch + left;
        while (written < srcWidth) {
          let n = src[q++];
          if (n & 0x80) {
            n = Math.min((n & 0x7f) + 1, srcWidth - written);
            const copy = Math.max(0, Math.min(width - written, n));
            pixels.set(src.subarray(q, q + copy), dst);
            q += n;
          } else {
            n += 1;
          }
          written += n;
          dst += n;
        }
      }
    } else if (type === 0x02) {
      for (let y = 0; y < height; y++) {
        pixels.set(src.subarray(q, q + width), (top + y) * pitch + left);
        q += srcWidth;
      }
    } else if (type === 0x42) {
      // Largeur divisée par 4 : chaque octet vaut 4 pixels.
      for (let y = 0; y < height; y++) {
        const dst = (top + y) * pitch + left;
        for (let x = 0; x < width; x += 4) {
          pixels.fill(src[q + (x >> 2)], dst + x, dst + Math.min(x + 4, width));
        }
        q += srcWidth >> 2;
      }
    } else if ((type & 0x0f) === 0x02) {
      // Hauteur divisée par 2 : chaque ligne est dessinée deux fois.
      for (let y = 0; y < height; y += 2) {
        const row = src.subarray(q, q + width);
        pixels.set(row, (top + y) * pitch + left);
        if (y + 1 < height) pixels.set(row, (top + y + 1) * pitch + left);
        q += srcWidth;
      }
    } else {
      // Clairsemé à moitié de hauteur (non vérifié sur des données réelles).
      for (let y = 0; y < height; y += 2) {
        let written = 0;
        let dst = (top + y) * pitch + left;
        while (written < srcWidth) {
          let n = src[q++];
          if (n & 0x80) {
            n = Math.min((n & 0x7f) + 1, srcWidth - written);
            const run = src.subarray(q, q + Math.min(n, width - written));
            pixels.set(run, dst);
            if (y + 1 < height) pixels.set(run, dst + pitch);
            q += n;
          } else {
            n += 1;
          }
          written += n;
          dst += n;
        }
      }
    }

    return { left, top, right: left + width, bottom: top + height };
  }
}
