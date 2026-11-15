/**
 * Musique des puzzles : fichier `SX_<n>.HMI` (`src/audio/hmi.ts`) joué par le séquenceur MIDI commun (`MidiPlayer`, piloté par `tick`) sur le
 * synthétiseur General MIDI du site (`WebGmSynth`). `TrackPlayer` ne convient pas : c'est un lecteur de fichiers audio, pas de MIDI.
 *
 * - Boucle : celle du fichier (`FE 14` / `FE 15`, marqueurs posés par `parseHmi`) ; l'introduction d'un morceau dont la boucle ne commence pas
 *   au début n'est jouée qu'une fois. `SX_1022` (jingle) n'a pas de boucle : il se joue une fois.
 * - `play` : `PlaySound(music, 0, 1)` de l'original (41126d, drapeau 1) ; le morceau qui joue déjà continue. `restart` : arrêt puis
 *   relance, le morceau repart du début (fiche du puzzle, guitare).
 * - Voix du professeur : `silence` arrête la musique (424684 → 41177b(1000, 1)), `resume` la relance **du début** (424622, 423f9d, 425d6f).
 * - Arrêt net : le synthétiseur coupe toutes les voix, notes tenues comprises (`WebGmSynth.reset`). Ni fondu, ni baisse de volume.
 * - Le synthétiseur se charge en tâche de fond : un morceau demandé avant qu'il soit prêt démarre dès qu'il l'est.
 */
import { parseHmi, type HmiSong } from "../../../audio/hmi";
import { MidiPlayer } from "../../../engine/mohawk/audio/sequencer";
import type { MidiSink } from "../../../engine/mohawk/audio/sink";
import { isMusicNumber, musicFileName } from "./ids";

/** Ce que la musique demande au synthétiseur : `WebGmSynth` y répond tel quel. */
export interface GmPort extends MidiSink {
  readonly ready: boolean;
  /** Horloge audio (ms), celle des messages datés. */
  now(): number;
}

/** Fichiers `.HMI` : `ResourceIndex` y répond tel quel. */
export interface MusicResources {
  has(name: string): boolean;
  get(name: string): Uint8Array;
}

export class Tim3Music {
  private readonly player: MidiPlayer;
  private readonly songs = new Map<number, HmiSong | null>();
  private wanted = 0;
  /** Le morceau demandé partira au prochain `tick()` (synthétiseur pas encore prêt, ou reprise après la voix). */
  private pending = false;
  /** Musique coupée pendant la voix du professeur (41177b(1000, 1)) : rien ne joue, le morceau demandé est gardé. */
  private silent = false;

  constructor(
    private readonly resources: MusicResources,
    private readonly port: GmPort,
  ) {
    this.player = new MidiPlayer(port, { now: () => port.now() });
  }

  private song(music: number): HmiSong | null {
    if (this.songs.has(music)) return this.songs.get(music) ?? null;
    let song: HmiSong | null = null;
    const name = musicFileName(music);
    if (isMusicNumber(music) && this.resources.has(name)) {
      try {
        song = parseHmi(this.resources.get(name));
      } catch {
        song = null;
      }
    }
    this.songs.set(music, song);
    return song;
  }

  /** Numéro du morceau demandé (0 : aucun), qu'il joue ou non (`[0x481390]`). */
  get current(): number {
    return this.wanted;
  }

  /** Le morceau demandé joue (ou partira au prochain `tick()`). Faux pendant la voix et après la fin d'un morceau sans boucle. */
  get playing(): boolean {
    return this.wanted !== 0 && !this.silent && (this.player.playing || this.pending);
  }

  /** Coupée pendant la voix. */
  get silenced(): boolean {
    return this.silent;
  }

  /**
   * `PlaySound(music, 0, 1)` (41126d, drapeau 1) : lance `music` (1000 à 1023) sauf s'il joue déjà ; 0 ou un numéro inconnu arrête la
   * musique. Pendant la voix, le morceau est seulement retenu : il partira à la reprise.
   */
  play(music: number): void {
    if (music === this.wanted && this.playing) return;
    this.player.stop();
    this.pending = false;
    this.wanted = this.song(music) ? music : 0;
    if (this.wanted === 0 || this.silent) return;
    this.pending = true;
    this.begin();
  }

  /** Arrêt puis `PlaySound` (425edc … 425efa à l'ouverture de la fiche du puzzle ; guitare, drapeau 0) : le morceau repart du début. */
  restart(): void {
    const music = this.wanted;
    this.player.stop();
    this.pending = false;
    if (music !== 0) this.play(music);
  }

  /** Voix du professeur (424684 : 41177b(1000, 1)) : arrêt net, le morceau demandé est gardé. */
  silence(): void {
    this.silent = true;
    this.pending = false;
    this.player.stop();
  }

  /**
   * Fin de la voix (41177b(1000, 0) puis `PlaySound(music, 0, 1)` : 424622, 423f9d, 425d6f) : le morceau reprend **du début**, puisque la
   * voix l'a arrêté ; il continue s'il jouait encore. Le départ attend le prochain `tick()` : une voix qui en remplace une autre dans la même
   * image ne laisse pas filer de notes.
   */
  resume(): void {
    this.silent = false;
    if (this.wanted === 0 || this.player.playing || this.pending) return;
    this.pending = true;
  }

  private begin(): void {
    const song = this.song(this.wanted);
    if (!song || this.silent || !this.port.ready) return;
    this.pending = false;
    this.player.play(song, { loop: song.loop !== undefined });
  }

  /** Arrêt net ; plus aucun morceau demandé. */
  stop(): void {
    this.player.stop();
    this.wanted = 0;
    this.pending = false;
  }

  /** À appeler à chaque image : planifie les notes à venir et démarre un morceau en attente. */
  tick(): void {
    if (this.pending) this.begin();
    this.player.tick();
  }
}
