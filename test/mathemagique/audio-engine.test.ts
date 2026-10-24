import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SoundBankLoader } from "spessasynth_core";
import { SoundPrefs, soundPrefKey } from "../../src/ui/sound-prefs";
import { parseMidi } from "../../src/games/mathemagique/data/midi";
import { MohawkArchive, TAG_SND } from "../../src/games/mathemagique/data/mohawk";
import { loadPcm, pcmFromWave } from "../../src/games/mathemagique/audio/pcm";
import { collectPrograms, presetKey } from "../../src/games/mathemagique/audio/programs";
import { rhythmRewrite } from "../../src/games/mathemagique/audio/rhythm-rewrite";
import { MidiPlayer, parsePrograms, parseSysx, type PlayOptions } from "../../src/games/mathemagique/audio/sequencer";
import type { MidiSink } from "../../src/games/mathemagique/audio/sink";
import { type Song, bpmOf, isNoteOn, parseSong } from "../../src/games/mathemagique/audio/smf";
import { hasOriginalFiles, readOriginal } from "./helpers";

// --- Données synthétiques ------------------------------------------------------------------------------------------

const text = (s: string) => [...new TextEncoder().encode(s)];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];

function wave(samples: number[], rate = 11025): Uint8Array {
  const data = [...be16(rate), ...be32(samples.length), 8, 1, ...be16(0), ...be16(0), ...be32(0), ...be32(0), ...samples];
  const body = [...text("WAVE"), ...text("Data"), ...be32(data.length), ...data];
  return Uint8Array.from([...text("MHWK"), ...be32(body.length), ...body]);
}

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
};

/** Événement à un tick absolu : `[tick, ...octets]` (méta : `0xff, type, longueur, ...données`). */
type Ev = [number, ...number[]];
const meta = (tick: number, type: number, data: number[]): Ev => [tick, 0xff, type, ...vlq(data.length), ...data];
const marker = (tick: number, label: string, type = 0x06): Ev => meta(tick, type, text(label));
const tempo = (tick: number, micros: number): Ev => meta(tick, 0x51, [(micros >> 16) & 255, (micros >> 8) & 255, micros & 255]);
const end = (tick: number): Ev => meta(tick, 0x2f, []);

function smf(events: Ev[], division = 480): Uint8Array {
  let last = 0;
  const track = [...events].sort((a, b) => a[0] - b[0]).flatMap(([tick, ...bytes]) => {
    const delta = tick - last;
    last = tick;
    return [...vlq(delta), ...bytes];
  });
  return Uint8Array.from([...text("MThd"), ...be32(6), ...be16(0), ...be16(1), ...be16(division), ...text("MTrk"), ...be32(track.length), ...track]);
}

/** 120 bpm à 480 ticks par noire : 1 tick = 1000 / 960 ms, 960 ticks = 1 s. */
const T120 = 500_000;
const ms = (tick: number) => (tick * 500) / 480;

class FakeSink implements MidiSink {
  sent: { bytes: number[]; at: number | undefined }[] = [];
  resets = 0;
  send(message: Uint8Array, atMs?: number): void {
    this.sent.push({ bytes: [...message], at: atMs });
  }
  reset(): void {
    this.resets++;
  }
  notes(on = true) {
    return this.sent.filter((m) => (m.bytes[0] & 0xf0) === (on ? 0x90 : 0x80) && (!on || m.bytes[2] > 0));
  }
}

function setup(events: Ev[], config: { init?: Uint8Array[]; lookaheadMs?: number } = {}) {
  const sink = new FakeSink();
  const clock = { t: 1000 };
  const player = new MidiPlayer(sink, { now: () => clock.t, initMessages: config.init, lookaheadMs: config.lookaheadMs });
  const song = parseSong(smf(events));
  /** Avance l'horloge par tranches de 17 ms (tick du moteur), jusqu'à `until`. */
  const run = (until: number) => {
    while (clock.t < until) {
      clock.t = Math.min(until, clock.t + 17);
      player.tick();
    }
  };
  return { sink, clock, player, song, run };
}

// --- WAVE ----------------------------------------------------------------------------------------------------------

