import type { OplSink } from "../../../audio/opl-stream";
import { parseSong, type Song } from "../../../audio/smf";
import type { SongBank } from "../data/music";
import { QueenAdLibDriver } from "./adlib-driver";
import { JUNGLE_LIST, TUNES } from "./tables";

/**
 * Musique AdLib de *Flight of the Amazon Queen* : file de morceaux, listes de morceaux, boucles et séquenceur. Réécriture de
 * `MidiMusic` (`engines/queen/music.cpp`, ScummVM, GPL v3 ou ultérieure, **lu en entier**) pour la voie AdLib, avec le
 * séquenceur MIDI de ScummVM (`MidiParser`, lu pour son rythme) remplacé par l'analyseur SMF commun (`src/audio/smf.ts`).
 *
 * Rythme (lu) : le pilote AdLib demande une horloge à 250 Hz (`getBaseTempo` = 1 000 000 / `kDefaultCallbackFrequency`), soit
 * un « tick » de 4 ms ; à chaque tick, les événements dont la date est échue sont envoyés. Chaque tick porte un numéro
 * (`beginTick`) pour que `OplStream` (worklet) place les écritures à l'échantillon près : le moteur n'a pas à être régulier.
 *
 * Reprises de ScummVM, bizarreries comprises (à confirmer à l'écoute contre ScummVM) :
 * - la file de 14 places ; le numéro 0 y marque une place libre, donc le morceau d'indice 0 ne peut pas être joué ;
 * - listes de morceaux : mode 0 tirage au hasard, 1 séquentiel en boucle, 2 une fois ; la liste 3 (jungle) est remplacée par
 *   `JUNGLE_LIST` tirée au hasard ; une valeur 1001 à 1999 enchaîne une autre liste, 2000 reprend le morceau d'avant ;
 * - les morceaux d'indice >= au nombre de morceaux (176 en fin de course de voiture) sont ignorés : silence ;
 * - `toggleVChange` : les morceaux « Vnormal / Vmedium / Vsoft » divisent puis multiplient par deux le volume général.
 *
 * Écarts :
 * - `MidiParser` arrondit le tempo en microsecondes par tick, l'analyseur SMF le calcule exactement : écart de moins d'un tick
 *   d'événement sur un morceau entier ;
 * - le hasard est injectable (`random`) pour les tests ;
 * - un numéro de morceau négatif (liste « Waterfall Off ») n'est pas mis en file, là où ScummVM y lit hors de ses tables.
 */

/** Horloge du séquenceur : 250 Hz. */
export const QUEEN_TICK_RATE = 250;
export const QUEEN_TICK_MS = 1000 / QUEEN_TICK_RATE;

/** `MUSIC_QUEUE_SIZE`. */
const QUEUE_SIZE = 14;
/** Volume général au départ (`_masterVolume`). */
const DEFAULT_VOLUME = 192;
/** Au-delà de ce retard (ms), `advance` oublie le surplus au lieu de rattraper (onglet resté en arrière-plan). */
const MAX_CATCH_UP_MS = 1000;

export interface QueenMusicOptions {
  bank: SongBank;
  sink: OplSink;
  /** Entier aléatoire dans [0, max] (`getRandomNumber`). Par défaut `Math.random`. */
  random?: (max: number) => number;
}

export class QueenMusic {
  private readonly driver: QueenAdLibDriver;
  private readonly sink: OplSink;
  private readonly bank: SongBank;
  private readonly random: (max: number) => number;
  private readonly parsed = new Map<number, Song>();

  private readonly queue = new Array<number>(QUEUE_SIZE).fill(0);
  private queuePos = 0;
  private lastSong = 0;
  private currentSong = 0;
  private looping = false;
  private randomLoop = false;
  private masterVolume = DEFAULT_VOLUME;
  private volumeToggle = false;

