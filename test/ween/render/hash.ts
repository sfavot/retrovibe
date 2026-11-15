import { createHash } from "node:crypto";

/** Empreinte compacte d'une image : `LxH:` sha1 des indices (10 hex) `:` sha1 de la palette 6 bits (6 hex). */
export function frameHash(width: number, indices: Uint8Array, palette6: Uint8Array): string {
  const idx = createHash("sha1").update(indices).digest("hex").slice(0, 10);
  const pal = createHash("sha1").update(palette6).digest("hex").slice(0, 6);
  return `${width}x${indices.length / width}:${idx}:${pal}`;
}

/** Palette du banc (`.pal` : `grabPalette` de ScummVM, 768 octets 0-255) ramenée à 6 bits comme `Video::setPalette` (>> 2). */
export function benchPalette6(pal: Uint8Array): Uint8Array {
  return pal.map((v) => v >> 2);
}
