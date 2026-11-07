/**
 * Images d'un `.BIN` (cinématique SSN ou animation « animate ») pour la visionneuse : chaque image est une copie
 * de l'écran après application du delta XOR, avec la palette alors en vigueur. Sans DOM, testé.
 */
import { AnimateDecoder, parseAnimate, playedFrameCount } from "../data/bin-animate";
import { parseSsn, SsnDecoder, SSN_COMPRESSION_RLE } from "../data/bin-ssn";
import { isSsnName } from "./viewer-data";

export interface BinFrame {
  /** Écran (64 000 indices de palette) après cette image. */
  screen: Uint8Array;
  /** Palette 6 bits en vigueur (`null` avant le premier bloc palette). */
  palette: Uint8Array | null;
  /** Nature : image RLE, image par décalages, image vide (un tour d'attente), ou image lue mais jamais jouée. */
  kind: "rle" | "offsets" | "empty" | "animate" | "unplayed";
}

export interface BinFrames {
  format: "SSN" | "animate";
  frames: BinFrame[];
  /** Images que le jeu affiche : le dernier `animate` n'est jamais joué. */
  played: number;
  /** Octets lus ; égal à la taille du fichier quand il n'a pas de reste. */
  bytesRead: number;
  /** Nombre d'images dont la palette diffère de celle de la première. */
  paletteChanges: number;
}

function samePalette(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.every((value, i) => value === b[i]);
}

function decodeSsn(bytes: Uint8Array): BinFrames {
  const file = parseSsn(bytes);
  const decoder = new SsnDecoder(file);
  const frames: BinFrame[] = [];
  for (let chunk = decoder.step(); chunk; chunk = decoder.step()) {
    if (chunk.kind === "palette") continue;
    const previous = frames.at(-1);
    if (chunk.kind === "empty") {
      if (previous) frames.push({ screen: previous.screen, palette: decoder.palette, kind: "empty" });
      continue;
    }
    frames.push({
      screen: decoder.screen.slice(),
      palette: decoder.palette,
      kind: chunk.compression === SSN_COMPRESSION_RLE ? "rle" : "offsets",
    });
  }
  const first = frames[0]?.palette ?? null;
  return {
    format: "SSN",
    frames,
    played: frames.length,
    bytesRead: file.bytesRead,
    paletteChanges: frames.filter((frame) => !samePalette(frame.palette, first)).length,
  };
}

function decodeAnimate(bytes: Uint8Array): BinFrames {
  const file = parseAnimate(bytes);
  const decoder = new AnimateDecoder(file);
  const frames: BinFrame[] = [];
  const played = playedFrameCount(file);
  const first = file.frames[0]?.palette ?? null;
  while (decoder.step()) {
    const index = frames.length;
    frames.push({ screen: decoder.screen.slice(), palette: decoder.palette, kind: index < played ? "animate" : "unplayed" });
  }
  return {
    format: "animate",
    frames,
    played,
    bytesRead: file.bytesRead,
    // Le jeu n'applique que la palette de la première image : on compte celles qui en différeraient.
    paletteChanges: file.frames.filter((frame) => !samePalette(frame.palette, first)).length,
  };
}

/** Décode toutes les images d'un `.BIN` ; le format se déduit du nom, avec repli sur l'autre si la lecture échoue. */
export function decodeBin(bytes: Uint8Array, name: string): BinFrames {
  const readers = isSsnName(name) ? [decodeSsn, decodeAnimate] : [decodeAnimate, decodeSsn];
  try {
    return readers[0](bytes);
  } catch (first) {
    try {
      return readers[1](bytes);
    } catch {
      throw first;
    }
  }
}

/** Indices (au plus `count`, répartis régulièrement) des images d'une planche-contact. */
export function sampleIndices(total: number, count: number): number[] {
  if (total <= 0) return [];
  if (total <= count) return Array.from({ length: total }, (_, i) => i);
  return Array.from({ length: count }, (_, i) => Math.floor((i * (total - 1)) / (count - 1)));
}
