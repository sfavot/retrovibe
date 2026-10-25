import { describe, expect, it } from "vitest";
import { type Mix, type MixBank, type MixTrack, bankData, decodeMixKey, mixKey, parseMix } from "../../src/games/armaeth/data/mix";
import { NOTE_DURATIONS, OPL_OPERATOR_OFFSETS, parseSongBank, readDriverTables, trackSteps } from "../../src/games/armaeth/data/music";
import { OplRecorder } from "../../src/games/armaeth/audio/opl-driver";
import {
  CMD_FADE_IN,
  CMD_LOOP,
  CMD_MASTER_VOLUME,
  CMD_SET_VOLUME,
  CMD_START,
  CMD_STOP,
  CMD_TEMPO,
  Sequencer,
  SongDriver,
} from "../../src/games/armaeth/audio/sequencer";
import { hasOriginalFiles, readOriginal } from "./helpers";

// ---- banque synthétique ----

interface BankSpec {
  tempo?: number;
  voices?: 9 | 11;
  /** Octets des motifs, sans le 0xFF final. */
  patterns: number[][];
  /** Liste de motifs par voix (les autres voix : liste vide). */
  tracks: Record<number, number[]>;
  /** Instruments de 12 octets. */
  instruments: number[][];
  /** Entrées de la table d'effets : numéros de motifs. */
  effects?: number[][];
}

/** Construit une banque au format de `docs/armaeth/audio.md` (un sous-morceau à l'offset 2). */
function buildBank(spec: BankSpec): Uint8Array {
  const voices = spec.voices ?? 9;
  const tableSize = 2 * spec.patterns.length;
  let pos = 0x22 + tableSize;
  const listOffsets: number[] = [];
  const lists: number[] = [];
  const emptyList = pos;
  lists.push(0xff);
  pos += 1;
  for (let k = 0; k < 11; k++) {
    const list = spec.tracks[k];
    if (!list) {
      listOffsets.push(emptyList);
      continue;
    }
    listOffsets.push(pos);
    lists.push(...list, 0xff);
    pos += list.length + 1;
  }
  const patternOffsets: number[] = [];
  const patternBytes: number[] = [];
  for (const p of spec.patterns) {
    patternOffsets.push(pos);
    patternBytes.push(...p, 0xff);
    pos += p.length + 1;
  }
  const envelopeOffset = pos;
  const envelope = [0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1];
  pos += 13;
  const instrumentOffset = pos;
  const instruments = spec.instruments.flat();
  pos += instruments.length;
  const midiOffset = pos;
  const midi = Array(spec.instruments.length).fill(0);
  pos += midi.length;
  let effectOffset = 0;
  const effects: number[] = [];
  if (spec.effects) {
    effectOffset = pos;
    for (let e = 0; e < 30; e++) {
      const entry = spec.effects[e] ?? [];
      for (let i = 0; i < 5; i++) effects.push(entry[i] ?? 0xff);
    }
    pos += effects.length;
  }
  const words = [
    spec.tempo ?? 3,
    voices,
    midiOffset,
    effectOffset,
    envelopeOffset,
    instrumentOffset,
    ...listOffsets,
    ...patternOffsets,
  ];
  const bytes: number[] = [2, 0];
  for (const w of words) bytes.push(w & 0xff, w >> 8);
  bytes.push(...lists, ...patternBytes, ...envelope, ...instruments, ...midi, ...effects);
  return Uint8Array.from(bytes);
}

/** Instrument 0 : voix FM ; registres de la voix 0 (opérateurs 0x00 et 0x03). */
const INSTRUMENT_0 = [0x00, 0x08, 0x21, 0x10, 0xf2, 0x73, 0x00, 0x22, 0x40, 0xf4, 0x75, 0x01];
const INSTRUMENT_1 = [0x00, 0x08, 0x31, 0x20, 0xf1, 0x72, 0x00, 0x32, 0x40, 0xf3, 0x76, 0x00];

type Write = [reg: number, value: number];

/** Pilote initialisé sur une banque synthétique, avec les écritures horodatées. */
function startDriver(spec: BankSpec, flags = CMD_START, mask = 1, volume = 0) {
  const rec = new OplRecorder();
  const driver = new SongDriver(rec);
  driver.init();
  driver.loadSong(buildBank(spec));
  driver.command(spec.tempo ?? 3, CMD_TEMPO, mask);
  driver.command(volume, CMD_SET_VOLUME, mask);
  driver.command(0, flags, mask);
  const at = (tick: number, regs?: number[]): Write[] =>
    rec
      .at(tick)
      .filter((w) => !regs || regs.includes(w.reg))
      .map((w): Write => [w.reg, w.value]);
  return { rec, driver, at };
}

