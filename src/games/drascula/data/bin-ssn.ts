import { BinaryReader } from "../../../data/reader";
import { decodeRle, SCREEN_PIXELS, xorInto } from "./rle";

/**
 * Cinématiques `.BIN` au format SSN (`INTRO`, `LOGOALC`, `LOGODDM`, `QPC`, `CRD`, `CDR`, `SCROLLB`) : delta XOR
 * contre l'écran précédent.
 *
 * Format tiré de `playFLI` et `playFrameSSN` (engines/drascula/graphics.cpp, ScummVM). Suite de blocs, chacun
 * commençant par un octet de type : 0 image (compression, longueur `u32`, données), 4 palette (768 octets en
 * 6 bits), 6 image vide (attend un tour de cadence), 3 fin. La cadence n'est pas dans le fichier : l'appelant
 * la donne. Écart : un type de bloc inconnu lance une erreur, alors que ScummVM arrête alors la lecture.
 */

export const SSN_CHUNK_IMAGE = 0;
export const SSN_CHUNK_END = 3;
export const SSN_CHUNK_PALETTE = 4;
export const SSN_CHUNK_EMPTY = 6;

export const SSN_COMPRESSION_RLE = 1;
export const SSN_COMPRESSION_OFFSETS = 2;

/** Le tampon de ScummVM fait 64 256 octets : une dernière série de décalages peut dépasser l'image. */
const OFFSET_BUFFER_BYTES = 64256;

export type SsnChunk =
  | { kind: "image"; compression: typeof SSN_COMPRESSION_RLE | typeof SSN_COMPRESSION_OFFSETS; data: Uint8Array }
  | { kind: "palette"; palette: Uint8Array }
  | { kind: "empty" };

export interface SsnFile {
  chunks: SsnChunk[];
  /** Octets lus, bloc de fin compris. Égal à la taille du fichier quand il n'a pas de reste. */
  bytesRead: number;
}

export function parseSsn(bytes: Uint8Array): SsnFile {
  const reader = new BinaryReader(bytes);
  const chunks: SsnChunk[] = [];
  for (;;) {
    if (reader.isAtEnd) throw new Error("SSN invalide : bloc de fin absent");
    const type = reader.u8();
    if (type === SSN_CHUNK_END) break;
    if (type === SSN_CHUNK_EMPTY) chunks.push({ kind: "empty" });
    else if (type === SSN_CHUNK_PALETTE) {
      if (reader.offset + 768 > reader.length) throw new Error("SSN invalide : palette tronquée");
      chunks.push({ kind: "palette", palette: reader.bytesView(768) });
    } else if (type === SSN_CHUNK_IMAGE) {
      const compression = reader.u8();
      if (compression !== SSN_COMPRESSION_RLE && compression !== SSN_COMPRESSION_OFFSETS)
        throw new Error(`SSN invalide : compression ${compression} inconnue`);
      const length = reader.u32();
      if (reader.offset + length > reader.length) throw new Error("SSN invalide : image tronquée");
      chunks.push({ kind: "image", compression, data: reader.bytesView(length) });
    } else throw new Error(`SSN invalide : type de bloc ${type} inconnu à l'octet ${reader.offset - 1}`);
  }
  return { chunks, bytesRead: reader.offset };
}

/**
 * Décode une image « décalages » : suite de `(décalage u16 LE, taille u8, taille octets)` écrite dans un
 * tampon remis à zéro. Seuls les 64 000 premiers octets forment l'image.
 */
export function decodeOffsets(data: Uint8Array): Uint8Array {
  const buffer = new Uint8Array(OFFSET_BUFFER_BYTES);
  let at = 0;
  while (at < data.length) {
    if (at + 3 > data.length) throw new Error("SSN invalide : série de décalages tronquée");
    const offset = data[at] | (data[at + 1] << 8);
    const size = data[at + 2];
    if (at + 3 + size > data.length || offset + size > OFFSET_BUFFER_BYTES)
      throw new Error("SSN invalide : série de décalages hors limites");
    buffer.set(data.subarray(at + 3, at + 3 + size), offset);
    at += 3 + size;
  }
  return buffer.subarray(0, SCREEN_PIXELS);
}

/** Applique les blocs un à un sur un écran de 64 000 pixels : la première image est copiée, les suivantes combinées par XOR. */
export class SsnDecoder {
  /** Écran courant (indices de palette). */
  readonly screen = new Uint8Array(SCREEN_PIXELS);
  /** Dernière palette reçue (768 octets, 6 bits), ou `null` avant le premier bloc palette. */
  palette: Uint8Array | null = null;
  /** Images affichées jusqu'ici (les images vides ne comptent pas). */
  imagesShown = 0;
  private next = 0;

  constructor(private readonly file: SsnFile) {}

  get done(): boolean {
    return this.next >= this.file.chunks.length;
  }

  /** Applique le bloc suivant et le rend, ou `null` à la fin du flux. */
  step(): SsnChunk | null {
    const chunk = this.file.chunks[this.next++];
    if (!chunk) return null;
    if (chunk.kind === "palette") this.palette = chunk.palette;
    else if (chunk.kind === "image") {
      const image = chunk.compression === SSN_COMPRESSION_RLE ? decodeRle(chunk.data).pixels : decodeOffsets(chunk.data);
      if (this.imagesShown === 0) this.screen.set(image);
      else xorInto(this.screen, image);
      this.imagesShown++;
    }
    return chunk;
  }
}
