import type { OplSink } from "../../../audio/opl-stream";
import type { Muteable } from "../../../ui/sound-prefs";
import { SoundManager, type LureSoundOptions } from "./sound";

/**
 * Son de *Lure of the Temptress* côté hôte : le `SoundManager` (`sound.ts`, pilote AdLib multi-sources) branché sur la sortie OPL2 commune
 * (`src/audio/web-opl.ts`, AudioWorklet à 250 ticks par seconde). Même rôle que `FotaqAudio` ; voir `docs/lure/audio.md`.
 *
 * - **Le temps du jeu ne dépend pas du son.** Un son est « en cours » pendant sa durée sur l'horloge de l'hôte, que le contexte audio existe,
 *   soit bloqué (autoplay) ou que le son soit coupé : la coupure ne fait que passer le gain général à 0, l'émulation continue au même rythme.
 * - L'hôte appelle `update()` une fois par image d'écran (les écritures OPL sont datées par tick de 4 ms, la régularité de l'appel n'a pas
 *   d'importance), `unlock()` au premier geste, `suspend()` / `resume()` quand l'onglet est masqué.
 * - Le moteur du jeu ne voit que `sound` (`LureSound`).
 */

/** Sortie de la musique : une `OplSink` qu'on peut couper, régler et libérer (`WebOpl`, ou un enregistreur de test). */
export interface MusicOutput extends OplSink, Muteable {
  unlock(): void;
  suspend(): void;
  resume(): void;
  close(): void;
  setVolume(level: number): void;
}

export interface LureAudioOptions extends Omit<LureSoundOptions, "sink"> {
  /** Millisecondes monotones de l'hôte (`host.now()`). */
  now(): number;
  music: MusicOutput;
}

export class LureAudio implements Muteable {
  readonly sound: SoundManager;
  private lastUpdate: number;
  private suspended = false;
  private volumeLevel = 1;

  constructor(private readonly options: LureAudioOptions) {
    this.sound = new SoundManager({ ...options, sink: options.music });
    this.lastUpdate = options.now();
  }

  /** Volume de la musique et des bruitages, de 0 à 1. */
  get volume(): number {
    return this.volumeLevel;
  }
  set volume(level: number) {
    this.volumeLevel = Math.min(1, Math.max(0, level));
    this.options.music.setVolume(this.volumeLevel);
  }

  /** Fait avancer le son au rythme de l'horloge de l'hôte : à appeler une fois par image d'écran. */
  update(): void {
    const now = this.options.now();
    if (!this.suspended) this.sound.advance(now - this.lastUpdate);
    this.lastUpdate = now;
  }

  /** À appeler dans un geste de l'utilisateur. */
  unlock(): void {
    this.options.music.unlock();
  }

  suspend(): void {
    this.update();
    this.suspended = true;
    this.options.music.suspend();
  }

  resume(): void {
    this.suspended = false;
    this.lastUpdate = this.options.now();
    this.options.music.resume();
  }

  setMuted(muted: boolean): void {
    this.options.music.setMuted(muted);
  }

  /** Page quittée. */
  close(): void {
    this.sound.killSounds();
    this.options.music.close();
  }
}
