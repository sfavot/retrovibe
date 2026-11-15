/**
 * Musique des puzzles : fichier `SX_<n>.HMI` (`src/audio/hmi.ts`) joué par le séquenceur MIDI commun (`MidiPlayer`, piloté par `tick`) sur le
 * synthétiseur General MIDI du site (`WebGmSynth`). `TrackPlayer` ne convient pas : c'est un lecteur de fichiers audio, pas de MIDI.
 *
 * - Boucle : celle du fichier (`FE 14` / `FE 15`, marqueurs posés par `parseHmi`) ; l'introduction d'un morceau dont la boucle ne commence pas
 *   au début n'est jouée qu'une fois. `SX_1022` (jingle) n'a pas de boucle : il se joue une fois.
 * - Même morceau redemandé pendant qu'il joue : rien (`449c10` ne relance pas le morceau courant).
 * - Arrêt net : le synthétiseur coupe toutes les voix, notes tenues comprises (`WebGmSynth.reset`).
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
  private started = false;

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

  /** Numéro du morceau demandé (0 : aucun). */
  get current(): number {
    return this.wanted;
  }

  /** Le morceau demandé joue (ou jouera dès que le synthétiseur est prêt). */
  get playing(): boolean {
    return this.wanted !== 0 && (this.player.playing || !this.started);
  }

  /** Lance le morceau `music` (1000 à 1023) ; 0 ou un numéro inconnu arrête la musique. Le morceau déjà en cours n'est pas relancé. */
  play(music: number): void {
    if (music === this.wanted && this.playing) return;
    this.stop();
    if (!this.song(music)) return;
    this.wanted = music;
    this.begin();
  }

  private begin(): void {
    const song = this.song(this.wanted);
    if (!song || !this.port.ready) return;
    this.started = true;
    this.player.play(song, { loop: song.loop !== undefined });
  }

  /** Arrêt net. */
  stop(): void {
    this.player.stop();
    this.wanted = 0;
    this.started = false;
  }

  /** À appeler à chaque image : planifie les notes à venir et démarre un morceau attendu par le synthétiseur. */
  tick(): void {
    if (this.wanted !== 0 && !this.started) this.begin();
    this.player.tick();
  }
}
