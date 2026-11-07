import { BinaryReader } from "../../../data/reader";
import { decodeRle, SCREEN_PIXELS, xorInto } from "./rle";

/**
 * Animations `.BIN` au format « animate » (les 26 autres `.BIN`) : delta XOR contre l'image précédente.
 *
 * Format tiré de `animate` et `showFrame` (engines/drascula/graphics.cpp, ScummVM) : `u32` nombre d'images
 * `N`, puis `N` images, chacune `u32` longueur, données RLE (64 000 pixels) et palette de 768 octets en
 * 6 bits. ScummVM n'affiche que les `N - 1` premières, la dernière est lue mais jamais jouée ; seule la
 * palette de la première image est appliquée. La cadence n'est pas dans le fichier.
 */

export interface AnimateFrame {
  /** Données RLE de l'image (à décoder avec `decodeRle`). */
  rle: Uint8Array;
  /** Palette de l'image, RVB 6 bits. */
  palette: Uint8Array;
}

export interface AnimateFile {
  /** Nombre d'images annoncé et présent dans le fichier. */
  frames: AnimateFrame[];
  /** Octets lus ; égal à la taille du fichier quand il n'a pas de reste. */
  bytesRead: number;
}

export function parseAnimate(bytes: Uint8Array): AnimateFile {
  const reader = new BinaryReader(bytes);
  if (bytes.length < 4) throw new Error("Animation invalide : fichier trop court");
  const count = reader.u32();
  const frames: AnimateFrame[] = [];
  for (let i = 0; i < count; i++) {
    if (reader.offset + 4 > reader.length) throw new Error(`Animation invalide : image ${i} tronquée`);
    const length = reader.u32();
    if (reader.offset + length + 768 > reader.length) throw new Error(`Animation invalide : image ${i} tronquée`);
    frames.push({ rle: reader.bytesView(length), palette: reader.bytesView(768) });
  }
  return { frames, bytesRead: reader.offset };
}

/** Nombre d'images que le jeu affiche : toutes sauf la dernière. */
export function playedFrameCount(file: AnimateFile): number {
  return Math.max(0, file.frames.length - 1);
}

/** Décode les images une à une : la première est copiée, les suivantes combinées par XOR. */
export class AnimateDecoder {
  /** Écran courant (indices de palette). */
  readonly screen = new Uint8Array(SCREEN_PIXELS);
  /** Palette de la première image, la seule que le jeu applique. */
  palette: Uint8Array | null = null;
  /** Images décodées jusqu'ici. */
  decoded = 0;

  constructor(private readonly file: AnimateFile) {}

  get done(): boolean {
    return this.decoded >= this.file.frames.length;
  }

  /** Décode l'image suivante dans `screen` ; faux à la fin du flux. */
  step(): boolean {
    const frame = this.file.frames[this.decoded];
    if (!frame) return false;
    const { pixels } = decodeRle(frame.rle);
    if (this.decoded === 0) {
      this.screen.set(pixels);
      this.palette = frame.palette;
    } else xorInto(this.screen, pixels);
    this.decoded++;
    return true;
  }
}
