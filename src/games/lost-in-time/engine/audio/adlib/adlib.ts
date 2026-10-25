/*
 * Pilote AdLib des jeux Coktel : gestion des voix OPL2 et séquenceur à 1000 ticks par seconde.
 *
 * Port de engines/gob/sound/adlib.cpp de ScummVM (https://www.scummvm.org, GPL-3.0-or-later,
 * aussi LGPL-2.1+) et de la mécanique de EmulatedChip::readBuffer (audio/softsynth/opl, chip.cpp)
 * qui déclenche la fonction de rappel du séquenceur tous les `rate / 1000` échantillons.
 *
 * Écarts : pas de mutex (tout tourne dans un seul fil), voix hors bornes ignorées (comportement
 * indéfini en C++), volume de musique fixé à la valeur par défaut de ScummVM (192/256).
 */
import { Opl2 } from "../../../../../audio/opl2";

// Paramètres d'opérateur
export const PARAM_KEY_SCALE_LEVEL = 0;
export const PARAM_FREQ_MULTI = 1;
export const PARAM_FEEDBACK = 2;
export const PARAM_ATTACK = 3;
export const PARAM_SUSTAIN = 4;
export const PARAM_SUSTAINING = 5;
export const PARAM_DECAY = 6;
export const PARAM_RELEASE = 7;
export const PARAM_LEVEL = 8;
export const PARAM_AM = 9;
export const PARAM_VIB = 10;
export const PARAM_KEY_SCALE_RATE = 11;
export const PARAM_FM = 12;
export const PARAM_WAVE_SELECT = 13;

export const OPERATOR_COUNT = 18;
export const PARAM_COUNT = 14;
const PITCH_STEP_COUNT = 25;
const OCTAVE_COUNT = 8;
const HALF_TONE_COUNT = 12;
export const OPERATORS_PER_VOICE = 2;
export const MELODY_VOICE_COUNT = 9;
export const MAX_VOICE_COUNT = 11;
const NOTE_COUNT = HALF_TONE_COUNT * OCTAVE_COUNT;
export const MAX_VOLUME = 0x7f;
const MAX_PITCH = 0x3fff;
const MID_PITCH = 0x2000;
const STANDARD_MID_C = 60;
const OPL_MID_C = 48;

const VOICE_BASE_DRUM = 6;
const VOICE_SNARE_DRUM = 7;
const VOICE_TOM = 8;
const PITCH_TOM = 24;
const PITCH_TOM_TO_SNARE = 7;
const PITCH_SNARE_DRUM = PITCH_TOM + PITCH_TOM_TO_SNARE;

/** Volume « music_volume » par défaut de ScummVM (sur 256). */
const DEFAULT_MUSIC_VOLUME = 192;

/** Atténuation des porteuses selon le volume du mixeur (kVolumeTable). */
const VOLUME_TABLE = [
  63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 62, 61, 59, 57, 56, 55, 53, 52, 51, 50, 49, 48, 47, 46, 46, 45, 44, 43, 43,
  42, 41, 41, 40, 39, 39, 38, 38, 37, 37, 36, 36, 35, 35, 34, 34, 33, 33, 33, 32, 32, 31, 31, 31, 30, 30, 30, 29, 29,
  29, 28, 28, 28, 27, 27, 27, 26, 26, 26, 26, 25, 25, 25, 24, 24, 24, 24, 23, 23, 23, 23, 22, 22, 22, 22, 21, 21, 21,
  21, 21, 20, 20, 20, 20, 19, 19, 19, 19, 19, 18, 18, 18, 18, 18, 18, 17, 17, 17, 17, 17, 16, 16, 16, 16, 16, 16, 15,
  15, 15, 15, 15, 15, 14, 14, 14, 14, 14, 14, 13, 13, 13, 13, 13, 13, 13, 12, 12, 12, 12, 12, 12, 12, 11, 11, 11, 11,
  11, 11, 11, 11, 10, 10, 10, 10, 10, 10, 10, 10, 9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3,
  3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  0, 0,
];

