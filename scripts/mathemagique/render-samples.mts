// Rend quelques images SHAP de Math Workshop en PNG, pour vérifier à l'œil le décodage et la palette.
// Usage : npx vite-node scripts/mathemagique/render-samples.mts [dossier de sortie]
// (défaut : <tmp>/mathemagique-shap ; rien n'est écrit dans le dépôt)
// Mode animation : npx vite-node scripts/mathemagique/render-samples.mts <dossier> --scr <ARCHIVE.DAT> <id SCR> [id…]
// rend les images d'un ou plusieurs scripts `\0SCR` en une bande PNG par script (`scr-<archive>-<id>.png`), sur le fond
// plein écran de l'archive s'il existe ; au plus 12 images, réparties régulièrement. Les modes de blit ne sont pas
// distingués (index 0 transparent) : contrôle visuel seulement.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import {
  MohawkArchive,
  TAG_SHAP,
  TAG_SHPL,
} from "../../src/games/mathemagique/data/mohawk";
import {
  applyShpl,
  createPalette,
  type Palette,
} from "../../src/games/mathemagique/data/palette";
import { decodeShap, type Shape } from "../../src/games/mathemagique/data/shap";
import { decodeTbmp } from "../../src/games/mathemagique/data/tbmp";
import { parseTpal } from "../../src/games/mathemagique/data/tpal";
import { parseShpl } from "../../src/games/mathemagique/data/shpl";
import {
  parseScr,
  resolveScrResources,
  type ScrScript,
} from "../../src/games/mathemagique/data/scr";
import { TAG_SCR, TAG_SNDL } from "../../src/games/mathemagique/data/mohawk";

const original = resolve(import.meta.dirname, "../../original/mathemagique");
const args = process.argv.slice(2);
const scrFlag = args.indexOf("--scr");
const outDir =
  (scrFlag === 0 ? undefined : args[0]) ??
  resolve(tmpdir(), "mathemagique-shap");
mkdirSync(outDir, { recursive: true });

/** Écran : archive, SHPL de fond (palette de l'écran), puis SHPL ajoutés (forme, personnage…), et la forme à rendre. */
const samples = [
  { name: "title", file: "TITLE.DAT", palettes: [105], shape: 105 },
  { name: "title-logo", file: "TITLE.DAT", palettes: [105], shape: 200 },
  { name: "mainscrn-bg", file: "MAINSCRN.DAT", palettes: [100], shape: 100 },
  { name: "mainscrn-101", file: "MAINSCRN.DAT", palettes: [100], shape: 101 },
  { name: "mainscrn-104", file: "MAINSCRN.DAT", palettes: [100], shape: 104 },
  {
    name: "mainscrn-char-301",
    file: "MAINSCRN.DAT",
    palettes: [100, 301],
    shape: 301,
  },
  {
    name: "mainscrn-1000",
    file: "MAINSCRN.DAT",
    palettes: [100, 1000],
    shape: 1000,
  },
  {
    name: "mainscrn-200",
    file: "MAINSCRN.DAT",
    palettes: [100, 200],
    shape: 200,
  },
];

/** `tBMP` de `MPC/PVG.MHK` avec un `tPAL`, valeurs brutes puis éclaircies. */
const pvgSamples = [
  { name: "pvg-tbmp0-raw", bitmap: 0, palette: 1, adjust: false },
  { name: "pvg-tbmp0-bright", bitmap: 0, palette: 1, adjust: true },
];

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

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(
      rgb.subarray(y * width * 3, (y + 1) * width * 3),
      y * (width * 3 + 1) + 1,
    );
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function render(name: string, shape: Shape, palette: Palette): void {
  const rgb = new Uint8Array(shape.width * shape.height * 3);
  for (let i = 0; i < shape.pixels.length; i++) {
    const index = shape.pixels[i]!;
    rgb.set(
      shape.bitsPerPixel === 1
        ? index
          ? [255, 255, 255]
          : [0, 0, 0]
        : palette.subarray(index * 3, index * 3 + 3),
      i * 3,
    );
  }
  const path = resolve(outDir, `${name}.png`);
  writeFileSync(path, encodePng(shape.width, shape.height, rgb));
  console.log(`${path} (${shape.width}x${shape.height})`);
}

/** Fonds plein écran : fichier -> SHPL `100 + k` (engine.md §2.4). */
const backgrounds: Record<string, number> = {
  "MAINSCRN.DAT": 100,
  "BOWLING.DAT": 101,
  "HIDDEN.DAT": 102,
  "PATTERNS.DAT": 103,
  "STICKLER.DAT": 104,
  "TITLE.DAT": 105,
  "CREDITS.DAT": 106,
  "TROPHY.DAT": 107,
};
const STRIP_MAX_FRAMES = 12;

