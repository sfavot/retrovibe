import { describe, expect, it } from "vitest";
import { findNamedMarker, parseSong, tickToMs } from "../../src/audio/smf";
import { LOOP_END_MARKER, LOOP_START_MARKER, parseHmi } from "../../src/audio/hmi";
import { ResourceIndex } from "../../src/games/tim3/data/volume";
import { originalFiles } from "../support/original";

const original = originalFiles("tim3", "RESOURCE.MAP");

/** Piste synthétique : en-tête de 0x57 + 4 octets, évènements à `dataOffset`. */
function track(events: number[]): number[] {
  const head = new Array(0x60).fill(0);
  [..."HMI-MIDITRACK"].forEach((c, i) => (head[i] = c.charCodeAt(0)));
  head[0x57] = 0x60;
  return [...head, ...events, 0x00, 0xff, 0x2f, 0x00];
}

function song(tracks: number[][], ticksPerSecond = 120): Uint8Array {
  const table = 0x172;
  const first = table + 4 * tracks.length;
  const out = new Uint8Array(first + tracks.reduce((n, t) => n + t.length, 0));
  [..."HMI-MIDISONG061595"].forEach((c, i) => (out[i] = c.charCodeAt(0)));
  const view = new DataView(out.buffer);
  view.setUint16(0xd4, ticksPerSecond, true);
  view.setUint32(0xe4, tracks.length, true);
  view.setUint32(0xe8, table, true);
  let at = first;
  tracks.forEach((t, i) => {
    view.setUint32(table + 4 * i, at, true);
    out.set(t, at);
    at += t.length;
  });
  return out;
}

describe("parseHmi", () => {
  it("recrée le Note Off d'après la durée qui suit le Note On, avec le running status", () => {
    const s = parseHmi(song([track([0x00, 0xc1, 0x05, 0x10, 0x91, 0x3c, 0x64, 0x20, 0x00, 0x3e, 0x50, 0x81, 0x00])]));
    const midi = s.events.filter((e) => e.kind === "midi").map((e) => [e.tick, [...(e as { bytes: Uint8Array }).bytes]]);
    expect(midi).toEqual([
      [0, [0xc1, 5]],
      [16, [0x91, 60, 100]],
      [16, [0x91, 62, 80]],
      [48, [0x81, 60, 0]],
      [16 + 128, [0x81, 62, 0]],
    ].sort((a, b) => (a[0] as number) - (b[0] as number)));
    expect(s.endTick).toBe(144);
    expect(s.events.at(-1)?.kind).toBe("end");
  });

  it("place le Note Off d'une note avant le Note On suivant au même instant", () => {
    const s = parseHmi(song([track([0x00, 0x90, 0x40, 0x7f, 0x10, 0x10, 0x40, 0x7f, 0x10])]));
    const kinds = s.events.filter((e) => e.kind === "midi" && e.tick === 16).map((e) => (e as { bytes: Uint8Array }).bytes[0]);
    expect(kinds).toEqual([0x80, 0x90]);
  });

  it("a un tempo fixe de 120 ticks par seconde et la même forme qu'un Song de smf.ts", () => {
    const s = parseHmi(song([track([0x00, 0x90, 0x40, 0x7f, 0x0a])]));
    expect(s.division).toBe(120);
    expect(s.tempoMap).toEqual([{ tick: 0, ms: 0, microsPerQuarter: 1_000_000 }]);
    expect(tickToMs(s.tempoMap, s.division, 120)).toBe(1000);
    expect(s.endMs).toBeCloseTo((10 * 1000) / 120);
    expect(s.events[0]).toMatchObject({ kind: "tempo", microsPerQuarter: 1_000_000 });
    // même interface que parseSong : les mêmes champs
    const smf = parseSong(Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 120, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4, 0, 0xff, 0x2f, 0]));
    expect(Object.keys(s).sort()).toEqual([...Object.keys(smf), "loop", "tracks"].sort());
  });

  it("expose la boucle FE 14 / FE 15 en marqueurs et en champ `loop`", () => {
    const s = parseHmi(
      song([
        track([0x00, 0xfe, 0x14, 0xff, 0xff, 0x00, 0xfe, 0x10, 0x80, 0x01, 0x02, 0x68, 0x00, 0xf4, 0x02, 0x00, 0x00, 0x78, 0x90, 0x40, 0x7f, 0x10, 0x00, 0xfe, 0x15, 0x80, 0x01, 0x6e, 0, 0, 0]),
      ]),
    );
    expect(s.loop).toEqual({ startTick: 0, startMs: 0, endTick: 0x78, endMs: 1000 });
    expect(findNamedMarker(s.events, LOOP_START_MARKER)?.tick).toBe(0);
    expect(findNamedMarker(s.events, LOOP_END_MARKER)?.tick).toBe(0x78);
  });

  it("refuse les entrées invalides", () => {
    expect(() => parseHmi(new Uint8Array(400))).toThrow(/signature/);
    const good = song([track([0x00, 0x90, 0x40, 0x7f, 0x10])]);
    expect(() => parseHmi(good.subarray(0, good.length - 3))).toThrow(/tronquée/);
    expect(() => parseHmi(song([track([0x00, 0x90, 0x90, 0x7f, 0x10])]))).toThrow(/invalide/);
    expect(() => parseHmi(song([track([0x00, 0xfe, 0x77, 0, 0])]))).toThrow(/inconnu/);
    expect(() => parseHmi(song([track([0x00, 0x40, 0x10])]))).toThrow(/running status/);
    expect(() => parseHmi(song([track([])], 0))).toThrow(/cadence/);
  });
});

