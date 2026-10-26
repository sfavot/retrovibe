import { describe, expect, it } from "vitest";
import type { PlayOptions, SoundSink } from "../../../src/games/swiv3d/audio";
import { VolumeSink } from "../../../src/games/swiv3d/ui/volume-sink";

function recorder() {
  const calls: { play: number[]; gain: number[] } = { play: [], gain: [] };
  const sink = {
    createBuffer: () => 0,
    play: (_b: number, o: PlayOptions) => (calls.play.push(o.gain), 1),
    setGain: (_v: number, g: number) => void calls.gain.push(g),
    setPan: () => {},
    setRate: () => {},
    stop: () => {},
    setMuted: () => {},
  } as SoundSink;
  return { sink, calls };
}

describe("volume des effets", () => {
  it("multiplie le gain des sons joués et celui des changements de gain", () => {
    const { sink, calls } = recorder();
    const volume = new VolumeSink(sink);
    volume.play(0, { loop: false, gain: 0.5, pan: 0, rate: 1, onEnded: () => {} });
    volume.setScale(0.5);
    volume.play(0, { loop: false, gain: 0.5, pan: 0, rate: 1, onEnded: () => {} });
    volume.setGain(1, 0.8);
    expect(calls.play).toEqual([0.5, 0.25]);
    expect(calls.gain).toEqual([0.4]);
  });
});
