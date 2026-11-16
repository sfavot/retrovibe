import { describe, expect, it } from "vitest";
import { SEQ_HEIGHT, SEQ_WIDTH } from "../../../src/games/gk1/data/ids";
import { createSeqCanvas, decodeSeqFrame, decodeSeqFrames, readSeq, SEQ_FRAME_FULL } from "../../../src/games/gk1/data/seq";
import { fnv1a, original, tally } from "./real";

function u16(n: number): number[] {
  return [n & 0xff, n >> 8];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
}

/** Palette de 2 couleurs au format 3 octets (37 + 6 octets). */
const PALETTE = [0x0e, ...new Array(9).fill(0), 1, 0, 0, ...u16(28), ...new Array(10).fill(0), 0, 0, 0, 0, ...u16(2), 1, 1, ...u32(0), 0, 0, 0, 255, 255, 255];

interface FrameSpec {
  rect: [number, number, number, number];
  type: number;
  control?: number[];
  literals: number[];
}

function buildSeq(frames: FrameSpec[]): Uint8Array {
  const out: number[] = [...u16(frames.length), ...u32(PALETTE.length), ...PALETTE];
  for (const { rect, type, control = [], literals } of frames) {
    const [left, top, width, height] = rect;
    const size = control.length + literals.length;
    out.push(...u16(width), ...u16(height), ...u16(left), ...u16(top), 255, type, 0, 0, ...u32(size), ...u32(control.length), ...u32(0), ...u32(out.length + 36), ...u32(0), ...u32(0));
    out.push(...control, ...literals);
  }
  return Uint8Array.from(out);
}

/** Lit le rectangle `rect` de la toile, ligne par ligne. */
function region(canvas: Uint8Array, [left, top, width, height]: [number, number, number, number]): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) rows.push([...canvas.subarray((top + y) * SEQ_WIDTH + left, (top + y) * SEQ_WIDTH + left + width)]);
  return rows;
}

describe("SEQ", () => {
  const rect: [number, number, number, number] = [10, 5, 4, 4];

  it("pose une image brute puis une différence (toutes les opérations)", () => {
    const seq = readSeq(
      buildSeq([
        { rect, type: SEQ_FRAME_FULL, literals: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4] },
        {
          rect,
          type: 11,
          // ligne 0 : saute 1, copie 2, ligne suivante ; ligne 1 : copie le reste (4) ; ligne 2 : saut long 2, copie longue 2,
          // ligne suivante ; ligne 3 : copie 1 ligne entière.
          control: [0xc1, 0x82, 0xc0, 0x80, 0x10, 2, 0x18, 2, 0xc0, 0x30, 1],
          literals: [9, 9, 8, 8, 8, 8, 7, 7, 6, 6, 6, 6],
        },
        { rect, type: 11, control: [0x38, 1, 0x30, 0], literals: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5] },
        { rect, type: 11, control: [0x38, 0], literals: [] },
      ]),
    );
    expect(seq.frames).toHaveLength(4);
    expect(seq.palette.count).toBe(2);
    expect(seq.frames[1]).toMatchObject({ left: 10, top: 5, width: 4, height: 4, colorKey: 255, type: 11, dataSize: 23, controlSize: 11 });

    const canvas = createSeqCanvas();
    expect(decodeSeqFrame(seq, 0, canvas)).toEqual({ controlUsed: 0, literalUsed: 16 });
    expect(region(canvas, rect)).toEqual([[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3], [4, 4, 4, 4]]);
    expect(decodeSeqFrame(seq, 1, canvas)).toEqual({ controlUsed: 11, literalUsed: 12 });
    expect(region(canvas, rect)).toEqual([[1, 9, 9, 1], [8, 8, 8, 8], [3, 3, 7, 7], [6, 6, 6, 6]]);
    // Saute 1 ligne, puis copie des lignes jusqu'au bas du rectangle (compte 0).
    decodeSeqFrame(seq, 2, canvas);
    expect(region(canvas, rect)).toEqual([[1, 9, 9, 1], [5, 5, 5, 5], [5, 5, 5, 5], [5, 5, 5, 5]]);
    decodeSeqFrame(seq, 3, canvas);
    expect(canvas.filter((p) => p !== 0)).toHaveLength(16);

    const last = [...decodeSeqFrames(seq)].pop()!;
    expect(last).toEqual(canvas);
  });

  it("refuse les écritures hors du rectangle, les littéraux épuisés et les opérations inconnues", () => {
    const run = (control: number[], literals: number[]) => {
      const seq = readSeq(buildSeq([{ rect, type: 11, control, literals }]));
      decodeSeqFrame(seq, 0, createSeqCanvas());
    };
    expect(() => run([0x85], [1, 2, 3, 4, 5])).toThrow(/hors du rectangle/);
    expect(() => run([0x38, 4, 0x81], [1])).toThrow(/hors du rectangle/);
    expect(() => run([0x82], [1])).toThrow(/littéraux épuisés/);
    expect(() => run([0x08, 0], [])).toThrow(/opération 1 inconnue/);
    expect(() => run([0x10], [])).toThrow(/contrôle tronqué/);
    const seq = readSeq(buildSeq([{ rect, type: SEQ_FRAME_FULL, literals: new Array(16).fill(0) }]));
    expect(() => decodeSeqFrame(seq, 1, createSeqCanvas())).toThrow(/absente/);
    expect(() => decodeSeqFrame(seq, 0, new Uint8Array(10))).toThrow(/toile/);
  });

  it("refuse un fichier dont les images ne vont pas jusqu'à la fin", () => {
    const bytes = buildSeq([{ rect, type: SEQ_FRAME_FULL, literals: new Array(16).fill(0) }]);
    expect(() => readSeq(Uint8Array.from([...bytes, 0]))).toThrow(/inexpliqués/);
    expect(() => readSeq(bytes.subarray(0, bytes.length - 1))).toThrow(/mal placées/);
    expect(() => readSeq(buildSeq([{ rect: [318, 0, 4, 4], type: SEQ_FRAME_FULL, literals: new Array(16).fill(0) }]))).toThrow(/hors de la toile/);
    expect(() => readSeq(Uint8Array.of(1, 0))).toThrow(/tronqué/);
  });
});

