import type { OplSink } from "../../../audio/opl-stream";

/**
 * Pilote AdLib de *Flight of the Amazon Queen* : traduit les messages MIDI du séquenceur et les méta-événements `FF 7F` de
 * `AQBANK.MUS` en écritures de registres OPL2 (`OplSink`). Réécriture de `AdLibMidiDriver` (`engines/queen/midiadlib.cpp`,
 * ScummVM, GPL v3 ou ultérieure), **lu en entier** pour comprendre puis réécrit : mêmes tables (cartes des voix, valeurs
 * initiales, fréquences des notes), même ordre d'écriture, noms du dépôt.
 *
 * Fonctionnement (lu) :
 * - 9 voix mélodiques, ou 6 mélodiques + 5 percussions (mode rythme, méta-événement 2) ; chaque voix MIDI = deux opérateurs
 *   (modulateur, porteuse) dont l'instrument (13 octets chacun + un numéro de forme d'onde) vient d'un `FF 7F` de type 1 ;
 * - messages courts : `cmd = (état >> 4) & 7` ; seuls `8n`/`9n` (note), `Dn` (volume du canal) et `En` (pitch bend, 14 bits)
 *   agissent, les contrôleurs, les changements de programme et la pression par touche sont ignorés ;
 * - hauteur : note MIDI - 12, pitch bend de +/- 2 tons (multiplié par le méta-événement 3), table de 192 fréquences par octave.
 *
 * Écarts avec ScummVM :
 * - le pilote n'a pas d'émulateur : il n'écrit que dans l'`OplSink` (l'émulateur tourne dans le worklet, `src/audio/opl2.ts`) ;
 * - les canaux MIDI 11 à 15 (sans voix) sont ignorés, là où ScummVM écrit hors de son tableau de volumes ;
 * - `setVolume` n'est pas appelé tant que le volume général reste à sa valeur de départ (comme ScummVM) : la table de volumes
 *   des canaux reste à 128, le volume choisi par la joueuse est un gain de sortie (`WebOpl.setVolume`).
 */

/** Nombre de canaux MIDI qui ont une voix (9 mélodiques, ou 11 avec le mode rythme). */
const MAX_CHANNELS = 11;

/** Opérateur de chaque canal d'opérateurs 0..17 (décalage de registre). */
const OPERATOR_OFFSET = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21];
/** Les canaux d'opérateurs 3..5, 9..11 et 15..17 sont des porteuses (pas de rétroaction `C0`). */
const IS_CARRIER = [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1];
/** Voix OPL d'un canal d'opérateurs, sans et avec le mode rythme (`_adlibChannelsMappingTable2`, `3`). */
const VOICE_OF_OPERATOR = [0, 1, 2, 0, 1, 2, 3, 4, 5, 3, 4, 5, 6, 7, 8, 6, 7, 8];
const VOICE_OF_OPERATOR_RHYTHM = [0, 1, 2, 0, 1, 2, 3, 4, 5, 3, 4, 5, 6, 10, 8, 6, 7, 9];
/** Canaux d'opérateurs (modulateur, porteuse) d'un canal MIDI ; 255 = pas de porteuse (percussion à un opérateur). */
const OPERATORS_OF_CHANNEL = [0, 3, 1, 4, 2, 5, 6, 9, 7, 10, 8, 11, 12, 15, 13, 16, 14, 17];
const OPERATORS_OF_CHANNEL_RHYTHM = [0, 3, 1, 4, 2, 5, 6, 9, 7, 10, 8, 11, 12, 15, 16, 255, 14, 255, 17, 255, 13, 255];

/** Instruments neutres écrits à l'ouverture (`_adlibInitSequenceData1` à `8`). */
const INIT_INSTRUMENT = [1, 1, 3, 15, 5, 0, 1, 3, 15, 0, 0, 0, 1, 0];
const INIT_INSTRUMENT_CARRIER = [0, 1, 1, 15, 7, 0, 2, 4, 0, 0, 0, 1, 0, 0];
const INIT_RHYTHM = [
  { operator: 12, data: [0, 0, 0, 10, 4, 0, 8, 12, 11, 0, 0, 0, 1, 0] },
  { operator: 15, data: [0, 0, 0, 13, 4, 0, 6, 15, 0, 0, 0, 0, 1, 0] },
  { operator: 16, data: [0, 12, 0, 15, 11, 0, 8, 5, 0, 0, 0, 0, 0, 0] },
  { operator: 14, data: [0, 4, 0, 15, 11, 0, 7, 5, 0, 0, 0, 0, 0, 0] },
  { operator: 17, data: [0, 1, 0, 15, 11, 0, 5, 5, 0, 0, 0, 0, 0, 0] },
  { operator: 13, data: [0, 1, 0, 15, 11, 0, 7, 5, 0, 0, 0, 0, 0, 0] },
];

