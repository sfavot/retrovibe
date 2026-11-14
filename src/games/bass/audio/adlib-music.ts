/**
 * Pilote musical AdLib de BASS : sections, morceaux, tempo et minuterie à 50 Hz.
 *
 * Références : ScummVM engines/sky/music/musicbase.cpp et musicbase.h (`MusicBase`), adlibmusic.cpp et adlibmusic.h (`AdLibMusic`), GPL v3 ou
 * ultérieure ; lu puis réécrit. `MusicBase` et `AdLibMusic` ne forment ici qu'une classe (un seul pilote AdLib).
 *
 * Écarts volontaires : pas de minuterie (`opl->start(onTimer, 50)`) : le moteur appelle `tick()` 50 fois par seconde de l'horloge audio, et les
 * écritures vont à un `OplSink` ; pas de pistes numériques (Music Enhancement Project : le chemin `_onNextPoll.stream`) ; pas de mutex (un seul
 * fil) ; les octets lus après la fin du fichier valent 0 (`TABLE_PADDING`) ; un morceau inexistant lève l'erreur dans `startMusic`, et non au tick suivant (`error()` de `loadNewMusic`).
 * Conservé : `stopMusic()` ne remet pas `_currentMusic` à zéro (le morceau ne redémarre pas) ; le jeu coupe la musique par `startMusic(0)`.
 */

import type { OplSink } from "../../../audio/opl-stream";
import { MusicFile } from "../data/music-file";
import { AdlibChannel } from "./adlib-channel";

/** Fichier de musique d'une section : `60202 + 4 * section`, fourni par l'appelant (voir `musicFile` de `data/ids.ts`). */
export type MusicFileLoader = (section: number) => Uint8Array;

/** Minuterie du pilote d'origine (`opl->start(onTimer, 50)`) ; c'est le `tickRate` par défaut de `WebOpl`. */
export const ADLIB_MUSIC_TICK_RATE = 50;
/** Volume maximal (le jeu donne 0 à 127 ; 127 au démarrage, `MusicBase::MusicBase`). */
export const MUSIC_VOLUME_MAX = 127;
/** Tempos initiaux d'une section, repris du fichier .idb d'origine (`loadSection`). */
export const INITIAL_TEMPO0 = 0x78;
export const INITIAL_TEMPO1 = 0xc0;
/** Valeur initiale de `_tempo` et `_aktTime` (`0x10001`). */
const INITIAL_TIME = 0x10001;
/** `0x4446390 / 23864` = 2999 (division entière, `updateTempo`). */
const TEMPO_DIVISOR = Math.trunc(0x4446390 / 23864);
const MAX_CHANNELS = 10;
/**
 * Octets lus comme des zéros après la fin du fichier : la table des instruments (128 numéros de note, jusqu'à 256 instruments de 16 octets)
 * dépasse la fin du fichier (jusqu'à 450 octets, section 6 par exemple) et le morceau 10 de la section 4 y lit l'instrument 127.
 * ScummVM lit alors le tas, au hasard ; ici des zéros (instrument muet).
 */
const TABLE_PADDING = 0x80 + 256 * 16;

function padded(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + TABLE_PADDING);
  out.set(data);
  return out;
}

/** État utile à une sauvegarde : la section et le morceau en cours (le jeu relance `loadSection` puis `startMusic`). */
export interface AdlibMusicState {
  readonly section: number;
  readonly song: number;
  readonly volume: number;
}

export class AdlibMusic {
  private file: MusicFile | null = null;
  private mirror = new Uint8Array(0);
  private channels: AdlibChannel[] = [];
  private currentSection = 0;
  private currentMusic = 0;
  private musicToProcess = 0;
  private musicVolume = MUSIC_VOLUME_MAX;
  private musicTempo0 = INITIAL_TEMPO0;
  private musicTempo1 = INITIAL_TEMPO1;
  private tempo = INITIAL_TIME;
  private aktTime = INITIAL_TIME;
  private nextTick = 0;

  constructor(
    private readonly sink: OplSink,
    private readonly loadFile: MusicFileLoader,
  ) {}

  /** Numéro du prochain tick (nombre de ticks déjà joués). */
  get tickNumber(): number {
    return this.nextTick;
  }

  /** `loadSection` : coupe le morceau en cours, charge le fichier de la section et envoie la séquence d'initialisation de l'OPL. */
  loadSection(section: number): void {
    if (this.currentMusic) this.stopMusicInternal();
    const file = new MusicFile(padded(this.loadFile(section)));
    this.file = file;
    // `_skyDisk->loadFile` rend un tampon neuf : le miroir (partagé par les canaux, écrit en place dans ScummVM) redémarre à l'état du fichier
    this.mirror = file.registerMirror.slice();
    this.currentSection = section;
    this.musicTempo0 = INITIAL_TEMPO0;
    this.musicTempo1 = INITIAL_TEMPO1;
    this.musicToProcess = 0;
    this.tempo = this.aktTime = INITIAL_TIME;
    this.currentMusic = 0;
    for (const [reg, value] of file.initSequence()) this.sink.write(reg, value);
  }

