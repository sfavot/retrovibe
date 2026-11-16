import { describe, expect, it } from "vitest";
import { decompressLzs } from "../../../src/games/gk1/data/lzs";

/** Écrit un flux LZS bit à bit, poids fort d'abord. */
class BitWriter {
  private readonly bits: number[] = [];
  put(value: number, count: number): this {
    for (let i = count - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
    return this;
  }
  literal(byte: number): this {
    return this.put(0, 1).put(byte, 8);
  }
  /** Copie à distance courte (7 bits) ; `lengthBits` = suite de (valeur, largeur) du code de longueur. */
  copy(distance: number, ...lengthBits: [number, number][]): this {
    this.put(1, 1).put(1, 1).put(distance, 7);
    for (const [v, n] of lengthBits) this.put(v, n);
    return this;
  }
  longCopy(distance: number, ...lengthBits: [number, number][]): this {
    this.put(1, 1).put(0, 1).put(distance, 11);
    for (const [v, n] of lengthBits) this.put(v, n);
    return this;
  }
  end(): Uint8Array {
    this.put(1, 1).put(1, 1).put(0, 7);
    while (this.bits.length % 8) this.bits.push(0);
    const out = new Uint8Array(this.bits.length / 8);
    this.bits.forEach((b, i) => (out[i >> 3] |= b << (7 - (i & 7))));
    return out;
  }
}

describe("LZS", () => {
  it("lit des littéraux jusqu'au marqueur de fin", () => {
    const src = new BitWriter().literal(0x41).literal(0xff).literal(0).end();
    expect([...decompressLzs(src, 3)]).toEqual([0x41, 0xff, 0]);
  });

  it("copie des zones chevauchantes, octet par octet", () => {
    // « ab » puis copie de 6 octets à distance 2 : « abababab ».
    const src = new BitWriter().literal(0x61).literal(0x62).copy(2, [3, 2], [1, 2]).end();
    expect(new TextDecoder().decode(decompressLzs(src, 8))).toBe("abababab");
  });

  it("décode les longueurs 2 à 4, 5 à 7 et les quartets prolongés", () => {
    const one = (bits: [number, number][], length: number) => {
      const src = new BitWriter().literal(7).copy(1, ...bits).end();
      const out = decompressLzs(src, 1 + length);
      expect(out.every((b) => b === 7)).toBe(true);
    };
    one([[0, 2]], 2);
    one([[2, 2]], 4);
    one([[3, 2], [0, 2]], 5);
    one([[3, 2], [2, 2]], 7);
    one([[3, 2], [3, 2], [0, 4]], 8);
    one([[3, 2], [3, 2], [15, 4], [15, 4], [3, 4]], 8 + 15 + 15 + 3);
  });

  it("gère les distances sur 11 bits", () => {
    const w = new BitWriter();
    for (let i = 0; i < 200; i++) w.literal(i);
    const out = decompressLzs(w.longCopy(200, [1, 2]).end(), 203);
    expect([...out.subarray(200)]).toEqual([0, 1, 2]);
  });

  it("refuse un flux tronqué, trop long, trop court ou une distance hors de la sortie", () => {
    expect(() => decompressLzs(new BitWriter().literal(1).end().subarray(0, 1), 1)).toThrow(/tronqué/);
    expect(() => decompressLzs(new BitWriter().literal(1).literal(2).end(), 1)).toThrow(/plus long/);
    expect(() => decompressLzs(new BitWriter().literal(1).copy(1, [2, 2]).end(), 3)).toThrow(/plus long/);
    expect(() => decompressLzs(new BitWriter().literal(1).end(), 2)).toThrow(/1 octets pour 2/);
    expect(() => decompressLzs(new BitWriter().literal(1).copy(2, [0, 2]).end(), 3)).toThrow(/hors de la sortie/);
  });
});
