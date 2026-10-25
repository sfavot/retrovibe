/**
 * Musiques et effets d'*Armaeth* : format des banques de `A1FMIX.SYS` (voir `mix.ts`) telles que le
 * pilote embarqué dans `AM1.EXE` (code `40f7`, données `406e`) les joue, et tables du pilote.
 * Tout est décrit dans `docs/armaeth/audio.md` ; les adresses sont celles de la rétro-ingénierie
 * (`docs/armaeth/re-index.md`).
 *
 * Une banque est une suite de sous-morceaux (toujours un seul dans les données du jeu) ; chaque
 * sous-morceau est un en-tête, 11 pointeurs de pistes, une table de motifs, des listes de motifs par
 * piste, les motifs eux-mêmes, puis les tables d'enveloppes de hauteur, d'instruments OPL2, de
 * programmes MIDI et d'effets. Tous les offsets internes sont relatifs au début du sous-morceau
 * (`05d9` : `SI`). Les champs que le pilote ne lit pas ou dont le rôle reste incertain sont gardés bruts.
 */

/** Fréquence de l'interruption du pilote (IRQ0, diviseur du PIT `0x5D37`, `40f7:0260`). */
export const DRIVER_TICK_HZ = 50;
/** Nombre de pointeurs de piste d'un en-tête, quel que soit le nombre de voix (`05d9` en lit `voiceCount`). */
export const TRACK_SLOTS = 11;
/** Offset de la table des motifs dans un sous-morceau (`05d9` : `LEA AX,[DI+0x22]`). */
export const PATTERN_TABLE_OFFSET = 0x22;
/** Taille de l'en-tête de sous-morceau avant les pointeurs de piste. */
export const SONG_HEADER_SIZE = 12;
/** Taille d'une enveloppe de hauteur (`074d` : `MUL 13`). */
export const PITCH_ENVELOPE_SIZE = 13;
/** Taille d'un instrument OPL2 (`082d` : `MUL 12`). */
export const INSTRUMENT_SIZE = 12;
/** Nombre d'effets d'une banque (`snd_start_track` refuse un indice supérieur ou égal à 30, `40f7:157e`). */
export const EFFECT_SLOTS = 30;
/** Taille d'une entrée de la table d'effets (`40f7:15a7` : indice * 5). */
export const EFFECT_ENTRY_SIZE = 5;
/** Marque de fin d'un motif, d'une liste de motifs et d'une entrée d'effet. */
export const END_MARK = 0xff;

/** Durées des notes en pas de séquenceur (`406e:0018`, 16 mots) : `80..8F` choisit l'une d'elles. */
export const NOTE_DURATIONS: readonly number[] = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];

/** Numéros F de l'OPL2 pour les 12 demi-tons d'une octave (`406e:06e5`) ; le bloc (octave) vaut `note / 12`. */
export const OPL_FNUMBERS: readonly number[] = [
  0x159, 0x16d, 0x183, 0x19a, 0x1b2, 0x1cc, 0x1e8, 0x205, 0x223, 0x244, 0x266, 0x28b,
];

/** Nombre de notes que connaît le pilote (8 octaves de 12 demi-tons) ; les données vont de 0 à 95. */
export const NOTE_COUNT = 96;

/** Mot écrit dans les registres `A0`/`B0` (sans la touche) pour une note : numéro F + bloc << 10 (`406e:06e5`). */
export function oplFrequency(note: number): number {
  return OPL_FNUMBERS[note % 12] | (Math.floor(note / 12) << 10);
}

/** Note MIDI jouée par le pilote MPU-401 pour une note des données : `note + 12` (`40f7:1356`). */
export function midiNote(note: number): number {
  return note + 12;
}