describe.skipIf(!original.has)("cinématiques de Gabriel Knight", () => {
  const files = original.list((name) => name.endsWith(".SEQ"));

  it("décode les 863 images des 25 fichiers jusqu'au dernier octet", () => {
    expect(files).toHaveLength(25);
    let frames = 0;
    const types: number[] = [];
    const paletteSizes: number[] = [];
    for (const file of files) {
      const seq = readSeq(original.read(file));
      paletteSizes.push(seq.palette.byteLength);
      expect(seq.palette).toMatchObject({ start: 0, count: 255 });
      expect(seq.frames[0]).toMatchObject({ type: SEQ_FRAME_FULL, left: 0, top: 0, width: SEQ_WIDTH, height: SEQ_HEIGHT });
      const canvas = createSeqCanvas();
      seq.frames.forEach((frame, i) => {
        const used = decodeSeqFrame(seq, i, canvas);
        // Tout le flux de contrôle et tous les littéraux sont consommés.
        expect(used.controlUsed).toBe(frame.type === SEQ_FRAME_FULL ? 0 : frame.controlSize);
        expect(used.literalUsed).toBe(frame.dataSize - (frame.type === SEQ_FRAME_FULL ? 0 : frame.controlSize));
        types.push(frame.type);
        frames++;
      });
    }
    expect(frames).toBe(863);
    expect(Object.fromEntries(tally(types))).toEqual({ 0: 201, 11: 662 });
    expect(Object.fromEntries(tally(paletteSizes))).toEqual({ 1057: 6, 802: 19 });
  });

  it("décode l'introduction (1.SEQ) à l'identique", () => {
    const seq = readSeq(original.read("SEQ/1.SEQ"));
    expect(seq.frames).toHaveLength(48);
    expect(seq.frames.slice(0, 3).map((f) => [f.type, f.width, f.height, f.left, f.top])).toEqual([
      [0, 320, 200, 0, 0],
      [0, 200, 125, 61, 34],
      [11, 111, 64, 140, 63],
    ]);
    const sums: number[] = [];
    let i = 0;
    for (const canvas of decodeSeqFrames(seq)) {
      if (i === 12 || i === 47) sums.push(fnv1a(canvas));
      i++;
    }
    expect(sums).toEqual(SEQ_1_CHECKSUMS);
  });
});

const SEQ_1_CHECKSUMS = [3620083397, 952198597];
