// Génère original/zoombinis/COVER.png : la jaquette de L'Odyssée des Zoombinis (640×480), le décor de l'île du choix des Zoombinis
// (`PICKER.MHK`, écran 3 : falaise, grotte et bateau), avec sa palette. Le `tBMP` 1000 de l'archive est une planche de sprites (le
// `SHPL` 1000 n'existe pas) : le fond plein écran de l'écran du choix est le `tBMP` 4000 avec le `SHPL` 4000 (voir scenes/picker.ts),
// éclairci comme dans le jeu. Puis régénère files.json. Usage : npx vite-node scripts/zoombinis/cover.mts
// Le script d'extraction du CD (scripts/zoombinis-extract.sh) conserve COVER.png.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { MohawkArchive, TAG_SHPL } from "../../src/data/mohawk/mohawk";
import { applyShpl, createPalette } from "../../src/engine/mohawk/graphics/palette-data";
import { decodeTbmp } from "../../src/data/mohawk/tbmp";
import { parseShpl } from "../../src/data/mohawk/shpl";
import { TAG_TBMP } from "../../src/games/zoombinis/data/archives";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "original/zoombinis");
const WIDTH = 640;
const HEIGHT = 480;
const BACKGROUND_ID = 4000;

const archive = MohawkArchive.parse(readFileSync(resolve(dir, "PICKER.MHK")));
const shape = decodeTbmp(archive.get(TAG_TBMP, BACKGROUND_ID));
if (shape.bitsPerPixel !== 8 || shape.width !== WIDTH || shape.height !== HEIGHT) throw new Error(`PICKER.MHK tBMP ${BACKGROUND_ID} : ${shape.width}x${shape.height}, 640x480 attendu`);
const palette = createPalette();
applyShpl(palette, parseShpl(archive.get(TAG_SHPL, BACKGROUND_ID)));

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  const row = y * (WIDTH * 3 + 1);
  for (let x = 0; x < WIDTH; x++) {
    const index = shape.pixels[y * WIDTH + x]!;
    raw.set(palette.subarray(index * 3, index * 3 + 3), row + 1 + x * 3);
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
head.writeUInt32BE(WIDTH, 0);
head.writeUInt32BE(HEIGHT, 4);
head[8] = 8;
head[9] = 2; // RVB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", head),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(resolve(dir, "COVER.png"), png);
console.log(`original/zoombinis/COVER.png (${WIDTH}x${HEIGHT}, tBMP ${BACKGROUND_ID}, ${png.length} octets)`);

// COVER.png fait partie des fichiers servis : le manifeste doit le lister.
execFileSync("python3", ["-I", resolve(root, "scripts/manifest.py"), dir], { stdio: "inherit" });
