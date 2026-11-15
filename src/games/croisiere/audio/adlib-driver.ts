/**
 * Pilote AdLib des timbres `.ADL` de Croisière pour un cadavre : programmation des voix OPL2, notes, volumes et bruitages.
 *
 * Référence : `engines/cruise/sound.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `PCSoundDriver::findNote`, `AdLibSoundDriver`
 * (`initCard`, `setupInstrument`, `adjustVolume`, `stopChannel`, `stopAll`, `syncSounds`) et `AdLibSoundDriverADL`
 * (`loadInstrument`, `loadRegisterInstrument`, `setChannelFrequency`, `playSample`) ; lu puis réécrit. Les tables viennent de `data/static-tables.ts`.
 *
 * Écarts volontaires : les écritures vont à un `OplSink` (valeurs réduites à un octet, comme les émulateurs OPL de ScummVM), et non à
 * un `OPL::OPL` ; pas de minuterie (le lecteur de modules est cadencé par l'appelant) ; les volumes de musique et de bruitage (0..255,
 * `music_volume` et `sfx_volume` de ScummVM, 192 par défaut) sont des paramètres ; un timbre de moins de 58 octets est refusé
 * par `parseAdlInstrument`, les octets en trop sont ignorés (ScummVM lit sans contrôle).
 */
import type { OplSink } from "../../../audio/opl-stream";
import { parseAdlInstrument, type AdlOperator } from "../data/music";
import { NOTE_TABLE, OPL_FREQ_TABLE, OPL_OPERATORS_TABLE, OPL_VOICE_OPERATORS_TABLE } from "../data/static-tables";

/** Voix dédiée aux bruitages (`playSound` : canal 4). */
export const SFX_CHANNEL = 4;
/** Volume par défaut de ScummVM (`kDefaultSFXVolume`, `kDefaultMusicVolume`). */
export const DEFAULT_VOLUME = 192;
/** Note jouée par un bruitage sans note fixe (`playSample`). */
const SAMPLE_NOTE = 48;
const CHANNEL_COUNT = 5;

/** Registres d'un opérateur, tous des `uint8` dans ScummVM. */
interface RegisterInstrument {
  vibrato: number;
  attackDecay: number;
  sustainRelease: number;
  feedbackStrength: number;
  keyScaling: number;
  outputLevel: number;
  freqMod: number;
}

interface SoundInstrument {
  mode: number;
  channel: number;
  regMod: RegisterInstrument;
  regCar: RegisterInstrument;
  waveSelectMod: number;
  waveSelectCar: number;
  amDepth: number;
}

interface ChannelVolume {
  original: number;
  adjusted: number;
}

function emptyRegisters(): RegisterInstrument {
  return { vibrato: 0, attackDecay: 0, sustainRelease: 0, feedbackStrength: 0, keyScaling: 0, outputLevel: 0, freqMod: 0 };
}

function emptyInstrument(): SoundInstrument {
  return { mode: 0, channel: 0, regMod: emptyRegisters(), regCar: emptyRegisters(), waveSelectMod: 0, waveSelectCar: 0, amDepth: 0 };
}

/** `loadRegisterInstrument` : les mots de 16 bits de l'opérateur deviennent des registres d'un octet. */
function registersOf(op: AdlOperator): RegisterInstrument {
  let vibrato = 0;
  if (op.am) vibrato |= 0x80;
  if (op.vibrato) vibrato |= 0x40;
  if (op.sustainingSound) vibrato |= 0x20;
  if (op.envelopeScaling) vibrato |= 0x10;
  vibrato |= op.freqMultiplier & 0xf;
  let feedbackStrength = (op.feedback << 1) & 0xff;
  if (op.connection === 0) feedbackStrength |= 1;
  return {
    vibrato,
    attackDecay: ((op.attack << 4) | (op.decay & 0xf)) & 0xff,
    sustainRelease: ((op.sustainLevel << 4) | (op.release & 0xf)) & 0xff,
    feedbackStrength,
    keyScaling: op.keyScaling & 0xff,
    outputLevel: op.outputLevel & 0xff,
    freqMod: op.connection & 0xff,
  };
}

function loadInstrument(data: Uint8Array): SoundInstrument {
  const adl = parseAdlInstrument(data);
  return {
    mode: adl.mode,
    channel: adl.channel,
    regMod: registersOf(adl.modulator),
    regCar: registersOf(adl.carrier),
    waveSelectMod: adl.waveSelectMod,
    waveSelectCar: adl.waveSelectCar,
    amDepth: adl.amDepth,
  };
}

