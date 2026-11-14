/**
 * Effets sonores de *Beneath a Steel Sky* : deux voies d'échantillons, volume par pièce, départ différé, effets à relancer au chargement.
 *
 * Référence : ScummVM engines/sky/sound.cpp (`Sound::loadSection`, `playSound`, `fnStartFx`, `checkFxQueue`, `restoreSfx`, `fnStopFx`,
 * `fnPauseFx`, `fnUnPauseFx`) et logic.cpp (`fnStartFx`, `fnStopFx`, `fnPauseFx`, `fnUnPauseFx`, `fnEnterSection`), GPL v3 ou
 * ultérieure ; lu puis réécrit. La table `musicList` (volume par pièce, drapeaux) est générée (`data/tables/sfx-list.ts`).
 *
 * Fidèle à ScummVM :
 * - `startFx(son, voie)` : le numéro d'effet est `256 + i` ; `278` dans la pièce 25 devient `394` (soudure) ; la voie est `voie & 1` ;
 *   l'emplacement à sauvegarder de la voie est vidé **avant** les autres tests (un effet refusé laisse donc la voie jouer sans être sauvé) ;
 * - volume : `(volume de la pièce × volume général) >> 8` (colonne AdLib de la table), puis `(v & 0x7F) << 1` sur 255 au mélangeur ;
 * - drapeau `0x80` : départ différé de `drapeaux & 0x7F` tours (file de 4 ; un effet qui ne trouve pas de place est perdu ; le comptage
 *   garde le bit `0x20` s'il est là, comme ScummVM) ; drapeau `0x20` : l'effet est sauvegardé (`saveSounds`) et relancé au chargement ;
 * - `checkFxQueue` au début de chaque tour ; `loadSection` coupe les effets et vide la file, sauf juste après une restauration ;
 * - boucle : si le son a une longueur de boucle, il joue une fois en entier puis rejoue ses derniers octets en boucle (`PlayOptions.loopStart`) ;
 * - `restoreSfx` : les effets sauvegardés repartent un tour plus tard (file, départ à 1).
 *
 * Écarts volontaires :
 * - un son de rang `soundsTotal` est ignoré (ScummVM le lirait hors table : `sound > total`) ;
 * - pause : ScummVM met les flux en pause dans le mélangeur ; ici la voie est arrêtée, puis reprise à la même position par un échantillon
 *   tronqué (la position est lue sur l'horloge du jeu, figée pendant une suspension de l'onglet) ;
 * - les taux sous 3 000 Hz (128 et 256 Hz dans les données, refusés par Web Audio) sont rééchantillonnés à 11 025 Hz, au plus proche voisin ;
 * - la colonne Roland de la table et `SF_ROLAND` ne sont pas portées (musique AdLib seule) ; `SF_FX_OFF` est `fxOff` ;
 * - un son dont le PCM déborde du fichier est ignoré au lieu de lever.
 */

import type { SamplePlayer } from "../../../audio/sample-channel";
import { u8ToFloat32 } from "../../../audio/pcm";
import type { PlayOptions, Sample, SampleVoice } from "../../../audio/web-sample-output";
import { SfxFile } from "../data/sfx-file";
import { MUSIC_LIST, SFX_DEFS } from "../data/tables/sfx-list";

/** Effets en file d'attente (`MAX_QUEUED_FX`). */
export const MAX_QUEUED_FX = 4;
/** Drapeaux d'un effet (`SFXF_START_DELAY`, `SFXF_SAVE`). */
export const SFXF_START_DELAY = 0x80;
export const SFXF_SAVE = 0x20;
/** Premier numéro d'effet de `fnStartFx` (en dessous, rien) et plus grand (`MAX_FX_NUMBER`). */
export const FIRST_FX_NUMBER = 256;
export const MAX_FX_NUMBER = 393;
/** Soudure de la pièce 25 : l'effet 278 y devient le 394 (« my anchor weld bodge »). */
export const WELD_FX = 278;
export const WELD_ROOM = 25;
export const WELD_FX_REPLACEMENT = 394;
/** Emplacement de sauvegarde vide (`_saveSounds`). */
export const NO_SAVED_SOUND = 0xffff;
/** Volume général par défaut (`Audio::Mixer::kMaxChannelVolume`). */
export const MAIN_SFX_VOLUME = 255;
/** Liste de pièces : « toutes les pièces » et fin de liste. */
const ALL_ROOMS = 0xff;
/** Fréquence de rééchantillonnage des sons trop lents pour Web Audio (< 3 000 Hz). */
const RESAMPLED_RATE = 11025;
const MIN_PLAY_RATE = 3000;

