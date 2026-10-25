import { describe, expect, it } from "vitest";
import { MIN_BUFFER_RATE, createMonoBuffer, s16leToFloat32, s8ToFloat32, u8ToFloat32 } from "../../src/audio/pcm";

describe("conversions PCM", () => {
  it("convertit le 8 bits non signé (0x80 = silence)", () => {
    expect([...u8ToFloat32(new Uint8Array([0, 128, 192, 255]))]).toEqual([-1, 0, 0.5, 127 / 128]);
  });

  it("convertit le 8 bits signé", () => {
    expect([...s8ToFloat32(new Int8Array([-128, 0, 64, 127]))]).toEqual([-1, 0, 0.5, 127 / 128]);
  });

  it("désentrelace le 16 bits signé little-endian", () => {
    // trames (L, R) : (0x4000, -0x8000), (-1, 0)
    const bytes = new Uint8Array([0x00, 0x40, 0x00, 0x80, 0xff, 0xff, 0x00, 0x00]);
    expect([...s16leToFloat32(bytes, 2, 0)]).toEqual([0.5, -1 / 32768]);
    expect([...s16leToFloat32(bytes, 2, 1)]).toEqual([-1, 0]);
    expect(s16leToFloat32(bytes, 1, 0)).toHaveLength(4);
  });

  it("ignore un échantillon 16 bits incomplet", () => {
    expect(s16leToFloat32(new Uint8Array([0, 0, 0]), 1, 0)).toHaveLength(1);
  });
});

describe("createMonoBuffer", () => {
  function fakeContext() {
    const calls: { channels: number; length: number; rate: number }[] = [];
    const copied: Float32Array[] = [];
    const ctx = {
      createBuffer(channels: number, length: number, rate: number) {
        calls.push({ channels, length, rate });
        const channel = new Float32Array(length);
        copied.push(channel);
        return { getChannelData: () => channel };
      },
    } as unknown as BaseAudioContext;
    return { ctx, calls, copied };
  }

  it("relève la fréquence au minimum de Web Audio", () => {
    const { ctx, calls } = fakeContext();
    createMonoBuffer(ctx, new Float32Array(4), 1000);
    expect(calls[0]).toEqual({ channels: 1, length: 4, rate: MIN_BUFFER_RATE });
  });

  it("conserve une fréquence suffisante et copie les échantillons", () => {
    const { ctx, calls, copied } = fakeContext();
    const samples = new Float32Array([0.25, -0.5]);
    createMonoBuffer(ctx, samples, 11025);
    expect(calls[0].rate).toBe(11025);
    expect([...copied[0]]).toEqual([0.25, -0.5]);
  });
});
