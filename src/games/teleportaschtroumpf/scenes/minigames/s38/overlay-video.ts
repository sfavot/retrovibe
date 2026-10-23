import { MuxDecoder } from "../../../data/mux";
import { TICKS_PER_SECOND } from "../../../engine/clock";
import type { SceneContext } from "../../../engine/scene";
import { scanMux } from "../../../engine/video";

/**
 * Vidéo MUX « en surimpression » (`179a:0673` avec `0x1000`, utilisée par S38 : `1fc6:085f` et `1fc6:0c20`). À chaque image l'original recopie le fond B
 * dans A **avant** de décoder l'image : les pixels sautés (codage inter) montrent donc le fond, pas l'image précédente de la vidéo. La
 * vidéo n'est qu'un calque animé posé sur le fond (un MCG ou l'écran info). Ici le décodeur écrit sur une copie du fond fournie par
 * `background(image)`. Même synchronisation que `VideoScene` : l'image suit la position du son, ou l'horloge s'il n'y a pas de son.
 */
export class OverlayVideo {
  readonly decoder: MuxDecoder;
  readonly audio: Uint8Array | null;
  readonly frameCount: number;
  readonly fps: number;
  /** Numéro de la dernière image décodée (−1 avant la première). */
  shown = -1;
  ended = false;
  private startTick = 0;
  private usingAudio = false;
  private audioOffset = 0;
  private lastAudioTime = 0;
  private audioEndedTick: number | null = null;

  constructor(bytes: Uint8Array) {
    this.decoder = new MuxDecoder(bytes);
    const scan = scanMux(bytes, this.decoder.header.firstChunkOffset);
    this.audio = this.decoder.header.audioFrequency > 0 ? scan.audio : null;
    this.frameCount = scan.frameCount;
    this.fps = this.decoder.header.framesPerSecond || 11;
  }

  static async load(ctx: SceneContext, file: string): Promise<OverlayVideo> {
    return new OverlayVideo(await ctx.resources.bytes(file));
  }

  /** Image courante : le fond avec les pixels de l'image par-dessus. */
  get pixels(): Uint8Array {
    return this.decoder.pixels;
  }

  start(ctx: SceneContext): void {
    ctx.voice.holdMusic(true);
    ctx.voice.stop();
    this.shown = -1;
    this.ended = false;
    this.usingAudio = false;
    this.audioEndedTick = null;
    this.lastAudioTime = 0;
    this.decoder.reset();
    this.startTick = ctx.clock.ticks;
    this.startAudio(ctx, 0);
  }

  private startAudio(ctx: SceneContext, from: number): void {
    if (!this.audio) return;
    const rate = this.decoder.header.audioFrequency;
    const start = Math.floor(from * rate);
    if (start >= this.audio.length) return;
    ctx.voice.playPcm(start === 0 ? this.audio : this.audio.subarray(start), rate);
    this.usingAudio = ctx.voice.voicePlaying;
    this.audioOffset = from;
  }

  private time(ctx: SceneContext): number {
    if (!this.usingAudio) {
      const clock = (ctx.clock.ticks - this.startTick) / TICKS_PER_SECOND;
      this.startAudio(ctx, clock);
      if (!this.usingAudio) return clock;
    }
    if (ctx.voice.voicePlaying) {
      this.lastAudioTime = this.audioOffset + ctx.voice.position;
      return this.lastAudioTime;
    }
    this.audioEndedTick ??= ctx.clock.ticks;
    return this.lastAudioTime + (ctx.clock.ticks - this.audioEndedTick) / TICKS_PER_SECOND;
  }

  /**
   * Avance jusqu'à l'image du moment. `before(image)` est appelé avant chaque décodage et rend le fond de cette image ;
   * `after(image)` juste après (changement de palette, par exemple).
   */
  update(ctx: SceneContext, before: (image: number) => Uint8Array, after?: (image: number) => void): void {
    if (this.ended) return;
    const t = this.time(ctx);
    const wanted = Math.min(Math.floor(t * this.fps), this.frameCount - 1);
    while (this.shown < wanted) {
      this.decoder.pixels.set(before(this.shown + 1));
      if (!this.decoder.nextFrame()) {
        this.shown = this.frameCount;
        break;
      }
      this.shown++;
      after?.(this.shown);
    }
    const framesOver = Math.floor(t * this.fps) >= this.frameCount && !(this.usingAudio && ctx.voice.voicePlaying);
    if (framesOver) this.stop(ctx);
  }

  stop(ctx: SceneContext): void {
    if (this.ended) return;
    this.ended = true;
    ctx.voice.stop();
    ctx.voice.holdMusic(false);
  }
}