/** Un opérateur est-il modulateur (0) ou porteuse (1) ? */
const OPERATOR_TYPE = [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1];
/** Numéro d'opérateur -> décalage de registre OPL. */
const OPERATOR_OFFSET = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21];
/** Voix à laquelle appartient chaque opérateur (pour le registre 0xC0). */
const OPERATOR_VOICE = [0, 1, 2, 0, 1, 2, 3, 4, 5, 3, 4, 5, 6, 7, 8, 6, 7, 8];
const VOICE_MELODY_OPERATOR = [
  [0, 1, 2, 6, 7, 8, 12, 13, 14],
  [3, 4, 5, 9, 10, 11, 15, 16, 17],
];
const VOICE_PERCUSSION_OPERATOR = [
  [12, 16, 14, 17, 13],
  [15, 0, 0, 0, 0],
];
const PERCUSSION_MASKS = [0x10, 0x08, 0x04, 0x02, 0x01];

// Instruments par défaut
const PIANO_PARAMS = [
  [1, 1, 3, 15, 5, 0, 1, 3, 15, 0, 0, 0, 1, 0],
  [0, 1, 1, 15, 7, 0, 2, 4, 0, 0, 0, 1, 0, 0],
];
const BASE_DRUM_PARAMS = [
  [0, 0, 0, 10, 4, 0, 8, 12, 11, 0, 0, 0, 1, 0],
  [0, 0, 0, 13, 4, 0, 6, 15, 0, 0, 0, 0, 1, 0],
];
const SNARE_DRUM_PARAMS = [0, 12, 0, 15, 11, 0, 8, 5, 0, 0, 0, 0, 0, 0];
const TOM_PARAMS = [0, 4, 0, 15, 11, 0, 7, 5, 0, 0, 0, 0, 0, 0];
const CYMBAL_PARAMS = [0, 1, 0, 15, 11, 0, 5, 5, 0, 0, 0, 0, 0, 0];
const HIHAT_PARAMS = [0, 1, 0, 15, 11, 0, 7, 5, 0, 0, 0, 0, 0, 0];

/** Fréquences OPL (fnum) de chaque demi-ton, par pas de pitch bend. */
function buildFreqs(): Uint16Array {
  const freqs = new Uint16Array(PITCH_STEP_COUNT * HALF_TONE_COUNT);
  const numStep = Math.trunc(100 / PITCH_STEP_COUNT);
  for (let i = 0; i < PITCH_STEP_COUNT; i++) {
    const num = i * numStep;
    const denom = 100;
    let val = Math.trunc(((denom * 100 + 6 * num) * 52088) / (denom * 2500));
    val = Math.trunc((val * 147456) / 111875);
    freqs[i * HALF_TONE_COUNT] = (4 + val) >> 3;
    for (let j = 1; j < HALF_TONE_COUNT; j++) {
      val = Math.trunc((val * 106) / 100);
      freqs[i * HALF_TONE_COUNT + j] = (4 + val) >> 3;
    }
  }
  return freqs;
}
const FREQS = buildFreqs();

/** Base d'un lecteur de musique AdLib : sous-classes = format (ADL, MDY...). */
export abstract class AdLib {
  private readonly opl: Opl2;
  private readonly sampleRate: number;
  /** Échantillons entre deux ticks, en virgule fixe 16.16 (EmulatedChip::_samplesPerTick). */
  private readonly samplesPerTick: number;
  private nextTick = 0;
  private readonly scratch = new Int16Array(4096);

  private volume = DEFAULT_MUSIC_VOLUME;
  private toPoll = 0;
  private repCount = 0;
  private first = true;
  private _playing = false;
  private ended = true;

  private tremoloDepth = false;
  private vibratoDepth = false;
  private keySplit = false;
  private enableWaveSelectFlag = true;
  private percussionMode = false;
  private percussionBits = 0;
  private pitchRangeStep = 0;

  private readonly voiceNote = new Uint8Array(MAX_VOICE_COUNT);
  private readonly voiceOn = new Uint8Array(MAX_VOICE_COUNT);
  private readonly operatorVolume = new Uint8Array(OPERATOR_COUNT);
  private readonly operatorParams: Uint8Array[] = Array.from({ length: OPERATOR_COUNT }, () => new Uint8Array(PARAM_COUNT));
  /** Ligne de `FREQS` (pas de pitch bend) et décalage en demi-tons de chaque voix. */
  private readonly freqRow = new Int32Array(MAX_VOICE_COUNT);
  private readonly halfToneOffset = new Int32Array(MAX_VOICE_COUNT);

