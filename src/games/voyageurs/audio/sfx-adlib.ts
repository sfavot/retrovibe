/**
 * Effets sonores des *Voyageurs du temps* : pilote AdLib des `.SPL` (D4), qui écrit dans une puce OPL2 (`OplSink`).
 *
 * Référence : ScummVM engines/cine/sound.cpp, `AdLibSoundDriver` (`initCard`, `setupInstrument`, `stopAll`, tables de fréquences et
 * d'opérateurs) et `AdLibSoundDriverINS` (`stopChannel`, `playSample`) (GPL v3 ou ultérieure), et `PCSoundDriver::resetChannel`.
 * Le décodage de l'instrument (`loadInstrument`, `loadRegisterInstrument`) est dans `data/spl.ts`.
 *
 * Sous-ensemble repris (effets seulement, pas de musique : celle-ci va au CD, `cd-music.ts`) : init de la carte, jouer un instrument
 * à la note fixe 12 (volume 127, le volume du script est ignoré comme dans ScummVM), arrêter un canal. Un instrument en mode
 * percussion (`mode != 0`) utilise les voix de rythme via le registre 0xBD.
 *
 * Écarts : le pilote n'a pas de minuterie de 109 Hz (son seul rôle dans ScummVM est la musique AdLib, absente ici) ; un canal hors de
 * 0..7 est ignoré au lieu de lever une assertion ; un fichier trop court pour contenir un instrument est ignoré. Les écritures
 * partent vers `sink` tout de suite, c'est à lui de les dater (`beginTick` appelé par `audio.ts`).
 */
import type { OplSink } from "../../../audio/opl-stream";
import { readSpl, type OplInstrument, type OplOperator } from "../data/spl";

/** `MAX_ADLIB_CHANNELS`. */
export const SFX_CHANNELS = 8;

/** `_freqTable` : numéros F d'une octave. */
const FREQ_TABLE = [0x157, 0x16c, 0x181, 0x198, 0x1b1, 0x1cb, 0x1e6, 0x203, 0x222, 0x243, 0x266, 0x28a];
/** `_operatorsTable` : décalage de registre des 18 opérateurs. */
const OPERATORS = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21];
/** `_voiceOperatorsTable` : modulateur et porteuse de chaque voix. */
const VOICE_OPERATORS = [0, 3, 1, 4, 2, 5, 6, 9, 7, 10, 8, 11, 12, 15, 16, 16, 14, 14, 17, 17, 13, 13];

/** Note fixe des effets (`playSample`). */
const SAMPLE_NOTE = 12;
/** Volume de canal fixé par `playSample`. */
const SAMPLE_VOLUME = 127;

/** Instrument vide : `memset(_instrumentsTable, 0)`. */
const EMPTY_OPERATOR: OplOperator = { vibrato: 0, attackDecay: 0, sustainRelease: 0, feedbackStrength: 0, keyScaling: 0, outputLevel: 0, freqMod: 0 };
const EMPTY_INSTRUMENT: OplInstrument = {
  mode: 0,
  channel: 0,
  modulator: EMPTY_OPERATOR,
  carrier: EMPTY_OPERATOR,
  waveSelectModulator: 0,
  waveSelectCarrier: 0,
  amDepth: 0,
};

export class AdlibSfx {
  /** `_vibrato` (registre 0xBD). */
  private vibrato = 0;
  private readonly volumes = new Array<number>(SFX_CHANNELS).fill(0);
  private readonly instruments = new Array<OplInstrument>(SFX_CHANNELS).fill(EMPTY_INSTRUMENT);

  constructor(private readonly sink: OplSink) {
    this.initCard();
  }

  /** `playSample(data, size, channel, volume)` : `data` = fichier `.SPL` entier, instrument à l'octet 257. */
  playSample(channel: number, data: Uint8Array): void {
    if (!validChannel(channel)) return;
    let instrument: OplInstrument;
    try {
      instrument = readSpl(data).instrument;
    } catch {
      return;
    }
    this.volumes[channel] = SAMPLE_VOLUME;
    this.resetChannel(channel);
    this.setupInstrument(instrument, channel);
    const ins = instrument;
    let voice = channel;
    if (ins.mode !== 0 && ins.channel === 6) voice = 6;
    if (ins.mode === 0 || voice === 6) {
      let freq = FREQ_TABLE[SAMPLE_NOTE % 12]!;
      this.write(0xa0 | voice, freq);
      freq = ((SAMPLE_NOTE / 12) << 2) | ((freq & 0x300) >> 8);
      if (ins.mode === 0) freq |= 0x20;
      this.write(0xb0 | voice, freq);
    }
    if (ins.mode !== 0) {
      this.vibrato |= 1 << (10 - ins.channel);
      this.write(0xbd, this.vibrato);
    }
  }

