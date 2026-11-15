// Génère original/yoda/COVER.png : l'écran du lanceur du CD français de Yoda Stories (YODA/BITMAPS/SCREEN.BMP,
// 519x333, 256 couleurs), lu dans l'ISO. L'image titre du jeu (YODESK.DTA) n'est pas utilisée : ses données
// contiennent une tache sur la tête de Yoda.
// Usage : npx vite-node scripts/yoda-cover.mts [Yoda.iso]   (défaut : archives/yoda-stories/Yoda.iso ; outil requis : 7zz)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BinaryReader } from "../src/data/reader";
import { encodePng } from "./lib/png.mts";

const root = resolve(import.meta.dirname, "..");
const iso = process.argv[2] ?? resolve(root, "archives/yoda-stories/Yoda.iso");
const bmp = new Uint8Array(execFileSync("7zz", ["e", "-so", iso, "YODA/BITMAPS/SCREEN.BMP"], { maxBuffer: 1 << 24 }));

// BMP Windows 8 bits non compressé : lignes de bas en haut, alignées sur 4 octets, palette BGRx.
const r = new BinaryReader(bmp);
if (r.tag().slice(0, 2) !== "BM") throw new Error("SCREEN.BMP n'est pas un BMP");
r.offset = 10;
const pixelsAt = r.u32();
const headerSize = r.u32();
const width = r.i32();
const height = r.i32();
r.offset += 2;
if (r.u16() !== 8 || r.u32() !== 0) throw new Error("SCREEN.BMP : seul le 8 bits non compressé est géré");
const paletteAt = 14 + headerSize;
const stride = Math.ceil(width / 4) * 4;
const rgb = new Uint8Array(width * height * 3);
for (let y = 0; y < height; y++) {
  const row = pixelsAt + (height - 1 - y) * stride;
  for (let x = 0; x < width; x++) {
    const c = paletteAt + bmp[row + x] * 4;
    const o = (y * width + x) * 3;
    rgb[o] = bmp[c + 2];
    rgb[o + 1] = bmp[c + 1];
    rgb[o + 2] = bmp[c];
  }
}
const png = encodePng(width, height, { rgb });
writeFileSync(resolve(root, "original/yoda/COVER.png"), png);
console.log(`original/yoda/COVER.png (${width}x${height}, ${png.length} octets)`);