/** Une note de 2 pas avec l'instrument 0 puis un silence de 4 pas. */
const MELODY: BankSpec = {
  tempo: 2,
  patterns: [[0xa0, 0xc0, 0x80, 0x24, 0x82, 0x00]],
  tracks: { 0: [0] },
  instruments: [INSTRUMENT_0],
};
const VOICE0_REGS = [0x01, 0x20, 0x23, 0x40, 0x43, 0x60, 0x63, 0x80, 0x83, 0xa0, 0xb0, 0xc0, 0xe0, 0xe3];

describe("séquenceur : une voix, banque synthétique", () => {
  it("premier tick : instrument chargé, touche coupée puis rallumée, note 36 à la fréquence 0x0D59", () => {
    const { at, driver } = startDriver(MELODY);
    driver.tick();
    // coupure directe de B0 (instrument), puis écriture des différences par registre croissant
    expect(at(1, VOICE0_REGS)).toEqual([
      [0xb0, 0x00],
      [0x01, 0x20],
      [0x20, 0x21],
      [0x23, 0x22],
      [0x40, 0x10],
      [0x43, 0x41], // KSL 0x40 de l'instrument | niveau 1 (commande C0 = atténuation 2 * 0 + 1)
      [0x60, 0xf2],
      [0x63, 0xf4],
      [0x80, 0x73],
      [0x83, 0x75],
      [0xa0, 0x59],
      [0xb0, 0x2d],
      [0xc0, 0x08],
      [0xe3, 0x01],
    ]);
    // 9 voix : le mode rythme est retiré de BD par la première commande
    expect(at(1, [0xbd])).toEqual([[0xbd, 0x00]]);
  });

  it("la note dure 2 pas de 2 ticks, comptés à partir du premier tick (3 ticks avec le décalage de phase)", () => {
    const { at, driver } = startDriver(MELODY);
    for (let t = 1; t <= 12; t++) driver.tick();
    expect(at(2)).toEqual([[0x01, 0x20]]);
    expect(at(3)).toEqual([[0x01, 0x20]]);
    // tick 4 : le décompte a diminué deux fois, silence (note 0) : A0 et B0 à 0
    expect(at(4)).toEqual([
      [0x01, 0x20],
      [0xa0, 0x00],
      [0xb0, 0x00],
    ]);
    expect(at(5)).toEqual([[0x01, 0x20]]);
    expect(at(11)).toEqual([[0x01, 0x20]]);
    // tick 12 : 4 pas de 2 ticks écoulés depuis le tick 4, fin de liste : la voix s'arrête, niveau 63
    expect(at(12)).toEqual([
      [0x01, 0x20],
      [0x43, 0x7f],
    ]);
    expect(driver.isMusicActive()).toBe(false);
  });

  it("la voix reste active jusqu'au tick 11 (note de 2 pas puis silence de 4 pas, tempo 2)", () => {
    const { driver } = startDriver(MELODY);
    for (let t = 1; t <= 11; t++) {
      driver.tick();
      expect(driver.isMusicActive()).toBe(true);
    }
    driver.tick();
    expect(driver.isMusicActive()).toBe(false);
  });

  it("boucle : la liste repart du début au tick de fin, instrument rechargé non, touche recoupée oui", () => {
    const { at, driver } = startDriver(MELODY, CMD_START | CMD_LOOP);
    for (let t = 1; t <= 14; t++) driver.tick();
    expect(at(12)).toEqual([
      [0xb0, 0x00],
      [0x01, 0x20],
      [0xa0, 0x59],
      [0xb0, 0x2d],
    ]);
    expect(driver.isMusicActive()).toBe(true);
    // la deuxième passe recommence au tick 12 : mêmes écritures 3 ticks plus tard qu'à la première passe (décalage de phase)
    expect(at(14)).toEqual([[0x01, 0x20]]);
  });

  it("note sans commande d'instrument : changement de hauteur seul, sans coupure de touche", () => {
    const { at, driver } = startDriver({
      tempo: 2,
      patterns: [[0xa0, 0xc0, 0x80, 0x24, 0x80, 0x31]],
      tracks: { 0: [0] },
      instruments: [INSTRUMENT_0],
    });
    for (let t = 1; t <= 4; t++) driver.tick();
    // note 49 : numéro F 0x16D, bloc 4
    expect(at(4)).toEqual([
      [0x01, 0x20],
      [0xa0, 0x6d],
      [0xb0, 0x31],
    ]);
  });

  it("la même commande d'instrument recoupe la touche sans recharger les registres", () => {
    const { at, driver } = startDriver({
      tempo: 2,
      patterns: [[0xa0, 0xc0, 0x80, 0x24, 0xa0, 0x80, 0x31]],
      tracks: { 0: [0] },
      instruments: [INSTRUMENT_0],
    });
    for (let t = 1; t <= 4; t++) driver.tick();
    expect(at(4)).toEqual([
      [0xb0, 0x0d],
      [0x01, 0x20],
      [0xa0, 0x6d],
      [0xb0, 0x31],
    ]);
  });

  it("volume : atténuation = max(volume de la voix, volume maître) + 2v + 1, plafonnée à 63", () => {
    const { at, driver } = startDriver(
      { tempo: 2, patterns: [[0xa0, 0xc5, 0x80, 0x24, 0x80, 0xdf, 0x25]], tracks: { 0: [0] }, instruments: [INSTRUMENT_0] },
      CMD_START,
      1,
      3,
    );
    for (let t = 1; t <= 4; t++) driver.tick();
    expect(at(1, [0x43])).toEqual([[0x43, 0x40 | (3 + 11)]]);
    // DF : atténuation 63
    expect(at(4, [0x43])).toEqual([[0x43, 0x7f]]);
    driver.command(20, CMD_MASTER_VOLUME, 0);
    expect(driver.masterVolume).toBe(20);
  });

  it("volume maître : il remplace le volume de la voix quand il est plus fort", () => {
    const { at, driver } = startDriver({ tempo: 2, patterns: [[0xa0, 0xc5, 0x80, 0x24]], tracks: { 0: [0] }, instruments: [INSTRUMENT_0] }, CMD_START, 1, 3);
    driver.command(20, CMD_MASTER_VOLUME, 0);
    driver.tick();
    expect(at(1, [0x43])).toEqual([[0x43, 0x40 | (20 + 11)]]);
  });

  it("E0 : la transposition s'ajoute aux notes mais pas au silence", () => {
    const { at, driver } = startDriver({
      tempo: 2,
      patterns: [[0xe0, 0x02, 0xa0, 0xc0, 0x80, 0x24, 0x80, 0x00]],
      tracks: { 0: [0] },
      instruments: [INSTRUMENT_0],
    });
    for (let t = 1; t <= 4; t++) driver.tick();
    // note 38 : numéro F 0x183, bloc 3 (0x0D83) : A0 = 0x83, B0 = 0x0D | touche
    expect(at(1, [0xa0, 0xb0])).toEqual([
      [0xb0, 0x00],
      [0xa0, 0x83],
      [0xb0, 0x2d],
    ]);
    expect(at(4, [0xa0, 0xb0])).toEqual([
      [0xa0, 0x00],
      [0xb0, 0x00],
    ]);
  });

  it("E1 et E2 consomment leur argument ; E2 règle le tempo des voix d'effet ; E7 n'en a pas", () => {
    const { driver } = startDriver({
      tempo: 2,
      patterns: [[0xe1, 0x00, 0xe2, 0x03, 0xe7, 0xa0, 0xc0, 0x80, 0x24]],
      tracks: { 0: [0] },
      instruments: [INSTRUMENT_0],
    });
    driver.tick();
    expect(driver.effectTempo).toBe(3);
    expect(driver.music[0].frequency).toBe(0x0d59);
  });

  it("E3 : instrument d'indice donné par l'octet suivant", () => {
    const { at, driver } = startDriver({
      tempo: 2,
      patterns: [[0xe3, 0x01, 0xc0, 0x80, 0x24]],
      tracks: { 0: [0] },
      instruments: [INSTRUMENT_0, INSTRUMENT_1],
    });
    driver.tick();
    expect(at(1, [0x20, 0x40])).toEqual([
      [0x20, 0x31],
      [0x40, 0x20],
    ]);
  });

  it("une durée dure NOTE_DURATIONS[code & 15] pas de `tempo` ticks : 8 pas de 3 ticks pour le code 0x84", () => {
    expect(NOTE_DURATIONS[4]).toBe(8);
    const { driver } = startDriver({ tempo: 3, patterns: [[0xa0, 0xc0, 0x84, 0x24]], tracks: { 0: [0] }, instruments: [INSTRUMENT_0] });
    for (let t = 1; t <= 23; t++) {
      driver.tick();
      expect(driver.isMusicActive()).toBe(true);
    }
    driver.tick();
    expect(driver.isMusicActive()).toBe(false);
  });

  it("deux motifs dans une liste se suivent ; la durée courante persiste d'un motif à l'autre", () => {
    const { driver } = startDriver({
      tempo: 1,
      patterns: [[0xa0, 0xc0, 0x82, 0x24], [0x26]],
      tracks: { 0: [0, 1] },
      instruments: [INSTRUMENT_0],
    });
    driver.tick(); // note 36 pendant 4 pas
    expect(driver.music[0].frequency).toBe(0x0d59);
    expect(driver.music[0].patternCount).toBe(1);
    for (let t = 2; t <= 4; t++) driver.tick();
    expect(driver.music[0].frequency).toBe(0x0d59);
    driver.tick(); // tick 5 : motif 1, note 38 de 4 pas
    expect(driver.music[0].patternCount).toBe(2);
    expect(driver.music[0].frequency).toBe(0x0d83);
    for (let t = 6; t <= 8; t++) driver.tick();
    expect(driver.isMusicActive()).toBe(true);
    driver.tick();
    expect(driver.isMusicActive()).toBe(false);
  });

  it("fondu entrant : le volume part de 63 et baisse d'un cran tous les 9 ticks jusqu'au volume maître", () => {
    const { driver } = startDriver({ ...MELODY, patterns: [[0xa0, 0xc0, 0x8b, 0x24]] }, CMD_START | CMD_FADE_IN);
    expect(driver.music[0].volume).toBe(0x3f);
    for (let t = 1; t <= 8; t++) driver.tick();
    expect(driver.music[0].volume).toBe(0x3f);
    driver.tick();
    expect(driver.music[0].volume).toBe(0x3e);
    for (let t = 10; t <= 18; t++) driver.tick();
    expect(driver.music[0].volume).toBe(0x3d);
  });

  it("arrêt : niveaux à 63 écrits tout de suite, touche relâchée au tick suivant", () => {
    const { at, driver } = startDriver(MELODY);
    driver.tick();
    driver.command(0, CMD_STOP, 0);
    // le flush de l'arrêt s'ajoute à celui du tick 1 : niveau du modulateur (0x10 | 0x3f) et de la porteuse
    expect(at(1, [0x40, 0x43]).slice(-2)).toEqual([
      [0x40, 0x3f],
      [0x43, 0x7f],
    ]);
    driver.tick();
    expect(driver.isMusicActive()).toBe(false);
    expect(at(2)).toEqual([
      [0x01, 0x20],
      [0xa0, 0x00],
      [0xb0, 0x00],
    ]);
  });

  it("un chargement sans démarrage fait sauter le prochain tick", () => {
    const rec = new OplRecorder();
    const driver = new SongDriver(rec);
    driver.init();
    driver.loadSong(buildBank(MELODY));
    driver.tick();
    expect(rec.at(1)).toEqual([]);
    driver.tick();
    expect(rec.at(2)).toEqual([{ tick: 2, reg: 0x01, value: 0x20 }, ...rec.at(2).slice(1)]);
  });
});