describe.skipIf(!original.has)("musiques HMI de TIM3", () => {
  const index = new ResourceIndex().add(original.read("RESOURCE.MAP"), (n) => original.read(n));
  const names = Array.from({ length: 24 }, (_, i) => `SX_${1000 + i}.HMI`);

  it("les 24 morceaux existent", () => {
    for (const name of names) expect(index.has(name), name).toBe(true);
  });

  it("se lisent jusqu'au dernier octet, avec des évènements valides et une durée plausible", () => {
    const durations: number[] = [];
    let looping = 0;
    for (const name of names) {
      const s = parseHmi(index.get(name));
      expect(s.tracks.length, name).toBeGreaterThanOrEqual(2);
      for (const t of s.tracks) expect(t.parsedEnd, name).toBe(t.end);
      let on = 0;
      let off = 0;
      for (const e of s.events) {
        if (e.kind !== "midi") continue;
        const [status, a, b] = e.bytes;
        expect(status & 0x80, name).toBe(0x80);
        expect(a & 0x80, name).toBe(0);
        if (b !== undefined) expect(b & 0x80, name).toBe(0);
        if ((status & 0xf0) === 0x90) on++;
        if ((status & 0xf0) === 0x80) off++;
      }
      expect(on, name).toBe(s.tracks.reduce((n, t) => n + t.notes, 0));
      expect(off, name).toBe(on);
      expect(s.events.every((e, i, all) => i === 0 || all[i - 1].tick <= e.tick), name).toBe(true);
      durations.push(s.endMs / 1000);
      if (s.loop) {
        looping++;
        expect(s.loop.startTick, name).toBeLessThan(s.loop.endTick);
        expect(s.loop.endTick, name).toBeLessThanOrEqual(s.endTick);
      }
    }
    // Entre 10 s (jingle SX_1022) et 3 min ; 23 morceaux sur 24 bouclent.
    expect(Math.min(...durations)).toBeGreaterThan(10);
    expect(Math.max(...durations)).toBeLessThan(180);
    expect(looping).toBe(23);
    console.info(`HMI durées : min ${Math.min(...durations).toFixed(1)} s, max ${Math.max(...durations).toFixed(1)} s`);
  });
});