  private song: Song | null = null;
  private cursor = 0;
  /** Temps écoulé dans le morceau (ms), multiple de `QUEEN_TICK_MS`. */
  private songTime = 0;
  private playing = false;
  /** Notes tenues (`canal << 8 | note`), coupées à l'arrêt comme `MidiParser::allNotesOff`. */
  private readonly active = new Set<number>();
  private timerTicks = 0;
  private remainder = 0;
  /** Un morceau a été chargé pendant l'envoi des événements : le tick courant s'arrête là. */
  private reloaded = false;

  constructor(options: QueenMusicOptions) {
    this.bank = options.bank;
    this.sink = options.sink;
    this.random = options.random ?? ((max) => Math.floor(Math.random() * (max + 1)));
    this.driver = new QueenAdLibDriver(options.sink);
    this.sink.beginTick?.(0);
    this.driver.open();
  }

  /** Nombre de morceaux de `AQBANK.MUS`. */
  get songCount(): number {
    return this.bank.songs.length;
  }

  /** Un morceau est en cours de lecture. */
  get isPlaying(): boolean {
    return this.playing;
  }

  /** Indice (à partir de 0) du morceau en cours ou du dernier joué. */
  get currentSongIndex(): number {
    return this.currentSong;
  }

  get volume(): number {
    return this.masterVolume;
  }

  /** Volume général 0 à 255 (`MidiMusic::setVolume`). */
  setVolume(volume: number): void {
    volume = Math.min(255, Math.max(0, volume));
    if (this.masterVolume === volume) return;
    this.masterVolume = volume;
    this.driver.setVolume(volume);
  }

  /** `toggleVChange` : un morceau « volume » (Vnormal, Vmedium, Vsoft) change le volume, une fois sur deux en le divisant par deux. */
  toggleVChange(): void {
    this.setVolume(this.volumeToggle ? this.masterVolume * 2 : Math.trunc(this.masterVolume / 2));
    this.volumeToggle = !this.volumeToggle;
  }

  // --- file ------------------------------------------------------------------------------------------------------------

  /** `queueClear` : vide la file et retient son premier morceau (pour le « 2000 » : reprendre le morceau d'avant). */
  private queueClear(): void {
    this.lastSong = this.queue[0];
    this.queuePos = 0;
    this.looping = this.randomLoop = false;
    this.queue.fill(0);
  }

  /** `queueSong` : `songNum` est un indice à partir de 0, ou une valeur spéciale (>= 1000). */
  private queueSong(songNum: number): boolean {
    if (songNum < 0) return false;
    if (songNum >= this.songCount && songNum < 1000) return false;
    let empty = 0;
    for (const value of this.queue) if (!value) empty++;
    if (empty === 0) return false;
    this.queue[QUEUE_SIZE - empty] = songNum;
    return true;
  }

  private randomQueuePos(): number {
    let size = 0;
    for (const value of this.queue) if (value) size++;
    return size === 0 ? 0 : this.random(size - 1) & 0xff;
  }

  /** `queueTuneList` : charge la liste de morceaux `tuneList` (indice à partir de 0) de `TUNES` dans la file. */
  queueTuneList(tuneList: number): void {
    this.queueClear();
    // La jungle est la seule à avoir plusieurs listes ; ScummVM la code en dur.
    if (tuneList + 1 === 3) {
      this.randomLoop = true;
      for (const num of JUNGLE_LIST) this.queueSong(num - 1);
      return;
    }
    const tune = TUNES[tuneList];
    if (!tune) return;
    switch (tune.mode) {
      case 0:
        this.randomLoop = true;
        this.looping = false;
        break;
      case 1:
        // La file est encore vide ici : la boucle est donc toujours active (comme dans ScummVM).
        this.looping = this.queue[1] === 0;
        break;
      default:
        this.looping = false;
    }
    for (const num of tune.songs) this.queueSong(num - 1);
    if (this.randomLoop) this.queuePos = this.randomQueuePos();
  }

  /** Met un seul morceau (indice à partir de 0) en file et le joue (`MidiMusic::playSong`). */
  playSong(songNum: number): void {
    this.queueClear();
    this.queueSong(songNum);
    this.playMusic();
  }

