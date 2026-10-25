// Encodeur PNG minimal (Node uniquement) pour les scripts qui rendent des échantillons à vérifier à l'œil.
import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const buf = Buffer.alloc(12 + body.length);
  buf.writeUInt32BE(body.length, 0);
  buf.write(type, 4, "latin1");
  buf.set(body, 8);
  buf.writeUInt32BE(crc32(buf.subarray(4, 8 + body.length)), 8 + body.length);
  return buf;
}

/**
 * Image à encoder : RGBA 8 bits (`rgba`, 4 octets par pixel), RGB 8 bits (`rgb`, 3 octets par pixel) ou indexée
 * (`indexed` + `palette` RGB 8 bits, 3 octets par couleur).
 */
export type PngImage = { rgba: Uint8Array } | { rgb: Uint8Array } | { indexed: Uint8Array; palette: Uint8Array };

/** Encode une image en PNG : RGBA (type 6), RGB (type 2) ou indexée (type 3, profondeur 8, PLTE). Lance si les tailles ne correspondent pas. */
export function encodePng(width: number, height: number, image: PngImage): Buffer {
  const indexed = "indexed" in image;
  const data = "indexed" in image ? image.indexed : "rgb" in image ? image.rgb : image.rgba;
  const bytesPerPixel = indexed ? 1 : "rgb" in image ? 3 : 4;
  if (data.length !== width * height * bytesPerPixel) {
    throw new Error(`encodePng : ${data.length} octets pour ${width}x${height} (${width * height * bytesPerPixel} attendus)`);
  }
  if (indexed && (image.palette.length % 3 !== 0 || image.palette.length === 0 || image.palette.length > 768)) {
    throw new Error("encodePng : palette invalide (multiple de 3 octets, 1 à 256 couleurs)");
  }
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height); // octet de filtre 0 en tête de chaque ligne
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = indexed ? 3 : "rgb" in image ? 2 : 6;
  const chunks = [chunk("IHDR", head)];
  if (indexed) chunks.push(chunk("PLTE", image.palette));
  chunks.push(chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([SIGNATURE, ...chunks]);
}
