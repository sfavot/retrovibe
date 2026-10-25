/** Intervalle de surveillance de la fin de plage (ms) ; `timeupdate` est trop lent (≈ 250 ms). */
const WATCH_MS = 40;

/** Plage à lire dans un fichier ; sans options, la piste est lue en entier. */
export interface TrackOptions {
  /** Position de départ, en secondes depuis le début du fichier (0 par défaut). */
  start?: number;
  /** Position d'arrêt automatique, en secondes ; absente = fin du fichier. */
  end?: number;
  /** Reprend à `start` au lieu de s'arrêter en fin de plage (`onEnded` n'est alors jamais appelé). */
  loop?: boolean;
}

/**
 * Piste de musique lue en flux par un HTMLAudioElement (un gros fichier n'est jamais décodé en entier) :
 * la lecture démarre par un saut `currentTime` et s'arrête à la fin de la plage. Indépendant des jeux.
 */
export class TrackPlayer {
  private readonly audio: HTMLAudioElement;
  private url = "";
  private startSec = 0;
  private endSec = Infinity;
  private looping = false;
  private active = false;
  /** Identifie la lecture en cours : un `loadedmetadata` d'une lecture remplacée ne doit plus agir. */
  private token = 0;
  /** Pause de l'interface (onglet masqué) : la lecture reprend à la même position au retour. */
  private suspended = false;
  private playingWhenSuspended = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Appelé quand une piste ou une plage se termine d'elle-même (pas sur `stop()`, pas en boucle). */
  onEnded: (() => void) | null = null;

  /** `createAudio` : point d'injection de l'élément média (faux élément dans les tests). */
  constructor(createAudio: () => HTMLAudioElement = () => new Audio()) {
    this.audio = createAudio();
    this.audio.preload = "metadata";
  }

  /** Coupé : l'élément continue de lire en silence, la position avance comme d'habitude. */
  get muted(): boolean {
    return this.audio.muted;
  }

  set muted(value: boolean) {
    this.audio.muted = value;
  }

  /** Charge les métadonnées d'un fichier sans le jouer, pour que le premier `play` démarre vite. */
  preload(url: string): void {
    this.load(url);
  }

  private load(url: string): void {
    if (url === this.url) return;
    this.url = url;
    this.audio.src = url;
  }

  /** À rappeler après une interaction : relance une lecture bloquée par la politique d'autoplay. */
  unlock(): void {
    if (!this.suspended && this.active && this.audio.paused) void this.audio.play().catch(() => {});
  }

  /** Met la lecture en pause sans la terminer : `playing` garde sa valeur, aucune fin de plage n'est vue. */
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

  /** Lit `url` (remplace la lecture en cours), de `start` à `end` ; `end` arrête la lecture, sauf en boucle. */
  play(url: string, opts: TrackOptions = {}): void {
    this.stop();
    const startSec = opts.start ?? 0;
    this.startSec = startSec;
    this.endSec = opts.end ?? Infinity;
    this.looping = opts.loop ?? false;
    this.active = true;
    const token = ++this.token;
    this.load(url);
    const audio = this.audio;
    const begin = (): void => {
      if (!this.active || this.token !== token) return;
      audio.currentTime = startSec;
      if (this.suspended) return; // reprise au retour de la pause
      void audio.play().catch(() => {
        // bloqué (autoplay) : l'état « playing » est faux, la position vient de l'horloge
      });
    };
    if (audio.readyState >= 1) begin();
    else audio.addEventListener("loadedmetadata", begin, { once: true });
    this.timer = setInterval(() => {
      if (!(audio.currentTime >= this.endSec || audio.ended)) return;
      if (this.looping) {
        audio.currentTime = this.startSec;
        if (!this.suspended) void audio.play().catch(() => {});
        return;
      }
      this.stop();
      this.onEnded?.();
    }, WATCH_MS);
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.audio.pause();
  }

  /** Vrai tant que le son sort réellement (faux si en pause, terminé ou bloqué par le navigateur). */
  get playing(): boolean {
    if (this.suspended) return this.active && this.playingWhenSuspended;
    return this.active && !this.audio.paused && !this.audio.ended && this.audio.readyState >= 3;
  }

  /** Position de lecture courante, en secondes depuis le début du fichier. */
  get currentTime(): number {
    return this.audio.currentTime;
  }
}
