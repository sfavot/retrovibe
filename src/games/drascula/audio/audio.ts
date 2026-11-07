import { TrackPlayer } from "../../../audio/track-player";
import { WebSampleOutput } from "../../../audio/web-sample-output";
import type { HostStorage } from "../../../engine/storage";
import { SoundPrefs, type Muteable } from "../../../ui/sound-prefs";
import { DrasculaMusic } from "./music";
import { SoundChannel, type SoundFiles } from "./voice";

/**
 * Son de *Drascula* côté hôte : voix et effets `.ALS` (une voie, `voice.ts`), musique par pièce (`music.ts`), coupure et pause.
 * L'hôte du navigateur délègue ses six méthodes de son (`playSound`, `stopSound`, `soundActive`, `playMusic`, `stopMusic`,
 * `musicPlaying`) à `DrasculaAudio`, appelle `unlock()` au premier geste et `suspend()` / `resume()` quand l'onglet est masqué
 * (comme Lost in Time et Armaeth), et branche la préférence « Son » avec `createSoundPrefs`.
 *
 * La coupure (« Son ») ne change ni la durée des sons ni la position des pistes : le moteur attend les voix comme avant.
 */

export interface DrasculaAudioOptions {
  /** Millisecondes monotones de l'hôte (`host.now()`). */
  now(): number;
  files: SoundFiles;
  /** URL d'un fichier de musique (`track7.mp3`). */
  trackUrl(file: string): string;
  /** Points d'injection des tests. */
  createContext?: () => AudioContext;
  createAudio?: () => HTMLAudioElement;
}

export class DrasculaAudio implements Muteable {
  private readonly output: WebSampleOutput;
  private readonly sound: SoundChannel;
  private readonly music: DrasculaMusic;

  constructor(options: DrasculaAudioOptions) {
    this.output = new WebSampleOutput({ now: options.now, createContext: options.createContext });
    this.sound = new SoundChannel(this.output, options.files);
    this.music = new DrasculaMusic(new TrackPlayer(options.createAudio), options.trackUrl);
  }

  playSound(name: string): boolean {
    return this.sound.play(name);
  }

  stopSound(): void {
    this.sound.stop();
  }

  soundActive(): boolean {
    return this.sound.active;
  }

  playMusic(track: number): void {
    this.music.play(track);
  }

  stopMusic(): void {
    this.music.stop();
  }

  musicPlaying(): boolean {
    return this.music.playing;
  }

  /** Volume de la musique de 0 à 1 (`setMusicVolume` de l'hôte : fondu de fin de chapitre et des cinématiques). */
  setMusicVolume(level: number): void {
    this.music.volume = level;
  }

  /** Piste demandée (0 si aucune). */
  get musicTrack(): number {
    return this.music.track;
  }

  /** À appeler dans un geste de l'utilisateur. */
  unlock(): void {
    this.output.unlock();
    this.music.unlock();
  }

  suspend(): void {
    this.output.suspend();
    this.music.suspend();
  }

  resume(): void {
    this.output.resume();
    this.music.resume();
  }

  setMuted(muted: boolean): void {
    this.output.setMuted(muted);
    this.music.muted = muted;
  }

  /** Page quittée. */
  close(): void {
    this.sound.stop();
    this.music.stop();
    this.output.close();
  }
}

/** Préférence « Son » commune (`retrovibe:drascula:sound`), appliquée à `audio` dès la création. */
export function createSoundPrefs(storage: HostStorage, audio: Muteable): SoundPrefs {
  return new SoundPrefs(storage, audio, "drascula");
}