  /** Appelé quand la lecture s'arrête d'elle-même (fin du morceau, sans répétition restante). */
  onFinished: (() => void) | null = null;

  constructor(sampleRate: number, callbackFrequency: number) {
    this.sampleRate = sampleRate;
    this.opl = new Opl2(sampleRate);
    this.resetFreqs();
    this.initOPL();
    const d = Math.trunc(sampleRate / callbackFrequency);
    const r = sampleRate % callbackFrequency;
    this.samplesPerTick = (d << 16) + Math.trunc((r << 16) / callbackFrequency);
  }

  /** Cadence d'échantillonnage de la sortie. */
  get rate(): number {
    return this.sampleRate;
  }

  /** Reste-t-il quelque chose à jouer ? (le `_playing` de ScummVM) */
  isPlaying(): boolean {
    return this._playing;
  }

  getRepeating(): number {
    return this.repCount;
  }

  /** Nombre de passages supplémentaires après le premier ; négatif = boucle infinie. */
  setRepeating(repCount: number): void {
    this.repCount = repCount;
  }

  startPlay(): void {
    this._playing = true;
    this.ended = false;
    this.first = true;
    this.reset();
    this.rewind();
  }

  stopPlay(): void {
    this.end(true);
    this._playing = false;
  }

  /**
   * Génère `length` échantillons mono (flottants -1..1) dans `out` : EmulatedChip::readBuffer,
   * le séquenceur est appelé à chaque tick, entre deux paquets d'échantillons.
   */
  render(out: Float32Array, offset: number, length: number): void {
    let len = length;
    let pos = offset;
    do {
      let step = len;
      if (step > this.nextTick >> 16) step = this.nextTick >> 16;
      this.generate(out, pos, step);
      this.nextTick -= step << 16;
      if (!(this.nextTick >> 16)) {
        this.onTimer();
        this.nextTick += this.samplesPerTick;
      }
      pos += step;
      len -= step;
    } while (len);
  }

  private generate(out: Float32Array, offset: number, length: number): void {
    const buf = this.scratch;
    for (let done = 0; done < length; ) {
      const n = Math.min(buf.length, length - done);
      this.opl.generate(buf, 0, n);
      for (let i = 0; i < n; i++) out[offset + done + i] = buf[i] / 32768;
      done += n;
    }
  }

  // --- Séquenceur ---------------------------------------------------------------------------

  /** Lit les commandes du morceau, retourne le nombre de ticks avant la suivante. */
  protected abstract pollMusic(first: boolean): number;
  /** Remet le morceau au début. */
  protected abstract rewind(): void;

  private onTimer(): void {
    if (!this._playing) return;
    if (this.toPoll > 0) {
      this.toPoll--;
      return;
    }
    while (this.toPoll === 0 && this._playing) {
      if (this.ended) {
        this.toPoll = 0;
        break;
      }
      this.toPoll = this.pollMusic(this.first);
      this.first = false;
    }
    if (this.ended) {
      this.toPoll = 0;
      // repCount == 0 : plus de répétition ; < 0 : boucle infinie
      if (this.repCount !== 0) {
        if (this.repCount > 0) this.repCount--;
        this.first = true;
        this.ended = false;
        this.reset();
        this.rewind();
      } else {
        this._playing = false;
        this.onFinished?.();
      }
    }
  }

  protected end(killRepeat = false): void {
    this.reset();
    this.ended = true;
    if (killRepeat) this.repCount = 0;
  }

  private writeOPL(reg: number, val: number): void {
    this.opl.writeReg(reg, val & 0xff);
  }

  private reset(): void {
    this.allOff();
    this.initOPL();
  }

  private allOff(): void {
    const numVoices = this.percussionMode ? MAX_VOICE_COUNT : MELODY_VOICE_COUNT;
    for (let i = 0; i < numVoices; i++) this.noteOff(i);
  }

  private initOPL(): void {
    this.tremoloDepth = false;
    this.vibratoDepth = false;
    this.keySplit = false;
    this.enableWaveSelectFlag = true;
    this.voiceNote.fill(0);
    this.voiceOn.fill(0);
    this.operatorVolume.fill(MAX_VOLUME);
    this.resetFreqs();

    this.setPercussionMode(false);
    this.setTremoloDepth(false);
    this.setVibratoDepth(false);
    this.setKeySplit(false);
    for (let i = 0; i < MELODY_VOICE_COUNT; i++) this.voiceOff(i);
    this.setPitchRange(1);
    this.enableWaveSelect(true);
  }