describe("pcm (WAVE → PcmSound)", () => {
  it("convertit le PCM 8 bits non signé en flottants et garde la fréquence", () => {
    const sound = pcmFromWave(wave([0x00, 0x80, 0xff, 0xc0], 22050));
    expect(sound.sampleRate).toBe(22050);
    expect([...sound.samples]).toEqual([-1, 0, 127 / 128, 0.5]);
  });

  it("met en cache par (archive, id)", () => {
    let reads = 0;
    const archive = { get: (_tag: string, id: number) => (reads++, wave([id])) } as unknown as MohawkArchive;
    const other = { get: () => wave([9]) } as unknown as MohawkArchive;
    expect(loadPcm(archive, 7)).toBe(loadPcm(archive, 7));
    expect(reads).toBe(1);
    expect(loadPcm(archive, 8)).not.toBe(loadPcm(archive, 7));
    expect(loadPcm(other, 7)).not.toBe(loadPcm(archive, 7));
  });

  it.runIf(hasOriginalFiles)("convertit un vrai WAVE du jeu", () => {
    const archive = MohawkArchive.parse(readOriginal("MAINSCRN.DAT"));
    const id = archive.ids(TAG_SND).find((n) => !archive.get(TAG_SND, n).subarray(8, 12).every((b, i) => b === "MIDI".charCodeAt(i)))!;
    const sound = loadPcm(archive, id);
    expect(sound.sampleRate).toBeGreaterThan(0);
    expect(sound.samples.length).toBeGreaterThan(0);
    expect(Math.max(...sound.samples.subarray(0, 4096).map(Math.abs))).toBeLessThanOrEqual(1);
  });
});

// --- Lecture SMF ---------------------------------------------------------------------------------------------------

describe("parseSong", () => {
  it("trie les événements, applique le statut courant et calcule le temps avec la table des tempos", () => {
    const track: Ev[] = [
      tempo(0, T120),
      [0, 0xc1, 5],
      [0, 0x91, 60, 100],
      [480, 0x91, 62, 100], // statut courant écrit tel quel par l'encodeur de test (statut répété) : lu comme message complet
      tempo(960, 250_000), // 240 bpm à partir de la noire 2
      marker(960, "loop end "),
      [1440, 0x81, 60, 0],
      end(1920),
    ];
    const song = parseSong(smf(track));
    expect(song.division).toBe(480);
    expect(song.tempoMap.map((t) => [t.tick, t.ms])).toEqual([[0, 0], [960, 1000]]);
    expect(song.endTick).toBe(1920);
    expect(song.endMs).toBe(1000 + 500); // 960 ticks à 240 bpm = 500 ms
    expect(song.events.map((e) => e.kind)).toEqual(["tempo", "midi", "midi", "midi", "tempo", "marker", "midi", "end"]);
    expect(song.events.find((e) => e.kind === "marker")).toMatchObject({ text: "loop end ", ms: 1000 });
    expect(bpmOf(T120)).toBe(120);
  });

  it("lit le running status, les SysEx, le nom, la mesure, et refuse la division SMPTE", () => {
    // Piste écrite à la main : Note On 0x90 60 100, puis running status 62 100, SysEx F0 02 7E F7, nom, mesure 3/4.
    const trackBytes = [
      0, 0xff, 0x03, 3, ...text("abc"),
      0, 0xff, 0x58, 4, 3, 2, 24, 8,
      0, 0x90, 60, 100,
      10, 62, 100,
      0, 0xf0, 3, 0x7e, 0x7f, 0xf7,
      0, 0xff, 0x2f, 0,
    ];
    const file = Uint8Array.from([...text("MThd"), ...be32(6), ...be16(0), ...be16(1), ...be16(96), ...text("MTrk"), ...be32(trackBytes.length), ...trackBytes]);
    const song = parseSong(file);
    expect(song.name).toBe("abc");
    expect(song.beatsPerBar).toBe(3);
    const messages = song.events.filter((e) => e.kind === "midi").map((e) => (e.kind === "midi" ? [...e.bytes] : []));
    expect(messages).toEqual([[0x90, 60, 100], [0x90, 62, 100], [0xf0, 0x7e, 0x7f, 0xf7]]);
    const smpte = Uint8Array.from(file);
    smpte[12] = 0xe7;
    expect(() => parseSong(smpte)).toThrow(/SMPTE/);
  });

  it("ajoute une fin de piste quand elle manque et distingue marqueurs et points de repère", () => {
    const song = parseSong(smf([[0, 0x90, 60, 100], marker(100, "a", 0x07), marker(200, "x")]));
    expect(song.events.at(-1)).toMatchObject({ kind: "end", tick: 200 });
    expect(song.events.filter((e) => e.kind === "marker").map((e) => (e.kind === "marker" ? e.metaType : 0))).toEqual([7, 6]);
  });
});

