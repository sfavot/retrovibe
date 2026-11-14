import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Sequence } from "../../../src/games/bass/data/sequence";
import { deblockBackground, showFullImage } from "../../../src/games/bass/render/draw";
import { FrameBuffer, SCREEN_SIZE } from "../../../src/games/bass/render/frame-buffer";
import { hasOriginalFiles, skyDisk } from "../data/helpers";
import { decodePng } from "./png";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(import.meta.dirname, "fixtures", name)));

/** Introduction (`_cdIntroSeq`) : 59502 = `CD_1_LOG` (image de l'orateur), 59501 = `CD_PAL`, 59503 = `CD_1` (séquence jouée par-dessus). */
const CD_PAL = 59501;
const CD_1_LOG = 59502;
const CD_1 = 59503;

function mismatches(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

describe.skipIf(!hasOriginalFiles)("comparaison avec les captures du banc ScummVM (introduction, 320 x 200)", () => {
  const disk = hasOriginalFiles ? skyDisk() : undefined!;

  function frameAfter(sequenceFrames: number): FrameBuffer {
    const fb = new FrameBuffer();
    fb.setVgaPalette(disk.load(CD_PAL));
    showFullImage(fb.pixels, disk.load(CD_1_LOG), false);
    const seq = new Sequence(disk.load(CD_1));
    const decoder = seq.decoder();
    for (let i = 0; i < sequenceFrames; i++) decoder.next(fb.pixels);
    return fb;
  }

  // Captures `i-0011`, `i-0012`, `i-0013` : palette complète (`FADEUP` terminé), image seule puis après 2 et 3 images de la séquence `CD_1`.
  it.each([
    ["i-0011.png", 0],
    ["i-0012.png", 2],
    ["i-0013.png", 3],
  ])("%s : %i images de séquence, RGBA identique au pixel près", (name, frames) => {
    const png = decodePng(fixture(name));
    expect([png.width, png.height]).toEqual([320, 200]);
    const rgba = frameAfter(frames).toRgba();
    expect(rgba).toHaveLength(SCREEN_SIZE * 4);
    expect(mismatches(rgba, png.rgba)).toBe(0);
  });

  it("les captures 0012 et 0013 diffèrent bien (la séquence modifie l'image)", () => {
    expect(mismatches(frameAfter(2).toRgba(), frameAfter(3).toRgba())).toBeGreaterThan(0);
    expect(mismatches(frameAfter(0).toRgba(), frameAfter(2).toRgba())).toBeGreaterThan(0);
  });

  it("décor de la première pièce (fichier 64) : les blocs de 16 x 8 remis en lignes retrouvent la capture hors sprites", () => {
    const reference = fixture("room-a.idx.bin");
    const background = deblockBackground(disk.load(64));
    let same = 0;
    for (let i = 0; i < background.length; i++) if (background[i] === reference[i]) same++;
    // Le reste de la capture est Foster, Joey, les objets et le curseur (sprites, composés en vague R partie 2).
    expect(same / background.length).toBeGreaterThan(0.95);
    // Lu comme des lignes sans remise en blocs, le décor ne ressemble à rien.
    const raw = disk.load(64);
    let rawSame = 0;
    for (let i = 0; i < raw.length; i++) if (raw[i] === reference[i]) rawSame++;
    expect(rawSame / raw.length).toBeLessThan(0.2);
  });
});