  protected isPercussionMode(): boolean {
    return this.percussionMode;
  }

  protected setPercussionMode(percussion: boolean): void {
    if (percussion) {
      this.voiceOff(VOICE_BASE_DRUM);
      this.voiceOff(VOICE_SNARE_DRUM);
      this.voiceOff(VOICE_TOM);
      // fréquence des deux dernières percussions à hauteur fixe
      this.setFreq(VOICE_TOM, PITCH_TOM, false);
      this.setFreq(VOICE_SNARE_DRUM, PITCH_SNARE_DRUM, false);
    }
    this.percussionMode = percussion;
    this.percussionBits = 0;
    this.initOperatorParams();
    this.writeTremoloVibratoDepthPercMode();
  }

  private enableWaveSelect(enable: boolean): void {
    this.enableWaveSelectFlag = enable;
    for (let i = 0; i < OPERATOR_COUNT; i++) this.writeOPL(0xe0 + OPERATOR_OFFSET[i], 0);
    // NB : ScummVM écrit ici le registre 0x11 et non 0x01 ; la puce ignore l'écriture, donc la
    // sélection de forme d'onde reste inactive et tous les opérateurs jouent un sinus. Conservé tel quel.
    this.writeOPL(0x11, this.enableWaveSelectFlag ? 0x20 : 0);
  }

  protected setPitchRange(range: number): void {
    this.pitchRangeStep = Math.min(Math.max(range, 0), 12) * PITCH_STEP_COUNT;
  }

  private setTremoloDepth(depth: boolean): void {
    this.tremoloDepth = depth;
    this.writeTremoloVibratoDepthPercMode();
  }

  private setVibratoDepth(depth: boolean): void {
    this.vibratoDepth = depth;
    this.writeTremoloVibratoDepthPercMode();
  }

  private setKeySplit(keySplit: boolean): void {
    this.keySplit = keySplit;
    this.writeOPL(0x08, this.keySplit ? 0x40 : 0);
  }

  /**
   * Règle le timbre d'une voix. Disposition des 28 paramètres : 13 du premier opérateur, 13 du
   * second, puis la forme d'onde de chacun.
   */
  protected setVoiceTimbre(voice: number, params: Uint16Array): void {
    const p0 = params.subarray(0, PARAM_COUNT - 1);
    const p1 = params.subarray(PARAM_COUNT - 1, 2 * (PARAM_COUNT - 1));
    const waves = params.subarray(2 * (PARAM_COUNT - 1));
    const voicePerc = voice - VOICE_BASE_DRUM;

    if (!this.percussionMode || voice < VOICE_BASE_DRUM) {
      if (voice < MELODY_VOICE_COUNT) {
        this.setOperatorParams(VOICE_MELODY_OPERATOR[0][voice], p0, waves[0]);
        this.setOperatorParams(VOICE_MELODY_OPERATOR[1][voice], p1, waves[1]);
      }
    } else if (voice === VOICE_BASE_DRUM) {
      this.setOperatorParams(VOICE_PERCUSSION_OPERATOR[0][voicePerc], p0, waves[0]);
      this.setOperatorParams(VOICE_PERCUSSION_OPERATOR[1][voicePerc], p1, waves[1]);
    } else if (voicePerc < 5) {
      this.setOperatorParams(VOICE_PERCUSSION_OPERATOR[0][voicePerc], p0, waves[0]);
    }
  }

  protected setVoiceVolume(voice: number, volume: number): void {
    if (voice >= MAX_VOICE_COUNT) return;
    const voicePerc = voice - VOICE_BASE_DRUM;
    let oper: number;
    if (!this.percussionMode || voice < VOICE_BASE_DRUM) {
      if (voice >= MELODY_VOICE_COUNT) return;
      oper = VOICE_MELODY_OPERATOR[1][voice];
    } else {
      oper = VOICE_PERCUSSION_OPERATOR[voice === VOICE_BASE_DRUM ? 1 : 0][voicePerc];
    }
    this.operatorVolume[oper] = Math.min(volume, MAX_VOLUME);
    this.writeKeyScaleLevelVolume(oper);
  }