/** Diviseurs du PIT du haut-parleur par note (`406e:07a7`, 108 mots) ; 0xFFFF pour les deux premières notes. */
export const SPEAKER_DIVISORS: readonly number[] = [
  0xffff, 0xffff, 0xfe38, 0xefec, 0xe26c, 0xd5ac, 0xc9a8, 0xbe4c, 0xb398, 0xa97c, 0x9ff4, 0x96f4,
  0x8eb8, 0x86b0, 0x7f1c, 0x77f6, 0x7136, 0x6ad6, 0x64d4, 0x5f26, 0x59cc, 0x54be, 0x4ffa, 0x4b7a,
  0x475c, 0x4358, 0x3f8e, 0x3bfb, 0x389b, 0x356b, 0x326a, 0x2f93, 0x2ce6, 0x2a5f, 0x27fd, 0x25bd,
  0x23ae, 0x21ac, 0x1fc7, 0x1dfd, 0x1c4d, 0x1ab6, 0x1935, 0x17ca, 0x1673, 0x1530, 0x13fe, 0x12de,
  0x11d7, 0x10d6, 0x0fe4, 0x0eff, 0x0e27, 0x0d5b, 0x0c9a, 0x0be5, 0x0b39, 0x0a98, 0x09ff, 0x096f,
  0x08ec, 0x086b, 0x07f2, 0x077f, 0x0713, 0x06ad, 0x064d, 0x05f2, 0x059d, 0x054c, 0x0500, 0x04b8,
  0x0476, 0x0436, 0x03f9, 0x03c0, 0x038a, 0x0357, 0x0327, 0x02f9, 0x02ce, 0x02a6, 0x0280, 0x025c,
  0x023b, 0x021b, 0x01fc, 0x01e0, 0x01c5, 0x01ab, 0x0193, 0x017c, 0x0167, 0x0153, 0x0140, 0x012e,
  0x011d, 0x010d, 0x00fe, 0x00f0, 0x00e2, 0x00d5, 0x00c9, 0x00be, 0x00b3, 0x00a9, 0x00a0, 0x0097,
];

/** Notes GM des percussions (voix 7 à 11 en mode rythme), jouées sur le canal MIDI 10 (`406e:087f`). */
export const MIDI_DRUM_NOTES: readonly number[] = [0x23, 0x26, 0x30, 0x33, 0x2e];

/** Décalages des 18 opérateurs de l'OPL2 (`406e:03a3`). */
export const OPL_OPERATOR_OFFSETS: readonly number[] = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
];
/** Pour chaque voix en mode mélodique (9 voix) : indices (modulateur, porteuse) dans `OPL_OPERATOR_OFFSETS` (`406e:03b5`). */
export const OPL_VOICE_OPERATORS_MELODIC: readonly number[] = [
  0, 3, 1, 4, 2, 5, 6, 9, 7, 10, 8, 11, 12, 15, 13, 16, 14, 17,
];
/**
 * Idem pour 11 voix (6 mélodiques, grosse caisse, caisse claire, tom, cymbale, charleston ; mode rythme
 * de l'OPL2, `406e:03c7`). Les quatre dernières voix n'ont qu'un opérateur (indice répété).
 */
export const OPL_VOICE_OPERATORS_RHYTHM: readonly number[] = [
  0, 3, 1, 4, 2, 5, 6, 9, 7, 10, 8, 11, 12, 15, 16, 16, 14, 14, 17, 17, 13, 13,
];

/** Position, dans `AM1.EXE`, du segment de données du pilote (`406e`) : `0x4000 + (0x406e - 0x1000) * 16`. */
export const DRIVER_DATA_FILE_OFFSET = 0x346e0;

/** Tables que le pilote lit dans son segment de données, relues dans l'exécutable (pour vérifier les constantes). */
export interface DriverTables {
  noteDurations: number[];
  /** `NOTE_COUNT` mots : numéro F | bloc << 10. */
  oplFrequencies: number[];
  speakerDivisors: number[];
  drumNotes: number[];
  operatorOffsets: number[];
  melodicOperators: number[];
  rhythmOperators: number[];
}

/** Lit les tables du pilote dans `AM1.EXE`. */
export function readDriverTables(exe: Uint8Array): DriverTables {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const base = DRIVER_DATA_FILE_OFFSET;
  if (exe.length < base + 0x890) throw new Error("EXE invalide : segment du pilote tronqué");
  const words = (off: number, n: number) => Array.from({ length: n }, (_, i) => view.getUint16(base + off + i * 2, true));
  const bytes = (off: number, n: number) => Array.from(exe.subarray(base + off, base + off + n));
  return {
    noteDurations: words(0x18, 16),
    oplFrequencies: words(0x6e5, NOTE_COUNT),
    speakerDivisors: words(0x7a7, SPEAKER_DIVISORS.length),
    drumNotes: bytes(0x87f, 5),
    operatorOffsets: bytes(0x3a3, 18),
    melodicOperators: bytes(0x3b5, 18),
    rhythmOperators: bytes(0x3c7, 22),
  };
}

