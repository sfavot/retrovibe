import { describe, expect, it } from "vitest";
import { readSoundEffect } from "../../../src/games/tim3/data/wave";
import { baseIndex, namesWithExtension, original } from "./real";

function wav(bits: 8 | 16, rate: number, samples: number[]): Uint8Array {
  const dataSize = samples.length * (bits / 8);
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  out.set([..."RIFFxxxxWAVEfmt "].map((c) => c.charCodeAt(0)));
  view.setUint32(4, out.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * (bits / 8), true);
  view.setUint16(32, bits / 8, true);
  view.setUint16(34, bits, true);
  out.set([..."data"].map((c) => c.charCodeAt(0)), 36);
  view.setUint32(40, dataSize, true);
  samples.forEach((s, i) => (bits === 8 ? view.setUint8(44 + i, s) : view.setInt16(44 + 2 * i, s, true)));
  return out;
}

describe("effets sonores", () => {
  it("lit du PCM 8 et 16 bits", () => {
    const a = readSoundEffect(wav(8, 11025, [128, 255, 0]));
    expect([a.sampleRate, a.bitsPerSample, a.channels.length, a.channels[0].length]).toEqual([11025, 8, 1, 3]);
    expect(a.channels[0][0]).toBe(0);
    const b = readSoundEffect(wav(16, 22050, [0, 16384, -32768]));
    expect(b.channels[0][1]).toBe(0.5);
    expect(b.duration).toBeCloseTo(3 / 22050);
  });

  it("refuse un fichier avec reste ou tronqué", () => {
    const ok = wav(8, 11025, [1, 2, 3, 4]);
    expect(readSoundEffect(Uint8Array.from([...ok, 7, 8])).trailer).toEqual(Uint8Array.from([7, 8]));
    const longer = ok.slice();
    new DataView(longer.buffer).setUint32(4, ok.length, true);
    expect(() => readSoundEffect(longer)).toThrow(/structure/);
    expect(() => readSoundEffect(ok.subarray(0, ok.length - 1))).toThrow(/structure/);
  });
});

describe.skipIf(!original.has)("WAV réels", () => {
  it("lit les 121 effets : 120 en 8 bits 11 025 Hz, SX_3400 en 16 bits 22 050 Hz", () => {
    const names = namesWithExtension(baseIndex(), "WAV");
    expect(names.length).toBe(121);
    let total = 0;
    const withTrailer: string[] = [];
    for (const name of names) {
      const fx = readSoundEffect(baseIndex().get(name));
      total += fx.duration;
      if (fx.trailer.length > 0) withTrailer.push(`${name}:${fx.trailer.length}`);
      if (name.toUpperCase() === "SX_3400.WAV") expect([fx.sampleRate, fx.bitsPerSample]).toEqual([22050, 16]);
      else expect([fx.sampleRate, fx.bitsPerSample], name).toEqual([11025, 8]);
    }
    expect(withTrailer).toEqual(["SX_3400.WAV:470"]);
    expect(total).toBeGreaterThan(80);
    expect(total).toBeLessThan(95);
  });
});
