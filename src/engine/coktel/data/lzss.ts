/**
 * Décompression LZSS de Coktel Vision.
 * Fenêtre de 4 Kio initialisée avec des espaces ; la variante « étendue »
 * (marqueur 0x1234 0x5678) démarre en 273 et autorise les longueurs longues.
 * `offset` pointe sur le flux (après la taille décompressée).
 */
export function unpackLzss(src: Uint8Array, offset: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const window = new Uint8Array(4096).fill(0x20);
  let windowPos = 4078;
  let extended = false;
  let p = offset;
  if (src[p] === 0x34 && src[p + 1] === 0x12 && src[p + 2] === 0x78 && src[p + 3] === 0x56) {
    extended = true;
    windowPos = 273;
    p += 4;
  }

  let o = 0;
  let flags = 0;
  while (o < size && p < src.length) {
    flags >>= 1;
    if ((flags & 0x100) === 0) flags = src[p++] | 0xff00;

    if (flags & 1) {
      const c = src[p++];
      out[o++] = c;
      window[windowPos] = c;
      windowPos = (windowPos + 1) & 4095;
      continue;
    }

    const low = src[p++];
    const high = src[p++];
    const from = low | ((high & 0xf0) << 4);
    let length = (high & 0x0f) + 3;
    if (extended && length === 18) length = src[p++] + 18;
    for (let i = 0; i < length && o < size; i++) {
      const c = window[(from + i) & 4095];
      out[o++] = c;
      window[windowPos] = c;
      windowPos = (windowPos + 1) & 4095;
    }
  }
  return out;
}

/** Bloc empaqueté : taille décompressée (u32 LE) suivie du flux LZSS. */
export function unpackBlock(src: Uint8Array): Uint8Array {
  const size = new DataView(src.buffer, src.byteOffset, src.byteLength).getUint32(0, true);
  return unpackLzss(src, 4, size);
}