describe("séquenceur : mode rythme (11 voix)", () => {
  const RHYTHM: BankSpec = {
    tempo: 2,
    voices: 11,
    patterns: [[0xa0, 0xc0, 0x80, 0x24]],
    tracks: { 7: [0] },
    instruments: [INSTRUMENT_0],
  };

  it("caisse claire (voix 7) : un seul opérateur (0x14), BD coupé puis posé à 0x28", () => {
    const { at, driver } = startDriver(RHYTHM, CMD_START, 0x80);
    driver.tick();
    // BD : coupure du bit 3 de l'image envoyée (0x20 -> 0x20), puis réécriture avec le bit 3 posé
    expect(at(1, [0x01, 0x34, 0x54, 0x74, 0x94, 0xbd, 0xc7, 0xf4])).toEqual([
      [0xbd, 0x20],
      [0x01, 0x20],
      [0x34, 0x21],
      [0x54, 0x01], // niveau 1 sur le seul opérateur (KSL de l'instrument = 0)
      [0x74, 0xf2],
      [0x94, 0x73],
      [0xbd, 0x28],
      [0xc7, 0x08],
    ]);
  });

  it("les percussions n'écrivent jamais de hauteur ; la grosse caisse (voix 6) écrit A6/B6 sans touche", () => {
    const { at, rec, driver } = startDriver({ ...RHYTHM, tracks: { 6: [0], 7: [0], 8: [0], 9: [0], 10: [0] } }, CMD_START, 0x7c0);
    driver.tick();
    expect(at(1, [0xa6, 0xb6])).toEqual([
      [0xa6, 0x59],
      [0xb6, 0x0d],
    ]);
    expect(at(1, [0xbd]).at(-1)).toEqual([0xbd, 0x3f]);
    // A7/B7/A8/B8 restent ceux de l'image par défaut, A9/B9/AA/BA n'existent pas
    const regs = new Set(rec.writes.map((w) => w.reg));
    for (const reg of [0xa9, 0xaa, 0xb9, 0xba]) expect(regs.has(reg)).toBe(false);
    expect(rec.writes.filter((w) => w.reg === 0xa7 || w.reg === 0xb7).map((w) => w.tick)).toEqual([0, 0]);
  });

  it("une voix silencieuse ne retire pas son bit de BD", () => {
    const { at, driver } = startDriver({ ...RHYTHM, patterns: [[0xa0, 0xc0, 0x80, 0x24, 0x80, 0x00]] }, CMD_START, 0x80);
    for (let t = 1; t <= 4; t++) driver.tick();
    expect(at(4, [0xbd])).toEqual([]);
    expect(driver.opl.working[0xbd]).toBe(0x28);
  });
});

