// Génère original/indy/COVER.png : l'image de l'écran titre d'Indy (288x288), telle que dessinée par le jeu,
// agrandie x2 sans lissage. Usage : npx vite-node scripts/indy-cover.mts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { parseDaw } from "../src/games/indy/data/daw";
import { extractPalette } from "../src/games/indy/data/palette";

const dir = resolve(import.meta.dirname, "../original/indy");
const SIZE = 288;
const SCALE = 2;

const data = parseDaw(readFileSync(resolve(dir, "DESKTOP.DAW")));
const palette = extractPalette(readFileSync(resolve(dir, "DESKADV.EXE")));

// Même règle que l'écran titre : l'indice 0 est du noir opaque.
const out = SIZE * SCALE;
const raw = Buffer.alloc((out * 4 + 1) * out);
for (let y = 0; y < out; y++) {
  const row = y * (out * 4 + 1);
  for (let x = 0; x < out; x++) {
    const c = data.startupImage[Math.floor(y / SCALE) * SIZE + Math.floor(x / SCALE)];
    const rgba = c ? palette[c] : 0xff000000; // 0xAABBGGRR
    raw.writeUInt32LE(rgba, row + 1 + x * 4);
  }
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const buf = Buffer.alloc(12 + body.length);
  buf.writeUInt32BE(body.length, 0);
  buf.write(type, 4, "latin1");
  body.copy(buf, 8);
  buf.writeUInt32BE(crc32(buf.subarray(4, 8 + body.length)), 8 + body.length);
  return buf;
}
const head = Buffer.alloc(13);
head.writeUInt32BE(out, 0);
head.writeUInt32BE(out, 4);
head[8] = 8;
head[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", head),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/indy/COVER.png (${out}x${out}, ${png.length} octets)`);