/** Mise à l'échelle du pitch bend par canal (`_midiChannelsNoteTable`) : 256 = neutre. */
const PITCH_SCALE = 256;

/** Fréquences (registres `A0` et bits 0-1 de `B0`) des 192 pas d'un octave (`_midiNoteFreqTable`) : un négatif demande l'octave suivant. */
const NOTE_FREQUENCY = [
  690, 692, 695, 697, 700, 702, 705, 707, 710, 713, 715, 718, 720, 723, 726, 728, 731, 733, 736, 739, 741, 744, 747, 749, 752, 755, 758, 760, 763, 766, 769, 771,
  774, 777, 780, 783, 785, 788, 791, 794, 797, 800, 803, 806, 809, 811, 814, 817, 820, 823, 826, 829, 832, 835, 838, 841, 844, 847, 850, 854, 857, 860, 863, 866,
  869, 872, 875, 879, 882, 885, 888, 891, 895, 898, 901, 904, 908, 911, 914, 917, 921, 924, 927, 931, 934, 937, 941, 944, 948, 951, 955, 958, 961, 965, 968, 972,
  975, 979, 983, 986, 990, 993, 997, 1000, 1004, 1008, 1011, 1015, 1019, 1022, -511, -509, -507, -505, -504, -502, -500, -498, -496, -494, -492, -490, -488, -486,
  -484, -482, -480, -479, -477, -475, -473, -471, -469, -467, -465, -463, -460, -458, -456, -454, -452, -450, -448, -446, -444, -442, -440, -438, -436, -433, -431,
  -429, -427, -425, -423, -420, -418, -416, -414, -412, -409, -407, -405, -403, -401, -398, -396, -394, -391, -389, -387, -385, -382, -380, -378, -375, -373, -371,
  -368, -366, -363, -361, -359, -356, -354, -351, -349, -347, -344, -342, -339, -337,
];

/** Octets d'un instrument : modulateur 13, porteuse 13, forme d'onde du modulateur, forme d'onde de la porteuse. */
export const ADLIB_INSTRUMENT_SIZE = 28;

/** Préfixe d'un `FF 7F` de Queen (`READ_BE_UINT32 == 0x3F00`), puis le type et ses données. */
const META_PREFIX = [0x00, 0x00, 0x3f, 0x00];

const OPERATOR_STRIDE = 14;

export class QueenAdLibDriver {
  /** Instruments des 18 canaux d'opérateurs : 13 paramètres puis la forme d'onde (`_adlibSetupChannelSequence1`). */
  private readonly setup = new Uint8Array(18 * OPERATOR_STRIDE);
  private readonly levelScaling = new Uint8Array(MAX_CHANNELS).fill(127);
  private readonly volumeTable = new Uint8Array(MAX_CHANNELS).fill(128);
  /** Dernier volume reçu de chaque canal MIDI (suivi seulement, comme ScummVM). */
  private readonly channelVolume = new Uint16Array(16);
  private readonly note1 = new Int32Array(9);
  private readonly note2 = new Int32Array(9).fill(8192);
  private readonly octave = new Int32Array(9);
  private readonly frequency = new Int32Array(9);
  private rhythm = false;
  private channelCount = 9;
  private vibratoRhythm = 0;
  private amDepth = 0;
  private vibratoDepth = 0;
  private keyboardSplit = 0;
  private noteMultiplier = 1;
  private waveformSelect = 0;

  constructor(private readonly sink: OplSink) {}

  /** `AdLibMidiDriver::open` : remet la carte à zéro puis silence les 11 canaux. */
  open(): void {
    this.setupCard();
    for (let i = 0; i < MAX_CHANNELS; i++) {
      this.channelVolume[i] = 0;
      this.setNoteVolume(i, 0);
      this.turnNoteOff(i);
    }
  }

