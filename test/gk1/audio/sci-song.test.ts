import { describe, expect, it } from "vitest";
import { ResourceType, SoundDevice } from "../../../src/games/gk1/data/ids";
import { readSound, type SoundChannel, type SoundTrack, trackFor } from "../../../src/games/gk1/data/sound";
import { firstEventAt, parseSong, parseTrack, type SciSong, SongEventType, songLoopPoints, songSignals } from "../../../src/games/gk1/audio/sci-song";
import { mainIndex, original, tally } from "../data/real";

function channel(number: number, data: number[], flags = 0, voices = 1, priority = 0): SoundChannel {
  return { offset: 0, size: data.length + 2, number, flags, voices, priority, data: Uint8Array.from(data) };
}

function track(...channels: SoundChannel[]): SoundTrack {
  return { device: SoundDevice.GeneralMidi, channels };
}

/** Évènements lisibles : `tick type canal statut a b`. */
function lines(song: SciSong): string[] {
  const names = Object.fromEntries(Object.entries(SongEventType).map(([name, value]) => [value, name]));
  return song.events.map((e) => `${e.tick} ${names[e.type]} c${e.channel} ${e.status.toString(16)} ${e.a} ${e.b}`);
}

describe("flux MIDI d'un canal", () => {
  it("lit deltas, F8, statut courant, note-on de vélocité nulle, et s'arrête à FC", () => {
    const song = parseTrack(track(channel(1, [0, 0xc1, 48, 0, 0xb1, 7, 100, 0, 10, 64, 0xf8, 5, 0x91, 60, 100, 10, 60, 0, 3, 0xfc, 0])));
    expect(lines(song)).toEqual(["0 Midi c1 c0 48 0", "0 Midi c1 b0 7 100", "0 Midi c1 b0 10 64", "245 Midi c1 90 60 100", "255 Midi c1 80 60 0"]);
    expect(song.endTick).toBe(258);
    expect(song.channels).toEqual([{ number: 1, voices: 1, priority: 0, dontRemap: false, muted: false }]);
    expect(song.ignored).toBe(0);
  });

  it("fusionne les canaux par date, et à date égale dans l'ordre de la piste", () => {
    const song = parseTrack(
      track(channel(2, [0, 0x92, 60, 90, 10, 60, 0, 0, 0xfc]), channel(9, [0, 0x99, 36, 80, 5, 36, 0, 5, 38, 70, 0, 0xfc], 2, 3, 1), channel(2, [10, 0x92, 64, 90, 0, 0xfc])),
    );
    expect(lines(song)).toEqual([
      "0 Midi c2 90 60 90",
      "0 Midi c9 90 36 80",
      "5 Midi c9 80 36 0",
      "10 Midi c2 80 60 0",
      "10 Midi c9 90 38 70",
      "10 Midi c2 90 64 90",
    ]);
    // Un canal présent deux fois n'est décrit qu'une fois ; drapeau 2 : ne pas réaffecter.
    expect(song.channels.map((c) => [c.number, c.dontRemap, c.voices, c.priority])).toEqual([
      [2, false, 1, 0],
      [9, true, 3, 1],
    ]);
  });

  it("traduit le canal 15 : signaux, point de boucle, repère, maintien, réverbération", () => {
    const control = [0, 0xcf, 0, 0, 0xbf, 0x50, 127, 0, 10, 64, 20, 0xcf, 127, 30, 10, 5, 0xbf, 0x60, 0, 0, 0x52, 3, 0, 0xef, 0, 64, 0, 0xfc];
    const song = parseTrack(track(channel(15, control), channel(3, [0, 0xb3, 0x4b, 2, 0, 0x4e, 1, 0, 0x50, 4, 60, 0xfc])));
    expect(lines(song)).toEqual([
      "0 Signal c15 0 0 0",
      "0 Reverb c15 0 127 0",
      "0 Voices c3 0 2 0",
      "0 Mute c3 0 1 0",
      "0 Reverb c3 0 4 0",
      "20 LoopPoint c15 0 0 0",
      "50 Signal c15 0 10 0",
      "55 Cue c15 0 1 0",
      "55 Hold c15 0 3 0",
    ]);
    // Écartés : le panoramique et la molette du canal 15 (deux octets chacun).
    expect(song.ignored).toBe(4);
    expect(song.channels.map((c) => c.number)).toEqual([3]);
    expect(song.endTick).toBe(60);
    expect(songSignals(song)).toEqual([
      { tick: 0, value: 0 },
      { tick: 50, value: 10 },
    ]);
    expect(songLoopPoints(song)).toEqual([20]);
    expect(firstEventAt(song, 20)).toBe(5);
    expect(firstEventAt(song, 21)).toBe(6);
    expect(firstEventAt(song, 1000)).toBe(song.events.length);
  });

  it("écarte un message système et refuse un flux tronqué", () => {
    const song = parseTrack(track(channel(1, [0, 0xf0, 0x41, 0x10, 0xf7, 4, 0x91, 60, 1, 0, 0xfc])));
    expect(lines(song)).toEqual(["4 Midi c1 90 60 1"]);
    expect(song.ignored).toBe(3);
    expect(() => parseTrack(track(channel(1, [0, 0x91, 60])))).toThrow(/tronqué/);
    expect(() => parseTrack(track(channel(1, [0, 0xf0, 1, 2])))).toThrow(/sans fin/);
    expect(() => parseTrack(track(channel(1, [0, 60, 1])))).toThrow(/inattendu/);
  });
});

