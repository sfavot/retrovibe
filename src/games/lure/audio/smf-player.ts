/**
 * Lecteur de fichiers MIDI standard (SMF) à plusieurs sources, cadencé par une horloge de 250 Hz : chaque morceau est joué sur une source
 * du pilote (la musique sur la source 0, les bruitages sur les sources 1 à 9), avec boucle, arrêt et pause.
 *
 * Source : `MidiParser::onTimer`, `processEvent`, `jumpToTick`, `allNotesOff`, `pausePlaying` (`audio/midiparser.cpp`) et `MidiMusic`
 * (`engines/lure/sound.cpp`), ScummVM, GPL v3 ou ultérieure, lus puis réécrits. Les fichiers sont déjà analysés par `src/audio/smf.ts`.
 *
 * Rythme (repris à l'identique) : la minuterie du pilote tourne à 250 Hz, soit 4 000 µs par appel ; à chaque appel, les événements dont la
 * date est échue (`<=` la fin de l'intervalle) sont envoyés. Une date vaut la date de l'événement précédent plus l'écart en ticks fois les
 * microsecondes par tick, que `setTempo` arrondit : `(tempo + (ticks par noire >> 2)) / ticks par noire`, entier. Le tempo de départ est de
 * 500 000 µs par noire ; un événement de tempo du fichier le change pour la suite.
 *
 * Boucle (`mpAutoLoop`) : à la fin de piste, les notes encore tenues sont coupées (`allNotesOff` : un Note Off par note tenue, notes puis canaux
 * croissants) puis la lecture repart du tick 0 **à l'appel de minuterie suivant** (le reste de l'intervalle est perdu) ; le tempo courant est
 * gardé (les événements du début le rechangent s'il y a lieu) et la source garde ses instruments. Sans boucle, la fin de piste rend la source
 * au pilote (`deinitSource`) et le lecteur s'arrête, sans Note Off du lecteur (le pilote coupe les voix de la source).
 *
 * Écarts : les SysEx et méta-événements texte ne sont pas transmis au pilote (aucun ne l'est dans les données du jeu, et le pilote ignore
 * les seconds) ; la pause est celle de `pausePlaying` (les notes sont coupées et ne reprennent pas) ; pas de point de boucle intérieur.
 */
import type { Song, SongEvent } from "../../../audio/smf";
import { META_END_OF_TRACK, META_SEQUENCER, TIMER_PERIOD_US, TIMER_RATE } from "./adlib-multisource";

export { TIMER_PERIOD_US, TIMER_RATE };
/** Tempo avant tout événement de tempo : 120 battements par minute. */
const DEFAULT_TEMPO = 500_000;

/** Ce que le lecteur demande au pilote (`MidiDriver_Multisource`). */
export interface MidiTarget {
  send(source: number, status: number, data1: number, data2: number): void;
  metaEvent(source: number, type: number, data: Uint8Array): void;
  deinitSource(source: number): void;
}

/** Lecture d'un morceau sur une source (`MidiMusic` et son `MidiParser`). */
export class SmfPlayback {
  /** Le morceau joue encore (`MidiMusic::isPlaying`) : faux après la fin de piste ou l'arrêt. */
  playing = true;
  private tracking = true;
  private paused = false;
  private cursor = 0;
  private playTime = 0;
  private lastEventTime = 0;
  private lastEventTick = 0;
  private microsPerTick: number;
  private readonly events: readonly SongEvent[];
  private readonly division: number;
  /** Notes tenues par note MIDI : un bit par canal (`_activeNotes`). */
  private readonly held = new Uint16Array(128);

  constructor(
    song: Song,
    readonly source: number,
    private readonly loop: boolean,
    private readonly target: MidiTarget,
  ) {
    this.division = song.division;
    this.events = song.events.filter((e) => e.kind === "midi" || e.kind === "tempo" || e.kind === "sequencerSpecific" || e.kind === "end");
    this.microsPerTick = this.ticksToMicros(DEFAULT_TEMPO);
  }

  private ticksToMicros(tempo: number): number {
    return Math.trunc((tempo + (this.division >> 2)) / this.division);
  }

  /** Un appel de la minuterie de 250 Hz (`MidiParser::onTimer`). */
  onTimer(): void {
    if (!this.tracking || this.paused) return;
    const endTime = this.playTime + TIMER_PERIOD_US;
    for (;;) {
      const event = this.events[this.cursor];
      if (!event) {
        // Fichier sans fin de piste (`parseSong` en ajoute une, jamais atteint) : comme une fin de piste.
        this.endOfTrack();
        return;
      }
      const eventTime = this.lastEventTime + (event.tick - this.lastEventTick) * this.microsPerTick;
      if (eventTime > endTime) break;

      switch (event.kind) {
        case "midi":
          this.sendMidi(event.bytes);
          break;
        case "tempo":
          this.microsPerTick = this.ticksToMicros(event.microsPerQuarter);
          break;
        case "sequencerSpecific":
          this.target.metaEvent(this.source, META_SEQUENCER, event.data);
          break;
        case "end":
          this.endOfTrack();
          return;
        default:
          break;
      }
      this.playTime = eventTime;
      this.lastEventTime = eventTime;
      this.lastEventTick = event.tick;
      this.cursor++;
    }
    this.playTime = endTime;
  }