/** `PCSoundDriver::findNote` : première note de la table dont la période n'excède pas `freq` (la dernière à défaut). */
export function findNote(freq: number): { note: number; octave: number } {
  let note = NOTE_TABLE.length - 1;
  for (let i = 0; i < NOTE_TABLE.length; i++) {
    if (NOTE_TABLE[i]! <= freq) {
      note = i;
      break;
    }
  }
  return { note: note % 12, octave: Math.trunc(note / 12) };
}

export class AdlibDriver {
  private vibrato = 0;
  private readonly channelVolumes: ChannelVolume[] = Array.from({ length: CHANNEL_COUNT }, () => ({ original: 0, adjusted: 0 }));
  private readonly instruments: SoundInstrument[] = Array.from({ length: CHANNEL_COUNT }, emptyInstrument);

  /** Écrit la séquence `initCard` : le pilote d'origine la lance à sa construction. */
  constructor(
    private readonly sink: OplSink,
    private musicVolume = DEFAULT_VOLUME,
    private sfxVolume = DEFAULT_VOLUME,
  ) {
    this.initCard();
  }

  private write(reg: number, value: number): void {
    this.sink.write(reg, value & 0xff);
  }

  private initCard(): void {
    this.vibrato = 0x20;
    this.write(0xbd, this.vibrato);
    this.write(0x08, 0x40);
    for (let i = 0; i < 9; i++) this.write(0xb0 | i, 0);
    for (let i = 0; i < 9; i++) this.write(0xc0 | i, 0);
    for (const base of [0x40, 0x60, 0x80, 0x20, 0xe0]) {
      for (let i = 0; i < 18; i++) this.write(base | OPL_OPERATORS_TABLE[i]!, 0);
    }
    this.write(1, 0x20);
    this.write(1, 0);
  }