/** Événement d'un motif, tel que le séquenceur l'interprète (`40f7:0a52` pour l'OPL2). */
export type PatternEvent =
  /** Octet `00..7F` : note (0 = do 0 ; MIDI = note + 12). Aucun silence explicite : une piste muette joue la note 0 avec `volume` 31. */
  | { kind: "note"; note: number }
  /** `80..9F` : durée des notes suivantes, indice dans `NOTE_DURATIONS` (bits 0 à 3 ; le bit 4 est ignoré). */
  | { kind: "duration"; index: number; ticks: number }
  /** `A0..BF` (indice = bits 0 à 4) ou `E3 xx` (indice = `xx & 0x7F`) : instrument de la voix. */
  | { kind: "instrument"; index: number }
  /**
   * `C0..DF` : niveau de volume `v` (bits 0 à 4). OPL2 et MIDI : atténuation `2 * v + 1` ajoutée au volume
   * de la voix (`DF` = 63 = muet). Haut-parleur : `v ^ 0x1F` ≠ 0 = audible (`0c9c`).
   */
  | { kind: "volume"; level: number }
  /** `E0 xx` (et `E4`, `E8`... : le pilote ne lit que les bits 0 et 1) : transposition en demi-tons, ajoutée à chaque note (toujours 0 dans les données). */
  | { kind: "transpose"; value: number }
  /** `E1 xx` : enveloppe de hauteur `xx` de la table du sous-morceau (toujours 0 dans les données). */
  | { kind: "pitchEnvelope"; index: number }
  /** `E2 xx` : tempo des voix d'effet (`SI+0x1B`), en ticks de 50 Hz par pas. */
  | { kind: "effectTempo"; value: number }
  /** `E7`, `EB`... (bits 0 et 1 à 1, hors `E3`) : le pilote ne fait rien (`078f` : RET) ; absent des données. */
  | { kind: "nop"; code: number };

export interface Pattern {
  /** Offset du motif dans le sous-morceau. */
  offset: number;
  /** Octets du motif, `0xFF` final compris. */
  bytes: Uint8Array;
  events: PatternEvent[];
}

/** Décode un motif à partir de `start`, jusqu'au premier `0xFF` rencontré comme code. */
export function decodePattern(data: Uint8Array, start: number, offset = start): Pattern {
  const events: PatternEvent[] = [];
  let pos = start;
  const next = (): number => {
    if (pos >= data.length) throw new Error("MUS invalide : motif sans fin");
    return data[pos++];
  };
  for (;;) {
    const code = next();
    if (code === END_MARK) break;
    if (code < 0x80) events.push({ kind: "note", note: code });
    else if (code < 0xa0) events.push({ kind: "duration", index: code & 0x0f, ticks: NOTE_DURATIONS[code & 0x0f] });
    else if (code < 0xc0) events.push({ kind: "instrument", index: code & 0x1f });
    else if (code < 0xe0) events.push({ kind: "volume", level: code & 0x1f });
    else if (code === 0xe3) events.push({ kind: "instrument", index: next() & 0x7f });
    else {
      switch (code & 3) {
        case 0:
          events.push({ kind: "transpose", value: next() });
          break;
        case 1:
          events.push({ kind: "pitchEnvelope", index: next() });
          break;
        case 2:
          events.push({ kind: "effectTempo", value: next() });
          break;
        default:
          events.push({ kind: "nop", code });
      }
    }
  }
  return { offset, bytes: data.subarray(start, pos), events };
}

/** Segment d'une enveloppe de hauteur (3 octets, `07b7`). */
export interface PitchSegment {
  /** Nombre de pas du segment (`ES:[BP+0]`). */
  count: number;
  /** Incrément de hauteur par pas, signé (`ES:[BP+1]`). */
  delta: number;
  /** Durée d'un pas en ticks (`ES:[BP+2]`). */
  ticks: number;
}

/** Enveloppe de hauteur (13 octets : drapeaux puis 4 segments). Dans les données, une seule, neutre (deltas nuls). */
export interface PitchEnvelope {
  /** Bit 7 : le dernier segment reboucle sur le deuxième (`07f5`..`0815`). Autres bits : non lus. */
  flags: number;
  segments: PitchSegment[];
}

/** Opérateur OPL2 d'un instrument : valeurs écrites telles quelles dans les registres. */
export interface OplOperator {
  /** Registre `20+op` : tremolo, vibrato, maintien, KSR, multiplicateur. */
  characteristics: number;
  /** Registre `40+op` : KSL (bits 6-7) et niveau total. Pour la porteuse, seuls les bits 6-7 sont écrits (le niveau vient du volume). */
  levels: number;
  /** Registre `60+op` : attaque et déclin. */
  attackDecay: number;
  /** Registre `80+op` : niveau de maintien et relâchement. */
  sustainRelease: number;
  /** Registre `E0+op` : forme d'onde. */
  waveform: number;
}

