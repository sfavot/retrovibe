import { describe, expect, it } from "vitest";
import { AdlibMultisourceDriver, bnkToInstrument, type OplInstrument } from "../../../src/games/lure/audio/adlib-multisource";
import { LureAdlibDriver } from "../../../src/games/lure/audio/lure-adlib";
import { RecordingSink } from "./scenario";

/** Instrument de test : 28 octets BNK sans les deux premiers champs (opérateur 0, opérateur 1, formes d'onde). */
const INSTRUMENT_FM = [1, 2, 3, 12, 5, 1, 7, 4, 20, 1, 1, 1, 0, 2, 1, 0, 15, 6, 1, 3, 5, 10, 0, 1, 0, 1, 1, 2];
/** Même chose avec la connexion de l'opérateur 0 à 0 : synthèse additive. */
const INSTRUMENT_ADDITIVE = [0, 1, 7, 10, 8, 1, 2, 6, 5, 1, 0, 0, 0, 3, 2, 0, 9, 4, 0, 4, 2, 18, 1, 0, 1, 0, 2, 0];

const instrumentMeta = (channel: number, bnk: number[]) => Uint8Array.from([0x00, 0x00, 0x3f, 0x00, 0x01, channel, ...bnk]);
const pitchBendSensitivity = (semitones: number) => Uint8Array.from([0x00, 0x00, 0x3f, 0x00, 0x03, semitones]);

function lure() {
  const sink = new RecordingSink();
  sink.beginTick(0);
  const driver = new LureAdlibDriver(sink);
  const mark = () => sink.writes.length;
  /** Écritures faites depuis `from`, au format `[registre, valeur]`. */
  const since = (from: number) => sink.writes.slice(from).map((w) => [w.reg, w.value] as const);
  return { sink, driver, mark, since };
}

