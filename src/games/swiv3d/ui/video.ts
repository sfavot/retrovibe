import { SmackerDecoder, type SmackerFrame } from "../../../data/smacker";

/** Avance de l'image sur l'horloge au démarrage : le temps de mettre le son en file. */
const LEAD_MS = 120;
/** Images décodées au plus par appel (une machine lente rattrape sur plusieurs images du navigateur). */
const MAX_DECODE_PER_UPDATE = 8;

/** Nombre d'images de la vidéo qui devraient avoir été montrées après `elapsedMs` (la première à 0 ms). */
export function framesDue(elapsedMs: number, frameDurationMs: number, frameCount: number): number {
  if (elapsedMs < 0) return 0;
  return Math.min(frameCount, Math.floor(elapsedMs / frameDurationMs) + 1);
}

/** Où le son d'une vidéo est envoyé. */
export interface VideoAudioTarget {
  ctx: AudioContext;
  destination: AudioNode;
}

export interface VideoFrameInfo {
  /** Palette de l'image (RVB 8 bits, 768 octets). */
  palette: Uint8Array;
  /** Numéro de l'image, à partir de 1 (textes `.SCR`). */
  number: number;
}

/**
 * Lecture d'une vidéo Smacker dans une image indexée 320×400 : cadence de l'en-tête, son décodé image par image et mis en file sur Web
 * Audio. Les images sont décodées à la demande ; la dernière reste dans `fb` à la fin.
 */
export class VideoPlayer {
  private readonly decoder: SmackerDecoder;
  private readonly sources: AudioBufferSourceNode[] = [];
  private startWall = -1;
  private audioCursor = 0;
  private last: SmackerFrame | null = null;
  private stopped = false;
  private finishedWall = false;

  constructor(
    bytes: Uint8Array,
    private readonly audio: VideoAudioTarget | null,
  ) {
    this.decoder = new SmackerDecoder(bytes);
  }

  get frameCount(): number {
    return this.decoder.file.frameCount;
  }

  /** Toutes les images ont été montrées et leur durée est écoulée. */
  get ended(): boolean {
    return this.stopped || this.finishedWall;
  }

  /**
   * Avance à l'instant `now` (ms) : décode les images dues, copie la dernière dans `fb`. Renvoie les informations de l'image montrée, ou
   * `null` si rien n'a changé depuis l'appel précédent.
   */
  update(now: number, fb: Uint8Array): VideoFrameInfo | null {
    if (this.stopped) return null;
    const { frameDurationMs, frameCount } = this.decoder.file;
    if (this.startWall < 0) {
      this.startWall = now + LEAD_MS;
      this.audioCursor = (this.audio?.ctx.currentTime ?? 0) + LEAD_MS / 1000;
    }
    const due = framesDue(now - this.startWall, frameDurationMs, frameCount);
    let changed = false;
    for (let n = 0; this.decoder.position < due && n < MAX_DECODE_PER_UPDATE; n++) {
      const frame = this.decoder.nextFrame();
      if (!frame) break;
      this.queueAudio(frame);
      this.last = frame;
      changed = true;
    }
    if (this.decoder.done && now - this.startWall >= frameCount * frameDurationMs) this.finishedWall = true;
    if (!changed || !this.last) return null;
    fb.set(this.last.pixels);
    return { palette: this.last.palette, number: this.last.index + 1 };
  }

  /** Arrête le son en file (touche pour passer, fin de l'écran). */
  stop(): void {
    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // déjà arrêtée
      }
      source.disconnect();
    }
    this.sources.length = 0;
  }

  private queueAudio(frame: SmackerFrame): void {
    const target = this.audio;
    const track = frame.audio[0];
    if (!target || !track || track.samples.length === 0) return;
    const { ctx, destination } = target;
    const channels = track.channels;
    const length = Math.floor(track.samples.length / channels);
    const buffer = ctx.createBuffer(channels, length, track.rate);
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = track.samples[i * channels + c]! / 32768;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    // Les morceaux s'enchaînent sans trou ; en retard sur l'horloge, ils repartent tout de suite.
    const at = Math.max(ctx.currentTime, this.audioCursor);
    source.start(at);
    this.audioCursor = at + buffer.duration;
    source.onended = () => {
      const at = this.sources.indexOf(source);
      if (at >= 0) this.sources.splice(at, 1);
    };
    this.sources.push(source);
  }
}
