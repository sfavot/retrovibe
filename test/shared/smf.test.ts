import { describe, expect, it } from "vitest";
import { parseSong } from "../../src/audio/smf";

/** Un fichier de format 0 : un tempo, un `FF 7F` (octets bruts), une note et la fin de piste. */
function sample(): Uint8Array {
  const track = [
    0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, // 500 000 µs par noire
    0, 0xff, 0x7f, 6, 0, 0, 0x3f, 0, 2, 1, // méta propre au séquenceur (Queen : mode rythme)
    0x83, 0x60, 0x90, 60, 100, // 480 ticks plus tard
    0, 0xff, 0x2f, 0,
  ];
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]; // 480 ticks par noire
  return Uint8Array.from([...head, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track]);
}

describe("parseSong : méta-événement FF 7F", () => {
  it("garde les octets bruts, à leur date, sans toucher aux autres événements", () => {
    const song = parseSong(sample());
    const special = song.events.find((e) => e.kind === "sequencerSpecific");
    expect(special).toBeDefined();
    expect(special?.kind === "sequencerSpecific" && [...special.data]).toEqual([0, 0, 0x3f, 0, 2, 1]);
    expect(special?.ms).toBe(0);
    const note = song.events.find((e) => e.kind === "midi");
    expect(note?.ms).toBe(500);
    expect(song.events.map((e) => e.kind)).toEqual(["tempo", "sequencerSpecific", "midi", "end"]);
  });

  it("la copie ne dépend pas du tampon source", () => {
    const bytes = sample();
    const song = parseSong(bytes);
    bytes.fill(0);
    const special = song.events.find((e) => e.kind === "sequencerSpecific");
    expect(special?.kind === "sequencerSpecific" && special.data[2]).toBe(0x3f);
  });
});
