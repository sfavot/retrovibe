/**
 * Canal du pilote musical AdLib de BASS : flux d'octets (delta en varint 7 bits, puis événement), opcodes 0x00-0x9C.
 *
 * Référence : ScummVM engines/sky/music/adlibchannel.cpp et adlibchannel.h (`AdLibChannel`), GPL v3 ou ultérieure ; lu puis réécrit.
 * Positions de la v0.0372 uniquement (celles de `music-file.ts`).
 *
 * Écarts volontaires : les écritures vont à un `OplSink` (pas à un OPL de ScummVM) ; le miroir de registres est une copie du fichier,
 * jamais le fichier lui-même (ScummVM l'écrit en place) ; les accès hors fichier (instrument inexistant, pas de données d'instrument avec
 * `tremoVibro`) lèvent une erreur au lieu de lire au hasard ; les `assert` de ScummVM sont des `RangeError`.
 * Conservé à l'identique : le bogue de `getNextNote` (l'assembleur d'origine), la lecture de la table des fréquences hors de ses bornes
 * pour un indice négatif, les entiers 16 bits (`int16`, `uint16`) des calculs.
 */

import type { OplSink } from "../../../audio/opl-stream";
import { MUSIC_FREQUENCY_TABLE_POS, type AdlibInstrument, type MusicFile } from "../data/music-file";

/** Volume initial d'un canal avant `updateVolume` (`_musicVolume = 128`). */
const INITIAL_MUSIC_VOLUME = 128;
const NOTE_ON = 0x20;
/** Taille d'un `u16` ; les pointeurs de flux de ScummVM sont des `uint16`. */
const U16 = 0xffff;

/** Opcodes `0x90 | n` (`process`). */
const OP_NOTE_OFF = 0x0;
const OP_STOP_CHANNEL = 0x1;
const OP_SETUP_INSTRUMENT = 0x2;
const OP_UPDATE_TEMPO = 0x3;
const OP_FREQ_OFFSET = 0x5;
const OP_CHANNEL_VOLUME = 0x6;
const OP_TREMO_VIBRO = 0x7;
const OP_LOOP = 0x8;
const OP_KEY_OFF = 0x9;
const OP_SET_LOOP_POINT = 0xc;

export class AdlibChannel {
  private musicVolume = INITIAL_MUSIC_VOLUME;

  // `AdLibChannelType`
  private eventDataPtr: number;
  private nextEventTime: number;
  private loopPoint: number;
  private adlibChannelNumber = 0;
  private lastCommand = 0;
  private active = true;
  private note = 0;
  private adlibReg1 = 0;
  private adlibReg2 = 0;
  private instrumentData: AdlibInstrument | null = null;
  private assignedInstrument = 0xff;
  private channelVolume = 0x7f;
  private tremoVibro = 0;
  private freqOffset = 0;

  private readonly data: Uint8Array;
  private readonly view: DataView;
  private readonly registerTable: Uint8Array;
  private readonly outputTable: Uint8Array;
  private readonly instrumentMap: Uint8Array;
  private readonly instrumentCache: Array<AdlibInstrument | undefined> = [];

  /**
   * @param mirror miroir de registres (256 octets) partagé par tous les canaux d'une section : une copie, pas une vue du fichier.
   * @param startOfData position absolue du flux du canal dans le fichier.
   */
  constructor(
    private readonly sink: OplSink,
    private readonly file: MusicFile,
    private readonly mirror: Uint8Array,
    startOfData: number,
  ) {
    this.data = file.data;
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    this.registerTable = file.registerTable;
    this.outputTable = file.outputLevelTable;
    this.instrumentMap = file.instrumentMap;
    this.loopPoint = startOfData & U16;
    this.eventDataPtr = startOfData & U16;
    this.nextEventTime = this.getNextEventTime();
  }

  isActive(): boolean {
    return this.active;
  }

  updateVolume(volume: number): void {
    this.musicVolume = volume & U16;
  }

  /** Ce que fait le destructeur C++ : coupe la note en cours. */
  dispose(): void {
    this.stopNote();
  }