/** Instrument OPL2 de 12 octets (`082d`). */
export interface OplInstrument {
  /** Octet 0 : jamais lu par le pilote ; valeurs 0, 1, 2, 4, 8, 16 (ressemble à un bit du registre `BD`). */
  unknown: number;
  /** Octet 1 : registre `C0+voix` (rétroaction, connexion ; le bit 0 = additif, auquel cas le volume agit aussi sur le modulateur). */
  feedbackConnection: number;
  modulator: OplOperator;
  carrier: OplOperator;
  raw: Uint8Array;
}

export interface Song {
  /** Offset du sous-morceau dans la banque, base de tous les offsets internes. */
  offset: number;
  /** Mot 0 : tempo initial (ticks de 50 Hz par pas de séquenceur) ; remplacé par celui de l'entrée de la table 1 de `A1FMIX.SYS`. */
  tempo: number;
  /** Mot 1 : nombre de voix, 9 (mélodique) ou 11 (6 mélodiques + 5 percussions OPL2 ; `[0x17]`). */
  voiceCount: number;
  /** Mot 2 : offset des programmes MIDI (`BX+0x17`, `10cc`). */
  midiMapOffset: number;
  /** Mot 3 : offset de la table d'effets (`BX+0x19`, `snd_start_track`) ; 0 = aucun. */
  effectTableOffset: number;
  /** Mot 4 : offset des enveloppes de hauteur (`BX+4`, `074d`). */
  pitchEnvelopeOffset: number;
  /** Mot 5 : offset des instruments OPL2 (`BX+0x13`, `082d`). */
  instrumentOffset: number;
  /** Les 11 pointeurs de piste bruts (mots à partir de l'offset 12) ; seuls les `voiceCount` premiers servent. */
  trackOffsets: number[];
  /** Pour chaque pointeur de piste : liste de numéros de motifs jouée dans l'ordre (la liste finit par 0xFF, absent ici). */
  trackLists: number[][];
  patterns: Pattern[];
  pitchEnvelopes: PitchEnvelope[];
  instruments: OplInstrument[];
  /** Un programme MIDI par instrument (le bit 7 est masqué par le pilote). */
  midiPrograms: Uint8Array;
  /** Entrées de la table d'effets (30) : numéros de motifs à jouer sur les voix d'effet 0 à 4 ; liste vide = effet libre. */
  effects: number[][];
}

/**
 * Longueur d'une piste en pas de séquenceur (un pas = `tempo` ticks de 50 Hz) : somme des durées des
 * notes de ses motifs. La durée courante persiste d'un motif à l'autre ; elle vaut 0 au départ.
 * Dans les données, toutes les pistes actives d'un morceau ont la même longueur (904 pas pour la première musique).
 */
export function trackSteps(song: Song, track: number): number {
  let ticks = 0;
  let duration = 0;
  for (const p of song.trackLists[track]) {
    for (const e of song.patterns[p].events) {
      if (e.kind === "duration") duration = e.ticks;
      else if (e.kind === "note") ticks += duration;
    }
  }
  return ticks;
}

export interface SongBank {
  /** Offsets des sous-morceaux (table de mots au début de la banque ; `05d9` lit le mot d'indice du morceau). */
  songOffsets: number[];
  songs: Song[];
}

