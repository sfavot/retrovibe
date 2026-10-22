import type { Bounds, PlacedImage } from "../engine/sprites";

/** Petit constructeur DOM : `h("div", { class: "x" }, enfants…)`. Les chaînes deviennent des nœuds texte. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

/** Palette 768 octets RGB 8 bits -> table de 256 couleurs RGBA (little-endian, 0xAABBGGRR). L'index 0 est transparent si demandé. */
export function paletteTable(palette: Uint8Array | null, transparentZero: boolean): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const r = palette ? palette[i * 3] : i;
    const g = palette ? palette[i * 3 + 1] : i;
    const b = palette ? palette[i * 3 + 2] : i;
    table[i] = ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  if (transparentZero) table[0] = 0;
  return table;
}

export function makeCanvas(width: number, height: number, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
  return canvas;
}

/** Peint des pixels indexés dans un canvas (redimensionné si besoin). */
export function paintIndexed(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  width: number,
  height: number,
  table: Uint32Array,
): void {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(width, height);
  const out = new Uint32Array(data.data.buffer);
  for (let i = 0; i < width * height; i++) out[i] = table[pixels[i]];
  ctx.putImageData(data, 0, 0);
}

export function indexedCanvas(
  pixels: Uint8Array,
  width: number,
  height: number,
  table: Uint32Array,
  scale = 1,
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height, scale);
  paintIndexed(canvas, pixels, width, height, table);
  return canvas;
}

/** Nuancier 16x16 ; chaque case porte en `title` l'index et la couleur. */
export function paletteSwatch(palette: Uint8Array | null, cell = 14): HTMLCanvasElement {
  const canvas = makeCanvas(16 * cell, 16 * cell);
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < 256; i++) {
    const r = palette ? palette[i * 3] : i;
    const g = palette ? palette[i * 3 + 1] : i;
    const b = palette ? palette[i * 3 + 2] : i;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect((i % 16) * cell, Math.floor(i / 16) * cell, cell, cell);
  }
  canvas.className = "swatch";
  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * 16);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * 16);
    const i = row * 16 + col;
    if (i >= 0 && i < 256 && palette) {
      canvas.title = `#${i} rgb(${palette[i * 3]}, ${palette[i * 3 + 1]}, ${palette[i * 3 + 2]})`;
    }
  });
  return canvas;
}

/** Dessine des images posées dans un tampon RGBA ; l'origine du tampon est (-bounds.minX, -bounds.minY). */
export function paintPlaced(canvas: HTMLCanvasElement, placed: PlacedImage[], bounds: Bounds, table: Uint32Array): void {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(width, height);
  const out = new Uint32Array(data.data.buffer);
  for (const { image, left, top, mirror } of placed) {
    for (let y = 0; y < image.height; y++) {
      const dy = top + y - bounds.minY;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < image.width; x++) {
        const value = image.pixels[y * image.width + (mirror ? image.width - 1 - x : x)];
        if (value === 0) continue;
        const dx = left + x - bounds.minX;
        if (dx >= 0 && dx < width) out[dy * width + dx] = table[value];
      }
    }
  }
  ctx.putImageData(data, 0, 0);
}

/** Nombre d'octets lisibles : 1.2 Mo, 34 Ko. */
export function formatSize(bytes: number): string {
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} Mo`;
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(1)} Ko`;
  return `${bytes} o`;
}