describe("parsePrograms, parseSysx", () => {
  it("lit le bloc Prg# et les messages d'initialisation, en ignorant le bourrage", () => {
    expect(parsePrograms(Uint8Array.from([0, 2, 0, 5, 0x02, 0, 0, 0x2d, 0, 3]))).toEqual([
      { program: 5, channelMask: 0x200 },
      { program: 0x2d, channelMask: 3 },
    ]);
    expect(parsePrograms(new Uint8Array(0))).toEqual([]);
    const messages = parseSysx(Uint8Array.from([0xb0, 0x79, 0, 0xc1, 5, 0xb2, 7, 127, 0, 0]));
    expect(messages.map((m) => [...m])).toEqual([[0xb0, 0x79, 0], [0xc1, 5], [0xb2, 7, 127]]);
  });
});

// --- Séquenceur ----------------------------------------------------------------------------------------------------

describe("MidiPlayer", () => {
  const base: Ev[] = [tempo(0, T120), [0, 0x90, 60, 100], [480, 0x80, 60, 0], marker(960, "x", 0x07), end(960)];

  it("démarre par reset, initialisation (SYSX) puis programmes (Prg#), avant la première note", () => {
    const { sink, player, song, clock } = setup(base, { init: [Uint8Array.of(0xb0, 0x79, 0), Uint8Array.of(0xb0, 7, 127)] });
    player.play(song, { programs: [{ program: 5, channelMask: 0b101 }] });
    expect(sink.resets).toBe(1);
    expect(sink.sent.map((m) => m.bytes)).toEqual([[0xb0, 0x79, 0], [0xb0, 7, 127], [0xc0, 5], [0xc2, 5], [0x90, 60, 100]]);
    expect(sink.sent[0].at).toBe(clock.t);
    expect(sink.sent.at(-1)!.at).toBe(clock.t + 20); // première note après le délai de départ
  });

  it("planifie dans la fenêtre d'avance avec l'heure exacte, et signale les repères à leur heure", () => {
    const { sink, player, song, clock, run } = setup(base);
    const markers: { text: string; at: number }[] = [];
    const start = clock.t;
    player.play(song, { onMarker: (m) => markers.push({ text: m.text, at: clock.t }) });
    expect(sink.notes(false)).toHaveLength(0); // note off à +520 ms : hors fenêtre (100 ms)
    run(start + 450);
    expect(sink.notes(false).map((m) => m.at)).toEqual([start + 20 + 500]);
    run(start + 20 + 960); // juste avant le repère (planifié à +980)
    expect(markers).toEqual([]);
    run(start + 20 + ms(960) + 17);
    expect(markers).toHaveLength(1);
    expect(markers[0].text).toBe("x");
    expect(markers[0].at).toBeGreaterThanOrEqual(start + 20 + ms(960));
    expect(markers[0].at).toBeLessThan(start + 20 + ms(960) + 17);
  });

  it("appelle onEnd une fois à la fin d'un morceau qui ne boucle pas", () => {
    const { player, song, clock, run } = setup(base);
    let ended = 0;
    player.play(song, { onEnd: () => ended++ });
    expect(player.playing).toBe(true);
    run(clock.t + 20 + ms(960) - 1);
    expect(ended).toBe(0);
    run(clock.t + 100);
    expect(ended).toBe(1);
    expect(player.playing).toBe(false);
    run(clock.t + 500);
    expect(ended).toBe(1);
  });

  it("stop coupe tout, n'envoie plus rien et n'appelle pas onEnd", () => {
    const { sink, player, song, clock, run } = setup(base);
    let ended = 0;
    player.play(song, { onEnd: () => ended++ });
    const count = sink.sent.length;
    player.stop();
    expect(sink.resets).toBe(2); // départ + arrêt
    run(clock.t + 2000);
    expect(sink.sent).toHaveLength(count);
    expect(ended).toBe(0);
  });

  describe("boucle", () => {
    // setup end au tick 2, note courte à chaque 480 ticks, loop end au tick 1919, fin au tick 1920.
    const looped: Ev[] = [
      tempo(0, T120),
      marker(2, "setup end"),
      [3, 0x90, 60, 100],
      [3 + 100, 0x80, 60, 0],
      [483, 0x90, 64, 100], // tenue au-delà de la boucle
      marker(1919, "loop end "),
      [1919, 0x80, 64, 0],
      end(1920),
    ];

    it("repart de setup end à loop end, sans dérive, en coupant les notes tenues", () => {
      const { sink, player, song, clock, run } = setup(looped);
      const start = clock.t;
      let markers = 0;
      player.play(song, { loop: true, onMarker: () => markers++ });
      run(start + 6100);
      const first = sink.notes().filter((m) => m.bytes[1] === 60);
      expect(first.length).toBeGreaterThanOrEqual(4);
      const period = ms(1919) - ms(2);
      for (let i = 1; i < first.length; i++) expect(first[i].at! - first[i - 1].at!).toBeCloseTo(period, 6);
      expect(player.playing).toBe(true);
      expect(markers).toBe(7); // setup end (4 passages) + loop end (3 fins de tour)
    });

    it("loop start prime sur setup end ; les noms ignorent la casse et les espaces", () => {
      const withStart: Ev[] = [...looped.slice(0, 3), marker(400, " Loop Start"), ...looped.slice(3)];
      const { sink, player, song, clock, run } = setup(withStart);
      const start = clock.t;
      player.play(song, { loop: true });
      run(start + 3000);
      const note60 = sink.notes().filter((m) => m.bytes[1] === 60);
      expect(note60).toHaveLength(1); // la note 60 (tick 3) précède loop start : jouée une seule fois
      const note64 = sink.notes().filter((m) => m.bytes[1] === 64);
      expect(note64[1].at! - note64[0].at!).toBeCloseTo(ms(1919) - ms(400), 6);
    });

    it("sans repère de boucle, boucle sur toute la durée ; respecte loopMarkers", () => {
      const { sink, player, song, clock, run } = setup([tempo(0, T120), [0, 0x90, 60, 100], marker(480, "fin"), [480, 0x80, 60, 0], end(960)]);
      const start = clock.t;
      player.play(song, { loop: true });
      run(start + 2500);
      expect(sink.notes().map((m) => m.at)).toEqual([start + 20, start + 20 + 1000, start + 20 + 2000]);

      const other = setup([tempo(0, T120), [0, 0x90, 60, 100], marker(480, "fin"), [480, 0x80, 60, 0], end(960)]);
      other.player.play(other.song, { loop: true, loopMarkers: { end: "fin" } });
      other.run(other.clock.t + 1400);
      expect(other.sink.notes().length).toBeGreaterThanOrEqual(2);
      expect(other.sink.notes()[1].at).toBeCloseTo(other.sink.notes()[0].at! + 500, 6);
    });

    it("coupe les notes tenues à la fin du tour", () => {
      const { sink, player, song, clock, run } = setup(looped);
      const start = clock.t;
      player.play(song, { loop: true });
      run(start + 2300);
      const offs = sink.notes(false).filter((m) => m.bytes[1] === 64);
      expect(offs.length).toBeGreaterThanOrEqual(1);
      expect(offs[0].at).toBeCloseTo(start + 20 + ms(1919), 6);
    });
  });

  it("startMarker : commence au repère, ne garde des événements qui le précèdent que les réglages", () => {
    const events: Ev[] = [tempo(0, T120), [0, 0xb0, 7, 90], [0, 0x90, 60, 100], [100, 0x80, 60, 0], marker(480, "go"), [480, 0x90, 62, 100], end(960)];
    const { sink, player, song, clock } = setup(events);
    player.play(song, { startMarker: "go" });
    expect(sink.sent.map((m) => m.bytes)).toEqual([[0xb0, 7, 90], [0x90, 62, 100]]);
    expect(sink.sent[1].at).toBe(clock.t + 20);
    expect(sink.sent[0].at).toBe(clock.t);
  });

  it("applique le hook de réécriture et le tempo de départ", () => {
    const { sink, player, song, clock, run } = setup(base);
    const silence: PlayOptions["rewrite"] = (events) => events.map((e) => (e.kind === "midi" && isNoteOn(e.bytes) ? { ...e, bytes: Uint8Array.of(e.bytes[0], e.bytes[1], 0) } : e));
    player.play(song, { rewrite: silence, bpm: 240 });
    expect(sink.sent.some((m) => isNoteOn(Uint8Array.from(m.bytes)))).toBe(false);
    expect(player.bpm).toBe(240);
    run(clock.t + 300);
    expect(sink.notes(false).map((m) => m.at)).toEqual([expect.closeTo(clock.t - 300 + 20 + 250, 6)]); // 500 ms à 240 bpm
  });

  it("setBpm change la vitesse sans inverser l'ordre des événements", () => {
    const events: Ev[] = [tempo(0, T120), ...[0, 1, 2, 3, 4, 5].map((n): Ev => [n * 480, 0x90, 60 + n, 100]), end(2880)];
    const { sink, player, song, clock, run } = setup(events);
    const start = clock.t;
    player.play(song);
    run(start + 600);
    player.setBpm(240);
    run(start + 4000);
    const times = sink.notes().map((m) => m.at!);
    expect(times).toHaveLength(6);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // avant le changement : écart de 500 ms ; après : de 250 ms
    expect(times[1] - times[0]).toBeCloseTo(500, 6);
    expect(times[5] - times[4]).toBeCloseTo(250, 6);
    expect(() => player.setBpm(0)).toThrow();
  });
});

