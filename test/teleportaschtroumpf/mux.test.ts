import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MuxDecoder } from "../../src/games/teleportaschtroumpf/data/mux";
import { hasOriginalFiles, listData, readData, withExtension } from "./helpers";

const sha1 = (bytes: Uint8Array, length = 40) => createHash("sha1").update(bytes).digest("hex").slice(0, length);

/** Fichiers MUX : tous les `.MUX` plus `S20/S20H/S20H` (même format, sans extension). */
const muxFiles = () => [...listData(withExtension("MUX")), "S20/S20H/S20H"];

/** Compte les chunks 05 d'un fichier, indépendamment du décodeur. */
function countFrameChunks(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = view.getUint32(0x20, true) & 0x3fffffff;
  let count = 0;
  while (pos + 6 <= bytes.length && bytes[pos] !== 0x04) {
    if (bytes[pos] === 0x05) count++;
    pos += 6 + view.getUint32(pos + 2, true);
  }
  return count;
}

/** Hash attendus (SHA-1 des pixels, 12 premiers caractères de celui de la palette) produits par `scripts/teleportaschtroumpf/proto/mux.py`. */
const EXPECTED: Record<string, { frames: number; hashes: Record<number, [string, string]> }> = {
  "S01/S01B/S01B.MUX": {
    frames: 152,
    hashes: {
      0: ["fea8172889f65c6f647c7a245a625eb48a263279", "30be7c42251c"],
      76: ["c217bf4b1827b53d5635de982ffa079463588828", "30be7c42251c"],
      151: ["fea8172889f65c6f647c7a245a625eb48a263279", "30be7c42251c"],
    },
  },
  "S06/S06A/S06A.MUX": {
    frames: 1346,
    hashes: {
      0: ["7a2d7a2b4a3d3af4267ec333486722e9cdb9b60f", "e3476e0f6976"],
      673: ["7192d5c227ff19d540f8ca6926ec03cefa735770", "6a75d443f4be"],
      1345: ["e1d38afd43fe6821d70a9b7b34f618d5479811d3", "def1adf860af"],
    },
  },
  "S20/S20H/S20H": {
    frames: 20,
    hashes: {
      0: ["fbac5008c852978282b0e9ccaf0cb19e2c80dfe3", "422752f9b74c"],
      1: ["b265d728cebaf10bf15d5f63bdb372659074886a", "422752f9b74c"],
      10: ["98484df1875178a938c5b9e8cf4f0e4be4611739", "b44a97c2c407"],
      19: ["d8ceea5c0a33139be8c4b14e77690b014e401b41", "b44a97c2c407"],
    },
  },
  "S27/S27E/S27E.MUX": {
    frames: 432,
    hashes: {
      0: ["9843503d1be102316b93fa4a4d6d2a7e33dc53e8", "302ed3ef347f"],
      216: ["9a40516311693fa52d403fb73ea2444b2da2a64b", "ff1d4db713ec"],
      431: ["4864a34a8035ebad5d2645fc2aa70b622992b93a", "e0d8c05d8346"],
    },
  },
};

describe("MuxDecoder (sans fichier)", () => {
  it("refuse une signature invalide", () => {
    const bytes = new Uint8Array(0x1800);
    bytes[0] = 0x07;
    bytes[1] = 0xab;
    expect(() => new MuxDecoder(bytes)).toThrow(/signature/);
  });

  it("refuse un fichier trop court", () => {
    expect(() => new MuxDecoder(new Uint8Array(8))).toThrow(/trop court/);
  });
});

describe.skipIf(!hasOriginalFiles)("MuxDecoder (fichiers originaux)", () => {
  it("décode tous les MUX, une image par chunk 05", { timeout: 120_000 }, () => {
    const files = muxFiles();
    expect(files.length).toBe(233);
    for (const file of files) {
      const bytes = readData(file);
      const decoder = new MuxDecoder(bytes);
      expect(decoder.header.width, file).toBe(320);
      expect(decoder.header.height, file).toBe(200);
      let count = 0;
      for (let frame = decoder.nextFrame(); frame; frame = decoder.nextFrame()) {
        expect(frame.index, file).toBe(count);
        count++;
      }
      expect(count, file).toBe(countFrameChunks(bytes));
      expect(decoder.nextFrame(), file).toBeNull();
    }
  });

  it("déduit la cadence du diviseur", () => {
    const { header } = new MuxDecoder(readData("S01/S01B/S01B.MUX"));
    expect(header.frameDivisor).toBe(9039);
    expect(header.framesPerSecond).toBeCloseTo(11, 1);
    expect(header.audioFrequency).toBe(18867);
  });

  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`reproduit les pixels du prototype pour ${file}`, { timeout: 30_000 }, () => {
      const decoder = new MuxDecoder(readData(file));
      let count = 0;
      for (let frame = decoder.nextFrame(); frame; frame = decoder.nextFrame()) {
        const hashes = expected.hashes[frame.index];
        if (hashes) {
          expect(sha1(decoder.pixels), `${file} #${frame.index}`).toBe(hashes[0]);
          expect(sha1(decoder.palette, 12), `${file} #${frame.index} palette`).toBe(hashes[1]);
        }
        count++;
      }
      expect(count).toBe(expected.frames);
    });
  }

  it("reset() rejoue la même séquence", () => {
    const decoder = new MuxDecoder(readData("S20/S20H/S20H"));
    while (decoder.nextFrame());
    const last = sha1(decoder.pixels);
    decoder.reset();
    expect(decoder.pixels.every((v) => v === 0)).toBe(true);
    let count = 0;
    while (decoder.nextFrame()) count++;
    expect(count).toBe(20);
    expect(sha1(decoder.pixels)).toBe(last);
  });

  it("renvoie l'audio par image", () => {
    const decoder = new MuxDecoder(readData("S01/S01B/S01B.MUX"));
    let audioBytes = 0;
    for (let frame = decoder.nextFrame(); frame; frame = decoder.nextFrame()) {
      for (const chunk of frame.audio) audioBytes += chunk.length;
    }
    expect(audioBytes).toBeGreaterThan(0);
  });
});
