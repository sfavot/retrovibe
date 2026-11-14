/**
 * Fichier de musique AdLib d'une section (`60202 + 4 * section`) : pilote DOS d'origine et ses données, lus à des positions fixes (v0.0372).
 *
 * Références : ScummVM engines/sky/music/adlibmusic.cpp (`setupPointers`, `setupChannels`, `startDriver`), adlibchannel.cpp et adlibchannel.h
 * (`AdLibChannel::AdLibChannel`, `process`, `com90_*`, `InstrumentStruct`), musicbase.cpp (`loadNewMusic`, `startMusic`), GPL v3 ou ultérieure.
 * Seules les positions de la v0.0372 sont gérées (pas celles de la démo 109 ni de la v0.0267).
 *
 * Ce module ne fait que lire : le miroir de registres (`registerMirror`) est une vue sur le fichier, que le pilote (vague A) copie avant de
 * l'écrire, car ScummVM le modifie en place.
 */

/** Positions de la v0.0372 (`adlibmusic.cpp:68-70`, `adlibchannel.cpp:70-74`). */
export const MUSIC_DATA_LOC_POS = 0x1201;
export const MUSIC_INIT_SEQUENCE_POS = 0xe91;
export const MUSIC_INSTRUMENT_LOC_POS = 0x1205;
export const MUSIC_FREQUENCY_TABLE_POS = 0x7fe;
export const MUSIC_REGISTER_TABLE_POS = 0xdfe;
export const MUSIC_OUTPUT_LEVEL_POS = 0xe10;
export const MUSIC_REGISTER_MIRROR_POS = 0xf5f;

export const FREQUENCY_TABLE_ENTRIES = 0x300;
export const OUTPUT_LEVEL_ENTRIES = 0x81;
export const REGISTER_MIRROR_SIZE = 0x100;
export const INSTRUMENT_MAP_SIZE = 0x80;
export const INSTRUMENT_SIZE = 16;

/** `InstrumentStruct` (adlibchannel.h), 16 octets : les trois derniers sont du remplissage. */
export interface AdlibInstrument {
  readonly adOp1: number;
  readonly adOp2: number;
  readonly srOp1: number;
  readonly srOp2: number;
  readonly ampModOp1: number;
  readonly ampModOp2: number;
  readonly waveSelectOp1: number;
  readonly waveSelectOp2: number;
  readonly bindedEffect: number;
  readonly feedBack: number;
  readonly totOutLevOp1: number;
  readonly totOutLevOp2: number;
  readonly scalingLevel: number;
}

export interface MusicSong {
  /** Numéro de morceau, de 1 à `songCount` (0 = pas de musique). */
  readonly number: number;
  readonly tempo0: number;
  readonly tempo1: number;
  /** Position absolue de chaque canal dans le fichier (début du flux : un delta, puis un événement). */
  readonly channelOffsets: readonly number[];
}

/**
 * Morceaux qui ne bouclent pas (`musicbase.cpp:106-118`) : paires `section * 100 + morceau` de la liste de `loadNewMusic` (13 morceaux).
 * Ce test n'existe dans ScummVM que pour les pistes numériques ; le pilote AdLib d'origine boucle via l'opcode 0x98 propre à chaque flux.
 */
const NON_LOOPING: ReadonlySet<number> = new Set([1, 101, 104, 201, 204, 402, 403, 405, 406, 411, 501, 503, 504]);

export function isNonLoopingSong(section: number, song: number): boolean {
  return NON_LOOPING.has(section * 100 + song);
}

export const NON_LOOPING_SONG_COUNT = NON_LOOPING.size;

