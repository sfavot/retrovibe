import { describe, expect, it } from "vitest";
import { isRiffWave, parseRiffWave, riffWaveToChannels } from "../../src/data/riff-wave";

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16 = (v: number) => [v & 255, v >> 8];
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const chunk = (tag: string, body: number[]) => [...text(tag), ...u32(body.length), ...body, ...(body.length & 1 ? [0] : [])];

function wav(data: number[], opts: { channels?: number; bits?: number; rate?: number; extra?: number[] } = {}): Uint8Array {
  const { channels = 1, bits = 8, rate = 11025, extra = [] } = opts;
  const fmt = [...u16(1), ...u16(channels), ...u32(rate), ...u32((rate * channels * bits) / 8), ...u16((channels * bits) / 8), ...u16(bits)];
  const body = [...text("WAVE"), ...chunk("fmt ", fmt), ...extra, ...chunk("data", data)];
  return new Uint8Array([...text("RIFF"), ...u32(body.length), ...body]);
}

describe("RIFF WAVE", () => {
  it("lit un PCM 8 bits mono", () => {
    const bytes = wav([0, 128, 255]);
    expect(isRiffWave(bytes)).toBe(true);
    const w = parseRiffWave(bytes);
    expect(w).toMatchObject({ format: 1, channels: 1, sampleRate: 11025, bitsPerSample: 8 });
    expect([...w.data]).toEqual([0, 128, 255]);
    expect([...riffWaveToChannels(w)[0]]).toEqual([-1, 0, 127 / 128]);
  });

  it("lit un PCM 16 bits stéréo", () => {
    const w = parseRiffWave(wav([...u16(0x4000), ...u16(0x8000), ...u16(0), ...u16(0xc000)], { channels: 2, bits: 16, rate: 22050 }));
    expect(w.sampleRate).toBe(22050);
    const [l, r] = riffWaveToChannels(w);
    expect([...l]).toEqual([0.5, 0]);
    expect([...r]).toEqual([-1, -0.5]);
  });

  it("saute les blocs inconnus, y compris de taille impaire (padding)", () => {
    const w = parseRiffWave(wav([1, 2], { extra: chunk("LIST", [9, 9, 9]) }));
    expect([...w.data]).toEqual([1, 2]);
  });

  it("gère un bloc data de taille impaire suivi d'un autre bloc", () => {
    const bytes = wav([1, 2, 3], { extra: [] });
    expect(parseRiffWave(bytes).data).toHaveLength(3);
  });

  it("rejette une mauvaise signature", () => {
    const bad = wav([0]);
    bad[0] = 0x58;
    expect(isRiffWave(bad)).toBe(false);
    expect(() => parseRiffWave(bad)).toThrow(/RIFF/);
    const notWave = wav([0]);
    notWave[8] = 0x58;
    expect(() => parseRiffWave(notWave)).toThrow(/WAVE/);
  });

  it("rejette l'absence de fmt ou de data", () => {
    const body = [...text("WAVE"), ...chunk("junk", [1, 2])];
    expect(() => parseRiffWave(new Uint8Array([...text("RIFF"), ...u32(body.length), ...body]))).toThrow(/fmt/);
  });

  it("refuse les formats non pris en charge à la conversion", () => {
    const w = { ...parseRiffWave(wav([0])), bitsPerSample: 24 };
    expect(() => riffWaveToChannels(w)).toThrow(/non pris en charge/);
  });
});
