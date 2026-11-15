/**
 * Modules musicaux `CORPn` et instruments `.ADL` de Croisière pour un cadavre : lecture des fichiers seulement, sans lecture
 * du son (docs/croisiere/formats.md § 3.8).
 *
 * Référence : `engines/cruise/sound.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `PCSoundFxPlayer::load / play / handleEvents /
 * handlePattern` (module SoundFX à quatre voix) et `AdLibSoundDriver::loadRegisterInstrument`, `AdLibSoundDriverADL::loadInstrument`
 * (timbre de 58 octets). Module : grand-boutiste ; timbre : mots u16 petit-boutistes.
 *
 * Disposition d'un module : 15 volumes d'instrument (octets 0..14), 15 fiches de 30 octets à 20 (nom de 12 octets, le reste n'est pas
 * lu), nombre d'ordres à 470, tempo à 471, table d'ordre de 128 octets à 472, 1 800 octets non lus à 600, puis les motifs de
 * 1 024 octets à 2 400 (64 lignes de 16 octets = 4 voix de 4 octets).
 *
 * Écart volontaire : ScummVM calcule `eventsDelay` en entier (`(244 - tempo) * 100 / 1060`), ce que fait `eventsDelay` ici ; le nombre
 * de motifs est déduit de la taille du fichier et doit tomber juste (vérifié sur les 14 modules).
 */
import { latin1String } from "./overlay";

export const MUSIC_INSTRUMENT_COUNT = 15;
export const MUSIC_VOICES = 4;
export const MUSIC_ROWS_PER_PATTERN = 64;
export const MUSIC_PATTERN_SIZE = 1024;
export const MUSIC_ORDER_TABLE_SIZE = 128;
const NUM_ORDERS_OFFSET = 470;
const TEMPO_OFFSET = 471;
const ORDER_TABLE_OFFSET = 472;
const INSTRUMENT_CARD_OFFSET = 20;
const INSTRUMENT_CARD_SIZE = 30;
const INSTRUMENT_NAME_SIZE = 12;
const PATTERNS_OFFSET = 600 + 1800;

export interface MusicEvent {
  /** Période (i16) : > 0 déclenche une note. */
  freq: number;
  /** Instrument 1..15, 0 = inchangé (`octet 2 >> 4`). */
  instrument: number;
  /** Quartet bas de l'octet 2 (effet, ignoré par le moteur). */
  effect: number;
  /** Octet 3 (ignoré par le moteur). */
  param: number;
}

export interface MusicModule {
  /** Volume de chaque instrument (octets 0..14). */
  volumes: number[];
  /** Nom brut de chaque fiche (12 octets jusqu'au NUL, `""` = instrument ignoré). */
  instrumentNames: string[];
  /** Nom du fichier `.ADL` de chaque instrument (`""` si ignoré) : extension remplacée par `.ADL`, en majuscules. */
  instrumentFiles: string[];
  numOrders: number;
  /** Octet de tempo brut. */
  tempo: number;
  /** Ticks de 20 ms entre deux lignes : `(244 - tempo) * 100 / 1060`, entier. */
  eventsDelay: number;
  /** Table d'ordre complète (128 octets) ; seuls les `numOrders` premiers sont joués. */
  orders: number[];
  patternCount: number;
  /** Données de tous les motifs, copiées du fichier. */
  patterns: Uint8Array;
}

/** Nom du fichier `.ADL` d'une fiche : coupe au dernier point, ajoute `.ADL` (`PCSoundFxPlayer::load`). */
export function adlFileName(cardName: string): string {
  if (cardName === "") return "";
  const dot = cardName.lastIndexOf(".");
  return `${dot >= 0 ? cardName.slice(0, dot) : cardName}.ADL`.toUpperCase();
}

