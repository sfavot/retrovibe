// Icônes du site (écran d'accueil de l'iPhone, Android) : rasterise le dessin de `src/ui/favicon.svg` en PNG, au plus proche voisin
// pour garder les pixels francs, sur un fond uni (iOS n'accepte pas la transparence), avec une marge autour du dessin.
// Usage : npx vite-node scripts/site-icons.mts   (écrit dans src/ui/pwa/)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./lib/png.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "src/ui/favicon.svg"), "utf8");
const outDir = join(root, "src/ui/pwa");

/** Fond des icônes : celui de la page (`--bg`). */
const BACKGROUND = [0x17, 0x12, 0x0d] as const;
/** Taille de la grille du dessin (viewBox 16 × 16). */
const GRID = 16;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  color: readonly [number, number, number];
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

const rects: Rect[] = [...svg.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => {
  const fill = attr(tag, "fill") ?? "";
  if (!/^#[0-9a-f]{6}$/i.test(fill)) throw new Error(`site-icons : fill inattendu « ${fill} »`);
  return {
    x: Number(attr(tag, "x") ?? 0),
    y: Number(attr(tag, "y") ?? 0),
    w: Number(attr(tag, "width")),
    h: Number(attr(tag, "height")),
    rx: Number(attr(tag, "rx") ?? 0),
    color: [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16)) as unknown as Rect["color"],
  };
});

/** Couleur du dessin au point (u, v) de la grille 16 × 16 ; `undefined` hors de tout rectangle. Le dernier rectangle gagne (ordre du SVG). */
function sample(u: number, v: number): Rect["color"] | undefined {
  let hit: Rect["color"] | undefined;
  for (const r of rects) {
    if (u < r.x || u >= r.x + r.w || v < r.y || v >= r.y + r.h) continue;
    // coins arrondis : le point doit tomber dans le quart de disque de rayon rx
    const cx = u < r.x + r.rx ? r.x + r.rx : u > r.x + r.w - r.rx ? r.x + r.w - r.rx : u;
    const cy = v < r.y + r.rx ? r.y + r.rx : v > r.y + r.h - r.rx ? r.y + r.h - r.rx : v;
    if ((u - cx) ** 2 + (v - cy) ** 2 > r.rx ** 2) continue;
    hit = r.color;
  }
  return hit;
}

/**
 * PNG carré de `size` px : le dessin, agrandi d'un facteur entier `scale` (pixels réguliers), centré sur le fond.
 * Les rectangles du SVG sont centrés sur la grille (x 1..15, y 2..14 : centre à 8, 8).
 */
function render(size: number, scale: number): Buffer {
  const rgb = new Uint8Array(size * size * 3);
  const origin = (size - GRID * scale) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5 - origin) / scale;
      const v = (y + 0.5 - origin) / scale;
      const inside = u >= 0 && u < GRID && v >= 0 && v < GRID;
      rgb.set((inside ? sample(u, v) : undefined) ?? BACKGROUND, (y * size + x) * 3);
    }
  }
  return encodePng(size, size, { rgb });
}

// Le dessin occupe 14 × 12 cases sur 16. Icônes ordinaires : environ 3/4 de la largeur ; icône « maskable » : tout le dessin dans
// le cercle de sécurité (40 % du côté) que les lanceurs Android peuvent rogner.
const icons: Array<[file: string, size: number, scale: number]> = [
  ["apple-touch-icon.png", 180, 8],
  ["icon-192.png", 192, 8],
  ["icon-512.png", 512, 24],
  ["icon-maskable-512.png", 512, 20],
];

mkdirSync(outDir, { recursive: true });
for (const [file, size, scale] of icons) {
  writeFileSync(join(outDir, file), render(size, scale));
  console.log(`${file} ${size}x${size}`);
}