/** Un effet joué : échantillon décodé et début de boucle (en échantillons de `data`). */
interface SoundEntry {
  readonly data: Float32Array;
  readonly rate: number;
  readonly loopStart: number | undefined;
}

interface ChannelState {
  entry: SoundEntry;
  /** Gain de 0 à 1 (volume du mélangeur sur 255). */
  gain: number;
  /** Position (échantillons de `entry.data`, ramenée dans le son) au moment `startedAt`. */
  offset: number;
  startedAt: number;
  /** Vivante, ou arrêtée par une pause (à reprendre au `unPauseFx`). */
  voice: SampleVoice | null;
}

interface QueuedFx {
  count: number;
  fxNo: number;
  chan: number;
  vol: number;
}

export interface BassSfxOptions {
  output: SamplePlayer;
  /** Fichier d'effets de la section (`sfxFile(section)` de `data/ids.ts`, octets décompressés avec leur en-tête). */
  loadFile(section: number): Uint8Array;
  /** Numéro de pièce courant (`SCREEN & 0xFF`). */
  screen(): number;
  /** Volume général des effets de 0 à 255 (`_mainSfxVolume`). */
  mainVolume?: number;
}

/** État de sauvegarde des effets : `_saveSounds` (`numéro | volume << 8`, 0xFFFF si vide). */
export type SavedSounds = readonly [number, number];

export class BassSfx {
  /** Effets coupés (`SF_FX_OFF`, bouton du panneau de contrôle) : `startFx` ne joue plus rien. */
  fxOff = false;
  private mainVolume: number;
  private file: SfxFile | null = null;
  private entries = new Map<number, SoundEntry | undefined>();
  private readonly saveSounds: [number, number] = [NO_SAVED_SOUND, NO_SAVED_SOUND];
  private readonly queue: QueuedFx[] = Array.from({ length: MAX_QUEUED_FX }, () => ({ count: 0, fxNo: 0, chan: 0, vol: 0 }));
  private readonly channels: [ChannelState | null, ChannelState | null] = [null, null];
  private paused = false;

  constructor(private readonly options: BassSfxOptions) {
    this.mainVolume = options.mainVolume ?? MAIN_SFX_VOLUME;
  }

  /** Volume général des effets, de 0 à 255 (pris en compte au prochain effet). */
  get volume(): number {
    return this.mainVolume;
  }
  set volume(volume: number) {
    this.mainVolume = Math.min(255, Math.max(0, Math.trunc(volume)));
  }

  /**
   * `Sound::loadSection` : coupe les effets, charge le fichier de la section. La file est vidée, sauf juste après la restauration d'une
   * partie (`SF_GAME_RESTORED` : elle porte les effets à relancer).
   */
  loadSection(section: number, gameRestored = false): void {
    this.stopFx();
    this.file = new SfxFile(this.options.loadFile(section));
    this.entries = new Map();
    if (!gameRestored) for (const fx of this.queue) fx.count = 0;
  }

  /** `Sound::fnStartFx` (logique : `fnStartFx(son, b)` avec `voie = b & 1`). */
  startFx(sound: number, channel: number): void {
    const chan = channel & 1;
    this.saveSounds[chan] = NO_SAVED_SOUND;
    if (sound < FIRST_FX_NUMBER || sound > MAX_FX_NUMBER || this.fxOff) return;

    const screen = this.options.screen() & 0xff;
    if (sound === WELD_FX && screen === WELD_ROOM) sound = WELD_FX_REPLACEMENT;
    const def = SFX_DEFS[MUSIC_LIST[sound & ~FIRST_FX_NUMBER] ?? -1];
    if (!def) return;
    const soundNo = def[0]!;
    const flags = def[1]!;

    const adlibVolume = this.roomVolume(def, screen);
    if (adlibVolume === undefined) return;
    const volume = (adlibVolume * this.mainVolume) >> 8;

    if (flags & SFXF_START_DELAY) {
      const free = this.queue.find((fx) => fx.count === 0);
      if (free) {
        free.chan = chan;
        free.fxNo = soundNo;
        free.vol = volume;
        free.count = flags & 0x7f;
      }
      return; // sans place dans la file, l'effet est perdu
    }
    if (flags & SFXF_SAVE) this.saveSounds[chan] = soundNo | (volume << 8);
    this.playSound(soundNo, volume, chan);
  }