  /** `process` : avance de `aktTime` ticks de morceau ; rend le nouveau tempo demandé par le flux (0x93), ou 0. */
  process(aktTime: number): number {
    if (!this.active) return 0;
    let returnVal = 0;
    this.nextEventTime -= aktTime & U16;
    while (this.nextEventTime < 0 && this.active) {
      let opcode = this.byte();
      if (opcode & 0x80) {
        if (opcode === 0xff) {
          // opcode vide
        } else if (opcode >= 0x90) {
          switch (opcode & 0xf) {
            case OP_NOTE_OFF:
              if (this.data[this.eventDataPtr] === this.lastCommand) this.stopNote();
              this.eventDataPtr = (this.eventDataPtr + 1) & U16;
              break;
            case OP_STOP_CHANNEL:
              this.stopNote();
              this.active = false;
              break;
            case OP_SETUP_INSTRUMENT:
              this.channelVolume = 0x7f;
              this.freqOffset = 0x40;
              this.assignedInstrument = this.byte();
              this.instrumentData = this.instrument(this.assignedInstrument);
              this.adlibSetupInstrument();
              break;
            case OP_UPDATE_TEMPO:
              returnVal = this.byte();
              break;
            case OP_FREQ_OFFSET:
              this.setFreqOffset(this.byte());
              break;
            case OP_CHANNEL_VOLUME:
              this.channelVolume = this.byte();
              break;
            case OP_TREMO_VIBRO:
              this.tremoVibro = this.byte();
              break;
            case OP_LOOP:
              this.eventDataPtr = this.loopPoint;
              break;
            case OP_KEY_OFF:
              this.stopNote();
              break;
            case OP_SET_LOOP_POINT:
              this.loopPoint = this.eventDataPtr;
              break;
            default:
              throw new Error(`AdlibChannel : opcode de musique 0x${opcode.toString(16)} inconnu`);
          }
        } else {
          // nouvelle voix OPL
          this.adlibChannelNumber = opcode & 0xf;
          this.adlibReg1 = this.registerTable[((opcode & 0xf) << 1) | 0]!;
          this.adlibReg2 = this.registerTable[((opcode & 0xf) << 1) | 1]!;
        }
      } else {
        this.lastCommand = opcode;
        this.stopNote();
        // ScummVM : « pas sûr de la raison de ce test, un bogue de mon code ou des données (section 1, morceau 2) »
        if (this.instrumentData || this.tremoVibro) {
          this.setupInstrument(opcode);
          opcode = this.byte();
          this.setupChannelVolume(opcode);
        } else {
          this.eventDataPtr = (this.eventDataPtr + 1) & U16;
        }
      }
      if (this.active) this.nextEventTime += this.getNextEventTime();
    }
    return returnVal;
  }

  private byte(): number {
    const b = this.data[this.eventDataPtr];
    if (b === undefined) throw new Error(`AdlibChannel : flux hors du fichier (${this.eventDataPtr})`);
    this.eventDataPtr = (this.eventDataPtr + 1) & U16;
    return b;
  }

  /** `setRegister` : une écriture qui ne change pas le miroir est supprimée. */
  private setRegister(reg: number, value: number): void {
    reg &= 0xff;
    value &= 0xff;
    if (this.mirror[reg] !== value) {
      this.sink.write(reg, value);
      this.mirror[reg] = value;
    }
  }

  private stopNote(): void {
    if (this.note & NOTE_ON) {
      this.note &= ~NOTE_ON;
      this.setRegister(0xb0 | this.adlibChannelNumber, this.note);
    }
  }

  /** Delta en varint 7 bits, 4 octets au plus ; -1 si le 4e octet a encore le bit de suite (« ne devrait jamais arriver »). */
  private getNextEventTime(): number {
    let value = 0;
    let last = 0;
    for (let i = 0; i < 4; i++) {
      last = this.byte();
      value = (value << 7) | (last & 0x7f);
      if (!(last & 0x80)) break;
    }
    return last & 0x80 ? -1 : value;
  }

  private instrument(n: number): AdlibInstrument {
    return (this.instrumentCache[n] ??= this.file.instrument(n));
  }

  private requireInstrument(): AdlibInstrument {
    if (!this.instrumentData) throw new Error("AdlibChannel : note sans instrument (ScummVM lirait un pointeur nul)");
    return this.instrumentData;
  }

  private setupInstrument(opcode: number): void {
    let nextNote: number;
    if (this.tremoVibro) {
      const newInstrument = this.instrumentMap[opcode]!;
      if (newInstrument !== this.assignedInstrument) {
        this.assignedInstrument = newInstrument;
        this.instrumentData = this.instrument(newInstrument);
        this.adlibSetupInstrument();
      }
      this.lastCommand = this.requireInstrument().bindedEffect;
      nextNote = this.getNextNote(this.lastCommand);
    } else {
      nextNote = this.getNextNote(opcode - 0x18 + this.requireInstrument().bindedEffect);
    }
    this.setRegister(0xa0 | this.adlibChannelNumber, nextNote & 0xff);
    this.setRegister(0xb0 | this.adlibChannelNumber, ((nextNote >> 8) | NOTE_ON) & 0xff);
    this.note = ((nextNote >> 8) | NOTE_ON) & 0xff;
  }