describe("séquenceur : effets sur une voix jumelle", () => {
  const EFFECT_BANK: BankSpec = {
    tempo: 1,
    patterns: [
      [0xa0, 0xc0, 0x8b, 0x24], // musique : note 36 pendant 96 pas
      [0xa1, 0xc0, 0x80, 0x31, 0x80, 0x00], // effet : note 49 (2 pas) puis silence (2 pas)
    ],
    tracks: { 0: [0] },
    instruments: [INSTRUMENT_0, INSTRUMENT_1],
    effects: [[1]],
  };

  it("l'effet prend la voix, charge son instrument, puis la rend à la musique", () => {
    const { at, driver } = startDriver(EFFECT_BANK);
    for (let t = 1; t <= 5; t++) driver.tick();
    expect(driver.isEffectActive()).toBe(false);
    driver.startEffect(0, 1, CMD_SET_VOLUME | CMD_START, 0);
    expect(driver.isEffectActive(0)).toBe(true);
    driver.tick(); // tick 6
    expect(at(6, [0xb0, 0xa0, 0x20, 0x80, 0xe3])).toEqual([
      [0xb0, 0x0d], // coupure directe : B0 envoyé 0x2D sans la touche
      [0x20, 0x31],
      [0x80, 0x72],
      [0xa0, 0x6d],
      [0xb0, 0x31],
      [0xe3, 0x00],
    ]);
    driver.tick(); // 7 : la note continue
    expect(at(7)).toEqual([[0x01, 0x20]]);
    driver.tick(); // 8 : silence de l'effet, la musique ne reprend pas la main
    expect(at(8, [0xa0, 0xb0])).toEqual([
      [0xa0, 0x00],
      [0xb0, 0x00],
    ]);
    driver.tick(); // 9
    driver.tick(); // 10 : fin de l'effet
    expect(driver.isEffectActive()).toBe(false);
    driver.tick(); // 11 : la musique reprend sa note (ses registres d'instrument restent ceux de l'effet)
    expect(at(11, [0xa0, 0xb0])).toEqual([
      [0xa0, 0x59],
      [0xb0, 0x2d],
    ]);
    // le cache d'instrument est invalidé : la prochaine commande d'instrument de la musique recharge
    expect(driver.music[0].instrument).toBe(0xff);
  });

  it("un effet inexistant ou hors table est ignoré", () => {
    const { driver } = startDriver(EFFECT_BANK);
    driver.startEffect(1, 1, CMD_START, 0);
    driver.startEffect(30, 1, CMD_START, 0);
    expect(driver.isEffectActive()).toBe(false);
  });

  it("le 5e motif d'un effet joue sur les voix 0 à 3 (masque tronqué à 4 bits)", () => {
    const { driver } = startDriver({
      tempo: 1,
      patterns: [[0xa0, 0xc0, 0x8b, 0x24], [0xa1, 0xc0, 0x80, 0x31]],
      tracks: { 0: [0] },
      instruments: [INSTRUMENT_0, INSTRUMENT_1],
      effects: [[1, 1, 1, 1, 1]],
    });
    driver.startEffect(0, 1, CMD_START, 0);
    for (let k = 0; k < 4; k++) expect(driver.isEffectActive(k)).toBe(true);
    expect(driver.isEffectActive(4)).toBe(false);
  });
});

