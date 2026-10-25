import { describe, expect, it } from "vitest";
import { bankData, parseMix } from "../../src/games/armaeth/data/mix";
import {
  EFFECT_ENTRY_SIZE,
  EFFECT_SLOTS,
  INSTRUMENT_SIZE,
  MIDI_DRUM_NOTES,
  NOTE_COUNT,
  NOTE_DURATIONS,
  OPL_OPERATOR_OFFSETS,
  OPL_VOICE_OPERATORS_MELODIC,
  OPL_VOICE_OPERATORS_RHYTHM,
  PATTERN_TABLE_OFFSET,
  PITCH_ENVELOPE_SIZE,
  SPEAKER_DIVISORS,
  decodePattern,
  midiNote,
  oplFrequency,
  parseSongBank,
  readDriverTables,
  trackSteps,
} from "../../src/games/armaeth/data/music";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("motifs", () => {
  it("décode chaque famille de codes", () => {
    const pattern = decodePattern(Uint8Array.of(0xdf, 0xa3, 0xe3, 0x25, 0x84, 0x24, 0x00, 0xe0, 0x02, 0xe1, 0x01, 0xe2, 0x03, 0xe7, 0xff, 0x55), 0);
    expect(pattern.bytes).toHaveLength(15);
    expect(pattern.events).toEqual([
      { kind: "volume", level: 31 },
      { kind: "instrument", index: 3 },
      { kind: "instrument", index: 0x25 },
      { kind: "duration", index: 4, ticks: 8 },
      { kind: "note", note: 0x24 },
      { kind: "note", note: 0 },
      { kind: "transpose", value: 2 },
      { kind: "pitchEnvelope", index: 1 },
      { kind: "effectTempo", value: 3 },
      { kind: "nop", code: 0xe7 },
    ]);
  });

  it("ne prend pas 0xFF pour fin quand il est argument", () => {
    expect(decodePattern(Uint8Array.of(0xe3, 0xff, 0xe0, 0xff, 0xff), 0).events).toHaveLength(2);
  });

  it("refuse un motif sans marque de fin", () => {
    expect(() => decodePattern(Uint8Array.of(0x24, 0x26), 0)).toThrow(/MUS invalide/);
  });
});

describe("tables du pilote", () => {
  it("ont les bonnes tailles", () => {
    expect(NOTE_DURATIONS).toHaveLength(16);
    expect(SPEAKER_DIVISORS).toHaveLength(108);
    expect(MIDI_DRUM_NOTES).toHaveLength(5);
    expect(OPL_OPERATOR_OFFSETS).toHaveLength(18);
    expect(OPL_VOICE_OPERATORS_MELODIC).toHaveLength(18);
    expect(OPL_VOICE_OPERATORS_RHYTHM).toHaveLength(22);
  });

  it("calculent les fréquences OPL2 et MIDI", () => {
    expect(oplFrequency(0)).toBe(0x159);
    expect(oplFrequency(12)).toBe(0x559);
    expect(oplFrequency(95)).toBe(0x1e8b);
    expect(midiNote(36)).toBe(48);
  });
});

/** Banque synthétique : un sous-morceau de 2 voix déclarées (9 en vrai), 1 motif, 1 instrument, 1 effet. */
function syntheticBank(): Uint8Array {
  const base = 2;
  const head = 12 + 22; // en-tête + pointeurs de piste = 0x22
  const patterns = [head + 2]; // table d'un motif
  const lists = head + 2; // listes : 11 x [0, 0xFF]
  const patternStart = lists + 11 * 2;
  const pattern = [0xa1, 0x84, 0x24, 0xff];
  const pitch = patternStart + pattern.length;
  const instruments = pitch + PITCH_ENVELOPE_SIZE;
  const midi = instruments + INSTRUMENT_SIZE;
  const effects = midi + 1;
  const bytes: number[] = [];
  const word = (v: number) => bytes.push(v & 0xff, v >> 8);
  word(base);
  word(3); // tempo
  word(2); // voix
  word(midi);
  word(effects);
  word(pitch);
  word(instruments);
  for (let k = 0; k < 11; k++) word(lists + 2 * k);
  word(patternStart);
  expect(patterns).toEqual([head + 2]);
  for (let k = 0; k < 11; k++) bytes.push(0, 0xff);
  bytes.push(...pattern);
  bytes.push(0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1); // enveloppe neutre
  bytes.push(0, 0x01, 0x21, 0x10, 0xf2, 0x07, 0x00, 0x22, 0x80, 0xf1, 0x74, 0x01); // instrument
  bytes.push(0x38); // programme MIDI
  for (let e = 0; e < EFFECT_SLOTS; e++) bytes.push(...(e === 0 ? [0, 0xff, 0xff, 0xff, 0xff] : [0xff, 0xff, 0xff, 0xff, 0xff]));
  return Uint8Array.from(bytes);
}

