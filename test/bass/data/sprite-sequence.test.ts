import { describe, expect, it } from "vitest";
import { DATA_FILE_HEADER_SIZE, parseDataFileHeader } from "../../../src/games/bass/data/header";
import { Sequence, SEQUENCE_PIXELS, decodeSequenceFrame } from "../../../src/games/bass/data/sequence";
import { FRAME_INDEX_MASK, SpriteFile, frameIndexOf, spriteFileOf } from "../../../src/games/bass/data/sprite";
import { allFiles, hasOriginalFiles, skyDisk } from "./helpers";

function spriteBytes(width: number, height: number, frames: number[][], offsetX = -3, offsetY = -4): Uint8Array {
  const size = width * height;
  const out = new Uint8Array(DATA_FILE_HEADER_SIZE + frames.length * size);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x81, true);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  view.setUint16(10, size, true);
  view.setUint16(14, frames.length, true);
  view.setInt16(16, offsetX, true);
  view.setInt16(18, offsetY, true);
  frames.forEach((frame, i) => out.set(frame, DATA_FILE_HEADER_SIZE + i * size));
  return out;
}

describe("SpriteFile (données synthétiques)", () => {
  it("lit l'en-tête et rend les images dans l'ordre", () => {
    const sprite = new SpriteFile(spriteBytes(2, 2, [[1, 2, 3, 4], [5, 6, 7, 8]]));
    expect([sprite.width, sprite.height, sprite.frameCount, sprite.offsetX, sprite.offsetY]).toEqual([2, 2, 2, -3, -4]);
    expect([...sprite.frame(1)]).toEqual([5, 6, 7, 8]);
    expect(() => sprite.frame(2)).toThrow(RangeError);
  });

  it("refuse un fichier plus court que ses images", () => {
    const bytes = spriteBytes(2, 2, [[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(() => new SpriteFile(bytes.subarray(0, bytes.length - 1))).toThrow(/invalide/);
  });

  it("sépare identifiant de fichier et numéro d'image d'un compact (frame >> 6, frame & 0x3F)", () => {
    const frame = (12 << 6) | 5;
    expect(spriteFileOf(frame)).toBe(12);
    expect(frameIndexOf(frame)).toBe(5);
    expect(FRAME_INDEX_MASK).toBe(63);
  });
});

describe("décodeur de séquence (données synthétiques)", () => {
  /** Image : saut 0, copie 3 pixels, puis saut du reste jusqu'à la fin (par 0xFF puis le reliquat), copie 0. */
  function frameBytes(): number[] {
    const skip = SEQUENCE_PIXELS - 3;
    const skips: number[] = [];
    let left = skip;
    while (left >= 0xff) {
      skips.push(0xff);
      left -= 0xff;
    }
    skips.push(left);
    return [0, 3, 9, 8, 7, ...skips, 0];
  }

  it("applique les sauts et les copies et marque les blocs touchés", () => {
    const data = Uint8Array.from([2, ...frameBytes(), ...frameBytes()]);
    const screen = new Uint8Array(64000);
    const seq = new Sequence(data);
    expect(seq.frameCount).toBe(2);
    const end = seq.play(screen);
    expect(end).toBe(data.length);
    expect([...screen.subarray(0, 4)]).toEqual([9, 8, 7, 0]);
    const { dirty } = decodeSequenceFrame(data, 1, new Uint8Array(64000));
    expect(dirty[0]).toBe(1);
    expect(dirty.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
  });

  it("une séquence d'un compact compte une image de moins", () => {
    expect(new Sequence(Uint8Array.from([5]), true).frameCount).toBe(4);
  });

  it("refuse les données tronquées et les écritures hors de l'écran", () => {
    const data = Uint8Array.from([1, ...frameBytes()]);
    expect(() => new Sequence(data.subarray(0, data.length - 2)).play(new Uint8Array(64000))).toThrow(/séquence invalide/);
    expect(() => decodeSequenceFrame(Uint8Array.from([0xfe, 0, 0]), 0, new Uint8Array(100))).toThrow(RangeError);
    // Saut jusqu'à 5 pixels de la fin d'un écran de 61 440 octets, puis copie de 10 pixels.
    const overrun = Uint8Array.from([...Array(240).fill(0xff), 235, 10, ...Array(10).fill(1)]);
    expect(() => decodeSequenceFrame(overrun, 0, new Uint8Array(SEQUENCE_PIXELS))).toThrow(/au-delà de l'écran/);
  });
});

/** Séquences de fichiers de l'introduction du CD (`_cdIntroSeq`, arguments de `BGFLIRT` et `DOFLIRT`). */
const INTRO_SEQUENCE_FILES = [
  59503, 59506, 59509, 59512, 59516, 59519, 59524, 59533, 59557, 59569, 59575, 59589, 59595, 59605, 59609, 59611, 59623, 59643, 60087, 60099, 60091, 60094, 60097,
  60098,
];

describe.skipIf(!hasOriginalFiles)("fichiers réels", () => {
  it("décode chaque image de chacune des 24 séquences de l'introduction sans dépassement, en consommant exactement le fichier", () => {
    const disk = skyDisk();
    let frames = 0;
    for (const id of INTRO_SEQUENCE_FILES) {
      const data = disk.load(id);
      const screen = new Uint8Array(320 * 200);
      const seq = new Sequence(data);
      let seen = 0;
      const end = seq.play(screen, () => seen++);
      expect(seen, `séquence ${id}`).toBe(seq.frameCount);
      expect(end, `séquence ${id} : octets restants`).toBe(data.length);
      // Les 8 dernières lignes ne sont jamais touchées par une séquence.
      expect(screen.subarray(SEQUENCE_PIXELS).every((v) => v === 0), `séquence ${id} : bas de l'écran`).toBe(true);
      frames += seen;
    }
    expect(frames).toBe(1236);
  });

  it("les fichiers de sprites ont tous des images de s_sp_size = largeur x hauteur, dont le fichier est exactement la somme", () => {
    let sprites = 0;
    let withBit2 = 0;
    let maxFrames = 0;
    for (const [id, bytes] of allFiles()) {
      if (id >= 50000 || bytes.length < DATA_FILE_HEADER_SIZE) continue;
      const header = parseDataFileHeader(bytes);
      if (header.numSprites === 0 || header.spriteSize === 0) continue;
      if (bytes.length !== DATA_FILE_HEADER_SIZE + header.numSprites * header.spriteSize || header.width * header.height !== header.spriteSize) continue;
      const sprite = new SpriteFile(bytes);
      sprites++;
      if (header.flag & 4) withBit2++;
      maxFrames = Math.max(maxFrames, sprite.frameCount);
    }
    expect(sprites).toBe(948);
    // Le drapeau « 32 couleurs » n'est posé sur aucun sprite : les pixels sont toujours des indices d'un octet.
    expect(withBit2).toBe(0);
    expect(maxFrames).toBeGreaterThan(0);
  });

  it("les curseurs 60300 à 60302 sont des sprites de 22 x 22", () => {
    const disk = skyDisk();
    const mice = new SpriteFile(disk.load(60300));
    expect([mice.width, mice.height, mice.frameCount]).toEqual([22, 22, 9]);
    expect(new SpriteFile(disk.load(60301)).frameCount).toBe(50);
    expect(new SpriteFile(disk.load(60302)).frameCount).toBe(44);
  });

  it("le sprite 12 : 50 images de 32 x 56, décalage (-16, -48)", () => {
    const sprite = new SpriteFile(skyDisk().load(12));
    expect([sprite.width, sprite.height, sprite.frameCount, sprite.offsetX, sprite.offsetY]).toEqual([32, 56, 50, -16, -48]);
  });
});
