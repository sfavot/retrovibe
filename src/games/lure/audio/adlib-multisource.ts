/**
 * Pilote MIDI AdLib (OPL2) à plusieurs sources : plusieurs flux MIDI indépendants (une musique, des bruitages) se partagent les 9 voix
 * d'une puce OPL2 ; le pilote suit l'état MIDI de chaque source (programme, volume, inflexion de hauteur…) et le traduit en
 * écritures de registres.
 *
 * Source : `MidiDriver_ADLIB_Multisource` (`audio/adlib_ms.cpp`, `adlib_ms.h`) et `MidiDriver_Multisource` (`audio/mididrv_ms.cpp`),
 * ScummVM, GPL v3 ou ultérieure, **lus en entier** puis réécrits. Ce module ne connaît aucun jeu (règle des deux usages : il reste dans le
 * dossier de *Lure of the Temptress*, qui est le seul à s'en servir, et sera promu vers `src/audio/` au deuxième usage, évolution M4 de
 * `docs/lure/plan.md`) ; les particularités d'un jeu se placent en sous-classe (`lure-adlib.ts`) en redéfinissant `determineInstrument`,
 * `calculateFrequency`, `calculatePitchBend`, `calculateUnscaledVolume`, `channelAftertouch` ou `metaEvent`.
 *
 * Sous-ensemble repris : OPL2 seul (9 voix mélodiques), allocation **dynamique** (chaque note prend une voix : libre, sinon la plus
 * anciennement relâchée, sinon la plus ancienne de même instrument, sinon la plus ancienne ; ce vol de voix interrompt la note) ou
 * **statique** (une voix fixe par couple source / canal MIDI, première arrivée première servie, sans vol), instruments à deux
 * opérateurs, fréquences et volumes de la carte son Windows 95 SB16 (mode `ACCURACY_MODE_SB16_WIN95`, celui par défaut de ScummVM),
 * contrôleurs MIDI usuels (volume, expression, pédale de sustain, RPN d'inflexion de hauteur), volume par source avec fondu, et volume utilisateur.
 *
 * Écarts volontaires (tout ce qui n'a pas de sortie sonore dans le jeu qui s'en sert) :
 * - pas de mode rythme, pas d'OPL3 ni de double OPL2, pas d'instruments à quatre opérateurs, pas de banque General MIDI par défaut (la
 *   banque d'instruments se donne : `instrumentBank`) ;
 * - pas de mode d'écriture « changement de programme » ni « premier note on » : l'instrument est réécrit à chaque note (`INSTRUMENT_WRITE_MODE_NOTE_ON`) ;
 * - pas de mode de précision General MIDI (`ACCURACY_MODE_GM`), pas de valeurs de contrôleurs par défaut (`setControllerDefault`), pas de SysEx
 *   « General MIDI System On » ;
 * - pas de verrous : tout est synchrone sur le fil principal, la lecture et les ordres du jeu s'enchaînent dans l'ordre des appels.
 */
import type { OplSink } from "../../../audio/opl-stream";

export const OPL2_NUM_CHANNELS = 9;
export const MIDI_CHANNEL_COUNT = 16;
/** `MidiDriver_Multisource::MAXIMUM_SOURCES`. */
export const MAXIMUM_SOURCES = 10;
/** Valeur « tous » des paramètres de source et de canal (`0xFF`). */
export const ANY = 0xff;
/** Volume neutre d'une source (`DEFAULT_SOURCE_NEUTRAL_VOLUME`). */
export const DEFAULT_SOURCE_NEUTRAL_VOLUME = 255;
/** Cadence de la minuterie du pilote : 250 appels par seconde (`kDefaultCallbackFrequency`). */
export const TIMER_RATE = 250;
/** Durée d'un appel de minuterie, en µs (`getBaseTempo`). */
export const TIMER_PERIOD_US = 1_000_000 / TIMER_RATE;
/** Délai entre deux mises à jour du volume pendant un fondu, en µs (`FADING_DELAY`). */
const FADING_DELAY_US = 25 * 1000;
/** Volume utilisateur neutre : `(niveau * 256) >> 8` ne change rien. */
export const NEUTRAL_USER_VOLUME = 256;

const MIDI_PITCH_BEND_DEFAULT = 0x2000;
const MIDI_PANNING_DEFAULT = 0x40;
const MIDI_EXPRESSION_DEFAULT = 0x7f;
const MIDI_RPN_NULL = 0x7f7f;
const MIDI_RPN_PITCH_BEND_SENSITIVITY = 0x0000;
const MIDI_RPN_MASTER_TUNING_FINE = 0x0001;
const MIDI_RPN_MASTER_TUNING_COARSE = 0x0002;
const GM_PITCH_BEND_SENSITIVITY_DEFAULT = 2;
const MIDI_MASTER_TUNING_FINE_DEFAULT = 0x2000;
const MIDI_MASTER_TUNING_COARSE_DEFAULT = 0x40;

const MIDI_COMMAND_NOTE_OFF = 0x80;
const MIDI_COMMAND_NOTE_ON = 0x90;
const MIDI_COMMAND_POLYPHONIC_AFTERTOUCH = 0xa0;
const MIDI_COMMAND_CONTROL_CHANGE = 0xb0;
const MIDI_COMMAND_PROGRAM_CHANGE = 0xc0;
const MIDI_COMMAND_CHANNEL_AFTERTOUCH = 0xd0;
const MIDI_COMMAND_PITCH_BEND = 0xe0;

/** Numéro du méta-événement « fin de piste » (`MIDI_META_END_OF_TRACK`). */
export const META_END_OF_TRACK = 0x2f;
/** Numéro du méta-événement « spécifique au séquenceur » (`MIDI_META_SEQUENCER`). */
export const META_SEQUENCER = 0x7f;