  /** `pitchBend` de 0 (tout en bas) à MAX_PITCH (tout en haut). */
  protected bendVoicePitch(voice: number, pitchBend: number): void {
    if (voice >= MAX_VOICE_COUNT) return;
    if (this.percussionMode && voice > VOICE_BASE_DRUM) return;
    this.changePitch(voice, Math.min(pitchBend, MAX_PITCH));
    this.setFreq(voice, this.voiceNote[voice], !!this.voiceOn[voice]);
  }

  protected noteOn(voice: number, note: number): void {
    if (voice >= MAX_VOICE_COUNT) return;
    note = Math.max(0, note - (STANDARD_MID_C - OPL_MID_C));
    if (this.percussionMode && voice >= VOICE_BASE_DRUM) {
      if (voice === VOICE_BASE_DRUM) {
        this.setFreq(VOICE_BASE_DRUM, note, false);
      } else if (voice === VOICE_TOM) {
        this.setFreq(VOICE_TOM, note, false);
        this.setFreq(VOICE_SNARE_DRUM, note + PITCH_TOM_TO_SNARE, false);
      }
      this.percussionBits |= PERCUSSION_MASKS[voice - VOICE_BASE_DRUM];
      this.writeTremoloVibratoDepthPercMode();
    } else {
      this.setFreq(voice, note, true);
    }
  }

  protected noteOff(voice: number): void {
    if (voice >= MAX_VOICE_COUNT) return;
    if (this.percussionMode && voice >= VOICE_BASE_DRUM) {
      this.percussionBits &= ~PERCUSSION_MASKS[voice - VOICE_BASE_DRUM];
      this.writeTremoloVibratoDepthPercMode();
    } else {
      this.setFreq(voice, this.voiceNote[voice], false);
    }
  }

  // --- Écriture des paramètres --------------------------------------------------------------

  private writeKeyScaleLevelVolume(oper: number): void {
    const params = this.operatorParams[oper];
    let volume = (63 - (params[PARAM_LEVEL] & 0x3f)) * this.operatorVolume[oper];
    volume = 63 - Math.trunc((2 * volume + MAX_VOLUME) / (2 * MAX_VOLUME));
    // atténuation des porteuses selon le volume général
    if (OPERATOR_TYPE[oper] === 1) {
      volume += VOLUME_TABLE[this.volume];
      if (volume > 63) volume = 63;
    }
    const keyScale = (params[PARAM_KEY_SCALE_LEVEL] << 6) & 0xff;
    this.writeOPL(0x40 + OPERATOR_OFFSET[oper], volume | keyScale);
  }

  private writeFeedbackFM(oper: number): void {
    if (OPERATOR_TYPE[oper] === 1) return;
    const params = this.operatorParams[oper];
    let value = 0;
    value |= params[PARAM_FEEDBACK] << 1;
    value |= params[PARAM_FM] ? 0 : 1;
    this.writeOPL(0xc0 + OPERATOR_VOICE[oper], value);
  }

  private writeAttackDecay(oper: number): void {
    const params = this.operatorParams[oper];
    this.writeOPL(0x60 + OPERATOR_OFFSET[oper], (params[PARAM_ATTACK] << 4) | (params[PARAM_DECAY] & 0x0f));
  }

  private writeSustainRelease(oper: number): void {
    const params = this.operatorParams[oper];
    this.writeOPL(0x80 + OPERATOR_OFFSET[oper], (params[PARAM_SUSTAIN] << 4) | (params[PARAM_RELEASE] & 0x0f));
  }

  private writeTremoloVibratoSustainingKeyScaleRateFreqMulti(oper: number): void {
    const params = this.operatorParams[oper];
    let value = 0;
    value |= params[PARAM_AM] ? 0x80 : 0;
    value |= params[PARAM_VIB] ? 0x40 : 0;
    value |= params[PARAM_SUSTAINING] ? 0x20 : 0;
    value |= params[PARAM_KEY_SCALE_RATE] ? 0x10 : 0;
    value |= params[PARAM_FREQ_MULTI] & 0x0f;
    this.writeOPL(0x20 + OPERATOR_OFFSET[oper], value);
  }