  private sendMidi(bytes: Uint8Array): void {
    let status = bytes[0]!;
    if (status >= 0xf0) return;
    const command = status & 0xf0;
    const channel = status & 0x0f;
    const data1 = bytes[1] ?? 0;
    const data2 = bytes[2] ?? 0;
    // Un Note On de vélocité 0 est un Note Off (`parseNextEvent`).
    if (command === 0x90 && data2 === 0) status = 0x80 | channel;
    if ((status & 0xf0) === 0x80) this.hold(channel, data1, false);
    else if (command === 0x90) this.hold(channel, data1, true);
    this.target.send(this.source, status, data1, data2);
  }

  private hold(channel: number, note: number, on: boolean): void {
    if (on) this.held[note] = this.held[note]! | (1 << channel);
    else this.held[note] = this.held[note]! & ~(1 << channel);
  }

  /** Un Note Off pour chaque note tenue : notes croissantes puis canaux croissants (`allNotesOff`, sans « All Notes Off » au pilote). */
  private allNotesOff(): void {
    for (let note = 0; note < 128; note++) {
      for (let channel = 0; channel < 16; channel++) {
        if (this.held[note]! & (1 << channel)) this.target.send(this.source, 0x80 | channel, note, 0);
      }
    }
    this.held.fill(0);
  }

  private endOfTrack(): void {
    if (this.loop) {
      // `jumpToTick(0)` : notes coupées, lecture rembobinée, le reste de l'intervalle de minuterie est perdu.
      this.allNotesOff();
      this.cursor = 0;
      this.playTime = 0;
      this.lastEventTime = 0;
      this.lastEventTick = 0;
      return;
    }
    // `stopPlaying` sans note à couper (le lecteur ne suit plus rien) puis `MidiMusic::metaEvent` : arrêt et rendu de la source.
    this.tracking = false;
    this.playing = false;
    this.target.deinitSource(this.source);
    this.target.metaEvent(this.source, META_END_OF_TRACK, new Uint8Array(0));
  }

  /** Décharge le fichier : notes tenues coupées si la lecture suivait encore (`unloadMusic`). */
  private unload(): void {
    if (this.tracking) this.allNotesOff();
    this.tracking = false;
  }

  /** `MidiMusic::stopMusic` : arrêt, notes coupées, source rendue au pilote. */
  stop(): void {
    this.playing = false;
    this.unload();
    this.target.deinitSource(this.source);
  }

  /** Destructeur de `MidiMusic` (le son est retiré de la liste) : notes coupées ; la source est rendue si le morceau jouait encore. */
  dispose(): void {
    this.unload();
    if (this.playing) {
      this.playing = false;
      this.target.deinitSource(this.source);
    }
  }

  /** `pausePlaying` : les notes sont coupées et le temps du morceau s'arrête. */
  pause(): void {
    if (this.tracking && !this.paused) {
      this.paused = true;
      this.allNotesOff();
    }
  }

  resume(): void {
    this.paused = false;
  }
}

/**
 * Les morceaux en cours, joués dans l'ordre où ils ont été lancés à chaque appel de minuterie. Plusieurs morceaux peuvent partager une
 * source (le jeu ne l'empêche pas pour la musique) : ils sont alors indépendants et jouent tous sur ses voix.
 */
export class SmfPlayer {
  private readonly playbacks: SmfPlayback[] = [];

  constructor(private readonly target: MidiTarget) {}

  /** Lance un morceau sur une source (0 : musique, 1 à 9 : bruitages). */
  start(song: Song, source: number, loop: boolean): SmfPlayback {
    const playback = new SmfPlayback(song, source, loop, this.target);
    this.playbacks.push(playback);
    return playback;
  }

  /** Retire un morceau (`~MidiMusic`). */
  remove(playback: SmfPlayback): void {
    const index = this.playbacks.indexOf(playback);
    if (index >= 0) this.playbacks.splice(index, 1);
    playback.dispose();
  }

  /** Un appel de la minuterie pour chaque morceau qui joue. */
  tick(): void {
    for (const playback of [...this.playbacks]) if (playback.playing) playback.onTimer();
  }

  pause(): void {
    for (const playback of this.playbacks) playback.pause();
  }

  resume(): void {
    for (const playback of this.playbacks) playback.resume();
  }

  get list(): readonly SmfPlayback[] {
    return this.playbacks;
  }
}
