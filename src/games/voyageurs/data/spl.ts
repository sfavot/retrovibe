/**
 * Effets sonores `.SPL` : patchs d'instrument OPL2 (pas de PCM sur PC).
 *
 * Référence : ScummVM engines/cine/anim.cpp (`loadSpl`, stocké tel quel en `ANIM_RAW`) et sound.cpp (`AdLibSoundDriverINS::playSample`,
 * `loadInstrument`, `AdLibSoundDriver::loadRegisterInstrument`) (GPL v3 ou ultérieure). Le bloc instrument commence à l'octet 257
 * (les 257 premiers octets sont un patch Roland MT-32, ignoré) : mode, canal, deux opérateurs de 13 mots 16 bits petit-boutistes
 * (modulateur puis porteuse), puis trois mots (formes d'onde, profondeur AM). docs/voyageurs/formats.md § 2.5.
 *
 * Écarts volontaires : les ~50 octets de fin du fichier (non décodés, non lus par ScummVM) sont ignorés ; le pilote OPL
 * (volumes, fréquences, `setupInstrument`) est écrit dans audio/, pas ici. Les octets bruts sont gardés dans `data`.
 */
import { BinaryReader } from "../../../data/reader";

export const SPL_INSTRUMENT_OFFSET = 257;
/** mode + canal + 2 x 26 + 3 x 2. */
export const SPL_INSTRUMENT_SIZE = 2 + 26 + 26 + 6;

export interface OplOperator {
  /** Registre 0x20 : AM (0x80), vibrato (0x40), maintien (0x20), échelle d'enveloppe (0x10), multiplicateur (4 bits). */
  readonly vibrato: number;
  /** Registre 0x60. */
  readonly attackDecay: number;
  /** Registre 0x80. */
  readonly sustainRelease: number;
  /** Feedback, bit 0 = 1 si le mot « modulation de fréquence » est nul. */
  readonly feedbackStrength: number;
  readonly keyScaling: number;
  readonly outputLevel: number;
  readonly freqMod: number;
}

export interface OplInstrument {
  readonly mode: number;
  readonly channel: number;
  readonly modulator: OplOperator;
  readonly carrier: OplOperator;
  readonly waveSelectModulator: number;
  readonly waveSelectCarrier: number;
  readonly amDepth: number;
}

export interface SplSound {
  /** Fichier entier (`ANIM_RAW`). */
  readonly data: Uint8Array;
  readonly size: number;
  readonly instrument: OplInstrument;
}

/** `loadRegisterInstrument` : 13 mots petit-boutistes. */
function readOperator(reader: BinaryReader): OplOperator {
  const words: number[] = [];
  for (let i = 0; i < 13; i++) words.push(reader.u16());
  const w = (i: number): number => words[i]!;
  let vibrato = 0;
  if (w(9)) vibrato |= 0x80;
  if (w(10)) vibrato |= 0x40;
  if (w(5)) vibrato |= 0x20;
  if (w(11)) vibrato |= 0x10;
  vibrato |= w(1) & 0xf;
  const attackDecay = ((w(3) << 4) | (w(6) & 0xf)) & 0xff;
  const sustainRelease = ((w(4) << 4) | (w(7) & 0xf)) & 0xff;
  let feedbackStrength = (w(2) << 1) & 0xff;
  if (w(12) === 0) feedbackStrength |= 1;
  return { vibrato, attackDecay, sustainRelease, feedbackStrength, keyScaling: w(0) & 0xff, outputLevel: w(8) & 0xff, freqMod: w(12) & 0xff };
}

export function readSpl(data: Uint8Array): SplSound {
  if (data.length < SPL_INSTRUMENT_OFFSET + SPL_INSTRUMENT_SIZE) throw new RangeError(`SPL trop court : ${data.length} octets`);
  const reader = new BinaryReader(data);
  reader.offset = SPL_INSTRUMENT_OFFSET;
  const mode = reader.u8();
  const channel = reader.u8();
  const modulator = readOperator(reader);
  const carrier = readOperator(reader);
  const waveSelectModulator = reader.u8() & 3;
  reader.u8();
  const waveSelectCarrier = reader.u8() & 3;
  reader.u8();
  const amDepth = reader.u8();
  return { data, size: data.length, instrument: { mode, channel, modulator, carrier, waveSelectModulator, waveSelectCarrier, amDepth } };
}