const CC_MODULATION = 0x01;
const CC_DATA_ENTRY_MSB = 0x06;
const CC_VOLUME = 0x07;
const CC_PANNING = 0x0a;
const CC_EXPRESSION = 0x0b;
const CC_DATA_ENTRY_LSB = 0x26;
const CC_SUSTAIN = 0x40;
const CC_RPN_LSB = 0x64;
const CC_RPN_MSB = 0x65;
const CC_ALL_SOUND_OFF = 0x78;
const CC_RESET_ALL_CONTROLLERS = 0x79;
const CC_ALL_NOTES_OFF = 0x7b;
const CC_OMNI_ON = 0x7c;
const CC_OMNI_OFF = 0x7d;
const CC_MONO_ON = 0x7e;
const CC_POLY_ON = 0x7f;

const REG_TEST = 0x01;
const REG_TIMER1 = 0x02;
const REG_TIMER2 = 0x03;
const REG_TIMER_CONTROL = 0x04;
const REG_NOTESELECT_CSM = 0x08;
const REG_RHYTHM = 0xbd;
const REG_FREQMULT_MISC = 0x20;
const REG_LEVEL = 0x40;
const REG_DECAY_ATTACK = 0x60;
const REG_RELEASE_SUSTAIN = 0x80;
const REG_WAVEFORM_SELECT = 0xe0;
const REG_FNUM_LOW = 0xa0;
const REG_FNUM_HIGH_BLOCK_KEYON = 0xb0;
const REG_CONNECTION_FEEDBACK = 0xc0;
const MASK_LEVEL = 0x3f;
const MASK_FNUM_HIGH_BLOCK = 0x1f;
const MASK_KEYON = 0x20;
const MASK_PANNING = 0xf0;
/** Niveau par défaut d'un opérateur au démarrage (`OPL_LEVEL_DEFAULT` : le registre reçoit `0x3F - (volume de canal par défaut >> 1)`). */
const DEFAULT_CHANNEL_VOLUME = 0;

/** Fréquence (F-num) de chaque demi-ton d'une octave, à l'octave 5 (valeurs du pilote SB16 de Windows 95). */
const OPL_NOTE_FREQUENCIES: readonly number[] = [0x0ab7, 0x0b5a, 0x0c07, 0x0cbe, 0x0d80, 0x0e4d, 0x0f27, 0x100e, 0x1102, 0x1205, 0x1318, 0x143a];

/** Niveau OPL d'une valeur MIDI de 5 bits (valeurs du pilote SB16 de Windows 95). */
const OPL_VOLUME_LOOKUP: readonly number[] = [
  0x50, 0x3f, 0x28, 0x24, 0x20, 0x1c, 0x17, 0x15, 0x13, 0x11, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x09, 0x08, 0x07, 0x06, 0x05, 0x05, 0x04, 0x04, 0x03,
  0x03, 0x02, 0x02, 0x01, 0x01, 0x00, 0x00,
];

/** Un opérateur d'un instrument OPL : valeurs des registres `2x`, `4x`, `6x`, `8x` et `Ex`. */
export interface OplOperator {
  /** `2x` : multiplicateur de fréquence, échelle de débit, type d'enveloppe, vibrato, modulation d'amplitude. */
  freqMultMisc: number;
  /** `4x` : niveau (6 bits bas) et échelle de niveau (2 bits hauts). */
  level: number;
  /** `6x` : attaque (4 bits hauts) et déclin. */
  decayAttack: number;
  /** `8x` : sustain (4 bits hauts) et relâchement. */
  releaseSustain: number;
  /** `Ex` : forme d'onde. */
  waveformSelect: number;
}

/** Instrument OPL2 à deux opérateurs : tout sauf les registres `Ax` et `Bx` (fréquence), dérivés de la note jouée. */
export interface OplInstrument {
  operator0: OplOperator;
  operator1: OplOperator;
  /** `Cx` : connexion (bit 0, `1` = additive) et rétroaction (bits 1 à 3). La répartition gauche / droite n'existe pas sur OPL2. */
  connectionFeedback: number;
  /** Demi-tons dont les notes de l'instrument sont transposées. */
  transpose: number;
}

function emptyOperator(): OplOperator {
  return { freqMultMisc: 0, level: 0, decayAttack: 0, releaseSustain: 0, waveformSelect: 0 };
}

/** Instrument vide (sans données) : une note qui l'utilise ne se joue pas. */
export function emptyInstrument(): OplInstrument {
  return { operator0: emptyOperator(), operator1: emptyOperator(), connectionFeedback: 0, transpose: 0 };
}

function operatorIsEmpty(o: OplOperator): boolean {
  return o.freqMultMisc === 0 && o.level === 0 && o.decayAttack === 0 && o.releaseSustain === 0 && o.waveformSelect === 0;
}

/** `OplInstrumentDefinition::isEmpty`. */
export function instrumentIsEmpty(i: OplInstrument): boolean {
  return operatorIsEmpty(i.operator0) && operatorIsEmpty(i.operator1);
}

/** Taille d'une définition au format BNK d'AdLib. */
export const BNK_INSTRUMENT_SIZE = 30;
const BNK_OPERATOR_SIZE = 13;

function bnkOperator(b: Uint8Array, at: number, waveform: number, into: OplOperator): void {
  const keyScalingLevel = b[at]!;
  const frequencyMultiplier = b[at + 1]!;
  const attack = b[at + 3]!;
  const sustain = b[at + 4]!;
  const envelopeGainType = b[at + 5]!;
  const decay = b[at + 6]!;
  const release = b[at + 7]!;
  const level = b[at + 8]!;
  const amplitudeModulation = b[at + 9]!;
  const vibrato = b[at + 10]!;
  const keyScalingRate = b[at + 11]!;
  into.freqMultMisc = (frequencyMultiplier | (keyScalingRate === 0 ? 0 : 0x10) | (envelopeGainType === 0 ? 0 : 0x20) | (vibrato === 0 ? 0 : 0x40) | (amplitudeModulation === 0 ? 0 : 0x80)) & 0xff;
  into.level = (level | (keyScalingLevel << 6)) & 0xff;
  into.decayAttack = (decay | (attack << 4)) & 0xff;
  into.releaseSustain = (release | (sustain << 4)) & 0xff;
  into.waveformSelect = waveform;
}