// --- Réécriture du Rhythm Shop -------------------------------------------------------------------------------------

describe("rhythmRewrite", () => {
  const cue = (tick: number, label: string) => marker(tick, label, 0x07);
  // Deux mesures de deux emplacements : a (tick 0) et b (tick 480), temps 1 à 0 et 2 à 480 ; mesure à 960.
  const rhythm: Ev[] = [
    tempo(0, T120),
    cue(0, "1"), cue(0, "a"), [0, 0x90, 60, 100], [100, 0x80, 60, 0],
    cue(480, "2"), cue(480, "b"), [480, 0x90, 62, 100], [580, 0x80, 62, 0],
    cue(960, "1"), cue(960, "a"), [960, 0x90, 60, 100],
    cue(1440, "b"), [1440, 0x90, 62, 100],
    end(1920),
  ];

  it("ne garde qu'une mesure et met les notes des emplacements vides à vélocité 0", () => {
    const song = parseSong(smf(rhythm));
    const rewrite = rhythmRewrite([true, false]); // a rempli, b vide
    const events = rewrite(song.events, song);
    expect(events.at(-1)).toMatchObject({ kind: "end", tick: 960 });
    expect(events.filter((e) => e.kind === "end")).toHaveLength(1);
    const noteOns = events.filter((e) => e.kind === "midi" && (e.bytes[0] & 0xf0) === 0x90);
    expect(noteOns.map((e) => (e.kind === "midi" ? [e.bytes[1], e.bytes[2]] : []))).toEqual([[60, 100], [62, 0]]);
    expect(events.every((e) => e.tick < 960 || e.kind === "end")).toBe(true);
    // Les originaux ne sont pas modifiés.
    expect(song.events.filter((e) => e.kind === "midi" && e.bytes[2] === 0 && (e.bytes[0] & 0xf0) === 0x90)).toHaveLength(0);
  });

  it("joué par le séquenceur : la note muette part avec vélocité 0 et le morceau s'arrête à la fin de la mesure", () => {
    const { sink, player, song, clock, run } = setup(rhythm);
    let ended = 0;
    player.play(song, { rewrite: rhythmRewrite([true, false]), onEnd: () => ended++ });
    run(clock.t + 1200);
    expect(sink.sent.filter((m) => (m.bytes[0] & 0xf0) === 0x90).map((m) => m.bytes.slice(1))).toEqual([[60, 100], [62, 0]]);
    expect(ended).toBe(1);
  });

  it("laisse le morceau intact s'il n'a pas les repères a et 1", () => {
    const song = parseSong(smf([tempo(0, T120), [0, 0x90, 60, 100], end(480)]));
    expect(rhythmRewrite([true])(song.events, song)).toHaveLength(song.events.length);
  });
});

