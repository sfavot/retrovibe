import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname } from "node:path";

/** Écrit une image indexée 320×400 en PNG (palette `lut` ABGR 0xAABBGGRR) si `SWIV3D_DUMP` donne un dossier : coup d'œil manuel, sans effet en CI. */
export function maybeDumpPng(name: string, pixels: Uint8Array, lut: Uint32Array, width = 320, height = 400): void {
  const dir = process.env.SWIV3D_DUMP;
  if (!dir) return;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const c = lut[pixels[y * width + x]!]!;
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = c & 255;
      raw[o + 1] = (c >> 8) & 255;
      raw[o + 2] = (c >> 16) & 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  const path = `${dir}/${name}.png`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}