/**
 * Définition d'instrument au format BNK d'AdLib (`AdLibBnkInstrumentDefinition::toOplInstrumentDefinition`), 30 octets : type et numéro de
 * voix rythmique (ignorés), puis les 13 champs de chaque opérateur (échelle de niveau, multiplicateur, rétroaction, attaque, sustain,
 * type d'enveloppe, déclin, relâchement, niveau, modulation d'amplitude, vibrato, échelle de débit, connexion), puis la forme d'onde de
 * chaque opérateur. `into` est modifié en place (les notes en cours qui s'y réfèrent suivent, comme les pointeurs de ScummVM).
 */
export function bnkToInstrument(bnk: Uint8Array, into: OplInstrument = emptyInstrument()): OplInstrument {
  if (bnk.length < BNK_INSTRUMENT_SIZE) throw new Error(`instrument BNK de ${bnk.length} octets (${BNK_INSTRUMENT_SIZE} attendus)`);
  const op0 = 2;
  const op1 = op0 + BNK_OPERATOR_SIZE;
  bnkOperator(bnk, op0, bnk[28]!, into.operator0);
  bnkOperator(bnk, op1, bnk[29]!, into.operator1);
  into.connectionFeedback = ((bnk[op0 + 12] === 0 ? 1 : 0) | (bnk[op0 + 2]! << 1)) & 0xff;
  into.transpose = 0;
  return into;
}

/** État des contrôleurs d'un canal MIDI d'une source (`MidiChannelControlData`). */
export interface ChannelControlData {
  program: number;
  channelPressure: number;
  /** 14 bits, `0x2000` au neutre. */
  pitchBend: number;
  modulation: number;
  volume: number;
  panning: number;
  expression: number;
  sustain: boolean;
  /** Deux valeurs de 7 bits. */
  rpn: number;
  pitchBendSensitivity: number;
  pitchBendSensitivityCents: number;
  masterTuningFine: number;
  masterTuningCoarse: number;
}

function newControlData(): ChannelControlData {
  return {
    program: 0,
    channelPressure: 0,
    pitchBend: MIDI_PITCH_BEND_DEFAULT,
    modulation: 0,
    volume: DEFAULT_CHANNEL_VOLUME,
    panning: MIDI_PANNING_DEFAULT,
    expression: MIDI_EXPRESSION_DEFAULT,
    sustain: false,
    rpn: MIDI_RPN_NULL,
    pitchBendSensitivity: GM_PITCH_BEND_SENSITIVITY_DEFAULT,
    pitchBendSensitivityCents: 0,
    masterTuningFine: MIDI_MASTER_TUNING_FINE_DEFAULT,
    masterTuningCoarse: MIDI_MASTER_TUNING_COARSE_DEFAULT,
  };
}

/** Note en cours (ou dernière jouée) sur une voix OPL (`ActiveNote`). */
export interface ActiveNote {
  /** Une note sonne (y compris tenue par la pédale, mais pas pendant son relâchement). */
  noteActive: boolean;
  /** Note relâchée mais tenue par la pédale de sustain. */
  noteSustained: boolean;
  /** Note MIDI du Note On. */
  note: number;
  velocity: number;
  /** Canal MIDI et source de la dernière note (`0xFF` : aucune encore). */
  channel: number;
  source: number;
  /** Note réellement jouée (différente de `note` si l'instrument la transpose ou la remplace). */
  oplNote: number;
  /** F-num et bloc au format des registres `Ax` (octet bas) et `Bx` (octet haut). */
  oplFrequency: number;
  /** Valeur du compteur de notes à la dernière mise en marche ou à l'arrêt de la voix. */
  noteCounterValue: number;
  instrumentId: number;
  lastWrittenInstrumentId: number;
  instrument: OplInstrument | null;
  /** Voix attribuée à un canal MIDI (allocation statique). */
  channelAllocated: boolean;
}

function newActiveNote(): ActiveNote {
  return {
    noteActive: false,
    noteSustained: false,
    note: 0,
    velocity: 0,
    channel: 0xff,
    source: 0xff,
    oplNote: 0,
    oplFrequency: 0,
    noteCounterValue: 0,
    instrumentId: 0,
    lastWrittenInstrumentId: -1,
    instrument: null,
    channelAllocated: false,
  };
}

/** Instrument choisi pour une note (`InstrumentInfo`). */
export interface InstrumentInfo {
  /** Note à jouer (`ActiveNote.oplNote`). */
  oplNote: number;
  instrument: OplInstrument | null;
  /** Identifiant unique de l'instrument, pour le choix d'une voix à voler. */
  instrumentId: number;
}

export type AllocationMode = "dynamic" | "static";

export interface MultisourceOptions {
  /** `dynamic` par défaut (`ALLOCATION_MODE_DYNAMIC`). */
  allocationMode?: AllocationMode;
  /** Profondeur de modulation d'amplitude, `1` forte (4,8 dB, par défaut) ou `0` faible (1 dB) : bit 7 du registre `BD`. */
  modulationDepth?: 0 | 1;
  /** Profondeur de vibrato, `1` forte (14 %, par défaut) ou `0` faible (7 %) : bit 6 du registre `BD`. */
  vibratoDepth?: 0 | 1;
  /** Instruments par numéro de programme (pilote sans instruments propres au jeu). */
  instrumentBank?: readonly (OplInstrument | undefined)[];
}

interface MidiSource {
  /** Les bruitages sont réglés par le volume « bruitages » de l'utilisateur, la musique par le volume « musique ». */
  type: "music" | "sfx";
  volume: number;
  neutralVolume: number;
  fadeStartVolume: number;
  fadeEndVolume: number;
  /** Temps écoulé depuis le début du fondu et durée totale, en µs (durée 0 : pas de fondu). */
  fadePassedTime: number;
  fadeDuration: number;
}