  // --- lecture ---------------------------------------------------------------------------------------------------------

  private songOf(index: number): Song {
    let song = this.parsed.get(index);
    if (!song) {
      song = parseSong(this.bank.songs[index].smf);
      this.parsed.set(index, song);
    }
    return song;
  }

  /** `playMusic` : joue le morceau de la file à `queuePos`, en suivant les valeurs spéciales (autre liste, reprise). */
  playMusic(): void {
    if (!this.queue[0]) return;
    let songNum = this.queue[this.queuePos];
    if (songNum > 999) {
      if (songNum + 1 === 2000) {
        songNum = this.lastSong;
        this.queueClear();
        this.queueSong(songNum);
      } else {
        this.queueTuneList(songNum - 1000);
        this.queuePos = this.randomLoop ? this.randomQueuePos() : 0;
        songNum = this.queue[this.queuePos];
      }
    }
    this.currentSong = songNum;
    if (!songNum) {
      this.stopMusic();
      return;
    }
    this.stopMusic();
    this.song = this.songOf(songNum);
    this.cursor = 0;
    this.songTime = 0;
    this.playing = true;
    this.reloaded = true;
    this.queueUpdatePos();
  }

  private queueUpdatePos(): void {
    if (this.randomLoop) {
      this.queuePos = this.randomQueuePos();
    } else if (this.queuePos < QUEUE_SIZE - 1 && this.queue[this.queuePos + 1]) {
      this.queuePos++;
    } else if (this.looping) {
      this.queuePos = 0;
    }
  }

  /** `stopMusic` : arrête le morceau, coupe les notes tenues. La file est gardée. */
  stopMusic(): void {
    this.playing = false;
    this.song = null;
    for (const key of this.active) this.driver.send(0x80 | (key >> 8), key & 0xff, 0);
    this.active.clear();
  }

  stopSong(): void {
    this.stopMusic();
  }

  // --- horloge ---------------------------------------------------------------------------------------------------------

  /** Numéro du dernier tick (celui de `beginTick`). */
  get tickCount(): number {
    return this.timerTicks;
  }

  /** Avance de `ms` millisecondes de temps réel (tronqué à `MAX_CATCH_UP_MS`) : autant de ticks de 4 ms que possible. */
  advance(ms: number): void {
    this.remainder += Math.min(MAX_CATCH_UP_MS, Math.max(0, ms));
    while (this.remainder >= QUEEN_TICK_MS) {
      this.remainder -= QUEEN_TICK_MS;
      this.tick();
    }
  }

  /** Un tick du séquenceur (`MidiMusic::onTimer`). */
  tick(): void {
    this.timerTicks++;
    this.sink.beginTick?.(this.timerTicks);
    if (!this.playing || !this.song) return;
    this.songTime += QUEEN_TICK_MS;
    this.reloaded = false;
    const events = this.song.events;
    while (this.playing && !this.reloaded && this.song) {
      const event = events[this.cursor];
      if (!event || event.ms > this.songTime) break;
      this.cursor++;
      switch (event.kind) {
        case "midi":
          this.dispatch(event.bytes);
          break;
        case "sequencerSpecific":
          this.driver.metaEvent(event.data);
          break;
        case "end":
          this.endOfTrack();
          break;
        default:
          break;
      }
    }
  }

  private dispatch(bytes: Uint8Array): void {
    const status = bytes[0];
    const note = bytes[1] ?? 0;
    const velocity = bytes[2] ?? 0;
    const type = status & 0xf0;
    if (type === 0x90 && velocity > 0) this.active.add(((status & 15) << 8) | note);
    else if (type === 0x80 || type === 0x90) this.active.delete(((status & 15) << 8) | note);
    this.driver.send(status, note, velocity);
  }

  /** Fin de piste (`FF 2F`) : notes coupées, puis morceau suivant de la file ou arrêt. */
  private endOfTrack(): void {
    this.stopMusic();
    if (this.looping || this.queue[1]) this.playMusic();
  }
}