  private writeTremoloVibratoDepthPercMode(): void {
    let value = 0;
    value |= this.tremoloDepth ? 0x80 : 0;
    value |= this.vibratoDepth ? 0x40 : 0;
    value |= this.percussionMode ? 0x20 : 0;
    value |= this.percussionBits;
    this.writeOPL(0xbd, value);
  }

  private writeWaveSelect(oper: number): void {
    const wave = this.enableWaveSelectFlag ? this.operatorParams[oper][PARAM_WAVE_SELECT] & 0x03 : 0;
    this.writeOPL(0xe0 + OPERATOR_OFFSET[oper], wave);
  }

  private writeAllParams(oper: number): void {
    this.writeTremoloVibratoDepthPercMode();
    this.writeOPL(0x08, this.keySplit ? 0x40 : 0);
    this.writeKeyScaleLevelVolume(oper);
    this.writeFeedbackFM(oper);
    this.writeAttackDecay(oper);
    this.writeSustainRelease(oper);
    this.writeTremoloVibratoSustainingKeyScaleRateFreqMulti(oper);
    this.writeWaveSelect(oper);
  }

  private initOperatorParams(): void {
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      const piano = PIANO_PARAMS[OPERATOR_TYPE[i]];
      this.setOperatorParams(i, piano, piano[PARAM_COUNT - 1]);
    }
    if (this.percussionMode) {
      this.setOperatorParams(12, BASE_DRUM_PARAMS[0], BASE_DRUM_PARAMS[0][PARAM_COUNT - 1]);
      this.setOperatorParams(15, BASE_DRUM_PARAMS[1], BASE_DRUM_PARAMS[1][PARAM_COUNT - 1]);
      this.setOperatorParams(16, SNARE_DRUM_PARAMS, SNARE_DRUM_PARAMS[PARAM_COUNT - 1]);
      this.setOperatorParams(14, TOM_PARAMS, TOM_PARAMS[PARAM_COUNT - 1]);
      this.setOperatorParams(17, CYMBAL_PARAMS, CYMBAL_PARAMS[PARAM_COUNT - 1]);
      this.setOperatorParams(13, HIHAT_PARAMS, HIHAT_PARAMS[PARAM_COUNT - 1]);
    }
  }

  private setOperatorParams(oper: number, params: ArrayLike<number>, wave: number): void {
    const operParams = this.operatorParams[oper];
    for (let i = 0; i < PARAM_COUNT - 1; i++) operParams[i] = params[i];
    operParams[PARAM_COUNT - 1] = wave & 0x03;
    this.writeAllParams(oper);
  }

  private voiceOff(voice: number): void {
    this.writeOPL(0xa0 + voice, 0);
    this.writeOPL(0xb0 + voice, 0);
  }

  // --- Hauteur ------------------------------------------------------------------------------

  private resetFreqs(): void {
    this.freqRow.fill(0);
    this.halfToneOffset.fill(0);
  }

  private changePitch(voice: number, pitchBend: number): void {
    let full: number;
    let frac: number;
    let amount = Math.trunc(((pitchBend - MID_PITCH) * this.pitchRangeStep) / MID_PITCH);
    if (amount >= 0) {
      // vers le haut
      full = Math.trunc(amount / PITCH_STEP_COUNT);
      frac = amount % PITCH_STEP_COUNT;
    } else {
      // vers le bas
      amount = PITCH_STEP_COUNT - 1 - amount;
      full = -Math.trunc(amount / PITCH_STEP_COUNT);
      frac = (amount - PITCH_STEP_COUNT + 1) % PITCH_STEP_COUNT;
      if (frac) frac = PITCH_STEP_COUNT - frac;
    }
    this.halfToneOffset[voice] = full;
    this.freqRow[voice] = frac;
  }

  private setFreq(voice: number, note: number, on: boolean): void {
    this.voiceOn[voice] = on ? 1 : 0;
    this.voiceNote[voice] = note;
    note = Math.min(Math.max(note + this.halfToneOffset[voice], 0), NOTE_COUNT - 1);
    const freq = FREQS[this.freqRow[voice] * HALF_TONE_COUNT + (note % HALF_TONE_COUNT)];
    let value = 0;
    value |= on ? 0x20 : 0;
    value |= (Math.trunc(note / HALF_TONE_COUNT) << 2) | ((freq >> 8) & 0x03);
    this.writeOPL(0xa0 + voice, freq);
    this.writeOPL(0xb0 + voice, value);
  }
}