// --- Préférence « Son » --------------------------------------------------------------------------------------------

describe("SoundPrefs (générique)", () => {
  const store = () => {
    const data = new Map<string, string>();
    return { data, get: (k: string) => data.get(k) ?? null, set: (k: string, v: string) => (data.set(k, v), true) };
  };
  const target = () => ({ muted: false, setMuted(m: boolean) { this.muted = m; } });

  it("est activée par défaut, une clé par jeu, '0' = coupé", () => {
    expect(soundPrefKey("mathemagique")).toBe("retrovibe:mathemagique:sound");
    const s = store();
    const t = target();
    const prefs = new SoundPrefs(s, t, "mathemagique");
    expect(prefs.isEnabled()).toBe(true);
    expect(t.muted).toBe(false);
    expect(prefs.toggle()).toBe(false);
    expect(t.muted).toBe(true);
    expect(s.data.get("retrovibe:mathemagique:sound")).toBe("0");
    expect(prefs.toggle()).toBe(true);
    expect(s.data.get("retrovibe:mathemagique:sound")).toBe("1");
  });

  it("relit la valeur enregistrée au démarrage et à reload()", () => {
    const s = store();
    s.data.set("retrovibe:mathemagique:sound", "0");
    const t = target();
    const prefs = new SoundPrefs(s, t, "mathemagique");
    expect(prefs.isEnabled()).toBe(false);
    expect(t.muted).toBe(true);
    expect(prefs.reload()).toBe(false);
    s.data.set("retrovibe:mathemagique:sound", "1");
    expect(prefs.reload()).toBe(true);
    expect(t.muted).toBe(false);
    // Un autre jeu a sa propre clé.
    expect(new SoundPrefs(s, target(), "autre").isEnabled()).toBe(true);
  });
});