function renderScr(file: string, scrId: number): void {
  const archive = MohawkArchive.parse(readFileSync(resolve(original, file)));
  const script: ScrScript = parseScr(archive.get(TAG_SCR, scrId));
  const ids = {
    shpl: new Set(archive.ids(TAG_SHPL)),
    sndl: new Set(archive.ids(TAG_SNDL)),
  };
  const { shplId } = resolveScrResources(scrId, ids);
  if (shplId === undefined)
    throw new Error(`${file} ${scrId} : SHPL introuvable`);
  const palette: Palette = createPalette();
  const backgroundId = backgrounds[file.toUpperCase()];
  if (backgroundId !== undefined && archive.has(TAG_SHPL, backgroundId))
    applyShpl(palette, parseShpl(archive.get(TAG_SHPL, backgroundId)));
  const list = parseShpl(archive.get(TAG_SHPL, shplId));
  applyShpl(palette, list);
  const shapes = new Map<number, Shape>();
  const shapeOf = (index: number): Shape | undefined => {
    if (index > list.shapeCount) return undefined;
    let shape = shapes.get(index);
    if (!shape)
      shapes.set(
        index,
        (shape = decodeShap(
          archive.get(TAG_SHAP, list.firstShapeId + index - 1),
        )),
      );
    return shape;
  };
  const background =
    backgroundId !== undefined && archive.has(TAG_SHAP, backgroundId)
      ? decodeShap(archive.get(TAG_SHAP, backgroundId))
      : undefined;

  // Boîte englobante : zone d'écrêtage et tous les sprites de toutes les images.
  const { clip } = script;
  let [x0, y0, x1, y1] = [clip.left, clip.top, clip.right, clip.bottom];
  for (const frame of script.frames) {
    for (const c of frame.cells) {
      const shape = shapeOf(c.shape);
      if (!shape || c.x < -30000) continue;
      x0 = Math.min(x0, clip.left + c.x);
      y0 = Math.min(y0, clip.top + c.y);
      x1 = Math.max(x1, clip.left + c.x + shape.width);
      y1 = Math.max(y1, clip.top + c.y + shape.height);
    }
  }
  x0 = Math.max(0, x0 - 4);
  y0 = Math.max(0, y0 - 4);
  x1 = Math.min(576, x1 + 4);
  y1 = Math.min(432, y1 + 4);
  const w = x1 - x0;
  const h = y1 - y0;

  const count = script.frames.length;
  const picked =
    count <= STRIP_MAX_FRAMES
      ? script.frames
      : Array.from(
          { length: STRIP_MAX_FRAMES },
          (_, i) =>
            script.frames[
              Math.round((i * (count - 1)) / (STRIP_MAX_FRAMES - 1))
            ]!,
        );
  const gap = 4;
  const stripW = picked.length * w + (picked.length - 1) * gap;
  const rgb = new Uint8Array(stripW * h * 3).fill(255);
  picked.forEach((frame, slot) => {
    const ox = slot * (w + gap);
    const plot = (shape: Shape, sx: number, sy: number): void => {
      if (shape.bitsPerPixel !== 8) return;
      for (let y = 0; y < shape.height; y++) {
        for (let x = 0; x < shape.width; x++) {
          const index = shape.pixels[y * shape.width + x]!;
          const px = sx + x - x0;
          const py = sy + y - y0;
          if (index === 0 || px < 0 || py < 0 || px >= w || py >= h) continue;
          rgb.set(
            palette.subarray(index * 3, index * 3 + 3),
            (py * stripW + ox + px) * 3,
          );
        }
      }
    };
    if (background) {
      // Le fond est opaque : on le recopie tel quel.
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const index =
            background.pixels[(y + y0) * background.width + x + x0]!;
          rgb.set(
            palette.subarray(index * 3, index * 3 + 3),
            (y * stripW + ox + x) * 3,
          );
        }
    }
    for (const c of frame.cells) {
      const shape = shapeOf(c.shape);
      if (shape && c.x > -30000) plot(shape, clip.left + c.x, clip.top + c.y);
    }
  });
  const name = `scr-${file.replace(/\.DAT$/i, "").toLowerCase()}-${scrId}`;
  const path = resolve(outDir, `${name}.png`);
  writeFileSync(path, encodePng(stripW, h, rgb));
  console.log(
    `${path} (${picked.length}/${count} images, ${script.duration} ticks, ${w}x${h} par image)`,
  );
}

if (scrFlag >= 0) {
  const [file, ...scrIds] = args.slice(scrFlag + 1);
  if (!file || scrIds.length === 0)
    throw new Error("Usage : --scr <ARCHIVE.DAT> <id SCR> [id…]");
  for (const id of scrIds) renderScr(file, Number(id));
} else {
  for (const sample of samples) {
    const archive = MohawkArchive.parse(
      readFileSync(resolve(original, sample.file)),
    );
    const palette: Palette = createPalette();
    for (const id of sample.palettes)
      applyShpl(palette, parseShpl(archive.get(TAG_SHPL, id)));
    render(
      sample.name,
      decodeShap(archive.get(TAG_SHAP, sample.shape)),
      palette,
    );
  }

  const pvg = MohawkArchive.parse(
    readFileSync(resolve(original, "MPC/PVG.MHK")),
  );
  for (const sample of pvgSamples) {
    const palette: Palette = createPalette();
    applyShpl(
      palette,
      parseTpal(pvg.get("tPAL", sample.palette)),
      sample.adjust,
    );
    render(sample.name, decodeTbmp(pvg.get("tBMP", sample.bitmap)), palette);
  }
}