/** Volume où s'arrête un fondu abandonné. */
export type FadeAbort = "end" | "start" | "current";

/** Division entière vers zéro (`/` du C sur des entiers). */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** Position du registre d'un opérateur d'une voix à deux opérateurs (`determineOperatorRegisterOffset`). */
export function operatorRegisterOffset(oplChannel: number, operatorNum: number): number {
  return Math.floor((oplChannel % 9) / 3) * 8 + ((oplChannel % 9) % 3) + operatorNum * 3;
}

/**
 * Le pilote. Construit sans écrire : `open()` initialise la puce (à appeler une fois, sous-classes prêtes), comme `MidiDriver::open`.
 * Les événements MIDI arrivent par `send(source, status, data1, data2)` et `metaEvent` ; `stopAllNotes`, `deinitSource` et
 * `setSourceVolume` complètent l'interface. Chaque écriture de registre passe par `OplSink.write` (les écritures qui ne changent pas
 * la valeur d'un registre sont supprimées, sauf à l'initialisation et à l'arrêt général).
 */
export class AdlibMultisourceDriver {
  protected readonly allocationMode: AllocationMode;
  protected readonly modulationDepth: 0 | 1;
  protected readonly vibratoDepth: 0 | 1;
  protected readonly instrumentBank: readonly (OplInstrument | undefined)[];

  /** Dernière valeur écrite de chaque registre (`_shadowRegisters`, à zéro au départ). */
  private readonly shadow = new Uint8Array(256);
  protected readonly controlData: ChannelControlData[][] = Array.from({ length: MAXIMUM_SOURCES }, () => Array.from({ length: MIDI_CHANNEL_COUNT }, newControlData));
  protected readonly activeNotes: ActiveNote[] = Array.from({ length: OPL2_NUM_CHANNELS }, newActiveNote);
  /** Voix attribuée à chaque canal MIDI de chaque source (allocation statique), `0xFF` si aucune. */
  protected readonly channelAllocations: number[][] = Array.from({ length: MAXIMUM_SOURCES }, () => new Array<number>(MIDI_CHANNEL_COUNT).fill(ANY));
  protected readonly sources: MidiSource[] = Array.from({ length: MAXIMUM_SOURCES }, (_, i): MidiSource => ({
      type: i === 0 ? "music" : "sfx",
      volume: DEFAULT_SOURCE_NEUTRAL_VOLUME,
      neutralVolume: DEFAULT_SOURCE_NEUTRAL_VOLUME,
      fadeStartVolume: 0,
      fadeEndVolume: 0,
      fadePassedTime: 0,
      fadeDuration: 0,
    }),
  );
  private noteCounter = 1;
  private fadeDelay = 0;
  private userMusicVolume = NEUTRAL_USER_VOLUME;
  private userSfxVolume = NEUTRAL_USER_VOLUME;
  private opened = false;

  constructor(
    protected readonly sink: OplSink,
    options: MultisourceOptions = {},
  ) {
    this.allocationMode = options.allocationMode ?? "dynamic";
    this.modulationDepth = options.modulationDepth ?? 1;
    this.vibratoDepth = options.vibratoDepth ?? 1;
    this.instrumentBank = options.instrumentBank ?? [];
  }