export class MusicFile {
  readonly data: Uint8Array;
  private readonly view: DataView;
  /** Début des données musicales (`LE16 @0x1201`) ; les positions des morceaux et des canaux lui sont relatives. */
  readonly musicDataLoc: number;
  readonly instrumentLoc: number;
  /** Position de la table des morceaux. */
  private readonly songTableLoc: number;
  readonly songCount: number;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const need = MUSIC_REGISTER_MIRROR_POS + REGISTER_MIRROR_SIZE;
    if (data.length < need) throw new Error(`fichier de musique invalide : ${data.length} octets, ${need} au moins`);
    this.musicDataLoc = this.view.getUint16(MUSIC_DATA_LOC_POS, true);
    this.instrumentLoc = this.view.getUint16(MUSIC_INSTRUMENT_LOC_POS, true);
    this.check(this.instrumentLoc, INSTRUMENT_MAP_SIZE + INSTRUMENT_SIZE, "instruments");
    this.check(this.musicDataLoc, 3, "données musicales");
    this.songCount = data[this.musicDataLoc]!;
    // `loadNewMusic` : table des morceaux = `musicDataLoc + LE16(musicDataLoc + 1)`, un `u16` par morceau.
    this.songTableLoc = this.musicDataLoc + this.view.getUint16(this.musicDataLoc + 1, true);
    this.check(this.songTableLoc, this.songCount * 2, "table des morceaux");
  }

  private check(at: number, size: number, what: string): void {
    if (at < 0 || at + size > this.data.length) throw new Error(`fichier de musique invalide : ${what} hors du fichier`);
  }

  /** Paires (registre, valeur) de `startDriver`, jusqu'à `00 00` exclu. */
  initSequence(): ReadonlyArray<readonly [number, number]> {
    const pairs: Array<readonly [number, number]> = [];
    for (let at = MUSIC_INIT_SEQUENCE_POS; ; at += 2) {
      if (at + 1 >= this.data.length) throw new Error("séquence d'initialisation sans fin 00 00");
      const reg = this.data[at]!;
      const value = this.data[at + 1]!;
      if (reg === 0 && value === 0) return pairs;
      pairs.push([reg, value]);
    }
  }

  /** Table des fréquences (0x300 `u16` LE) : copie. */
  frequencyTable(): Uint16Array {
    const out = new Uint16Array(FREQUENCY_TABLE_ENTRIES);
    for (let i = 0; i < out.length; i++) out[i] = this.view.getUint16(MUSIC_FREQUENCY_TABLE_POS + 2 * i, true);
    return out;
  }

  /** Registres des deux opérateurs de chaque voix OPL : `[2 * voix]` et `[2 * voix + 1]` (vue). */
  get registerTable(): Uint8Array {
    return this.data.subarray(MUSIC_REGISTER_TABLE_POS, MUSIC_OUTPUT_LEVEL_POS);
  }

  /** Niveaux de sortie OPL (0x81 entrées, vue). */
  get outputLevelTable(): Uint8Array {
    return this.data.subarray(MUSIC_OUTPUT_LEVEL_POS, MUSIC_OUTPUT_LEVEL_POS + OUTPUT_LEVEL_ENTRIES);
  }

  /** Miroir des registres : 256 octets partagés par tous les canaux (vue ; en faire une copie avant d'écrire). */
  get registerMirror(): Uint8Array {
    return this.data.subarray(MUSIC_REGISTER_MIRROR_POS, MUSIC_REGISTER_MIRROR_POS + REGISTER_MIRROR_SIZE);
  }

  /** Table note → numéro d'instrument (0x80 octets, vue). */
  get instrumentMap(): Uint8Array {
    return this.data.subarray(this.instrumentLoc, this.instrumentLoc + INSTRUMENT_MAP_SIZE);
  }

  /** Instrument `n` (`InstrumentStruct`) ; ScummVM n'en borne pas le numéro, ici il doit tenir dans le fichier. */
  instrument(n: number): AdlibInstrument {
    const at = this.instrumentLoc + INSTRUMENT_MAP_SIZE + n * INSTRUMENT_SIZE;
    if (!Number.isInteger(n) || n < 0 || at + INSTRUMENT_SIZE > this.data.length) throw new RangeError(`instrument ${n} hors du fichier`);
    const d = this.data;
    return {
      adOp1: d[at]!,
      adOp2: d[at + 1]!,
      srOp1: d[at + 2]!,
      srOp2: d[at + 3]!,
      ampModOp1: d[at + 4]!,
      ampModOp2: d[at + 5]!,
      waveSelectOp1: d[at + 6]!,
      waveSelectOp2: d[at + 7]!,
      bindedEffect: d[at + 8]!,
      feedBack: d[at + 9]!,
      totOutLevOp1: d[at + 10]!,
      totOutLevOp2: d[at + 11]!,
      scalingLevel: d[at + 12]!,
    };
  }

  /** Morceau `number` (1 à `songCount`) : en-tête `tempo0`, `tempo1`, nombre de canaux, positions `LE16` des canaux (`setupChannels`). */
  song(number: number): MusicSong {
    if (!Number.isInteger(number) || number < 1 || number > this.songCount) throw new RangeError(`morceau ${number} hors de 1 à ${this.songCount}`);
    const start = this.musicDataLoc + this.view.getUint16(this.songTableLoc + (number - 1) * 2, true);
    this.check(start, 3, `morceau ${number}`);
    const channels = this.data[start + 2]!;
    this.check(start + 3, channels * 2, `canaux du morceau ${number}`);
    const channelOffsets: number[] = [];
    for (let i = 0; i < channels; i++) channelOffsets.push(this.musicDataLoc + this.view.getUint16(start + 3 + 2 * i, true));
    return { number, tempo0: this.data[start]!, tempo1: this.data[start + 1]!, channelOffsets };
  }

  songs(): MusicSong[] {
    return Array.from({ length: this.songCount }, (_, i) => this.song(i + 1));
  }

  /** Examine le flux du canal commençant à `offset` (voir `scanChannel`). */
  scan(offset: number): ChannelScan {
    return scanChannel(this.data, offset);
  }
}