describe("parseSongBank : banque synthétique", () => {
  const bank = parseSongBank(syntheticBank());
  const song = bank.songs[0];

  it("lit l'en-tête et les tables", () => {
    expect(bank.songOffsets).toEqual([2]);
    expect(song).toMatchObject({ tempo: 3, voiceCount: 2, offset: 2 });
    expect(song.patterns).toHaveLength(1);
    expect(song.patterns[0].events).toEqual([
      { kind: "instrument", index: 1 },
      { kind: "duration", index: 4, ticks: 8 },
      { kind: "note", note: 0x24 },
    ]);
    expect(song.trackLists).toHaveLength(11);
    expect(song.trackLists.every((l) => l.length === 1 && l[0] === 0)).toBe(true);
    expect(song.pitchEnvelopes).toHaveLength(1);
    expect(song.pitchEnvelopes[0].segments).toEqual(Array(4).fill({ count: 1, delta: 0, ticks: 1 }));
    expect(song.instruments).toHaveLength(1);
    expect(song.instruments[0]).toMatchObject({ feedbackConnection: 1, modulator: { characteristics: 0x21, levels: 0x10 }, carrier: { waveform: 1 } });
    expect([...song.midiPrograms]).toEqual([0x38]);
    expect(song.effects).toHaveLength(EFFECT_SLOTS);
    expect(song.effects[0]).toEqual([0]);
    expect(song.effects[1]).toEqual([]);
    expect(trackSteps(song, 0)).toBe(8);
  });

  it("refuse les structures incohérentes", () => {
    const bytes = syntheticBank();
    bytes[4] = 12; // nombre de voix
    expect(() => parseSongBank(bytes)).toThrow(/voix/);
    expect(() => parseSongBank(Uint8Array.of(1, 0))).toThrow(/sous-morceaux/);
    expect(() => parseSongBank(syntheticBank().subarray(0, 100))).toThrow(/MUS invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("pilote et musiques d'Armaeth (fichiers du jeu)", () => {
  const exe = readOriginal("AM1.EXE");
  const mix = parseMix(readOriginal("A1FMIX.SYS"));
  const banks = mix.banks.map((b) => ({ info: b, bytes: bankData(mix, b) }));

  it("reprend exactement les tables du pilote de AM1.EXE", () => {
    const t = readDriverTables(exe);
    expect(t.noteDurations).toEqual([...NOTE_DURATIONS]);
    expect(t.speakerDivisors).toEqual([...SPEAKER_DIVISORS]);
    expect(t.drumNotes).toEqual([...MIDI_DRUM_NOTES]);
    expect(t.operatorOffsets).toEqual([...OPL_OPERATOR_OFFSETS]);
    expect(t.melodicOperators).toEqual([...OPL_VOICE_OPERATORS_MELODIC]);
    expect(t.rhythmOperators).toEqual([...OPL_VOICE_OPERATORS_RHYTHM]);
    expect(t.oplFrequencies).toHaveLength(NOTE_COUNT);
    expect(t.oplFrequencies).toEqual(Array.from({ length: NOTE_COUNT }, (_, n) => oplFrequency(n)));
  });

  it("lit les 55 banques, chacune avec un seul sous-morceau", () => {
    expect(banks).toHaveLength(55);
    for (const { info, bytes } of banks) {
      const bank = parseSongBank(bytes);
      expect(bank.songOffsets, `banque ${info.id}`).toEqual([2]);
      expect([9, 11]).toContain(bank.songs[0].voiceCount);
    }
  });

  it("consomme chaque banque exactement : motifs contigus, puis enveloppe, instruments, programmes MIDI, effets", () => {
    for (const { info, bytes } of banks) {
      const song = parseSongBank(bytes).songs[0];
      const where = `banque ${info.id}`;
      expect(song.trackOffsets[0], where).toBe(PATTERN_TABLE_OFFSET + 2 * song.patterns.length);
      expect(Math.min(...song.trackOffsets), where).toBe(song.trackOffsets[0]);
      // les listes de motifs sont contiguës et finissent là où commence le premier motif
      expect(song.patterns[0].offset, where).toBe(
        Math.max(...song.trackOffsets) + song.trackLists[song.trackOffsets.indexOf(Math.max(...song.trackOffsets))].length + 1,
      );
      for (let p = 1; p < song.patterns.length; p++) {
        expect(song.patterns[p].offset, where).toBe(song.patterns[p - 1].offset + song.patterns[p - 1].bytes.length);
      }
      const last = song.patterns[song.patterns.length - 1];
      expect(last.offset + last.bytes.length, where).toBe(song.pitchEnvelopeOffset);
      expect(song.pitchEnvelopes, where).toHaveLength(1);
      expect(song.pitchEnvelopeOffset + PITCH_ENVELOPE_SIZE, where).toBe(song.instrumentOffset);
      expect(song.instrumentOffset + INSTRUMENT_SIZE * song.instruments.length, where).toBe(song.midiMapOffset);
      if (song.effectTableOffset === 0) {
        expect(song.midiPrograms, where).toHaveLength(128);
        expect(song.effects, where).toHaveLength(0);
        expect(song.midiMapOffset + 128 + 2, where).toBe(bytes.length);
      } else {
        expect(song.midiMapOffset + song.midiPrograms.length, where).toBe(song.effectTableOffset);
        expect(song.effectTableOffset + EFFECT_SLOTS * EFFECT_ENTRY_SIZE + 2, where).toBe(bytes.length);
        expect(song.effects, where).toHaveLength(EFFECT_SLOTS);
      }
    }
  });

  it("n'emploie que des notes, motifs et commandes que le pilote connaît", () => {
    const kinds = new Set<string>();
    for (const { bytes } of banks) {
      const song = parseSongBank(bytes).songs[0];
      for (const pattern of song.patterns) {
        for (const e of pattern.events) {
          kinds.add(e.kind);
          if (e.kind === "note") expect(e.note).toBeLessThan(NOTE_COUNT);
        }
      }
      for (const effect of song.effects) for (const p of effect) expect(p).toBeLessThan(song.patterns.length);
      expect(song.tempo).toBeGreaterThanOrEqual(1);
      expect(song.tempo).toBeLessThanOrEqual(4);
    }
    expect([...kinds].sort()).toEqual(["duration", "effectTempo", "instrument", "note", "pitchEnvelope", "transpose", "volume"]);
  });

  it("donne un seul motif à chaque piste active", () => {
    let lists = 0;
    for (const { bytes } of banks) {
      const song = parseSongBank(bytes).songs[0];
      for (let k = 0; k < song.voiceCount; k++) {
        expect(song.trackLists[k]).toHaveLength(1);
        lists++;
      }
    }
    expect(lists).toBe(533);
  });

  it("n'a qu'une enveloppe de hauteur neutre", () => {
    for (const { bytes } of banks) {
      const [env] = parseSongBank(bytes).songs[0].pitchEnvelopes;
      expect(env.flags).toBe(0);
      expect(env.segments).toEqual(Array(4).fill({ count: 1, delta: 0, ticks: 1 }));
    }
  });

  it("donne la même longueur à toutes les pistes actives de la première musique (904 pas)", () => {
    const song = parseSongBank(banks[0].bytes).songs[0];
    const lengths = Array.from({ length: song.voiceCount }, (_, k) => trackSteps(song, k));
    expect(lengths).toEqual([904, 904, 904, 904, 904, 904, 904, 904, 904, 8, 904]);
    // la piste 9 est muette : motif 0 = volume 31 + note 0 (la voix 9 n'est pas dans le masque 0x5FF de la table 1)
    expect(song.trackLists[9]).toEqual([0]);
    expect(song.patterns[0].events).toEqual([
      { kind: "volume", level: 31 },
      { kind: "instrument", index: 0 },
      { kind: "duration", index: 4, ticks: 8 },
      { kind: "note", note: 0 },
    ]);
  });

  it("relie la table d'effets aux clés d'effet de la banque", () => {
    for (const { info, bytes } of banks) {
      const song = parseSongBank(bytes).songs[0];
      const declared = info.effectKeys.filter((k) => k !== 0).length;
      if (declared === 0) continue;
      expect(song.effectTableOffset).not.toBe(0);
      // chaque effet déclaré a au moins un motif ; la banque 302 en définit un de plus que de clés
      const used = song.effects.filter((e) => e.length > 0).length;
      expect(used, `banque ${info.id}`).toBe(info.id === 302 ? declared + 1 : declared);
      for (let i = 0; i < declared; i++) expect(song.effects[i].length).toBeGreaterThan(0);
    }
  });
});