  /** Message MIDI court : statut, puis deux octets de données (le second est 0 pour un message à un octet). */
  send(status: number, data1: number, data2: number): void {
    const channel = status & 15;
    const cmd = (status >> 4) & 7;
    if (status >= 0xf0 || channel >= MAX_CHANNELS) return;
    switch (cmd) {
      case 0:
        this.turnNoteOff(channel);
        break;
      case 1:
        this.noteOn(channel, data1, data2);
        break;
      case 5:
        this.setNoteVolume(channel, data1);
        this.channelVolume[channel] = data1;
        break;
      case 6:
        this.setPitchBend(channel, data1 | (data2 << 7));
        break;
      default:
        break;
    }
  }

  /** Volume général 0 à 255 (`AdLibMidiDriver::setVolume`) : la table de volumes des canaux vaut `volume / 4 + 64`. */
  setVolume(volume: number): void {
    for (let i = 0; i < this.channelCount; i++) this.volumeTable[i] = Math.trunc((volume * 64) / 256) + 64;
  }

  /**
   * Méta-événement `FF 7F` (octets après la longueur) : `00 00 3F 00`, type, valeur(s). Type 1 (34 octets) : instrument des
   * canaux d'opérateurs d'un canal MIDI ; type 2 (6) : mode rythme ; type 3 (6) : multiplicateur de pitch bend.
   * Un événement d'une autre forme est ignoré (ScummVM l'annonce par un avertissement).
   */
  metaEvent(data: Uint8Array): void {
    if (data.length <= 4 || META_PREFIX.some((byte, i) => data[i] !== byte)) return;
    switch (data[4]) {
      case 1:
        if (data.length === 34) this.instrumentEvent(data[5], data.subarray(6, 34));
        break;
      case 2:
        if (data.length === 6) {
          this.rhythm = data[5] !== 0;
          this.channelCount = this.rhythm ? 11 : 9;
          this.setAmplitudeVibratoRhythm();
        }
        break;
      case 3:
        if (data.length === 6) this.setNoteMultiplier(data[5]);
        break;
      default:
        break;
    }
  }

  /** Coupe la note de tous les canaux (fin ou arrêt d'un morceau). */
  allNotesOff(): void {
    for (let i = 0; i < MAX_CHANNELS; i++) this.turnNoteOff(i);
  }

  // --- événements de séquence (handleSequencerSpecificMetaEvent1) --------------------------------------------------------

  private instrumentEvent(channel: number, instrument: Uint8Array): void {
    if (this.channelCount <= channel) return;
    const table = this.rhythm ? OPERATORS_OF_CHANNEL_RHYTHM : OPERATORS_OF_CHANNEL;
    this.setupOperator(table[channel * 2], instrument.subarray(0, 13), instrument[26]);
    if (table[channel * 2 + 1] !== 255) this.setupOperator(table[channel * 2 + 1], instrument.subarray(13, 26), instrument[27]);
  }

  private noteOn(channel: number, note: number, velocity: number): void {
    if (velocity === 0) {
      this.turnNoteOff(channel);
      this.channelVolume[channel] = 0;
      return;
    }
    this.setNoteVolume(channel, velocity);
    this.channelVolume[channel] = velocity;
    this.turnNoteOff(channel);
    this.turnNoteOn(channel, note);
  }

  // --- carte son --------------------------------------------------------------------------------------------------------

  private write(reg: number, value: number): void {
    this.sink.write(reg, value & 0xff);
  }

  /** `adlibSetupCard`. */
  private setupCard(): void {
    for (let i = 1; i <= 0xf5; i++) this.write(i, 0);
    this.write(4, 6);
    for (let i = 0; i < 9; i++) {
      this.note2[i] = 8192;
      this.octave[i] = 0;
      this.note1[i] = 0;
      this.frequency[i] = 0;
    }
    this.levelScaling.fill(127);
    this.volumeTable.fill(128);
    this.setupChannels(false);
    this.resetAmplitudeVibratoRhythm(0, 0, 0);
    this.setNoteMultiplier(1);
    this.setWaveformSelect(true);
  }