describe.skipIf(!original.has)("sons réels", () => {
  const sound = (n: number) => readSound(mainIndex().get(ResourceType.Sound, n));
  const song = (n: number, device: number = SoundDevice.GeneralMidi) => parseSong(sound(n), device)!;

  it("son 1 : trois signaux, pas de boucle", () => {
    const s = song(1);
    expect(s.priority).toBe(sound(1).priority);
    expect([s.events.length, s.endTick, s.ignored]).toMatchInlineSnapshot(`
      [
        392,
        778,
        4,
      ]
    `);
    expect(s.channels.map((c) => `${c.number}${c.dontRemap ? "*" : ""}`).join(" ")).toMatchInlineSnapshot(`"1 2 3 4 5 6 9*"`);
    expect(songSignals(s)).toMatchInlineSnapshot(`
      [
        {
          "tick": 0,
          "value": 0,
        },
        {
          "tick": 317,
          "value": 10,
        },
        {
          "tick": 569,
          "value": 20,
        },
        {
          "tick": 627,
          "value": 30,
        },
      ]
    `);
    expect(songLoopPoints(s)).toEqual([]);
    expect([...tally(s.events.map((e) => e.type))].sort()).toMatchInlineSnapshot(`
      [
        [
          0,
          387,
        ],
        [
          1,
          4,
        ],
        [
          5,
          1,
        ],
      ]
    `);
  });

  it("son 100 : deux points de boucle, pas de signal", () => {
    const s = song(100);
    expect([s.events.length, s.endTick, s.ignored]).toMatchInlineSnapshot(`
      [
        4333,
        4442,
        4,
      ]
    `);
    expect(songLoopPoints(s)).toMatchInlineSnapshot(`
      [
        0,
        1379,
      ]
    `);
    expect(songSignals(s)).toEqual([]);
  });

  it("un son sans piste General MIDI n'a pas de morceau pour ce pilote", () => {
    expect(parseSong(sound(215), SoundDevice.GeneralMidi)).toBeUndefined();
    expect(parseSong(sound(215), SoundDevice.Mt32)?.channels.map((c) => c.number)).toEqual([1]);
    expect(parseSong(sound(264), SoundDevice.GeneralMidi)).toBeUndefined();
  });

  it("toutes les pistes de tous les périphériques se lisent ; signaux, boucles et contrôleurs relevés", () => {
    const numbers = mainIndex().numbers(ResourceType.Sound);
    const perDevice = new Map<number, number>();
    const signals = new Map<number, number>();
    const types = new Map<string, number>();
    const controllers = new Map<number, number>();
    const voices = new Map<string, number>();
    let loops = 0;
    let ignored = 0;
    let lateEnd = 0;
    let trailing = 0;
    for (const n of numbers) {
      const data = sound(n);
      for (const t of data.tracks) {
        const parsed = parseTrack(t, data.priority);
        perDevice.set(t.device, (perDevice.get(t.device) ?? 0) + 1);
        // Les évènements sont triés et aucun ne dépasse la fin.
        for (let i = 1; i < parsed.events.length; i++) expect(parsed.events[i].tick).toBeGreaterThanOrEqual(parsed.events[i - 1].tick);
        if (parsed.events.length > 0) expect(parsed.events.at(-1)!.tick).toBeLessThanOrEqual(parsed.endTick);
        if (t.device !== SoundDevice.GeneralMidi) continue;
        ignored += parsed.ignored;
        loops += songLoopPoints(parsed).length;
        for (const s of songSignals(parsed)) signals.set(s.value, (signals.get(s.value) ?? 0) + 1);
        for (const e of parsed.events) {
          const name = Object.entries(SongEventType).find(([, v]) => v === e.type)![0];
          types.set(name, (types.get(name) ?? 0) + 1);
          if (e.type === SongEventType.Midi && e.status === 0xb0) controllers.set(e.a, (controllers.get(e.a) ?? 0) + 1);
        }
        for (const c of t.channels) {
          // FC est toujours précédé d'un delta nul ; un octet nul le suit quand il faut une taille paire.
          const end = c.data.lastIndexOf(0xfc);
          if (c.data[end - 1] !== 0) lateEnd++;
          if (end !== c.data.length - 1) {
            trailing++;
            expect(c.data.length - 1 - end).toBe(1);
            expect(c.data.at(-1)).toBe(0);
          }
          expect(c.size % 2).toBe(0);
          // Seule la batterie garde son numéro.
          expect(c.flags).toBe(c.number === 9 ? 2 : 0);
          if (c.number !== 15) voices.set(`${c.voices} voix, priorité ${c.priority}`, (voices.get(`${c.voices} voix, priorité ${c.priority}`) ?? 0) + 1);
        }
      }
    }
    expect(numbers).toHaveLength(288);
    expect([...perDevice].sort((a, b) => a[0] - b[0])).toMatchInlineSnapshot(`
      [
        [
          0,
          286,
        ],
        [
          6,
          209,
        ],
        [
          7,
          275,
        ],
        [
          9,
          1,
        ],
        [
          11,
          257,
        ],
        [
          12,
          286,
        ],
        [
          18,
          285,
        ],
        [
          19,
          228,
        ],
      ]
    `);
    expect([...signals].sort((a, b) => a[0] - b[0])).toMatchInlineSnapshot(`
      [
        [
          0,
          2,
        ],
        [
          10,
          3,
        ],
        [
          20,
          2,
        ],
        [
          30,
          1,
        ],
      ]
    `);
    expect([...types].sort()).toMatchInlineSnapshot(`
      [
        [
          "Hold",
          1,
        ],
        [
          "LoopPoint",
          214,
        ],
        [
          "Midi",
          153467,
        ],
        [
          "Reverb",
          209,
        ],
        [
          "Signal",
          8,
        ],
      ]
    `);
    expect([...controllers].sort((a, b) => a[0] - b[0])).toMatchInlineSnapshot(`
      [
        [
          1,
          206,
        ],
        [
          7,
          1979,
        ],
        [
          10,
          452,
        ],
        [
          64,
          5940,
        ],
      ]
    `);
    expect([...voices].sort()).toMatchInlineSnapshot(`
      [
        [
          "0 voix, priorité 0",
          1,
        ],
        [
          "1 voix, priorité 0",
          438,
        ],
        [
          "1 voix, priorité 1",
          6,
        ],
        [
          "1 voix, priorité 2",
          2,
        ],
      ]
    `);
    expect({ loops, ignored, lateEnd, trailing }).toMatchInlineSnapshot(`
      {
        "ignored": 1808,
        "lateEnd": 0,
        "loops": 214,
        "trailing": 499,
      }
    `);
  });

  it("81 pistes General MIDI ne sont pas la piste MT-32", () => {
    let different = 0;
    let both = 0;
    for (const n of mainIndex().numbers(ResourceType.Sound)) {
      const data = sound(n);
      const gm = trackFor(data, SoundDevice.GeneralMidi);
      const mt32 = trackFor(data, SoundDevice.Mt32);
      if (!gm || !mt32) continue;
      both++;
      if (gm.channels.map((c) => c.offset).join() !== mt32.channels.map((c) => c.offset).join()) different++;
    }
    expect([both, different]).toEqual([275, 81]);
  });
});
