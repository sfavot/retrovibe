import { makeCanvas } from "../indexed-canvas";

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

/** Nombre d'octets lisibles : 1.2 Mo, 34 Ko. */
export function formatSize(bytes: number): string {
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} Mo`;
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(1)} Ko`;
  return `${bytes} o`;
}

/** Hexadécimal des `max` premiers octets, 16 par ligne, précédé du décalage sur 6 chiffres. */
export function hexDump(bytes: Uint8Array, max = 256): string {
  const lines: string[] = [];
  for (let i = 0; i < Math.min(bytes.length, max); i += 16) {
    const row = [...bytes.subarray(i, i + 16)];
    lines.push(`${i.toString(16).padStart(6, "0")}  ${row.map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
  }
  return lines.join("\n");
}

/** Nuancier 16x16 d'une palette RGB 8 bits (768 octets, niveaux de gris si absente) ; chaque case porte en `title` l'index et la couleur. */
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
