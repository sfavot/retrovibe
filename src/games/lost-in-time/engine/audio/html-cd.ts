import { TrackPlayer } from "../../../../audio/track-player";
import type { CdBackend } from "./backend";
import type { Mutable } from "./prefs";

/**
 * Piste CD de Lost in Time : un seul fichier (MUSIC.mp3, 36 Mo) lu en flux par le lecteur partagé,
 * de `startSec` à `endSec` (arrêt automatique en fin de plage).
 */
export class HtmlCdBackend implements CdBackend, Mutable {
  private readonly player = new TrackPlayer();

  constructor(private readonly url: string) {
    this.player.preload(url);
  }

  get muted(): boolean {
    return this.player.muted;
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

  play(startSec: number, endSec: number): void {
    this.player.play(this.url, { start: startSec, end: endSec });
  }

  stop(): void {
    this.player.stop();
  }

  get playing(): boolean {
    return this.player.playing;
  }

  get currentTime(): number {
    return this.player.currentTime;
  }
}