// ---- moteur son : choix de la banque, effets avec priorité ----

/** `Mix` minimal : une musique `M1` (id 1) dont la banque déclare les effets `B1`, `B2` et `J1`. */
function syntheticMix(): { mix: Mix; rec: OplRecorder } {
  const bytes = buildBank({
    tempo: 1,
    patterns: [
      [0xa0, 0xc0, 0x8b, 0x24],
      [0xa1, 0xc0, 0x80, 0x31, 0x80, 0x00],
      [0xa1, 0xc0, 0x80, 0x33],
    ],
    tracks: { 0: [0] },
    instruments: [INSTRUMENT_0, INSTRUMENT_1],
    effects: [[1], [2], [1]],
  });
  const effectKeys = [mixKey("B", 1), mixKey("B", 2), mixKey("J", 1), ...Array(13).fill(0)];
  const bank: MixBank = { id: 1, key: mixKey("M", 1), effectKeys, size: bytes.length, offset: 0 };
  const track = (key: number, volume: number): MixTrack => ({ key, tempo: 1, volume, voiceMask: 1, speakerTrack: 0xff, padding: 0 });
  const tracks = [track(mixKey("M", 1), 0), track(mixKey("B", 1), 4), track(mixKey("B", 2), 5), track(mixKey("J", 1), 6)];
  const mix: Mix = { musicBufferSize: bytes.length, effectBufferSize: bytes.length, tracks, banks: [bank], data: bytes };
  return { mix, rec: new OplRecorder() };
}