describe("pilote AdLib de Lure : écritures de registres (valeurs de ScummVM)", () => {
  it("initialise la puce : minuteries, 18 opérateurs, 9 voix, profondeurs de modulation et de vibrato faibles", () => {
    const { sink } = lure();
    const lines = sink.writes.map((w) => [w.reg, w.value]);
    expect(lines).toHaveLength(124);
    expect(lines.slice(0, 7)).toEqual([[0x01, 0x20], [0x02, 0], [0x03, 0], [0x04, 0x60], [0x04, 0x80], [0x08, 0], [0x20, 0]]);
    // Les niveaux (4x) partent de 0x3F : volume de canal par défaut 0.
    expect(lines.filter(([reg]) => reg! >= 0x40 && reg! <= 0x55).every(([, value]) => value === 0x3f)).toBe(true);
    // BD : modulation et vibrato à 0 (les valeurs par défaut du pilote générique sont 1 et 1).
    expect(lines.at(-1)).toEqual([0xbd, 0]);
  });

  it("une note : instrument BNK converti, niveaux mis à l'échelle de la vélocité, fréquence abaissée d'une octave", () => {
    const { driver, mark, since } = lure();
    driver.metaEvent(1, 0x7f, instrumentMeta(0, INSTRUMENT_FM));
    const from = mark();
    driver.send(1, 0x90, 60, 100);
    expect(since(from)).toEqual([
      // opérateur 0 : multiplicateur 2 | échelle de débit 0x10 | enveloppe soutenue 0x20 | vibrato 0x40 | modulation d'amplitude 0x80
      [0x20, 0xf2],
      // niveau : connexion additive (octet de connexion de l'opérateur 0 à 0) donc le volume agit sur les deux opérateurs ;
      // ((0x3F - 20) * 100 + 0x40) >> 7 = 34 ; 0x3F - (0x3F - 34) = 29 ; plus l'échelle de niveau 1 (bits 6-7) : 0x5D
      [0x40, 0x5d],
      [0x60, 0xc7], // attaque 12, déclin 7
      [0x80, 0x54], // sustain 5, relâchement 4
      [0xe0, 0x01],
      [0x23, 0x61],
      [0x43, 0x96],
      [0x63, 0xf3],
      [0x83, 0x65],
      [0xe3, 0x02],
      // rétroaction 3 << 1 | additive 1 = 7
      [0xc0, 0x07],
      // note 60 - 12 = 48 : octave 4, do : F-num 0x2B2 (< 0xF000, donc un bloc de moins : 3) ; Bx : bloc 3 << 2 | bits hauts 2 | mise en marche 0x20
      [0xa0, 0xb2],
      [0xb0, 0x2e],
    ]);
    const release = mark();
    driver.send(1, 0x80, 60, 0);
    expect(since(release)).toEqual([[0xb0, 0x0e]]);
  });

  it("le niveau d'un modulateur reste celui de l'instrument ; la pression de canal change la vélocité de la note en cours", () => {
    const { driver, mark, since } = lure();
    driver.metaEvent(1, 0x7f, instrumentMeta(0, [...INSTRUMENT_FM.slice(0, 12), 1, ...INSTRUMENT_FM.slice(13)]));
    driver.send(1, 0x90, 60, 127);
    const from = mark();
    driver.send(1, 0xd0, 0, 0);
    // pression 0 : seul le porteur (opérateur 1) est réécrit, au niveau minimal ; le modulateur (FM : connexion 1) garde son niveau
    expect(since(from)).toEqual([[0x43, 0xbf]]);
    const again = mark();
    driver.send(1, 0xd0, 127, 0);
    expect(since(again)).toHaveLength(1);
  });

  it("inflexion de hauteur : 1/16 de demi-ton par pas de 32, doublée par demi-ton de sensibilité au-delà de 1", () => {
    const { driver, mark, since } = lure();
    driver.metaEvent(1, 0x7f, instrumentMeta(0, INSTRUMENT_FM));
    driver.send(1, 0x90, 0x40, 100); // mi : 0x340 -> 0x365, A0 = 0x65, B0 = 0x2F
    const bend = (value: number) => {
      const from = mark();
      driver.send(1, 0xe0, value & 0x7f, value >> 7);
      return since(from);
    };
    expect(bend(0x0000)).toEqual([[0xa0, 0x34]]); // -256 / 16 = -1 demi-ton : ré# (0x334), même bloc
    expect(bend(0x2000)).toEqual([[0xa0, 0x65]]);
    expect(bend(0x3fff)).toEqual([[0xa0, 0x99]]); // +1 demi-ton : fa (0x399)
    driver.metaEvent(1, 0x7f, pitchBendSensitivity(2));
    expect(bend(0x0000)).toEqual([[0xa0, 0x06]]); // -2 demi-tons : ré (0x306)
    expect(bend(0x3fff)).toEqual([[0xa0, 0xcf]]); // +2 demi-tons : fa# (0x3CF)
    expect(bend(0x2000)).toEqual([[0xa0, 0x65]]);
  });

  it("les notes de la première octave valent 0 ; les plus aiguës sont ramenées à la note 0x5F", () => {
    const frequencyOf = (note: number) => {
      const { driver, mark, since } = lure();
      driver.metaEvent(1, 0x7f, instrumentMeta(0, INSTRUMENT_FM));
      const from = mark();
      driver.send(1, 0x90, note, 100);
      const writes = since(from);
      return [writes.find(([reg]) => reg === 0xa0)![1], writes.find(([reg]) => reg === 0xb0)![1]];
    };
    expect(frequencyOf(0)).toEqual([89, 33]);
    expect(frequencyOf(11)).toEqual(frequencyOf(0));
    expect(frequencyOf(12)).toEqual(frequencyOf(0));
    expect(frequencyOf(0x24)).toEqual([178, 38]);
    expect(frequencyOf(0x7f)).toEqual([175, 62]);
    expect(frequencyOf(0x6c)).toEqual(frequencyOf(0x7f));
  });

  it("un type de FF 7F inconnu est signalé, un instrument invalide est refusé", () => {
    const warnings: string[] = [];
    const driver = new LureAdlibDriver(new RecordingSink(), (m) => warnings.push(m));
    driver.metaEvent(1, 0x7f, Uint8Array.from([0, 0, 0x3f, 0, 9, 0]));
    expect(warnings).toHaveLength(1);
    driver.metaEvent(1, 0x7f, Uint8Array.from([0, 0, 0x3f, 0, 2, 0])); // mode rythme : ignoré
    expect(warnings).toHaveLength(1);
    expect(() => driver.metaEvent(1, 0x7f, instrumentMeta(16, INSTRUMENT_FM))).toThrow();
  });
});

