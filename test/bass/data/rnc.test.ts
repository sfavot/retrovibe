import { describe, expect, it } from "vitest";
import { RncError, crc16, hasRnc1Signature, rnc1Unpack } from "../../../src/games/bass/data/rnc";
import { DATA_FILE_HEADER_SIZE } from "../../../src/games/bass/data/header";
import { hasOriginalFiles, readOriginal, skyDisk } from "./helpers";

/**
 * Écrit des bits poids faible d'abord dans des mots `u16` LE, comme le décodeur les lit. Un mot est réservé à son premier bit : les octets
 * littéraux ajoutés ensuite se placent après lui, et les bits suivants continuent de remplir ce mot (le décodeur garde ses bits restants).
 */
class BitWriter {
  readonly bytes: number[] = [];
  private slot = 0;
  private count = 0;
  put(value: number, n: number): void {
    for (let i = 0; i < n; i++) this.bit((value >> i) & 1);
  }
  /** Un code de Huffman part par son bit de poids fort. */
  code(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bit((value >> i) & 1);
  }
  literals(...values: number[]): void {
    this.bytes.push(...values);
  }
  private bit(b: number): void {
    if (this.count === 0) {
      this.slot = this.bytes.length;
      this.bytes.push(0, 0);
    }
    this.bytes[this.slot + (this.count >> 3)]! |= b << (this.count & 7);
    this.count = (this.count + 1) % 16;
  }
}

/** Flux RNC méthode 1 de `abcabc` : littéraux « abc » puis copie (distance 3, longueur 3) ; un seul bloc de deux entrées. */
function syntheticStream(): { stream: Uint8Array; expected: Uint8Array } {
  const w = new BitWriter();
  w.put(0, 2);
  // Littéraux : symboles 0, 1, 2 sur 2 bits (codes 00, 01, 10).
  w.put(3, 5);
  for (let i = 0; i < 3; i++) w.put(2, 4);
  // Distances : même table. Longueurs : symboles 0 et 1 sur 1 bit (codes 0 et 1).
  w.put(3, 5);
  for (let i = 0; i < 3; i++) w.put(2, 4);
  w.put(2, 5);
  for (let i = 0; i < 2; i++) w.put(1, 4);
  w.put(2, 16);
  // Entrée 1 : 3 littéraux (symbole 2 = code 10, un bit supplémentaire à 1 : valeur 3), puis distance 3 (symbole 2, bit 0 : valeur 2 → 3)
  // et longueur 3 (symbole 1 : valeur 1 → 3).
  w.code(2, 2);
  w.put(1, 1);
  w.literals(0x61, 0x62, 0x63);
  w.code(2, 2);
  w.put(0, 1);
  w.code(1, 1);
  // Entrée 2 : aucun littéral (symbole 0 = code 00), pas de copie (dernière entrée).
  w.code(0, 2);

  const body = Uint8Array.from(w.bytes);
  const expected = Uint8Array.from([0x61, 0x62, 0x63, 0x61, 0x62, 0x63]);
  const header = new Uint8Array(18);
  const view = new DataView(header.buffer);
  header.set([0x52, 0x4e, 0x43, 0x01]);
  view.setUint32(4, expected.length, false);
  view.setUint32(8, body.length, false);
  view.setUint16(12, crc16(expected), false);
  view.setUint16(14, crc16(body), false);
  header[17] = 1;
  return { stream: Uint8Array.from([...header, ...body]), expected };
}

describe("RNC méthode 1 (données synthétiques)", () => {
  it("calcule le CRC-16 de polynôme 0xA001", () => {
    expect(crc16(new Uint8Array())).toBe(0);
    expect(crc16(Uint8Array.from(Buffer.from("123456789")))).toBe(0xbb3d);
  });

  it("reconnaît la signature", () => {
    expect(hasRnc1Signature(Uint8Array.from([0x52, 0x4e, 0x43, 0x01, 0]))).toBe(true);
    expect(hasRnc1Signature(Uint8Array.from([0x52, 0x4e, 0x43, 0x02]))).toBe(false);
    expect(hasRnc1Signature(new Uint8Array(2))).toBe(false);
  });

  it("décompresse un flux minimal (littéraux et copie recouvrante)", () => {
    const { stream, expected } = syntheticStream();
    expect(rnc1Unpack(stream)).toEqual(expected);
  });

  it("ignore les octets qui suivent le flux", () => {
    const { stream, expected } = syntheticStream();
    expect(rnc1Unpack(Uint8Array.from([...stream, 1, 2, 3]))).toEqual(expected);
  });

  it("refuse une signature absente, un flux tronqué et les CRC faux", () => {
    const { stream } = syntheticStream();
    expect(() => rnc1Unpack(new Uint8Array(30))).toThrow(RncError);
    expect(() => rnc1Unpack(stream.subarray(0, stream.length - 2))).toThrow(/tronqué/);
    const badPacked = stream.slice();
    badPacked[20]! ^= 1;
    expect(() => rnc1Unpack(badPacked)).toThrow(/CRC du flux compressé/);
    const badOutput = stream.slice();
    badOutput[13]! ^= 1;
    expect(() => rnc1Unpack(badOutput)).toThrow(/CRC de la sortie/);
  });

  it("refuse une taille décompressée aberrante", () => {
    const { stream } = syntheticStream();
    new DataView(stream.buffer).setUint32(4, 0x7fffffff, false);
    expect(() => rnc1Unpack(stream)).toThrow(/aberrante/);
  });
});

describe.skipIf(!hasOriginalFiles)("RNC méthode 1 (fichiers du jeu)", () => {
  /** Octets stockés de chaque fichier suivis d'une signature RNC (hors fichiers marqués « non compressés »). */
  function rncPayloads(): Array<{ id: number; packed: Uint8Array }> {
    const dsk = readOriginal("sky.dsk");
    const out: Array<{ id: number; packed: Uint8Array }> = [];
    for (const entry of skyDisk().entries) {
      if (entry.uncompressed || entry.storedSize < DATA_FILE_HEADER_SIZE) continue;
      const packed = dsk.subarray(entry.offset + DATA_FILE_HEADER_SIZE, entry.offset + entry.storedSize);
      if ((dsk[entry.offset]! & 0x80) !== 0 && hasRnc1Signature(packed)) out.push({ id: entry.id, packed });
    }
    return out;
  }

  it("décompresse les 1 273 flux RNC hors voix, deux CRC valides, taille égale à celle de l'en-tête", () => {
    const payloads = rncPayloads();
    expect(payloads).toHaveLength(1273);
    for (const { id, packed } of payloads) {
      const out = rnc1Unpack(packed);
      const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
      expect(out.length, `fichier ${id}`).toBe(view.getUint32(4, false));
    }
  });

  it("rejette un fichier dont on a corrompu un octet", () => {
    const { packed } = rncPayloads().find((p) => p.id === 12)!;
    const bad = Uint8Array.from(packed);
    bad[bad.length - 1]! ^= 0xff;
    expect(() => rnc1Unpack(bad)).toThrow(RncError);
    const badOutputCrc = Uint8Array.from(packed);
    badOutputCrc[12]! ^= 0xff;
    expect(() => rnc1Unpack(badOutputCrc)).toThrow(/CRC de la sortie/);
  });
});