  private setupChannels(rhythm: boolean): void {
    this.rhythm = rhythm;
    this.channelCount = rhythm ? 11 : 9;
    this.vibratoRhythm = 0;
    this.amDepth = 0;
    this.vibratoDepth = 0;
    this.keyboardSplit = 0;
    this.resetChannels();
    this.setAmplitudeVibratoRhythm();
  }

  private resetAmplitudeVibratoRhythm(am: number, vibrato: number, split: number): void {
    this.amDepth = am;
    this.vibratoDepth = vibrato;
    this.keyboardSplit = split;
    this.setAmplitudeVibratoRhythm();
    this.setKeyboardSplit();
  }

  private resetChannels(): void {
    for (let i = 0; i < 18; i++) this.setupOperator(i, IS_CARRIER[i] ? INIT_INSTRUMENT_CARRIER : INIT_INSTRUMENT, 0);
    if (this.rhythm) for (const { operator, data } of INIT_RHYTHM) this.setupOperator(operator, data, 0);
  }

  /** Registre `BD` : profondeurs AM et vibrato, mode rythme, touches des percussions. */
  private setAmplitudeVibratoRhythm(): void {
    let value = 0;
    if (this.amDepth) value |= 0x80;
    if (this.vibratoDepth) value |= 0x40;
    if (this.rhythm) value |= 0x20;
    this.write(0xbd, value | this.vibratoRhythm);
  }

  private setKeyboardSplit(): void {
    this.write(8, this.keyboardSplit ? 0x40 : 0);
  }

  private setNoteMultiplier(multiplier: number): void {
    this.noteMultiplier = Math.min(12, Math.max(1, multiplier));
  }

  private setWaveformSelect(enabled: boolean): void {
    this.waveformSelect = enabled ? 0x20 : 0;
    for (let i = 0; i < 18; i++) this.write(0xe0 + OPERATOR_OFFSET[i], 0);
    this.write(1, this.waveformSelect);
  }

  // --- hauteur et touche ------------------------------------------------------------------------------------------------

  private hasMelodicVoice(channel: number): boolean {
    return (this.rhythm && channel <= 6) || channel < 9;
  }

  private setPitchBend(channel: number, range: number): void {
    if (!this.hasMelodicVoice(channel)) return;
    this.note2[channel] = Math.min(16383, range);
    this.playNote(channel);
  }

  private playNote(channel: number): void {
    this.frequency[channel] = this.writeFrequency(channel, this.note1[channel], this.note2[channel], this.octave[channel]);
  }

  /** `adlibPlayNoteHelper` : écrit `A0`/`B0` et rend la valeur de `B0`. */
  private writeFrequency(channel: number, note: number, bend: number, octave: number): number {
    let n = ((bend * PITCH_SCALE) >> 8) - 8192;
    if (n !== 0) {
      n >>= 5;
      n *= this.noteMultiplier;
    }
    n += (note << 8) + 8;
    n >>= 4;
    n = Math.min(1535, Math.max(0, n));
    const index = (((n >> 4) % 12) << 4) | (n & 0xf);
    let f = NOTE_FREQUENCY[index];
    let o = Math.trunc((n >> 4) / 12) - 1;
    if (f < 0) o++;
    if (o < 0) {
      o++;
      f >>= 1;
    }
    this.write(0xa0 + channel, f & 0xff);
    const value = ((f >> 8) & 3) | (o << 2) | octave;
    this.write(0xb0 + channel, value);
    return value & 0xff;
  }

  private turnNoteOff(channel: number): void {
    if (this.hasMelodicVoice(channel)) {
      this.octave[channel] = 0;
      this.frequency[channel] &= ~0x20;
      this.write(0xb0 + channel, this.frequency[channel]);
    } else if (this.rhythm && channel <= 10) {
      this.vibratoRhythm &= ~(1 << (4 - (channel - 6)));
      this.setAmplitudeVibratoRhythm();
    }
  }