  /** `PCSound::stopSound` : `resetChannel` (arrêt du canal, puis `stopAll`). */
  stopSample(channel: number): void {
    if (validChannel(channel)) this.resetChannel(channel);
  }

  /** `stopChannel` (version INS) : coupe la voix du canal. */
  private stopChannel(channel: number): void {
    const ins = this.instruments[channel]!;
    let voice = channel;
    if (ins.mode !== 0 && ins.channel === 6) voice = 6;
    if (ins.mode === 0 || voice === 6) this.write(0xb0 | voice, 0);
    if (ins.mode !== 0) {
      this.vibrato &= ~(1 << (10 - ins.channel));
      this.write(0xbd, this.vibrato);
    }
  }

  private resetChannel(channel: number): void {
    this.stopChannel(channel);
    this.stopAll();
  }

  /** `stopAll` (hors Opération Stealth) : tous les niveaux au minimum, toutes les voix coupées, rythme éteint. */
  private stopAll(): void {
    for (let i = 0; i < 18; i++) this.write(0x40 | OPERATORS[i]!, 63);
    for (let i = 0; i < 9; i++) this.write(0xb0 | i, 0);
    this.write(0xbd, 0);
  }

  private initCard(): void {
    this.vibrato = 0x20;
    this.write(0xbd, this.vibrato);
    this.write(0x08, 0x40);
    for (let i = 0; i < 9; i++) this.write(0xb0 | i, 0);
    for (let i = 0; i < 9; i++) this.write(0xc0 | i, 0);
    for (const base of [0x40, 0x60, 0x80, 0x20, 0xe0]) {
      for (let i = 0; i < 18; i++) this.write(base | OPERATORS[i]!, 0);
    }
    this.write(1, 0x20);
    this.write(1, 0);
  }

  /** `setupInstrument` (avec `loadData`). */
  private setupInstrument(ins: OplInstrument, channel: number): void {
    this.instruments[channel] = ins;
    const voice = ins.mode !== 0 ? ins.channel : channel;
    const modIndex = VOICE_OPERATORS[2 * voice];
    const carIndex = VOICE_OPERATORS[2 * voice + 1];
    if (modIndex === undefined || carIndex === undefined) return;
    const mod = OPERATORS[modIndex]!;
    const car = OPERATORS[carIndex]!;
    const volume = this.volumes[channel]!;

    if (ins.mode === 0 || ins.channel === 6) {
      const reg = ins.modulator;
      this.write(0x20 | mod, reg.vibrato);
      let level: number;
      if (reg.freqMod) {
        level = reg.outputLevel & 0x3f;
      } else {
        level = (63 - (reg.outputLevel & 0x3f)) * volume;
        level = 63 - Math.trunc((2 * level + 127) / (2 * 127));
      }
      this.write(0x40 | mod, level | (reg.keyScaling << 6));
      this.write(0x60 | mod, reg.attackDecay);
      this.write(0x80 | mod, reg.sustainRelease);
      this.write(0xc0 | voice, reg.feedbackStrength);
      this.write(0xe0 | mod, ins.waveSelectModulator);
    }

    const reg = ins.carrier;
    this.write(0x20 | car, reg.vibrato);
    let level = (63 - (reg.outputLevel & 0x3f)) * volume;
    level = 63 - Math.trunc((2 * level + 127) / (2 * 127));
    this.write(0x40 | car, level | (reg.keyScaling << 6));
    this.write(0x60 | car, reg.attackDecay);
    this.write(0x80 | car, reg.sustainRelease);
    this.write(0xe0 | car, ins.waveSelectCarrier);
  }

  private write(reg: number, value: number): void {
    this.sink.write(reg & 0xff, value & 0xff);
  }
}

function validChannel(channel: number): boolean {
  return Number.isInteger(channel) && channel >= 0 && channel < SFX_CHANNELS;
}
