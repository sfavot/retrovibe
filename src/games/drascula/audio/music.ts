import type { TrackPlayer } from "../../../audio/track-player";

/**
 * Musique de fond. Reprend `playMusic`, `stopMusic` et `musicStatus` (engines/drascula/sound.cpp, ScummVM) : la piste `p` du
 * `.ALD` est la piste CD `p - 1` de ScummVM, que son gestionnaire de CD associe au fichier `track<p>` (voir `formats.md`,
 * « supposé »). Les pistes sont les `track1.mp3` à `track31.mp3` produits par `scripts/drascula-music.sh`.
 *
 * Une piste est jouée une fois, en entier ; la boucle principale la relance quand `playing` redevient faux (`loop.ts`).
 * Écarts : `playing` est l'état *demandé* (vrai dès `play`, faux à la fin de la piste ou à `stop`), non l'état réel du flux :
 * un flux bloqué par l'autoplay ou en cours de chargement ne fait pas relancer la piste à chaque image, et il démarre au
 * premier geste (`unlock`). Fondu (`MusicFadeout`, fin de chapitre et cinématiques) : le moteur baisse le volume pas à pas
 * (`volume`, évolution E2 de `TrackPlayer`) puis arrête la piste et remet le volume.
 */

export const FIRST_TRACK = 1;
export const LAST_TRACK = 31;

/** Fichier de la piste `track` (`track7.mp3`). */
export function trackFile(track: number): string {
  return `track${track}.mp3`;
}

export function isTrack(track: number): boolean {
  return Number.isInteger(track) && track >= FIRST_TRACK && track <= LAST_TRACK;
}

export class DrasculaMusic {
  private requested = false;
  private current = 0;

  /** `trackUrl` : URL d'un fichier de piste (`track7.mp3`). */
  constructor(
    private readonly player: TrackPlayer,
    private readonly trackUrl: (file: string) => string,
  ) {
    player.onEnded = () => {
      this.requested = false;
    };
  }

  /** Joue la piste `track` depuis le début, en remplaçant celle en cours ; une piste inconnue arrête la musique. */
  play(track: number): void {
    this.stop();
    if (!isTrack(track)) return;
    this.current = track;
    this.requested = true;
    this.player.play(this.trackUrl(trackFile(track)));
  }

  stop(): void {
    this.requested = false;
    this.current = 0;
    this.player.stop();
  }

  get playing(): boolean {
    return this.requested;
  }

  /** Piste demandée (0 si aucune). */
  get track(): number {
    return this.requested ? this.current : 0;
  }

  /** Volume de la musique, 0 à 1 (fondu du moteur). */
  get volume(): number {
    return this.player.volume;
  }

  set volume(value: number) {
    this.player.volume = value;
  }

  set muted(value: boolean) {
    this.player.muted = value;
  }

  unlock(): void {
    this.player.unlock();
  }

  suspend(): void {
    this.player.suspend();
  }

  resume(): void {
    this.player.resume();
  }
}