  private turnNoteOn(channel: number, midiNote: number): void {
    const note = Math.max(0, midiNote - 12);
    if (this.hasMelodicVoice(channel)) {
      this.note1[channel] = note;
      this.octave[channel] = 0x20;
      this.playNote(channel);
    } else if (this.rhythm && channel <= 10) {
      if (channel === 6) {
        this.note1[6] = note;
        this.playNote(channel);
      } else if (channel === 8 && this.note1[8] === note) {
        this.note1[8] = note;
        this.note1[7] = note + 7;
        this.playNote(8);
        this.playNote(7);
      }
      this.vibratoRhythm = 1 << (4 - (channel - 6));
      this.setAmplitudeVibratoRhythm();
    }
  }

  // --- instruments et volumes -------------------------------------------------------------------------------------------

  private setupOperator(operator: number, source: ArrayLike<number>, waveform: number): void {
    for (let i = 0; i < 13; i++) this.setup[OPERATOR_STRIDE * operator + i] = source[i];
    this.setup[OPERATOR_STRIDE * operator + 13] = waveform & 3;
    this.setAmplitudeVibratoRhythm();
    this.setKeyboardSplit();
    this.setLevel(operator);
    this.setFeedback(operator);
    this.setAttackDecay(operator);
    this.setSustainRelease(operator);
    this.setCharacteristics(operator);
    this.setWaveform(operator);
  }

  /** `adlibSetNoteVolume` : réécrit le niveau (registre `40`) des opérateurs du canal. */
  private setNoteVolume(channel: number, volume: number): void {
    if (this.channelCount <= channel) return;
    this.levelScaling[channel] = Math.min(127, volume);
    const table = this.rhythm ? OPERATORS_OF_CHANNEL_RHYTHM : OPERATORS_OF_CHANNEL;
    this.setLevel(table[channel * 2]);
    if (table[channel * 2 + 1] !== 255) this.setLevel(table[channel * 2 + 1]);
  }

  /** Registre `40 + opérateur` : niveau total mis à l'échelle de la vélocité et du volume du canal, échelle de clavier. */
  private setLevel(operator: number): void {
    const voice = (this.rhythm ? VOICE_OF_OPERATOR_RHYTHM : VOICE_OF_OPERATOR)[operator];
    const base = operator * OPERATOR_STRIDE;
    let value = 63 - (this.setup[base + 8] & 63);
    const percussion = this.rhythm && voice > 6;
    if (IS_CARRIER[operator] || this.setup[base + 12] === 0 || percussion) {
      value = (this.levelScaling[voice] * value + 64) >> 7;
    }
    value = (this.volumeTable[voice] * value * 2) >> 8;
    value = 63 - Math.min(63, value);
    value |= this.setup[base] << 6;
    this.write(0x40 + OPERATOR_OFFSET[operator], value);
  }

  /** Registre `C0 + voix` : rétroaction et connexion (modulateurs seulement). */
  private setFeedback(operator: number): void {
    if (IS_CARRIER[operator]) return;
    const base = operator * OPERATOR_STRIDE;
    let value = this.setup[base + 2] << 1;
    if (this.setup[base + 12] === 0) value |= 1;
    this.write(0xc0 + VOICE_OF_OPERATOR[operator], value);
  }

  private setAttackDecay(operator: number): void {
    const base = operator * OPERATOR_STRIDE;
    this.write(0x60 + OPERATOR_OFFSET[operator], (this.setup[base + 3] << 4) | (this.setup[base + 6] & 15));
  }

  private setSustainRelease(operator: number): void {
    const base = operator * OPERATOR_STRIDE;
    this.write(0x80 + OPERATOR_OFFSET[operator], (this.setup[base + 4] << 4) | (this.setup[base + 7] & 15));
  }

  /** Registre `20 + opérateur` : multiplicateur, échelle d'enveloppe, son tenu, vibrato, tremolo. */
  private setCharacteristics(operator: number): void {
    const base = operator * OPERATOR_STRIDE;
    let value = this.setup[base + 1] & 15;
    if (this.setup[base + 9]) value |= 0x80;
    if (this.setup[base + 10]) value |= 0x40;
    if (this.setup[base + 5]) value |= 0x20;
    if (this.setup[base + 11]) value |= 0x10;
    this.write(0x20 + OPERATOR_OFFSET[operator], value);
  }

  private setWaveform(operator: number): void {
    const value = this.waveformSelect ? this.setup[operator * OPERATOR_STRIDE + 13] & 3 : 0;
    this.write(0xe0 + OPERATOR_OFFSET[operator], value);
  }
}
