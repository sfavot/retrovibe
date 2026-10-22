import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import type { Frame } from "../../src/games/lost-in-time/render/canvas";

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? resolve(tmpdir(), "lit-snapshots");

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function png(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Écrit `<SNAPSHOT_DIR>/<name>.png` quand SNAPSHOT=1 (agrandi x2 pour les relire facilement). */
export function snapshot(name: string, frame: Frame, scale = 2): void {
  if (!process.env.SNAPSHOT) return;
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const w = frame.width * scale;
  const h = frame.height * scale;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / scale) * frame.width + Math.floor(x / scale)) * 4;
      out.set(frame.rgba.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  writeFileSync(resolve(SNAPSHOT_DIR, `${name}.png`), png(w, h, out));
}