  /** `startMusic` : le morceau (`param & 0xF`, 0 = silence) démarre au prochain `tick()`. Relancer le morceau en cours ne le redémarre pas. */
  startMusic(param: number): void {
    const song = param & 0xf;
    if (!this.file) throw new Error("AdlibMusic : aucune section chargée");
    if (song > this.file.songCount) throw new RangeError(`AdlibMusic : morceau ${song} demandé, ${this.file.songCount} dans la section ${this.currentSection}`);
    this.musicToProcess = song;
  }

  /** `stopMusic` : coupe les notes et libère les canaux ; ne touche ni au morceau en cours ni à la demande en attente (voir l'en-tête). */
  stopMusic(): void {
    this.stopMusicInternal();
  }

  musicIsPlaying(): boolean {
    return this.channels.some((channel) => channel.isActive());
  }

  giveVolume(): number {
    return this.musicVolume;
  }

  /** Morceau en cours (`giveCurrentMusic`), 0 s'il n'y en a pas. */
  giveCurrentMusic(): number {
    return this.currentMusic;
  }

  get section(): number {
    return this.currentSection;
  }

  /** `setVolume` : de 0 à 127 ; le volume entre dans le calcul des niveaux de sortie des notes suivantes. */
  setVolume(volume: number): void {
    this.musicVolume = Math.min(MUSIC_VOLUME_MAX, Math.max(0, Math.trunc(volume)));
    for (const channel of this.channels) channel.updateVolume(this.musicVolume);
  }

  /** État pour une sauvegarde. */
  getState(): AdlibMusicState {
    return { section: this.currentSection, song: this.currentMusic, volume: this.musicVolume };
  }

  /** Restauration d'une sauvegarde : comme le jeu, recharge la section puis relance le morceau (il prend effet au prochain tick). */
  restoreState(state: AdlibMusicState): void {
    this.setVolume(state.volume);
    this.loadSection(state.section);
    this.startMusic(state.song);
  }

  /** Un tick de 50 Hz (`AdLibMusic::onTimer`) : ne fait rien tant qu'aucune section n'est chargée. */
  tick(): void {
    this.sink.beginTick?.(this.nextTick++);
    if (this.file) this.pollMusic();
  }

  private pollMusic(): void {
    if (this.musicToProcess !== this.currentMusic) this.loadNewMusic();
    this.aktTime = (this.aktTime + this.tempo) >>> 0;
    for (const channel of this.channels) {
      const newTempo = channel.process((this.aktTime >>> 16) & 0xffff);
      if (newTempo) {
        this.musicTempo1 = newTempo;
        this.updateTempo();
      }
    }
    this.aktTime &= 0xffff;
  }

  private loadNewMusic(): void {
    const file = this.file!;
    if (this.currentMusic !== 0) this.stopMusicInternal();
    this.currentMusic = this.musicToProcess;
    if (this.currentMusic === 0) return;
    const song = file.song(this.currentMusic);
    this.musicTempo0 = song.tempo0;
    this.musicTempo1 = song.tempo1;
    if (song.channelOffsets.length > MAX_CHANNELS) throw new RangeError(`AdlibMusic : ${song.channelOffsets.length} canaux, ${MAX_CHANNELS} au plus`);
    this.channels = song.channelOffsets.map((offset) => {
      const channel = new AdlibChannel(this.sink, file, this.mirror, offset);
      // « corrige le bogue de la musique d'introduction à plein volume » (`setupChannels`)
      channel.updateVolume(this.musicVolume);
      return channel;
    });
    this.updateTempo();
  }

  /** `tempo0 * tempo1 / 2999` en virgule fixe 16.16 : partie entière, puis fraction par division de `(reste << 16) | quotient`. */
  private updateTempo(): void {
    const tempoMul = (this.musicTempo0 * this.musicTempo1) & 0xffff;
    const quotient = Math.trunc(tempoMul / TEMPO_DIVISOR);
    const remainder = tempoMul % TEMPO_DIVISOR;
    this.tempo = ((quotient << 16) | Math.trunc(((remainder << 16) | quotient) / TEMPO_DIVISOR)) >>> 0;
  }

  /** `stopMusicInternal` : le destructeur de chaque canal coupe sa note, dans l'ordre des canaux. */
  private stopMusicInternal(): void {
    for (const channel of this.channels) channel.dispose();
    this.channels = [];
  }
}