describe("Sequencer : play et selectTrack", () => {
  it("play charge la banque, le tempo, le volume et le masque de voix de la table 1", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    expect(seq.play(1, "M", 1, { loop: true })).toBe(true);
    expect(seq.driver.tempo).toBe(1);
    expect(seq.isMusicPlaying()).toBe(true);
    seq.tick();
    expect(rec.at(1).some((w) => w.reg === 0xa0 && w.value === 0x59)).toBe(true);
    expect(seq.play(2, "M", 9)).toBe(false);
    expect(seq.play(1, "M", 2)).toBe(false);
  });

  it("force faux : un son qui joue déjà n'est pas relancé", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.play(1, "M", 1);
    seq.tick();
    expect(seq.play(1, "M", 1, { force: false })).toBe(false);
    expect(seq.play(1, "M", 1)).toBe(true);
  });

  it("selectTrack : 0 sans musique, 0 si la clé n'est pas dans la banque", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    expect(seq.selectTrack("B", 1, 0)).toBe(0);
    seq.play(1, "M", 1);
    expect(seq.selectTrack("Z", 9, 0)).toBe(0);
    expect(seq.isEffectPlaying()).toBe(false);
  });

  it("lance l'effet de la clé trouvée (rang 0 pour B1) avec le volume de sa ligne de la table 1", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.play(1, "M", 1);
    seq.tick();
    expect(seq.selectTrack("B", 1, 0)).toBe(2);
    expect(seq.isEffectPlaying()).toBe(true);
    expect(seq.driver.effects[0].volume).toBe(4);
    expect(seq.driver.effects[0].target).toBe(4);
    expect(seq.selectTrack("B", 2, 0)).toBe(2);
    expect(seq.driver.effects[0].volume).toBe(5);
  });

  it("une demande identique ne relance pas l'effet", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.play(1, "M", 1);
    seq.tick();
    seq.selectTrack("B", 1, 0);
    seq.tick();
    seq.tick();
    const delay = seq.driver.effects[0].delay;
    const pos = seq.driver.effects[0].patternPos;
    expect(seq.selectTrack("B", 1, 0)).toBe(2);
    expect(seq.driver.effects[0].delay).toBe(delay);
    expect(seq.driver.effects[0].patternPos).toBe(pos);
    // même clé mais priorité ou boucle différente : relancé
    expect(seq.selectTrack("B", 1, 1)).toBe(2);
    expect(seq.driver.effects[0].flags & 1).toBe(1);
  });

  it("priorité : un effet de priorité inférieure est refusé, même après la fin du précédent ; stopEffect la libère", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.play(1, "M", 1);
    seq.tick();
    expect(seq.selectTrack("J", 1, 10)).toBe(2);
    expect(seq.selectTrack("B", 2, 5)).toBe(1);
    for (let t = 0; t < 20; t++) seq.tick();
    expect(seq.isEffectPlaying()).toBe(false);
    expect(seq.selectTrack("B", 2, 5)).toBe(1);
    seq.stopEffect();
    expect(seq.selectTrack("B", 2, 5)).toBe(2);
    // priorité égale ou supérieure : accepté
    expect(seq.selectTrack("B", 1, 5)).toBe(2);
    expect(seq.selectTrack("J", 1, 9)).toBe(2);
  });

  it("stopEffect(classe, numéro) ne touche qu'à l'effet demandé", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.play(1, "M", 1);
    seq.tick();
    seq.selectTrack("B", 1, 0);
    seq.tick();
    seq.stopEffect("B", 2);
    expect(seq.isEffectPlaying()).toBe(true);
    seq.stopEffect("B", 1);
    seq.tick();
    expect(seq.isEffectPlaying()).toBe(false);
  });

  it("un effet bouclé mis de côté reprend quand l'effet suivant est arrêté", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.play(1, "M", 1, { loop: true });
    seq.tick();
    expect(seq.selectTrack("B", 1, 0, true)).toBe(2);
    expect(seq.selectTrack("B", 2, 0)).toBe(2);
    for (let t = 0; t < 30; t++) seq.tick();
    expect(seq.isEffectPlaying()).toBe(false);
    seq.stopEffect("B", 2);
    seq.tick();
    expect(seq.isEffectPlaying()).toBe(true);
    // l'effet bouclé ne se termine plus
    for (let t = 0; t < 200; t++) seq.tick();
    expect(seq.isEffectPlaying()).toBe(true);
  });

  it("stop coupe la musique, un fondu laisse les voix actives mais muettes à terme", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.play(1, "M", 1);
    seq.tick();
    seq.stop();
    expect(seq.isMusicPlaying()).toBe(false);
    seq.play(1, "M", 1);
    seq.stop(true);
    expect(seq.isMusicPlaying()).toBe(true);
    expect(seq.driver.music[0].target).toBe(0x3f);
  });

  it("coupure du son : arrête tout, play charge sans démarrer, la fin de la coupure relance", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.play(1, "M", 1, { loop: true });
    seq.tick();
    seq.setMuted(true);
    expect(seq.isMuted).toBe(true);
    expect(seq.isMusicPlaying()).toBe(false);
    expect(seq.play(1, "M", 1)).toBe(true);
    expect(seq.isMusicPlaying()).toBe(false);
    expect(seq.selectTrack("B", 1, 0)).toBe(2);
    expect(seq.isEffectPlaying()).toBe(false);
    seq.setMuted(false);
    expect(seq.isMusicPlaying()).toBe(true);
  });

  it("setMasterVolume borne la valeur à 0..63", () => {
    const { mix, rec } = syntheticMix();
    const seq = new Sequencer(mix, rec);
    seq.setMasterVolume(100);
    expect(seq.driver.masterVolume).toBe(63);
    seq.setMasterVolume(-3);
    expect(seq.driver.masterVolume).toBe(0);
  });
});