/** Analyse un module `CORPn` dépacké. */
export function parseMusicModule(file: Uint8Array): MusicModule {
  if (file.length < PATTERNS_OFFSET) throw new RangeError("module musical trop court");
  const body = file.length - PATTERNS_OFFSET;
  if (body % MUSIC_PATTERN_SIZE > 1) throw new RangeError(`module musical : ${body} octets de motifs, pas un multiple de ${MUSIC_PATTERN_SIZE}`);
  // Une taille impaire vient du padding d'un octet du dépaquetage (formats.md § 1.3).
  const patternCount = Math.floor(body / MUSIC_PATTERN_SIZE);
  const volumes: number[] = [];
  const instrumentNames: string[] = [];
  for (let i = 0; i < MUSIC_INSTRUMENT_COUNT; i++) {
    volumes.push(file[i]!);
    const base = INSTRUMENT_CARD_OFFSET + i * INSTRUMENT_CARD_SIZE;
    instrumentNames.push(latin1String(file.subarray(base, base + INSTRUMENT_NAME_SIZE)));
  }
  const numOrders = file[NUM_ORDERS_OFFSET]!;
  const tempo = file[TEMPO_OFFSET]!;
  const orders = Array.from(file.subarray(ORDER_TABLE_OFFSET, ORDER_TABLE_OFFSET + MUSIC_ORDER_TABLE_SIZE));
  if (numOrders > MUSIC_ORDER_TABLE_SIZE) throw new RangeError(`module musical : ${numOrders} ordres`);
  for (let i = 0; i < numOrders; i++) {
    if (orders[i]! >= patternCount) throw new RangeError(`module musical : l'ordre ${i} désigne le motif ${orders[i]} sur ${patternCount}`);
  }
  return {
    volumes,
    instrumentNames,
    instrumentFiles: instrumentNames.map(adlFileName),
    numOrders,
    tempo,
    eventsDelay: Math.trunc(((244 - tempo) * 100) / 1060),
    orders,
    patternCount,
    patterns: file.slice(PATTERNS_OFFSET, PATTERNS_OFFSET + patternCount * MUSIC_PATTERN_SIZE),
  };
}

/** Événement d'une voix (0..3) à une ligne (0..63) d'un motif. */
export function musicEvent(module: MusicModule, pattern: number, row: number, voice: number): MusicEvent {
  if (pattern < 0 || pattern >= module.patternCount || row < 0 || row >= MUSIC_ROWS_PER_PATTERN || voice < 0 || voice >= MUSIC_VOICES) {
    throw new RangeError(`événement hors module : motif ${pattern}, ligne ${row}, voix ${voice}`);
  }
  const at = pattern * MUSIC_PATTERN_SIZE + row * 16 + voice * 4;
  const p = module.patterns;
  return { freq: ((p[at]! << 8) | p[at + 1]!) << 16 >> 16, instrument: p[at + 2]! >> 4, effect: p[at + 2]! & 15, param: p[at + 3]! };
}

/** Opérateur OPL2 d'un timbre : 13 mots petit-boutistes (`loadRegisterInstrument`). */
export interface AdlOperator {
  keyScaling: number;
  freqMultiplier: number;
  feedback: number;
  attack: number;
  sustainLevel: number;
  sustainingSound: number;
  decay: number;
  release: number;
  outputLevel: number;
  am: number;
  vibrato: number;
  envelopeScaling: number;
  /** 0 = modulation de fréquence. */
  connection: number;
}

export interface AdlInstrument {
  /** 0 = mélodique, autre = percussion. */
  mode: number;
  /** Voix de percussion. */
  channel: number;
  waveSelectMod: number;
  waveSelectCar: number;
  /** Si non nul : note fixe jouée pour un effet sonore. */
  amDepth: number;
  modulator: AdlOperator;
  carrier: AdlOperator;
}

export const ADL_SIZE = 58;
const ADL_OPERATOR_SIZE = 26;

function readOperator(view: DataView, at: number): AdlOperator {
  const w = (k: number) => view.getUint16(at + 2 * k, true);
  return {
    keyScaling: w(0),
    freqMultiplier: w(1),
    feedback: w(2),
    attack: w(3),
    sustainLevel: w(4),
    sustainingSound: w(5),
    decay: w(6),
    release: w(7),
    outputLevel: w(8),
    am: w(9),
    vibrato: w(10),
    envelopeScaling: w(11),
    connection: w(12),
  };
}

/**
 * Analyse un timbre `.ADL` dépacké (58 octets). Les octets suivants sont ignorés, comme dans ScummVM (`setupInstrument` ne lit que le
 * début) : certaines entrées de la base de fichiers en ont (60 octets pour un bruitage de la première pièce).
 */
export function parseAdlInstrument(file: Uint8Array): AdlInstrument {
  if (file.length < ADL_SIZE) throw new RangeError(`ADL : ${file.length} octets, ${ADL_SIZE} attendus`);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  return {
    mode: file[0]!,
    channel: file[1]!,
    waveSelectMod: file[2]! & 3,
    waveSelectCar: file[3]! & 3,
    amDepth: file[4]!,
    modulator: readOperator(view, 6),
    carrier: readOperator(view, 6 + ADL_OPERATOR_SIZE),
  };
}
