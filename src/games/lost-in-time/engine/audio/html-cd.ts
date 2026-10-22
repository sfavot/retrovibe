import type { CdBackend } from "./backend";
import type { Mutable } from "./prefs";

/** Intervalle de surveillance de la fin de plage (ms) ; `timeupdate` est trop lent (≈ 250 ms). */
const WATCH_MS = 40;

/**
 * Piste CD lue en flux par un HTMLAudioElement (le fichier de 48 Mo n'est jamais décodé en entier) :
 * la lecture démarre par un saut `currentTime` et s'arrête à la fin de la plage.
 */
export class HtmlCdBackend implements CdBackend, Mutable {
  private readonly audio: HTMLAudioElement;
  private endSec = 0;
  private startSec = 0;
  private active = false;
  /** Pause de l'interface (onglet masqué) : la lecture reprend à la même position au retour. */
  private suspended = false;
  private playingWhenSuspended = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(url: string) {
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.src = url;
  }

  /** Coupé : l'élément continue de lire en silence, la position avance comme d'habitude. */
  get muted(): boolean {
    return this.audio.muted;
  }

  set muted(value: boolean) {
    this.audio.muted = value;
  }

  /** À rappeler après une interaction : relance une lecture bloquée par la politique d'autoplay. */
  unlock(): void {
    if (!this.suspended && this.active && this.audio.paused) void this.audio.play().catch(() => {});
  }

  /** Met la lecture en pause sans la terminer : `playing` garde sa valeur, le moteur ne voit pas de fin de plage. */
  suspend(): void {
    if (this.suspended) return;
    this.playingWhenSuspended = this.playing;
    this.suspended = true;
    this.audio.pause();
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.unlock();
  }

  play(startSec: number, endSec: number): void {
    this.stop();
    this.startSec = startSec;
    this.endSec = endSec;
    this.active = true;
    const audio = this.audio;
    const begin = (): void => {
      if (!this.active || this.startSec !== startSec) return;
      audio.currentTime = startSec;
      if (this.suspended) return; // reprise au retour de la pause
      void audio.play().catch(() => {
        // bloqué (autoplay) : l'état « playing » est faux, la position vient de l'horloge
      });
    };
    if (audio.readyState >= 1) begin();
    else audio.addEventListener("loadedmetadata", begin, { once: true });
    this.timer = setInterval(() => {
      if (audio.currentTime >= this.endSec || audio.ended) this.stop();
    }, WATCH_MS);
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.audio.pause();
  }

  get playing(): boolean {
    if (this.suspended) return this.active && this.playingWhenSuspended;
    return this.active && !this.audio.paused && !this.audio.ended && this.audio.readyState >= 3;
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }
}