// ---- fichiers du jeu ----

const OPL_OPERATOR_SET = new Set(OPL_OPERATOR_OFFSETS);

/** Registre valide de l'OPL2 (YM3812). */
function isOpl2Register(reg: number): boolean {
  if ([0x01, 0x02, 0x03, 0x04, 0x08, 0xbd].includes(reg)) return true;
  if (reg >= 0xa0 && reg <= 0xa8) return true;
  if (reg >= 0xb0 && reg <= 0xb8) return true;
  if (reg >= 0xc0 && reg <= 0xc8) return true;
  for (const base of [0x20, 0x40, 0x60, 0x80, 0xe0]) if (reg >= base && reg <= base + 0x15 && OPL_OPERATOR_SET.has(reg - base)) return true;
  return false;
}

describe.skipIf(!hasOriginalFiles)("Sequencer : fichiers du jeu", () => {
  const mix = parseMix(readOriginal("A1FMIX.SYS"));
  const firstBank = mix.banks.find((b) => b.key === mixKey("M", 1))!;
  const song = parseSongBank(bankData(mix, firstBank)).songs[0];
  const track = mix.tracks.find((t) => t.key === mixKey("M", 1))!;
  const activeVoices = [...Array(song.voiceCount).keys()].filter((k) => (track.voiceMask >> k) & 1);

  /** Écritures hors du registre 00, que le pilote écrit une fois à l'initialisation (sans effet sur la puce). */
  const invalidWrites = (rec: OplRecorder) => rec.writes.filter((w) => w.reg !== 0x00 && !isOpl2Register(w.reg));

  it("la première musique a 10 pistes actives de 904 pas", () => {
    expect(song.voiceCount).toBe(11);
    expect(activeVoices).toHaveLength(10);
    expect(track.tempo).toBe(3);
    for (const k of activeVoices) expect(trackSteps(song, k)).toBe(904);
  });

  it("joue les 10 pistes pendant 904 pas de 3 ticks, puis s'arrête sans erreur ni écriture hors de l'OPL2", () => {
    const rec = new OplRecorder();
    const seq = new Sequencer(mix, rec);
    seq.setMasterVolume(0);
    expect(seq.play(firstBank.id, "M", 1)).toBe(true);
    const total = 904 * track.tempo;
    for (let t = 1; t < total; t++) {
      seq.tick();
      expect(seq.isMusicPlaying()).toBe(true);
    }
    // les 10 voix sont encore actives juste avant la fin ; la voix 9 (muette dans le masque) n'a jamais démarré
    for (let k = 0; k < song.voiceCount; k++) {
      expect((seq.driver.music[k].flags & 0x40) === 0).toBe(activeVoices.includes(k));
    }
    seq.tick();
    expect(seq.isMusicPlaying()).toBe(false);
    expect(invalidWrites(rec)).toEqual([]);
    // chaque piste a lu un seul motif
    for (const k of activeVoices) expect(seq.driver.music[k].patternCount).toBe(1);
    // les écritures les plus tardives sont à la fin
    expect(Math.max(...rec.writes.map((w) => w.tick))).toBe(total);
  });

  it("en boucle : la deuxième et la troisième passe écrivent exactement la même chose", () => {
    const rec = new OplRecorder();
    const seq = new Sequencer(mix, rec);
    seq.play(firstBank.id, "M", 1, { loop: true });
    const total = 904 * track.tempo;
    for (let t = 1; t <= 3 * total; t++) seq.tick();
    expect(seq.isMusicPlaying()).toBe(true);
    const pass = (n: number) =>
      rec.writes.filter((w) => w.tick > n * total && w.tick <= (n + 1) * total).map((w) => [w.tick - n * total, w.reg, w.value]);
    const second = pass(1);
    expect(second.length).toBeGreaterThan(1000);
    expect(pass(2)).toEqual(second);
    expect(invalidWrites(rec)).toEqual([]);
    // chaque passe relit le motif : les compteurs repartent de 0 à la fin de liste
    for (const k of activeVoices) expect(seq.driver.music[k].patternCount).toBe(1);
  });

  it("produit des notes : des fréquences variées sur les voix mélodiques et des coups de percussion", () => {
    const rec = new OplRecorder();
    const seq = new Sequencer(mix, rec);
    seq.play(firstBank.id, "M", 1);
    for (let t = 1; t <= 904 * 3; t++) seq.tick();
    const freqs = new Set(rec.writes.filter((w) => w.reg >= 0xa0 && w.reg <= 0xa5).map((w) => w.value));
    expect(freqs.size).toBeGreaterThan(10);
    const bd = rec.writes.filter((w) => w.reg === 0xbd).map((w) => w.value);
    expect(bd.some((v) => (v & 0x10) !== 0)).toBe(true); // grosse caisse
    expect(bd.some((v) => (v & 0x08) !== 0)).toBe(true); // caisse claire
    expect(bd.every((v) => (v & 0x20) !== 0 || v === 0)).toBe(true);
  });

  it("toutes les banques : lecture complète de la musique et de chaque effet, sans erreur et sans registre inconnu", () => {
    for (const bank of mix.banks) {
      const rec = new OplRecorder();
      const seq = new Sequencer(mix, rec);
      const key = decodeMixKey(bank.key);
      if (!key || !mix.tracks.some((t) => t.key === bank.key)) continue;
      expect(seq.play(bank.id, key.cls, key.num), `banque ${bank.id}`).toBe(true);
      for (const effectKey of bank.effectKeys.filter((k) => k !== 0)) {
        const e = decodeMixKey(effectKey)!;
        seq.stopEffect();
        const result = seq.selectTrack(e.cls, e.num, 0);
        expect(result, `effet ${e.cls}${e.num} de la banque ${bank.id}`).toBe(2);
        for (let t = 0; t < 300; t++) seq.tick();
      }
      for (let t = 0; t < 1200; t++) seq.tick();
      expect(invalidWrites(rec), `banque ${bank.id}`).toEqual([]);
    }
  });

  it("hypothèses du séquenceur : enveloppes de hauteur neutres, jamais de note juste après E0 ou E2", () => {
    for (const bank of mix.banks) {
      const parsed = parseSongBank(bankData(mix, bank)).songs[0];
      for (const envelope of parsed.pitchEnvelopes) for (const segment of envelope.segments) expect(segment.delta).toBe(0);
      for (const pattern of parsed.patterns) {
        // E0 et E2 laissent AH = 7 dans le pilote : une note n'est correcte que si une durée ou un instrument la précède
        let dirty = false;
        for (const event of pattern.events) {
          if (event.kind === "transpose" || event.kind === "effectTempo") dirty = true;
          else if (event.kind === "duration" || event.kind === "instrument" || event.kind === "pitchEnvelope") dirty = false;
          else if (event.kind === "note") expect(dirty, `banque ${bank.id}, motif ${pattern.offset}`).toBe(false);
        }
      }
    }
  });

  it("tables d'opérateurs et de fréquences identiques à celles de l'exécutable", () => {
    const tables = readDriverTables(readOriginal("AM1.EXE"));
    expect(tables.operatorOffsets).toEqual([...OPL_OPERATOR_OFFSETS]);
  });
});