describe("conversion d'un instrument BNK", () => {
  it("rend les valeurs de registres de ScummVM", () => {
    const bnk = Uint8Array.from([0, 0, ...INSTRUMENT_FM]);
    const instrument = bnkToInstrument(bnk);
    expect(instrument.operator0).toEqual({ freqMultMisc: 0xf2, level: 0x54, decayAttack: 0xc7, releaseSustain: 0x54, waveformSelect: 1 });
    expect(instrument.operator1).toEqual({ freqMultMisc: 0x61, level: 0x8a, decayAttack: 0xf3, releaseSustain: 0x65, waveformSelect: 2 });
    expect(instrument.connectionFeedback).toBe(7);
    expect(() => bnkToInstrument(new Uint8Array(29))).toThrow();
  });
});

describe("plusieurs sources sur 9 voix (allocation statique de Lure)", () => {
  /** Voix dont le bit de mise en marche vient d'être écrit (registre `Bx` avec le bit 5) depuis `from`. */
  const keyedOn = (since: readonly (readonly [number, number])[]) => since.filter(([reg, value]) => reg >= 0xb0 && reg <= 0xb8 && value & 0x20).map(([reg]) => reg - 0xb0);

  function twoSources() {
    const env = lure();
    for (const source of [1, 2]) for (let channel = 0; channel < 8; channel++) env.driver.metaEvent(source, 0x7f, instrumentMeta(channel, channel % 2 ? INSTRUMENT_ADDITIVE : INSTRUMENT_FM));
    return env;
  }

  it("chaque canal MIDI de chaque source prend une voix fixe, dans l'ordre de première note", () => {
    const { driver, mark, since } = twoSources();
    const voices: number[] = [];
    for (const [source, channel] of [[1, 0], [1, 1], [2, 0], [1, 2], [2, 1]] as const) {
      const from = mark();
      driver.send(source, 0x90 | channel, 0x30, 100);
      voices.push(...keyedOn(since(from)));
    }
    expect(voices).toEqual([0, 1, 2, 3, 4]);
    // Une autre note du même canal reprend la même voix.
    const from = mark();
    driver.send(2, 0x90, 0x34, 100);
    expect(keyedOn(since(from))).toEqual([2]);
  });

  it("sans voix libre la note n'est pas jouée ; la fin d'une source rend ses voix", () => {
    const { driver, mark, since } = twoSources();
    for (let channel = 0; channel < 5; channel++) driver.send(1, 0x90 | channel, 0x30, 100); // voix 0 à 4
    for (let channel = 0; channel < 4; channel++) driver.send(2, 0x90 | channel, 0x30, 100); // voix 5 à 8
    let from = mark();
    driver.send(2, 0x94, 0x30, 100); // dixième canal : aucune voix
    expect(since(from)).toEqual([]);
    // Fin de piste de la source 1 : notes coupées, voix rendues.
    from = mark();
    driver.metaEvent(1, 0x2f, new Uint8Array(0));
    expect(since(from).filter(([reg]) => reg >= 0xb0 && reg <= 0xb8).map(([reg, value]) => [reg - 0xb0, value & 0x20])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
    from = mark();
    driver.send(2, 0x94, 0x30, 100);
    expect(keyedOn(since(from))).toEqual([0]);
  });

  it("deux sources jouant le même canal MIDI ne se mélangent pas : instruments et notes séparés", () => {
    const { driver, mark, since } = lure();
    driver.metaEvent(1, 0x7f, instrumentMeta(0, INSTRUMENT_FM));
    driver.metaEvent(2, 0x7f, instrumentMeta(0, INSTRUMENT_ADDITIVE));
    let from = mark();
    driver.send(1, 0x90, 60, 100);
    const first = since(from);
    from = mark();
    driver.send(2, 0x90, 60, 100);
    const second = since(from);
    expect(first.find(([reg]) => reg === 0x20)![1]).toBe(0xf2);
    expect(second.find(([reg]) => reg === 0x21)![1]).toBe(0x81 | 0x20 | 0x00); // multiplicateur 1, enveloppe soutenue, modulation d'amplitude
    // Relâcher la note de la source 1 ne touche pas celle de la source 2.
    from = mark();
    driver.send(1, 0x80, 60, 0);
    expect(since(from)).toEqual([[0xb0, 0x0e]]);
  });
});

describe("vol de voix (allocation dynamique du pilote générique)", () => {
  function generic() {
    const sink = new RecordingSink();
    const bank: OplInstrument[] = [bnkToInstrument(Uint8Array.from([0, 0, ...INSTRUMENT_FM])), bnkToInstrument(Uint8Array.from([0, 0, ...INSTRUMENT_ADDITIVE]))];
    const driver = new AdlibMultisourceDriver(sink, { instrumentBank: bank });
    driver.open();
    const voice = (source: number, channel: number, note: number, velocity = 100): number => {
      const from = sink.writes.length;
      driver.send(source, 0x90 | channel, note, velocity);
      const on = sink.writes.slice(from).filter((w) => w.reg >= 0xb0 && w.reg <= 0xb8 && w.value & 0x20);
      return on.length === 1 ? on[0]!.reg - 0xb0 : -1;
    };
    return { sink, driver, voice };
  }

  it("prend d'abord la voix libre la plus basse, quelle que soit la source", () => {
    const { driver, voice } = generic();
    driver.send(0, 0xc0, 0, 0);
    driver.send(1, 0xc0, 1, 0);
    expect([voice(0, 0, 40), voice(1, 0, 41), voice(0, 0, 42), voice(1, 3, 43)]).toEqual([0, 1, 2, 3]);
  });

  it("voix toutes prises : vole une voix au repos, sinon la plus ancienne note du même instrument, sinon la plus ancienne", () => {
    const { driver, voice } = generic();
    // Voix 0 et 1 : programme 1 ; voix 2 à 8 : programme 0.
    driver.send(0, 0xc0, 1, 0);
    expect([voice(0, 0, 40), voice(0, 0, 41)]).toEqual([0, 1]);
    driver.send(0, 0xc0, 0, 0);
    for (let note = 0; note < 7; note++) expect(voice(0, 0, 50 + note)).toBe(2 + note);

    // Toutes prises, programme 0 : la plus ancienne note de programme 0 est sur la voix 2 (la voix 0, plus ancienne, joue le programme 1).
    expect(voice(0, 0, 70)).toBe(2);
    // Programme 1 : la voix 0 (la plus ancienne des deux notes de programme 1).
    driver.send(0, 0xc0, 1, 0);
    expect(voice(0, 0, 71)).toBe(0);
    // Une note relâchée libère sa voix : elle est prise avant toute note qui joue encore.
    driver.send(0, 0x80, 55, 0);
    driver.send(0, 0xc0, 0, 0);
    expect(voice(0, 0, 72)).toBe(7);
  });

  it("une note qui n'a pas d'instrument ne prend aucune voix", () => {
    const { driver, voice } = generic();
    driver.send(0, 0xc0, 5, 0);
    expect(voice(0, 0, 60)).toBe(-1);
  });

  it("la pédale de sustain retient la note relâchée jusqu'à son relâchement", () => {
    const { sink, driver } = generic();
    driver.send(0, 0xb0, 0x40, 0x7f);
    driver.send(0, 0x90, 60, 100);
    const from = sink.writes.length;
    driver.send(0, 0x80, 60, 0);
    expect(sink.writes.slice(from)).toEqual([]);
    driver.send(0, 0xb0, 0x40, 0);
    expect(sink.writes.slice(from)).toHaveLength(1);
    expect(sink.writes.at(-1)!.value & 0x20).toBe(0);
  });

  it("le volume d'une source s'applique aux notes en cours", () => {
    const { sink, driver } = generic();
    driver.send(0, 0xb0, 0x07, 0x7f);
    driver.send(0, 0x90, 60, 100);
    const level = () => [...sink.writes].reverse().find((w) => w.reg === 0x43)!.value & 0x3f;
    const full = level();
    driver.setSourceVolume(0, 128);
    expect(level()).toBeGreaterThan(full);
    driver.setSourceVolume(0, 255);
    expect(level()).toBe(full);
  });
});