export interface ChannelScan {
  /** `stop` : opcode 0x91 (canal arrêté) ; `loop` : opcode 0x98 (retour au point de boucle). */
  readonly end: "stop" | "loop";
  /** Position de l'octet suivant la dernière commande. */
  readonly endOffset: number;
  /** Nombre d'événements (delta exclu). */
  readonly events: number;
  /** Somme des delays, en ticks de morceau, jusqu'à la fin (sans compter un éventuel retour en boucle). */
  readonly duration: number;
  /** Position visée par le dernier 0x9C rencontré avant la fin (point de boucle), si présent. */
  readonly loopPoint: number | undefined;
}

/** Taille des arguments des opcodes 0x90 à 0x9C (`com90_*`) ; absent = opcode inconnu (`error("Unknown music opcode")`). */
const ARGS_90: Readonly<Record<number, number>> = { 0x0: 1, 0x1: 0, 0x2: 1, 0x3: 1, 0x5: 1, 0x6: 1, 0x7: 1, 0x8: 0, 0x9: 0, 0xc: 0 };

/**
 * Parcourt linéairement un flux de canal (`AdLibChannel::process`) : delta (varint 7 bits, 4 octets au plus, bit 7 = suite), puis un événement.
 * Événements : 0x00-0x7F note + vélocité (1 octet), 0x80-0x8F voix OPL, 0xFF sans effet, 0x90-0x9C avec leurs arguments. S'arrête sur 0x91 (arrêt,
 * aucun delta ensuite) ou 0x98 (boucle). Lève une erreur sur un opcode inconnu, un delta de plus de 4 octets ou un flux qui sort du fichier.
 */
export function scanChannel(data: Uint8Array, offset: number): ChannelScan {
  let at = offset;
  let events = 0;
  let duration = 0;
  let loopPoint: number | undefined;
  const byte = (): number => {
    if (at >= data.length) throw new Error(`flux de canal @${offset} : fin de fichier atteinte`);
    return data[at++]!;
  };
  for (;;) {
    let delta = 0;
    for (let i = 0; ; i++) {
      const b = byte();
      delta = (delta << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
      if (i === 3) throw new Error(`flux de canal @${offset} : delta de plus de 4 octets (en ${at - 1})`);
    }
    duration += delta;
    const opcode = byte();
    events++;
    if (opcode < 0x80) {
      byte();
    } else if (opcode >= 0x90 && opcode !== 0xff) {
      const args = ARGS_90[opcode & 0xf];
      if (opcode > 0x9c || args === undefined) throw new Error(`flux de canal @${offset} : opcode 0x${opcode.toString(16)} inconnu (en ${at - 1})`);
      for (let i = 0; i < args; i++) byte();
      if (opcode === 0x91) return { end: "stop", endOffset: at, events, duration, loopPoint };
      if (opcode === 0x98) return { end: "loop", endOffset: at, events, duration, loopPoint };
      if (opcode === 0x9c) loopPoint = at;
    }
    // 0x80-0x8F et 0xFF : sans argument.
  }
}