/** Lit une banque de `A1FMIX.SYS` (octets donnés par `bankData`). */
export function parseSongBank(data: Uint8Array): SongBank {
  const fail = (msg: string): never => {
    throw new Error(`MUS invalide : ${msg}`);
  };
  if (data.length < 2) fail("banque trop courte");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (off: number): number => {
    if (off < 0 || off + 2 > data.length) fail(`mot hors banque à ${off}`);
    return view.getUint16(off, true);
  };

  const firstSong = u16(0);
  if (firstSong < 2 || firstSong % 2 !== 0) fail("table des sous-morceaux");
  const songOffsets: number[] = [];
  for (let i = 0; i < firstSong / 2; i++) songOffsets.push(u16(i * 2));

  const songs = songOffsets.map((base): Song => {
    const at = (rel: number) => base + rel;
    const tempo = u16(at(0));
    const voiceCount = u16(at(2));
    if (voiceCount < 1 || voiceCount > TRACK_SLOTS) fail(`nombre de voix ${voiceCount}`);
    const midiMapOffset = u16(at(4));
    const effectTableOffset = u16(at(6));
    const pitchEnvelopeOffset = u16(at(8));
    const instrumentOffset = u16(at(10));
    const trackOffsets = Array.from({ length: TRACK_SLOTS }, (_, k) => u16(at(SONG_HEADER_SIZE + 2 * k)));

    // La table des motifs occupe l'espace entre elle et la première liste de motifs.
    const firstList = Math.min(...trackOffsets);
    const patternSpan = firstList - PATTERN_TABLE_OFFSET;
    if (patternSpan < 0 || patternSpan % 2 !== 0) fail("table des motifs");
    const patternCount = patternSpan / 2;
    const patterns: Pattern[] = [];
    for (let p = 0; p < patternCount; p++) {
      const rel = u16(at(PATTERN_TABLE_OFFSET + 2 * p));
      patterns.push(decodePattern(data, at(rel), rel));
    }

    const trackLists = trackOffsets.map((rel) => {
      const list: number[] = [];
      for (let pos = at(rel); ; pos++) {
        if (pos >= data.length) fail("liste de motifs sans fin");
        if (data[pos] === END_MARK) break;
        if (data[pos] >= patternCount) fail(`motif ${data[pos]} inexistant`);
        list.push(data[pos]);
      }
      return list;
    });

    const pitchSpan = instrumentOffset - pitchEnvelopeOffset;
    if (pitchSpan < 0 || pitchSpan % PITCH_ENVELOPE_SIZE !== 0) fail("enveloppes de hauteur");
    const pitchEnvelopes: PitchEnvelope[] = [];
    for (let e = 0; e < pitchSpan / PITCH_ENVELOPE_SIZE; e++) {
      const o = at(pitchEnvelopeOffset) + e * PITCH_ENVELOPE_SIZE;
      const segments: PitchSegment[] = [];
      for (let s = 0; s < 4; s++) {
        segments.push({
          count: data[o + 1 + 3 * s],
          delta: (data[o + 2 + 3 * s] << 24) >> 24,
          ticks: data[o + 3 + 3 * s],
        });
      }
      pitchEnvelopes.push({ flags: data[o], segments });
    }

    const instrumentSpan = midiMapOffset - instrumentOffset;
    if (instrumentSpan < 0 || instrumentSpan % INSTRUMENT_SIZE !== 0) fail("instruments");
    const instruments: OplInstrument[] = [];
    for (let i = 0; i < instrumentSpan / INSTRUMENT_SIZE; i++) {
      const raw = data.subarray(at(instrumentOffset) + i * INSTRUMENT_SIZE, at(instrumentOffset) + (i + 1) * INSTRUMENT_SIZE);
      instruments.push({
        unknown: raw[0],
        feedbackConnection: raw[1],
        modulator: { characteristics: raw[2], levels: raw[3], attackDecay: raw[4], sustainRelease: raw[5], waveform: raw[6] },
        carrier: { characteristics: raw[7], levels: raw[8], attackDecay: raw[9], sustainRelease: raw[10], waveform: raw[11] },
        raw,
      });
    }

    // Les programmes MIDI vont jusqu'à la table d'effets, ou jusqu'à la fin de la banque sans elle.
    const midiEnd = effectTableOffset !== 0 ? at(effectTableOffset) : data.length;
    if (midiEnd < at(midiMapOffset) || midiEnd > data.length) fail("programmes MIDI");
    const midiPrograms = data.subarray(at(midiMapOffset), midiEnd);

    const effects: number[][] = [];
    if (effectTableOffset !== 0) {
      const tableEnd = at(effectTableOffset) + EFFECT_SLOTS * EFFECT_ENTRY_SIZE;
      if (tableEnd > data.length) fail("table d'effets tronquée");
      for (let e = 0; e < EFFECT_SLOTS; e++) {
        const entry: number[] = [];
        for (let k = 0; k < EFFECT_ENTRY_SIZE; k++) {
          const v = data[at(effectTableOffset) + e * EFFECT_ENTRY_SIZE + k];
          if (v === END_MARK) break;
          entry.push(v);
        }
        effects.push(entry);
      }
    }

    return {
      offset: base,
      tempo,
      voiceCount,
      midiMapOffset,
      effectTableOffset,
      pitchEnvelopeOffset,
      instrumentOffset,
      trackOffsets,
      trackLists,
      patterns,
      pitchEnvelopes,
      instruments,
      midiPrograms,
      effects,
    };
  });

  return { songOffsets, songs };
}