  /**
   * Volume AdLib de l'effet dans la pièce courante, ou `undefined` s'il n'y est pas joué. Liste de pièces = triplets
   * `pièce, volume AdLib, volume Roland` ; une liste qui commence par 255 vaut pour toutes les pièces.
   */
  private roomVolume(def: readonly number[], screen: number): number | undefined {
    const first = 2;
    if (def[first] === ALL_ROOMS) return def[first + 1];
    for (let i = first; i < def.length; i += 3) {
      if (def[i] === ALL_ROOMS) return undefined;
      if (def[i] === screen) return def[i + 1];
    }
    return undefined;
  }

  /** `Sound::checkFxQueue` : à appeler au début de chaque tour de jeu. */
  checkFxQueue(): void {
    for (const fx of this.queue) {
      if (fx.count === 0) continue;
      fx.count--;
      if (fx.count === 0) this.playSound(fx.fxNo, fx.vol, fx.chan);
    }
  }

  /**
   * `Sound::playSound(son, volume, voie)` : joue le son `son` du fichier de la section sur la voie, à la place de celui qui y jouait.
   * Aussi appelé directement par les séquences (`IC_MAKE_SOUND`, `IC_FX_VOLUME` de l'introduction).
   */
  playSound(sound: number, volume: number, channel: number): void {
    const chan = channel === 0 ? 0 : 1;
    this.stopChannel(chan);
    if (!this.file) return;
    if (sound >= this.file.soundsTotal) return;
    const entry = this.entry(sound & 0xff);
    if (!entry) return;
    const gain = ((volume & 0x7f) << 1) / 255;
    this.begin(chan, entry, gain, 0);
  }

  /** `Sound::fnStopFx` : coupe les deux voies et oublie les effets à sauvegarder (la file différée reste). */
  stopFx(): void {
    this.stopChannel(0);
    this.stopChannel(1);
    this.saveSounds[0] = this.saveSounds[1] = NO_SAVED_SOUND;
  }

  /** `Sound::fnPauseFx` : fige les voies en cours. */
  pauseFx(): void {
    if (this.paused) return;
    this.paused = true;
    const now = this.options.output.clockNow();
    for (const state of this.channels) {
      if (!state?.voice) continue;
      const playing = state.voice.playing;
      state.voice.stop();
      state.voice = null;
      if (!playing) this.clear(state);
      else state.offset = this.position(state, now);
    }
  }