  /** Initialise la puce (`open`). */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.initOpl();
  }

  // --- interface MIDI ---------------------------------------------------------------------------------------------------

  /** Message de voix d'une source (`send(source, b)`) : `status` porte la commande et le canal. */
  send(source: number, status: number, data1: number, data2: number): void {
    const command = status & 0xf0;
    const channel = status & 0x0f;
    switch (command) {
      case MIDI_COMMAND_NOTE_OFF:
        this.noteOff(channel, data1, data2, source);
        break;
      case MIDI_COMMAND_NOTE_ON:
        this.noteOn(channel, data1, data2, source);
        break;
      case MIDI_COMMAND_POLYPHONIC_AFTERTOUCH:
        break;
      case MIDI_COMMAND_CONTROL_CHANGE:
        this.controlChange(channel, data1, data2, source);
        break;
      case MIDI_COMMAND_PROGRAM_CHANGE:
        this.programChange(channel, data1, source);
        break;
      case MIDI_COMMAND_CHANNEL_AFTERTOUCH:
        this.channelAftertouch(channel, data1, source);
        break;
      case MIDI_COMMAND_PITCH_BEND:
        this.pitchBend(channel, data1, data2, source);
        break;
      default:
        break;
    }
  }

  /** Méta-événement d'une source : la fin de piste libère ce que la source tient ; les autres sont ignorés par défaut. */
  metaEvent(source: number, type: number, _data: Uint8Array): void {
    if (type === META_END_OF_TRACK && source >= 0) this.deinitSource(source);
  }

  /** Coupe toutes les voix (écriture forcée du bit de mise en marche à 0, pour qu'aucune note ne reste coincée) : `stopAllNotes()`. */
  stopAllNotes(): void {
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) this.writeKeyOff(oplChannel, true);
  }

  /** Coupe les notes d'une source et d'un canal (`ANY` : tous) : `stopAllNotes(source, channel)`. */
  stopNotes(source: number, channel: number): void {
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
      const note = this.activeNotes[oplChannel]!;
      if (note.noteActive && (source === ANY || note.source === source) && (channel === ANY || note.channel === channel)) this.writeKeyOff(oplChannel);
    }
  }

  /** Libère une source : notes tenues relâchées, notes coupées, voix rendues, contrôleurs conservés (`deinitSource`). */
  deinitSource(source: number): void {
    for (let channel = 0; channel < MIDI_CHANNEL_COUNT; channel++) this.sustain(channel, 0, source);
    // Le fondu de la source s'arrête à son volume final.
    this.abortFade(source);
    this.stopNotes(source, ANY);
    for (let channel = 0; channel < MIDI_CHANNEL_COUNT; channel++) this.channelAllocations[source]![channel] = ANY;
    for (const note of this.activeNotes) {
      if (note.channelAllocated && note.source === source) {
        note.channelAllocated = false;
        note.lastWrittenInstrumentId = -1;
      }
    }
  }

  // --- volumes ----------------------------------------------------------------------------------------------------------

  /** Volume d'une source (`setSourceVolume`) : neutre à `DEFAULT_SOURCE_NEUTRAL_VOLUME`, appliqué aux notes en cours. */
  setSourceVolume(source: number, volume: number): void {
    this.sources[source]!.volume = volume;
    this.applySourceVolume(source);
  }

  /** Volume de toutes les sources (`setSourceVolume(volume)`). */
  setAllSourceVolumes(volume: number): void {
    for (let source = 0; source < MAXIMUM_SOURCES; source++) this.setSourceVolume(source, volume);
  }

  /**
   * Fondu du volume de toutes les sources (ou d'une seule) vers `targetVolume` en `duration` millisecondes (`startFade`) ; le volume change
   * toutes les 25 ms, au rythme de `updateFading` (un appel par tick de minuterie).
   */
  startFade(duration: number, targetVolume: number, source?: number): void {
    for (let i = source ?? 0; i < (source === undefined ? MAXIMUM_SOURCES : source + 1); i++) {
      const s = this.sources[i]!;
      s.fadePassedTime = 0;
      s.fadeStartVolume = s.volume;
      s.fadeEndVolume = targetVolume;
      s.fadeDuration = duration * 1000;
    }
  }

  /** Abandonne le fondu (de toutes les sources, ou d'une) : le volume va à sa valeur finale, initiale ou reste où il est (`abortFade`). */
  abortFade(source?: number, abort: FadeAbort = "end"): void {
    for (let i = source ?? 0; i < (source === undefined ? MAXIMUM_SOURCES : source + 1); i++) {
      const s = this.sources[i]!;
      if (s.fadeDuration <= 0) continue;
      s.fadeDuration = 0;
      if (abort === "end") this.setSourceVolume(i, s.fadeEndVolume);
      else if (abort === "start") this.setSourceVolume(i, s.fadeStartVolume);
    }
  }

  /** Un fondu est en cours (sur la source, ou sur l'une d'elles). */
  isFading(source?: number): boolean {
    return source === undefined ? this.sources.some((s) => s.fadeDuration > 0) : this.sources[source]!.fadeDuration > 0;
  }

  /** À appeler à chaque tick de minuterie, avant les morceaux (`MidiDriver_Multisource::onTimer`). */
  updateFading(): void {
    this.fadeDelay -= this.fadeDelay < TIMER_PERIOD_US ? this.fadeDelay : TIMER_PERIOD_US;
    let updated = false;
    for (let i = 0; i < MAXIMUM_SOURCES; i++) {
      const s = this.sources[i]!;
      if (s.fadeDuration <= 0) continue;
      s.fadePassedTime += TIMER_PERIOD_US;
      if (s.fadePassedTime >= s.fadeDuration) {
        this.setSourceVolume(i, s.fadeEndVolume);
        updated = true;
        s.fadeDuration = 0;
      } else if (this.fadeDelay === 0) {
        this.setSourceVolume(i, Math.trunc((s.fadePassedTime * (s.fadeEndVolume - s.fadeStartVolume)) / s.fadeDuration) + s.fadeStartVolume);
        updated = true;
      }
    }
    if (updated) this.fadeDelay = FADING_DELAY_US;
  }

  /** Volume utilisateur de la musique (source 0) et des bruitages (autres sources), de 0 à 256 (`syncSoundSettings`). */
  setUserVolumes(music: number, sfx: number): void {
    this.userMusicVolume = Math.min(NEUTRAL_USER_VOLUME, Math.max(0, music));
    this.userSfxVolume = Math.min(NEUTRAL_USER_VOLUME, Math.max(0, sfx));
    for (let source = 0; source < MAXIMUM_SOURCES; source++) this.applySourceVolume(source);
  }

  protected applySourceVolume(source: number): void {
    this.recalculateVolumes(ANY, source);
  }

  // --- initialisation ---------------------------------------------------------------------------------------------------

  /** Registres à leurs valeurs de départ (`initOpl`). */
  protected initOpl(): void {
    this.writeRegister(REG_TEST, 0x20, true);
    this.writeRegister(REG_TIMER1, 0, true);
    this.writeRegister(REG_TIMER2, 0, true);
    this.writeRegister(REG_TIMER_CONTROL, 0x60, true);
    this.writeRegister(REG_TIMER_CONTROL, 0x80, true);
    this.writeRegister(REG_NOTESELECT_CSM, 0, true);
    const operatorBases = [REG_FREQMULT_MISC, REG_LEVEL, REG_DECAY_ATTACK, REG_RELEASE_SUSTAIN, REG_WAVEFORM_SELECT];
    operatorBases.forEach((base, i) => {
      const value = i === 1 ? MASK_LEVEL - (DEFAULT_CHANNEL_VOLUME >> 1) : 0;
      for (let channel = 0; channel < OPL2_NUM_CHANNELS; channel++) {
        this.writeRegister(base + operatorRegisterOffset(channel, 0), value, true);
        this.writeRegister(base + operatorRegisterOffset(channel, 1), value, true);
      }
    });
    for (const base of [REG_FNUM_LOW, REG_FNUM_HIGH_BLOCK_KEYON, REG_CONNECTION_FEEDBACK]) {
      for (let channel = 0; channel < OPL2_NUM_CHANNELS; channel++) this.writeRegister(base + channel, 0, true);
    }
    this.writeRhythm(true);
  }

  // --- notes ------------------------------------------------------------------------------------------------------------

  protected noteOff(channel: number, note: number, _velocity: number, source: number): void {
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
      const active = this.activeNotes[oplChannel]!;
      if (active.noteActive && active.source === source && active.channel === channel && active.note === note) {
        if (this.controlData[source]![channel]!.sustain) active.noteSustained = true;
        else this.writeKeyOff(oplChannel);
      }
    }
  }

  protected noteOn(channel: number, note: number, velocity: number, source: number): void {
    if (velocity === 0) {
      this.noteOff(channel, note, velocity, source);
      return;
    }
    const info = this.determineInstrument(channel, source, note);
    if (!info.instrument || instrumentIsEmpty(info.instrument)) return;

    const oplChannel = this.allocateOplChannel(channel, source, info);
    if (oplChannel === ANY) return;
    const active = this.activeNotes[oplChannel]!;
    // Une note encore en cours sur cette voix est coupée.
    if (active.noteActive) this.writeKeyOff(oplChannel);
    active.noteActive = true;
    active.noteSustained = false;
    active.note = note;
    active.velocity = velocity;
    active.channel = channel;
    active.source = source;
    active.oplNote = info.oplNote;
    active.noteCounterValue = this.noteCounter++;
    active.instrumentId = info.instrumentId;
    active.instrument = info.instrument;
    this.writeInstrument(oplChannel, info);
    this.writeFrequency(oplChannel);
  }

  protected programChange(channel: number, program: number, source: number): void {
    this.controlData[source]![channel]!.program = program;
  }

  /** Pression de canal : sans effet par défaut (le pilote SB16 de Windows 95 l'ignore). */
  protected channelAftertouch(_channel: number, _pressure: number, _source: number): void {}

  protected pitchBend(channel: number, lsb: number, msb: number, source: number): void {
    this.controlData[source]![channel]!.pitchBend = (msb << 7) | lsb;
    this.recalculateFrequencies(channel, source);
  }

  protected controlChange(channel: number, controller: number, value: number, source: number): void {
    switch (controller) {
      case CC_MODULATION:
        break;
      case CC_DATA_ENTRY_MSB:
        this.dataEntry(channel, value, ANY, source);
        break;
      case CC_VOLUME:
        this.volume(channel, value, source);
        break;
      case CC_PANNING:
        this.panning(channel, value, source);
        break;
      case CC_EXPRESSION:
        this.expression(channel, value, source);
        break;
      case CC_DATA_ENTRY_LSB:
        this.dataEntry(channel, ANY, value, source);
        break;
      case CC_SUSTAIN:
        this.sustain(channel, value, source);
        break;
      case CC_RPN_LSB:
        this.registeredParameterNumber(channel, ANY, value, source);
        break;
      case CC_RPN_MSB:
        this.registeredParameterNumber(channel, value, ANY, source);
        break;
      case CC_ALL_SOUND_OFF:
        this.stopNotes(source, channel);
        break;
      case CC_RESET_ALL_CONTROLLERS:
        this.resetAllControllers(channel, source);
        break;
      case CC_ALL_NOTES_OFF:
      case CC_OMNI_OFF:
      case CC_OMNI_ON:
      case CC_MONO_ON:
      case CC_POLY_ON:
        this.allNotesOff(channel, source);
        break;
      default:
        break;
    }
  }

  private dataEntry(channel: number, msb: number, lsb: number, source: number): void {
    const data = this.controlData[source]![channel]!;
    switch (data.rpn) {
      case MIDI_RPN_PITCH_BEND_SENSITIVITY:
        if (msb !== ANY) data.pitchBendSensitivity = msb;
        if (lsb !== ANY) data.pitchBendSensitivityCents = lsb;
        this.recalculateFrequencies(channel, source);
        break;
      case MIDI_RPN_MASTER_TUNING_FINE:
        if (msb !== ANY) data.masterTuningFine = (data.masterTuningFine & 0x00ff) | (msb << 8);
        if (lsb !== ANY) data.masterTuningFine = (data.masterTuningFine & 0xff00) | lsb;
        this.recalculateFrequencies(channel, source);
        break;
      case MIDI_RPN_MASTER_TUNING_COARSE:
        if (msb !== ANY) data.masterTuningCoarse = msb;
        this.recalculateFrequencies(channel, source);
        break;
      default:
        break;
    }
  }

  private volume(channel: number, volume: number, source: number): void {
    const data = this.controlData[source]![channel]!;
    if (data.volume === volume) return;
    data.volume = volume;
    this.recalculateVolumes(channel, source);
  }

  private panning(channel: number, panning: number, source: number): void {
    const data = this.controlData[source]![channel]!;
    if (data.panning === panning) return;
    data.panning = panning;
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
      const active = this.activeNotes[oplChannel]!;
      if (active.noteActive && active.channel === channel && active.source === source) this.writePanning(oplChannel);
    }
  }

  private expression(channel: number, expression: number, source: number): void {
    const data = this.controlData[source]![channel]!;
    if (data.expression === expression) return;
    data.expression = expression;
    this.recalculateVolumes(channel, source);
  }

  private sustain(channel: number, sustain: number, source: number): void {
    const data = this.controlData[source]![channel]!;
    if (sustain >= 0x40) {
      data.sustain = true;
    } else if (data.sustain) {
      data.sustain = false;
      for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
        const active = this.activeNotes[oplChannel]!;
        if (active.noteActive && active.noteSustained && active.channel === channel && active.source === source) this.writeKeyOff(oplChannel);
      }
    }
  }

  private registeredParameterNumber(channel: number, msb: number, lsb: number, source: number): void {
    const data = this.controlData[source]![channel]!;
    if (msb !== ANY) data.rpn = (data.rpn & 0x00ff) | (msb << 8);
    if (lsb !== ANY) data.rpn = (data.rpn & 0xff00) | lsb;
  }

  private resetAllControllers(channel: number, source: number): void {
    this.expression(channel, MIDI_EXPRESSION_DEFAULT, source);
    this.sustain(channel, 0, source);
    this.registeredParameterNumber(channel, MIDI_RPN_NULL >> 8, MIDI_RPN_NULL & 0xff, source);
    this.pitchBend(channel, MIDI_PITCH_BEND_DEFAULT & 0x7f, MIDI_PITCH_BEND_DEFAULT >> 7, source);
    this.channelAftertouch(channel, 0, source);
  }

  private allNotesOff(channel: number, source: number): void {
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
      const active = this.activeNotes[oplChannel]!;
      if (active.noteActive && !active.noteSustained && active.source === source && active.channel === channel) this.noteOff(channel, active.note, 0, source);
    }
  }

  // --- recalcul ---------------------------------------------------------------------------------------------------------

  /** Réécrit la fréquence des notes en cours d'un canal MIDI d'une source. */
  protected recalculateFrequencies(channel: number, source: number): void {
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
      const active = this.activeNotes[oplChannel]!;
      if (active.noteActive && active.channel === channel && active.source === source) this.writeFrequency(oplChannel);
    }
  }

  /** Réécrit le niveau des opérateurs des notes en cours (`ANY` : tous les canaux, toutes les sources). */
  protected recalculateVolumes(channel: number, source: number): void {
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
      const active = this.activeNotes[oplChannel]!;
      if (active.noteActive && (channel === ANY || active.channel === channel) && (source === ANY || active.source === source)) {
        this.writeVolume(oplChannel, 0);
        this.writeVolume(oplChannel, 1);
      }
    }
  }

  // --- choix de l'instrument et de la voix ------------------------------------------------------------------------------

  /** Instrument d'une note : par défaut celui du programme du canal dans `instrumentBank`. */
  protected determineInstrument(channel: number, source: number, note: number): InstrumentInfo {
    const program = this.controlData[source]![channel]!.program;
    return { oplNote: note, instrument: this.instrumentBank[program] ?? null, instrumentId: program };
  }

  /** Voix OPL d'une note, ou `0xFF` si aucune n'est disponible (`allocateOplChannel`). */
  protected allocateOplChannel(channel: number, source: number, info: InstrumentInfo): number {
    if (this.allocationMode === "static") {
      // Une voix fixe par canal MIDI de chaque source : toutes ses notes la prennent. Plus de voix libre : la note n'est pas jouée.
      const allocated = this.channelAllocations[source]![channel]!;
      if (allocated !== ANY) return allocated;
      for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
        const active = this.activeNotes[oplChannel]!;
        if (!active.channelAllocated) {
          active.channelAllocated = true;
          active.source = source;
          active.channel = channel;
          this.channelAllocations[source]![channel] = oplChannel;
          return oplChannel;
        }
      }
      return ANY;
    }

    // Allocation dynamique : une voix par note. Dans l'ordre : jamais utilisée (la plus basse), au repos depuis le plus longtemps, jouant le
    // même instrument depuis le plus longtemps, jouant la plus ancienne note (qui est alors interrompue).
    let unused = ANY;
    let inactive = ANY;
    let sameInstrument = ANY;
    let lowest = ANY;
    let inactiveCounter = Infinity;
    let sameInstrumentCounter = Infinity;
    let lowestCounter = Infinity;
    for (let oplChannel = 0; oplChannel < OPL2_NUM_CHANNELS; oplChannel++) {
      const active = this.activeNotes[oplChannel]!;
      if (active.channelAllocated) continue;
      if (active.noteCounterValue === 0) {
        unused = oplChannel;
        break;
      }
      if (!active.noteActive && active.noteCounterValue < inactiveCounter) {
        inactiveCounter = active.noteCounterValue;
        inactive = oplChannel;
        continue;
      }
      if (active.noteActive && active.instrumentId === info.instrumentId && active.noteCounterValue < sameInstrumentCounter) {
        sameInstrumentCounter = active.noteCounterValue;
        sameInstrument = oplChannel;
      }
      if (active.noteActive && active.noteCounterValue < lowestCounter) {
        lowestCounter = active.noteCounterValue;
        lowest = oplChannel;
      }
    }
    if (unused !== ANY) return unused;
    if (inactive !== ANY) return inactive;
    if (sameInstrument !== ANY) return sameInstrument;
    return lowest;
  }

  // --- calculs ----------------------------------------------------------------------------------------------------------

  /**
   * F-num (10 bits) et bloc de la note, au format des registres `Ax` / `Bx` (`calculateFrequency`, algorithme du pilote SB16 de Windows 95) :
   * la fréquence de l'octave 5 est doublée ou divisée par deux selon l'octave, l'inflexion de hauteur s'y ajoute, puis le bloc compense
   * ce qui dépasse 10 bits.
   */
  protected calculateFrequency(channel: number, source: number, note: number): number {
    const octaveNote = note % 12;
    const octave = Math.floor(note / 12);
    let frequency = OPL_NOTE_FREQUENCIES[octaveNote]!;
    frequency = octave > 5 ? frequency << (octave - 5) : frequency >> (5 - octave);
    let block = 1;
    frequency += this.calculatePitchBend(channel, source, frequency);
    while (frequency > 0x3ff) {
      frequency >>= 1;
      block++;
    }
    block = Math.min(block, 7);
    return frequency | (block << 10);
  }

  /** Inflexion de hauteur en unités de F-num (`calculatePitchBend`) : à plus ou moins deux demi-tons, comme le pilote SB16. */
  protected calculatePitchBend(channel: number, source: number, oplFrequency: number): number {
    let pitchBend = Math.max(-0x8000, (this.controlData[source]![channel]!.pitchBend << 2) - 0x8001);
    pitchBend *= pitchBend > 0 ? 0x1f : 0x1b;
    pitchBend >>= 8;
    pitchBend *= oplFrequency;
    pitchBend >>= 0xf;
    return pitchBend;
  }

  /** Niveau (0 : fort, `0x3F` : muet) d'un opérateur avant l'échelle des sources (`calculateVolume`). */
  protected calculateVolume(channel: number, source: number, velocity: number, instrument: OplInstrument, operatorNum: number): number {
    const operator = operatorNum === 0 ? instrument.operator0 : instrument.operator1;
    // Un modulateur (en synthèse FM) garde le niveau de l'instrument : seuls les porteurs suivent la vélocité et les volumes.
    if (!this.isVolumeApplicableToOperator(instrument, operatorNum)) return operator.level & MASK_LEVEL;
    const unscaled = this.calculateUnscaledVolume(channel, source, velocity, instrument, operatorNum);
    let inverted = (MASK_LEVEL - unscaled) & 0xff;
    const s = this.sources[source]!;
    inverted = idiv(inverted * s.volume, s.neutralVolume) & 0xff;
    const userVolume = s.type === "sfx" ? this.userSfxVolume : this.userMusicVolume;
    inverted = ((inverted * userVolume) >> 8) & 0xff;
    inverted = Math.min(MASK_LEVEL, inverted);
    return MASK_LEVEL - inverted;
  }

  /** Niveau d'un opérateur d'après la vélocité, le volume de canal et le niveau de l'instrument (`calculateUnscaledVolume`, pilote SB16). */
  protected calculateUnscaledVolume(channel: number, source: number, velocity: number, instrument: OplInstrument, operatorNum: number): number {
    const operator = operatorNum === 0 ? instrument.operator0 : instrument.operator1;
    const operatorVolume = operator.level & MASK_LEVEL;
    const velocityVolume = OPL_VOLUME_LOOKUP[velocity >> 2]!;
    const channelVolume = OPL_VOLUME_LOOKUP[this.controlData[source]![channel]!.volume >> 2]!;
    return Math.min(MASK_LEVEL, (velocityVolume + channelVolume + operatorVolume) & 0xff);
  }

  /** Les porteurs de la synthèse FM et tous les opérateurs de la synthèse additive suivent les volumes. */
  protected isVolumeApplicableToOperator(instrument: OplInstrument, operatorNum: number): boolean {
    return (instrument.connectionFeedback & 0x01) === 0x01 || operatorNum === 1;
  }

  // --- écritures --------------------------------------------------------------------------------------------------------

  /** Écrit l'instrument d'une voix : opérateurs, puis connexion et rétroaction (`writeInstrument`). */
  private writeInstrument(oplChannel: number, info: InstrumentInfo): void {
    const active = this.activeNotes[oplChannel]!;
    const instrument = info.instrument!;
    active.instrument = instrument;
    active.lastWrittenInstrumentId = info.instrumentId;
    for (let i = 0; i < 2; i++) {
      const offset = operatorRegisterOffset(oplChannel, i);
      const operator = i === 0 ? instrument.operator0 : instrument.operator1;
      this.writeRegister(REG_FREQMULT_MISC + offset, operator.freqMultMisc);
      this.writeVolume(oplChannel, i);
      this.writeRegister(REG_DECAY_ATTACK + offset, operator.decayAttack);
      this.writeRegister(REG_RELEASE_SUSTAIN + offset, operator.releaseSustain);
      this.writeRegister(REG_WAVEFORM_SELECT + offset, operator.waveformSelect);
    }
    this.writePanning(oplChannel);
  }

  /** Relâche la note d'une voix : réécrit `Bx` sans le bit de mise en marche (`writeKeyOff`). */
  private writeKeyOff(oplChannel: number, force = false): void {
    const active = this.activeNotes[oplChannel]!;
    if (active.oplFrequency !== 0xffff) this.writeRegister(REG_FNUM_HIGH_BLOCK_KEYON + oplChannel, (active.oplFrequency >> 8) & MASK_FNUM_HIGH_BLOCK, force);
    active.noteActive = false;
    active.noteSustained = false;
    active.noteCounterValue = this.noteCounter;
  }

  /** Registre `BD` : profondeurs de modulation et de vibrato (le mode rythme n'existe pas ici). */
  private writeRhythm(force = false): void {
    this.writeRegister(REG_RHYTHM, (this.modulationDepth << 7) | (this.vibratoDepth << 6), force);
  }

  private writeVolume(oplChannel: number, operatorNum: number): void {
    const active = this.activeNotes[oplChannel]!;
    const instrument = active.instrument!;
    const operator = operatorNum === 0 ? instrument.operator0 : instrument.operator1;
    const level = this.calculateVolume(active.channel, active.source, active.velocity, instrument, operatorNum);
    // L'échelle de niveau de l'instrument (2 bits hauts) s'ajoute au niveau calculé.
    this.writeRegister(REG_LEVEL + operatorRegisterOffset(oplChannel, operatorNum), (level | (operator.level & ~MASK_LEVEL)) & 0xff);
  }

  private writePanning(oplChannel: number): void {
    const active = this.activeNotes[oplChannel]!;
    // OPL2 : pas de répartition gauche / droite.
    this.writeRegister(REG_CONNECTION_FEEDBACK + oplChannel, active.instrument!.connectionFeedback & ~MASK_PANNING & 0xff);
  }

  private writeFrequency(oplChannel: number): void {
    const active = this.activeNotes[oplChannel]!;
    const transposed = active.oplNote + active.instrument!.transpose;
    const oplNote = transposed < 0 ? 0 : transposed > 0x7f ? 0x7f : transposed;
    const frequency = this.calculateFrequency(active.channel, active.source, oplNote);
    active.oplFrequency = frequency;
    if (frequency === 0xffff) return;
    this.writeRegister(REG_FNUM_LOW + oplChannel, frequency & 0xff);
    this.writeRegister(REG_FNUM_HIGH_BLOCK_KEYON + oplChannel, ((frequency >> 8) | (active.noteActive ? MASK_KEYON : 0)) & 0xff);
  }

  /** Écrit un registre, sauf si sa valeur ne change pas (`force` : toujours). Les registres de minuterie sont toujours écrits. */
  private writeRegister(reg: number, value: number, force = false): void {
    if ((reg >= 1 && reg <= 3) || force || this.shadow[reg] !== value) {
      this.shadow[reg] = value;
      this.sink.write(reg, value);
    }
  }
}
