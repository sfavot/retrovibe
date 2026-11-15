import { describe, expect, it } from "vitest";
import { decompress, decompressPayload, lzwDecompress, rleDecompress } from "../../../src/games/tim3/data/compression";
import { readBitmap } from "../../../src/games/tim3/data/bitmap";
import { baseIndex, original } from "./real";

/** Encodeur LZW Dynamix de test : il rejoue les règles de largeur et de blocs du décodeur pour produire un flux valide. */
function lzwEncode(data: Uint8Array, resetAt: number[] = []): { stream: Uint8Array; widths: Set<number>; full: boolean; resets: number } {
  const bytes: number[] = [];
  let acc = 0;
  let accBits = 0;
  const put = (value: number, bits: number) => {
    for (let i = 0; i < bits; i++) {
      acc |= ((value >> i) & 1) << accBits;
      if (++accBits === 8) {
        bytes.push(acc);
        acc = 0;
        accBits = 0;
      }
    }
  };
  let nbits = 9;
  let tableMax = 512;
  let tableLen = 257;
  let full = false;
  let cache = 0;
  let emitted = 0;
  let sawFull = false;
  let resets = 0;
  const widths = new Set<number>([9]);
  const dict = new Map<number, number>();
  let next = 257;

  const emit = (code: number) => {
    put(code, nbits);
    cache += nbits;
    if (cache >= nbits * 8) cache -= nbits * 8;
    if (emitted > 0 && !full) {
      tableLen++;
      if (tableLen === tableMax) {
        if (nbits < 12) {
          nbits++;
          tableMax = 1 << nbits;
          cache = 0;
          widths.add(nbits);
        } else {
          full = true;
          sawFull = true;
        }
      }
    }
    emitted++;
  };
  const reset = () => {
    put(0x100, nbits);
    cache += nbits;
    if (cache >= nbits * 8) cache -= nbits * 8;
    if (cache > 0) put(0, nbits * 8 - cache);
    nbits = 9;
    tableMax = 512;
    tableLen = 257;
    full = false;
    cache = 0;
    emitted = 0;
    dict.clear();
    next = 257;
    resets++;
  };

  const marks = new Set(resetAt);
  let w = -1;
  for (let i = 0; i < data.length; i++) {
    if (marks.has(i) && w >= 0) {
      emit(w);
      reset();
      w = -1;
    }
    const c = data[i];
    if (w < 0) {
      w = c;
      continue;
    }
    const key = w * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) {
      w = hit;
    } else {
      emit(w);
      if (next < 4096) dict.set(key, next++);
      w = c;
    }
  }
  if (w >= 0) emit(w);
  if (accBits > 0) bytes.push(acc);
  return { stream: Uint8Array.from(bytes), widths, full: sawFull, resets };
}

/** Octets pseudo-aléatoires sur un petit alphabet, pour remplir le dictionnaire sans le saturer trop vite. */
function noise(length: number, alphabet: number, seed = 12345): Uint8Array {
  const out = new Uint8Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = (s >>> 16) % alphabet;
  }
  return out;
}

describe("RLE Dynamix", () => {
  it("recopie et répète", () => {
    const stream = Uint8Array.from([0x03, 1, 2, 3, 0x84, 9, 0x01, 7]);
    expect([...rleDecompress(stream, 8)]).toEqual([1, 2, 3, 9, 9, 9, 9, 7]);
  });

  it("accepte une commande de longueur nulle", () => {
    expect([...rleDecompress(Uint8Array.from([0x00, 0x80, 5, 0x01, 4]), 1)]).toEqual([4]);
  });

  it("refuse un flux tronqué ou qui déborde", () => {
    expect(() => rleDecompress(Uint8Array.from([0x03, 1, 2]), 3)).toThrow(/tronqué/);
    expect(() => rleDecompress(Uint8Array.from([0x85, 1]), 3)).toThrow(/trop long/);
    expect(() => rleDecompress(new Uint8Array(), 1)).toThrow(/tronqué/);
  });

  it("décompresse une charge `méthode, taille, flux`", () => {
    const payload = Uint8Array.from([1, 4, 0, 0, 0, 0x82, 6, 0x02, 1, 2]);
    expect([...decompressPayload(payload)]).toEqual([6, 6, 1, 2]);
  });
});

describe("décompression : méthodes", () => {
  it("méthode 0 = brut, taille exacte exigée", () => {
    expect([...decompressPayload(Uint8Array.from([0, 2, 0, 0, 0, 8, 9]))]).toEqual([8, 9]);
    expect(() => decompressPayload(Uint8Array.from([0, 2, 0, 0, 0, 8]))).toThrow(/brutes/);
  });

  it("refuse une méthode inconnue ou une charge trop courte", () => {
    expect(() => decompress(7, new Uint8Array(), 0)).toThrow(/inconnue/);
    expect(() => decompressPayload(new Uint8Array(3))).toThrow(/tronquée/);
  });
});

describe("LZW Dynamix", () => {
  it("décode un flux écrit à la main (9 bits, cas KwKwK)", () => {
    // « ABABABA » : codes 65, 66, 257 (AB), 259 (ABA, entrée pas encore créée), 9 bits poids faible d'abord.
    const value = 65n | (66n << 9n) | (257n << 18n) | (259n << 27n);
    const stream = Uint8Array.from({ length: 5 }, (_, i) => Number((value >> BigInt(8 * i)) & 0xffn));
    expect(new TextDecoder().decode(lzwDecompress(stream, 7))).toBe("ABABABA");
  });

  it("relit des données qui franchissent 9, 10, 11 puis 12 bits et saturent le dictionnaire", () => {
    const data = noise(60000, 3);
    const { stream, widths, full } = lzwEncode(data);
    expect([...widths].sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
    expect(full).toBe(true);
    expect(lzwDecompress(stream, data.length)).toEqual(data);
  });

  it("relit des données avec remises à zéro du dictionnaire à des positions quelconques", () => {
    const data = noise(30000, 5, 777);
    const { stream, widths, resets } = lzwEncode(data, [1000, 1001, 5000, 5003, 17001, 25555]);
    expect(resets).toBe(6);
    expect(widths.has(12)).toBe(true);
    expect(lzwDecompress(stream, data.length)).toEqual(data);
  });

  it("relit des octets quelconques et des répétitions longues", () => {
    const random = noise(5000, 256, 99);
    expect(lzwDecompress(lzwEncode(random).stream, random.length)).toEqual(random);
    const run = new Uint8Array(3000).fill(0x41);
    expect(lzwDecompress(lzwEncode(run).stream, run.length)).toEqual(run);
  });

  it("refuse un flux tronqué ou un code inexistant", () => {
    const data = noise(2000, 4);
    const { stream } = lzwEncode(data);
    expect(() => lzwDecompress(stream.subarray(0, 100), data.length)).toThrow(/tronqué/);
    // premier code 300 : l'entrée n'existe pas
    const bad = Uint8Array.from([300 & 0xff, 300 >> 8, 0, 0]);
    expect(() => lzwDecompress(bad, 3)).toThrow(/invalide/);
  });
});

describe("LZW sur PART136.BMP", () => {
  it.skipIf(!original.has)("les deux chunks compressés donnent leur taille annoncée (2 × 1 236 octets)", () => {
    const bitmap = readBitmap(baseIndex().get("PART136.BMP"));
    expect(bitmap.frames.map((f) => [f.width, f.height])).toEqual([
      [48, 43],
      [24, 17],
    ]);
    expect(bitmap.frames.reduce((n, f) => n + f.width * f.height, 0)).toBe(2 * 1236);
  });
});