  /** `Sound::fnUnPauseFx` : reprend les voies figées là où elles étaient. */
  unPauseFx(): void {
    if (!this.paused) return;
    this.paused = false;
    for (let chan = 0; chan < 2; chan++) {
      const state = this.channels[chan];
      if (state && !state.voice) this.begin(chan, state.entry, state.gain, state.offset);
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** `_saveSounds` pour une sauvegarde de partie. */
  get savedSounds(): SavedSounds {
    return [this.saveSounds[0], this.saveSounds[1]];
  }

  /**
   * Restauration d'une partie : `_saveSounds` revient, puis `restoreSfx` met les effets à relancer dans la file (départ au tour suivant :
   * ils repartent quand le joueur quitte le panneau). À faire avant `loadSection(section, true)`, qui garde cette file.
   */
  restoreState(saved: SavedSounds): void {
    this.saveSounds[0] = saved[0] & 0xffff;
    this.saveSounds[1] = saved[1] & 0xffff;
    this.restoreSfx();
  }

  /** `Sound::restoreSfx`. */
  restoreSfx(): void {
    for (const fx of this.queue) fx.count = fx.fxNo = fx.chan = fx.vol = 0;
    let slot = 0;
    for (let chan = 0; chan < 2; chan++) {
      const saved = this.saveSounds[chan]!;
      if (saved === NO_SAVED_SOUND) continue;
      const fx = this.queue[slot++]!;
      fx.fxNo = saved & 0xff;
      fx.vol = (saved >> 8) & 0xff;
      fx.chan = chan;
      fx.count = 1;
    }
  }

  /** Une voie joue (ou est en pause). Pour les tests et l'hôte. */
  channelActive(channel: number): boolean {
    const state = this.channels[channel & 1];
    return !!state && (state.voice === null || state.voice.playing);
  }

  /** Libère tout (page quittée). */
  close(): void {
    this.stopFx();
    for (const fx of this.queue) fx.count = 0;
  }

  // --- lecture ------------------------------------------------------------------------------------------------------------

  private entry(n: number): SoundEntry | undefined {
    if (this.entries.has(n)) return this.entries.get(n);
    let entry: SoundEntry | undefined;
    try {
      const info = this.file!.sound(n);
      entry = makeEntry(this.file!.sample(n), info.rate, info.loop);
    } catch {
      entry = undefined; // PCM hors du fichier : ignoré (ScummVM lirait au-delà du tampon)
    }
    this.entries.set(n, entry);
    return entry;
  }

  /** Lance la voie à partir de la position `from` de l'échantillon. */
  private begin(chan: number, entry: SoundEntry, gain: number, from: number): void {
    const { sample, options } = continuation(entry, from, gain);
    const voice = this.options.output.play(sample, options);
    this.channels[chan] = { entry, gain, offset: from, startedAt: this.options.output.clockNow(), voice };
  }

  private stopChannel(chan: number): void {
    const state = this.channels[chan];
    state?.voice?.stop();
    this.channels[chan] = null;
  }

  private clear(state: ChannelState): void {
    const chan = this.channels.indexOf(state);
    if (chan >= 0) this.channels[chan] = null;
  }

  /** Position dans l'échantillon à l'instant `now` (ramenée dans la boucle). */
  private position(state: ChannelState, now: number): number {
    const elapsed = Math.round(((now - state.startedAt) * state.entry.rate) / 1000);
    return wrapPosition(state.entry, state.offset + elapsed);
  }
}

/** Position `u` d'une lecture « déroulée » ramenée dans le son : dans la boucle si elle existe, sinon bornée à la fin. */
function wrapPosition(entry: SoundEntry, u: number): number {
  const length = entry.data.length;
  if (u < length) return Math.max(0, u);
  if (entry.loopStart === undefined) return length;
  const loop = length - entry.loopStart;
  return entry.loopStart + ((u - entry.loopStart) % loop);
}

/** Échantillon et options à jouer pour reprendre le son à la position `from` (0 : le son entier). */
function continuation(entry: SoundEntry, from: number, gain: number): { sample: Sample; options: PlayOptions } {
  const { data, rate, loopStart } = entry;
  const options: PlayOptions = { volume: gain };
  if (from <= 0) {
    if (loopStart !== undefined) options.loopStart = loopStart;
    return { sample: { data, rate }, options };
  }
  if (loopStart === undefined || from < loopStart) {
    if (loopStart !== undefined) options.loopStart = loopStart - from;
    return { sample: { data: data.subarray(from), rate }, options };
  }
  // Dans la boucle : le reste de la boucle en cours, puis la boucle entière qui se répète.
  const tail = data.subarray(from);
  const loop = data.subarray(loopStart);
  const joined = new Float32Array(tail.length + loop.length);
  joined.set(tail, 0);
  joined.set(loop, tail.length);
  options.loopStart = tail.length;
  return { sample: { data: joined, rate }, options };
}

function makeEntry(pcm: Uint8Array, rate: number, loopBytes: number): SoundEntry {
  let data = u8ToFloat32(pcm);
  let loopStart = loopBytes > 0 ? Math.max(0, pcm.length - loopBytes) : undefined;
  let outRate = rate;
  if (rate < MIN_PLAY_RATE) {
    const length = Math.max(1, Math.round((data.length * RESAMPLED_RATE) / Math.max(1, rate)));
    const out = new Float32Array(data.length === 0 ? 0 : length);
    for (let i = 0; i < out.length; i++) out[i] = data[Math.min(data.length - 1, Math.floor((i * Math.max(1, rate)) / RESAMPLED_RATE))]!;
    if (loopStart !== undefined) loopStart = Math.min(out.length - 1, Math.round((loopStart * RESAMPLED_RATE) / Math.max(1, rate)));
    data = out;
    outRate = RESAMPLED_RATE;
  }
  if (loopStart !== undefined && (data.length === 0 || loopStart >= data.length)) loopStart = undefined;
  return { data, rate: outRate, loopStart };
}
