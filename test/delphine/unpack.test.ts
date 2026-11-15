import { describe, expect, it } from "vitest";
import { DelphineUnpackError, delphineUnpack } from "../../src/engine/delphine/unpack";
import { CruiseVolumes } from "../../src/games/croisiere/data/volumes";
import { originalFiles } from "../support/original";

const original = originalFiles("croisiere", "VOL.CNF");

/** Flux de bits dans l'ordre de lecture du dépaqueteur : `value` sur `count` bits, poids fort d'abord. */
class Bits {
  readonly bits: number[] = [];
  push(value: number, count: number): this {
    for (let i = count - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
    return this;
  }
}

/**
 * Empaquette des bits au format Delphine : `chunk0` porte les 31 premiers bits (poids faible d'abord) plus un bit-sentinelle,
 * chaque mot rechargé en porte 32, lus à rebours juste avant `chunk0`. Le CRC est le OU exclusif de tous les mots.
 */
function pack(bits: number[], dstSize: number, crcFlip = 0): Uint8Array {
  const word = (from: number, count: number): number => {
    let w = 0;
    for (let i = 0; i < count; i++) w |= (bits[from + i] ?? 0) << i;
    return w >>> 0;
  };
  const chunk0 = (word(0, 31) | 0x80000000) >>> 0;
  const reloaded: number[] = [];
  for (let at = 31; at < bits.length; at += 32) reloaded.push(word(at, 32));
  let crc = chunk0;
  for (const w of reloaded) crc = (crc ^ w) >>> 0;
  const words = [...reloaded.reverse(), chunk0, (crc ^ crcFlip) >>> 0, dstSize];
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  words.forEach((w, i) => view.setUint32(i * 4, w >>> 0));
  return out;
}

/** Suite brute de 1 à 8 octets : `0 0`, `n - 1` sur 3 bits, puis les octets (le premier va en fin de sortie). */
function literal(bits: Bits, bytes: number[]): void {
  bits.push(0, 2).push(bytes.length - 1, 3);
  for (const b of bytes) bits.push(b, 8);
}

describe("delphineUnpack", () => {
  it("décode suites brutes et copies, à rebours", () => {
    const bits = new Bits();
    literal(bits, [0x41, 0x42]); // sortie[10] = A, sortie[9] = B
    bits.push(0b01, 2).push(2, 8); // copie de 2 octets, décalage 2
    bits.push(0b100, 3).push(3, 9); // copie de 3 octets, décalage 3
    bits.push(0b110, 3).push(3, 8).push(4, 12); // copie de 4 octets, décalage 4
    // Modèle de référence, écrit pas à pas.
    const out = new Array<number>(11).fill(0);
    let d = 10;
    out[d--] = 0x41;
    out[d--] = 0x42;
    for (const [count, offset] of [[2, 2], [3, 3], [4, 4]] as const) for (let i = 0; i < count; i++, d--) out[d] = out[d + offset]!;
    expect(d).toBe(-1);
    expect(Array.from(delphineUnpack(pack(bits.bits, 11), 11))).toEqual(out);
  });

  it("décode les longues suites brutes et copies (codes 1 1 1 et 1 1 0)", () => {
    const raw = Array.from({ length: 20 }, (_, i) => (i * 37 + 5) & 0xff);
    const bits = new Bits();
    bits.push(0b111, 3).push(raw.length - 9, 8);
    for (const b of raw) bits.push(b, 8);
    bits.push(0b110, 3).push(15, 8).push(20, 12); // 16 octets copiés à 20 octets plus haut
    const out = new Array<number>(36).fill(0);
    let d = 35;
    for (const b of raw) out[d--] = b;
    for (let i = 0; i < 16; i++, d--) out[d] = out[d + 20]!;
    expect(Array.from(delphineUnpack(pack(bits.bits, 36), 36))).toEqual(out);
  });

  it("complète par un zéro quand le flux ne rend que unpackedSize - 1 octets", () => {
    const bits = new Bits();
    literal(bits, [1, 2, 3]);
    expect(Array.from(delphineUnpack(pack(bits.bits, 3), 4))).toEqual([3, 2, 1, 0]);
  });

  it("refuse un CRC invalide", () => {
    const bits = new Bits();
    literal(bits, [1, 2, 3]);
    expect(() => delphineUnpack(pack(bits.bits, 3, 1), 3)).toThrow(DelphineUnpackError);
  });

  it("refuse une taille annoncée incompatible, un flux trop court, une copie hors de la sortie", () => {
    const bits = new Bits();
    literal(bits, [1, 2, 3]);
    expect(() => delphineUnpack(pack(bits.bits, 3), 9)).toThrow(/incompatible/);
    expect(() => delphineUnpack(new Uint8Array(8), 4)).toThrow(/trop court/);
    const bad = new Bits();
    literal(bad, [1]);
    bad.push(0b01, 2).push(200, 8); // décalage au-delà de ce qui est écrit
    expect(() => delphineUnpack(pack(bad.bits, 3), 3)).toThrow(/hors de la sortie/);
  });
});

describe.skipIf(!original.has)("delphineUnpack sur les volumes de Croisière", () => {
  it("dépaquette les 853 entrées packées : CRC à 0, extSize octets", () => {
    const volumes = CruiseVolumes.open((name) => original.read(name));
    const packed = volumes.entries.filter((e) => e.size !== e.extSize);
    expect(packed).toHaveLength(853);
    for (const entry of packed) expect(delphineUnpack(volumes.readRaw(entry), entry.extSize).length, entry.name).toBe(entry.extSize);
  });

  it("rend le contenu connu : palette seule « PAL\\0 », fond 256 couleurs", () => {
    const volumes = CruiseVolumes.open((name) => original.read(name));
    const raw = volumes.readRaw(volumes.find("I00.PI1")!);
    const background = delphineUnpack(raw, 64_770);
    expect(Array.from(background.subarray(0, 2))).toEqual([0, 8]);
  });
});