  /** `syncSounds` : nouveaux volumes (0..255), puis rechargement de tous les timbres des cinq voix. */
  setVolumes(musicVolume: number, sfxVolume: number): void {
    this.musicVolume = Math.min(255, Math.max(0, musicVolume));
    this.sfxVolume = Math.min(255, Math.max(0, sfxVolume));
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      this.adjustVolume(i, this.channelVolumes[i]!.original);
      this.setupInstrumentRegisters(this.instruments[i]!, i);
    }
  }

  /** `adjustVolume` : plafonne à 80, ajoute un quart (100 au plus), puis applique le volume de ScummVM (sur 128). */
  private adjustVolume(channel: number, volume: number): void {
    this.channelVolumes[channel]!.original = volume;
    volume = Math.min(80, Math.max(0, volume));
    volume += Math.trunc(volume / 4);
    const scale = channel === SFX_CHANNEL ? this.sfxVolume : this.musicVolume;
    volume = Math.trunc((volume * scale) / 128);
    this.channelVolumes[channel]!.adjusted = Math.min(127, volume);
  }

  /** `setupChannel` : sans timbre (fichier absent), la voix reste telle quelle. */
  setupChannel(channel: number, data: Uint8Array | null, volume: number): void {
    this.checkChannel(channel);
    if (!data) return;
    this.adjustVolume(channel, volume);
    this.setupInstrument(data, channel);
  }

  private checkChannel(channel: number): void {
    if (!Number.isInteger(channel) || channel < 0 || channel >= CHANNEL_COUNT) throw new RangeError(`AdlibDriver : voix ${channel}`);
  }

  private setupInstrument(data: Uint8Array, channel: number): void {
    const ins = loadInstrument(data);
    this.instruments[channel] = ins;
    this.setupInstrumentRegisters(ins, channel);
  }

  private operators(ins: SoundInstrument, channel: number): { mod: number; car: number } {
    const voice = ins.mode !== 0 ? ins.channel : channel;
    const mod = OPL_VOICE_OPERATORS_TABLE[2 * voice];
    const car = OPL_VOICE_OPERATORS_TABLE[2 * voice + 1];
    if (mod === undefined || car === undefined) throw new RangeError(`AdlibDriver : voix de timbre ${voice}`);
    return { mod: OPL_OPERATORS_TABLE[mod]!, car: OPL_OPERATORS_TABLE[car]! };
  }

  private setupInstrumentRegisters(ins: SoundInstrument, channel: number): void {
    const { mod, car } = this.operators(ins, channel);
    const adjusted = this.channelVolumes[channel]!.adjusted;
    if (ins.mode === 0 || ins.channel === 6) {
      const reg = ins.regMod;
      this.write(0x20 | mod, reg.vibrato);
      let tmp: number;
      if (reg.freqMod) {
        tmp = reg.outputLevel & 0x3f;
      } else {
        tmp = (63 - (reg.outputLevel & 0x3f)) * adjusted;
        tmp = 63 - Math.trunc((2 * tmp + 127) / (2 * 127));
      }
      this.write(0x40 | mod, tmp | (reg.keyScaling << 6));
      this.write(0x60 | mod, reg.attackDecay);
      this.write(0x80 | mod, reg.sustainRelease);
      this.write(0xc0 | (ins.mode !== 0 ? ins.channel : channel), reg.feedbackStrength);
      this.write(0xe0 | mod, ins.waveSelectMod);
    }
    const reg = ins.regCar;
    this.write(0x20 | car, reg.vibrato);
    let tmp = (63 - (reg.outputLevel & 0x3f)) * adjusted;
    tmp = 63 - Math.trunc((2 * tmp + 127) / (2 * 127));
    this.write(0x40 | car, tmp | (reg.keyScaling << 6));
    this.write(0x60 | car, reg.attackDecay);
    this.write(0x80 | car, reg.sustainRelease);
    this.write(0xe0 | car, ins.waveSelectCar);
  }

  /** Voix OPL d'une voix de percussion : 9 devient 8 et 10 devient 7. */
  private static percussionVoice(channel: number): number {
    return channel === 9 ? 8 : channel === 10 ? 7 : channel;
  }

  /** `setChannelFrequency` : période (table des notes) vers F-number, octave et déclenchement. */
  setChannelFrequency(channel: number, frequency: number): void {
    this.checkChannel(channel);
    const ins = this.instruments[channel]!;
    if (ins.mode !== 0) channel = AdlibDriver.percussionVoice(ins.channel);
    const found = findNote(frequency);
    let note = found.note + found.octave * 12;
    if (ins.amDepth) note = ins.amDepth;
    this.keyOn(ins, channel, note);
  }

  private keyOn(ins: SoundInstrument, channel: number, note: number): void {
    let freq = OPL_FREQ_TABLE[note % 12]!;
    this.write(0xa0 | channel, freq);
    freq = (Math.trunc(note / 12) << 2) | ((freq & 0x300) >> 8);
    if (ins.mode === 0) freq |= 0x20;
    this.write(0xb0 | channel, freq);
    if (ins.mode !== 0) {
      this.vibrato |= 1 << (10 - channel);
      this.write(0xbd, this.vibrato);
    }
  }

  /** `stopChannel` : coupe la voix mélodique, ou le bit de percussion du timbre. */
  stopChannel(channel: number): void {
    this.checkChannel(channel);
    const ins = this.instruments[channel]!;
    if (ins.mode !== 0 && ins.channel === 6) channel = 6;
    if (ins.mode === 0 || channel === 6) this.write(0xb0 | channel, 0);
    if (ins.mode !== 0) {
      this.vibrato &= ~(1 << (10 - ins.channel));
      this.write(0xbd, this.vibrato);
    }
  }

  /** `stopAll` : volumes à zéro sur les 18 opérateurs, notes coupées, percussions coupées. */
  stopAll(): void {
    for (let i = 0; i < 18; i++) this.write(0x40 | OPL_OPERATORS_TABLE[i]!, 63);
    for (let i = 0; i < 9; i++) this.write(0xb0 | i, 0);
    this.write(0xbd, 0);
  }

  /** `resetChannel` (`PCSound::stopSound`). */
  resetChannel(channel: number): void {
    this.stopChannel(channel);
    this.stopAll();
  }

  /** `playSample` : le timbre `.ADL` joué tel quel sur la voix donnée, à la note 48 sauf note fixe (`amDepth`). */
  playSample(data: Uint8Array, channel: number): void {
    this.checkChannel(channel);
    this.adjustVolume(channel, 127);
    this.setupInstrument(data, channel);
    const ins = this.instruments[channel]!;
    if (ins.mode !== 0 && ins.channel === 6) this.write(0xb0 | channel, 0);
    if (ins.mode !== 0) {
      this.vibrato &= ~(1 << (10 - ins.channel));
      this.write(0xbd, this.vibrato);
      channel = AdlibDriver.percussionVoice(ins.channel);
    }
    this.keyOn(ins, channel, ins.amDepth ? ins.amDepth : SAMPLE_NOTE);
  }
}