// --- Données réelles -----------------------------------------------------------------------------------------------

describe.runIf(hasOriginalFiles)("MIDI et soundfont du jeu", () => {
  const midis = new Map<number, ReturnType<typeof parseMidi>>();
  const songs = new Map<number, Song>();
  const archive = MohawkArchive.parse(readOriginal("MIDIMPC.DAT"));
  for (const id of archive.ids(TAG_SND)) {
    const resource = parseMidi(archive.get(TAG_SND, id));
    midis.set(id, resource);
    songs.set(id, parseSong(resource.smf));
  }

  it("lit Fanfare (101) : événements, durée, repères, Prg#", () => {
    const fanfare = songs.get(101)!;
    expect(fanfare.name).toBe("101Fanfare.mff");
    expect(fanfare.beatsPerBar).toBe(4);
    expect(fanfare.events.filter((e) => e.kind === "tempo")).toHaveLength(1);
    expect(fanfare.events.filter((e) => e.kind === "midi")).toHaveLength(335);
    expect(fanfare.events.filter((e) => e.kind === "midi" && isNoteOn(e.bytes))).toHaveLength(159);
    expect(fanfare.events.filter((e) => e.kind === "marker")).toHaveLength(61);
    expect(bpmOf(fanfare.tempoMap[0].microsPerQuarter)).toBeCloseTo(170, 0);
    expect(fanfare.endTick).toBe(21120);
    expect(fanfare.endMs).toBeCloseTo(15529.4, 1);
    const cues = fanfare.events.filter((e) => e.kind === "marker").map((e) => (e.kind === "marker" ? `${e.text}@${e.tick}` : ""));
    expect(cues.slice(0, 5)).toEqual(["1@0", "a@0", "2@479", "3@959", "b@959"]);
    expect(cues.at(-1)).toBe("z - end@19200");
    expect(parsePrograms(midis.get(101)!.programs)).toEqual([
      { program: 0, channelMask: 0x200 },
      { program: 32, channelMask: 2 },
      { program: 47, channelMask: 1 },
      { program: 56, channelMask: 0x14 },
      { program: 63, channelMask: 8 },
    ]);
  });

  it("retrouve les totaux documentés des 45 morceaux (15 931 notes, 367 pitch bends)", () => {
    expect(songs.size).toBe(45);
    const usage = collectPrograms(songs.values());
    expect(usage.noteOns).toBe(15931);
    expect(usage.pitchBends).toBe(367);
  });

  it("Fanfare rejoué en entier par le séquenceur : mêmes notes que le fichier, marqueurs dans l'ordre", () => {
    const { sink, player, clock, run } = setup([]);
    const fanfare = songs.get(101)!;
    const seen: string[] = [];
    player.play(fanfare, { onMarker: (m) => seen.push(m.text), programs: parsePrograms(midis.get(101)!.programs) });
    run(clock.t + 16_000);
    expect(sink.notes()).toHaveLength(159);
    expect(seen).toHaveLength(61);
    expect(seen.slice(0, 3)).toEqual(["1", "a", "2"]);
    expect(player.playing).toBe(false);
  });

  it("MIDIMAP.DAT : 64 messages d'initialisation CC121/7/11/10 sur 16 canaux", () => {
    const sysx = parseSysx(MohawkArchive.parse(readOriginal("MIDIMAP.DAT")).get("SYSX", 1));
    expect(sysx).toHaveLength(64);
    const byController = new Map<number, Set<number>>();
    for (const [status, controller, value] of sysx) {
      expect(status & 0xf0).toBe(0xb0);
      byController.set(controller, (byController.get(controller) ?? new Set()).add(value));
    }
    expect([...byController].sort((a, b) => a[0] - b[0]).map(([c, v]) => [c, [...v]])).toEqual([[7, [127]], [10, [64]], [11, [90]], [121, [0]]]);
    expect(new Set(sysx.map((m) => m[0] & 0x0f)).size).toBe(16);
  });

  const soundfont = resolve(import.meta.dirname, "../../original/mathemagique/mathemagique-gm.sf2");
  it.runIf(existsSync(soundfont))("la soundfont réduite contient tous les timbres joués par les 66 MIDI", () => {
    const all: Song[] = [];
    const dir = resolve(import.meta.dirname, "../../original/mathemagique");
    for (const file of JSON.parse(readFileSync(resolve(dir, "files.json"), "utf8")).map((e: { path: string }) => e.path).filter((p: string) => /\.DAT$/.test(p))) {
      const a = MohawkArchive.parse(readFileSync(resolve(dir, file)));
      for (const id of a.ids(TAG_SND)) {
        const bytes = a.get(TAG_SND, id);
        if (String.fromCharCode(...bytes.subarray(8, 12)) === "MIDI") all.push(parseSong(parseMidi(bytes).smf));
      }
    }
    expect(all).toHaveLength(66);
    const usage = collectPrograms(all);
    expect(usage.presets.size).toBeGreaterThan(70);
    const buffer = readFileSync(soundfont);
    const bank = SoundBankLoader.fromArrayBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    for (const preset of usage.presets.values()) {
      if (preset.bank !== 0 && !preset.drum) continue; // banques non nulles absentes des données
      const found = bank.getPreset({ program: preset.program, bankMSB: preset.drum ? 128 : 0, bankLSB: 0, isGMGSDrum: preset.drum }, "gm");
      expect(found.zones.length, presetKey(preset.drum, preset.bank, preset.program)).toBeGreaterThan(0);
    }
    expect(bank.presets.length).toBeLessThan(120);
  });
});