  /** Niveaux de sortie des deux opérateurs ; le volume de la musique entre ici, dans le calcul. */
  private setupChannelVolume(volume: number): void {
    const ins = this.requireInstrument();
    let resVol = this.scaledVolume(volume, ins.totOutLevOp2);
    this.checkLevel(resVol);
    this.setRegister(0x40 | this.adlibReg2, ((ins.scalingLevel << 6) & 0xc0) | this.outputTable[resVol]!);
    if (ins.feedBack & 1) {
      resVol = this.scaledVolume(volume, ins.totOutLevOp1);
    } else {
      resVol = ins.totOutLevOp1;
    }
    this.checkLevel(resVol);
    this.setRegister(0x40 | this.adlibReg1, ((ins.scalingLevel << 2) & 0xc0) | this.outputTable[resVol]!);
  }

  /** `((v + 1) * (tot + 1)) << 1`, tronqué à 16 bits, fois le volume du canal, puis du morceau, en `uint32`. */
  private scaledVolume(volume: number, totalLevel: number): number {
    let resVol = ((volume + 1) * (totalLevel + 1)) << 1;
    resVol &= 0xffff;
    resVol *= (this.channelVolume + 1) << 1;
    resVol >>>= 8;
    resVol *= this.musicVolume << 1;
    resVol >>>= 16;
    return resVol;
  }

  private checkLevel(level: number): void {
    if (level >= 0x81) throw new RangeError(`AdlibChannel : niveau de sortie ${level} hors de 0 à 0x80`);
  }

  private adlibSetupInstrument(): void {
    const ins = this.requireInstrument();
    this.setRegister(0x60 | this.adlibReg1, ins.adOp1);
    this.setRegister(0x60 | this.adlibReg2, ins.adOp2);
    this.setRegister(0x80 | this.adlibReg1, ins.srOp1);
    this.setRegister(0x80 | this.adlibReg2, ins.srOp2);
    this.setRegister(0xe0 | this.adlibReg1, ins.waveSelectOp1);
    this.setRegister(0xe0 | this.adlibReg2, ins.waveSelectOp2);
    this.setRegister(0xc0 | this.adlibChannelNumber, ins.feedBack);
    this.setRegister(0x20 | this.adlibReg1, ins.ampModOp1);
    this.setRegister(0x20 | this.adlibReg2, ins.ampModOp2);
  }

  /**
   * `getNextNote` : fréquence (registres A0 et B0) d'une note. Arithmétique en `int16` comme le C++ ; un indice négatif lit la table des
   * fréquences avant son début (dans le fichier). La branche « sans octave » est le bogue de l'assembleur d'origine : conservé.
   */
  private getNextNote(param: number): number {
    param &= 0xff;
    let freqIndex = this.freqOffset - 0x40;
    if (freqIndex >= 0x3f) freqIndex++;
    freqIndex = toInt16(freqIndex * 2);
    freqIndex = toInt16(freqIndex + (param << 6));
    const index = freqIndex % 0x300; // reste « à la C » : du signe du dividende
    const at = MUSIC_FREQUENCY_TABLE_POS + 2 * index;
    if (at < 0 || at + 2 > this.data.length) throw new RangeError(`AdlibChannel : table des fréquences, indice ${index} hors du fichier`);
    const freqData = this.view.getUint16(at, true);
    const octave = Math.trunc(freqIndex / 0x300);
    if (index >= 0x1c0 || octave > 0) {
      return ((((octave - 1) << 10) + (freqData & 0x7ff)) & 0xffff) >>> 0;
    }
    // ressemble à un bogue ; c'est ce que dit le code assembleur
    return (toInt16(freqData) >> 1) & 0xffff;
  }

  /** Opcode 0x95 : décalage de fréquence ; la note en cours est recalculée. */
  private setFreqOffset(offset: number): void {
    this.freqOffset = offset;
    if (this.note & NOTE_ON) {
      const nextNote = this.getNextNote(this.lastCommand - 0x18 + this.requireInstrument().bindedEffect);
      this.setRegister(0xa0 | this.adlibChannelNumber, nextNote & 0xff);
      this.setRegister(0xb0 | this.adlibChannelNumber, ((nextNote >> 8) | NOTE_ON) & 0xff);
      this.note = (((nextNote >> 8) & 0xff) | NOTE_ON) & 0xff;
    }
  }
}

function toInt16(value: number): number {
  return (value << 16) >> 16;
}
