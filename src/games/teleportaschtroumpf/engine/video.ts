import { MuxDecoder } from "../data/mux";
import { TICKS_PER_SECOND } from "./clock";
import type { Scene, SceneContext } from "./scene";

/** Cadence de repli si l'en-tête n'en donne pas (11 images/s, la cadence de presque toutes les vidéos). */
const FALLBACK_FPS = 11;

const CHUNK_END_OF_FILE = 0x04;
const CHUNK_END_OF_FRAME = 0x05;
const CHUNK_AUDIO = 0x06;
const CHUNK_AUDIO_FIRST = 0x07;

/**
 * Parcourt les chunks d'un MUX (sans décoder la vidéo) : renvoie la piste son complète (PCM 8 bits non signé,
 * `null` s'il n'y en a pas) et le nombre d'images. Les en-têtes de chunk font 6 octets : type, sous-type, taille u32.
 */
export function scanMux(bytes: Uint8Array, firstChunkOffset: number): { audio: Uint8Array | null; frameCount: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pieces: Uint8Array[] = [];
  let total = 0;
  let frameCount = 0;
  let pos = firstChunkOffset;
  while (pos + 6 <= bytes.length) {
    const type = bytes[pos];
    if (type === CHUNK_END_OF_FILE) break;
    const size = view.getUint32(pos + 2, true);
    const start = pos + 6;
    if (start + size > bytes.length) break;
    if (type === CHUNK_END_OF_FRAME) frameCount++;
    else if (type === CHUNK_AUDIO || type === CHUNK_AUDIO_FIRST) {
      pieces.push(bytes.subarray(start, start + size));
      total += size;
    }
    pos = start + size;
  }
  if (total === 0) return { audio: null, frameCount };
  const audio = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    audio.set(piece, offset);
    offset += piece.length;
  }
  return { audio, frameCount };
}

/**
 * Fond d'une vidéo « en surimpression » (`179a:0673` avec `0x1000` : Grand Schtroumpf `154c:097b`, S39). Les images de ces
 * vidéos ne sont que des deltas du personnage : après chaque image, l'original recopie le fond B dans A (`179a:04f9`), et
 * l'image suivante se décode sur ce fond ; seules les 128 premières couleurs de la vidéo sont chargées. Le fond est l'écran
 * d'avant la vidéo, passé en 128..255 par `13fc:0002(+1)` (pixels + 0x80, couleurs 0..127 recopiées en 128..255).
 */
export class VideoBackdrop {
  readonly pixels = new Uint8Array(64000);
  /** Couleurs 128..255 du fond ; `combine` y pose les 128 couleurs de la vidéo. */
  readonly palette = new Uint8Array(768);

  /** `13fc:0002(+1)` sur l'écran et la palette courants. */
  capture(ctx: SceneContext): void {
    const work = ctx.surface.work;
    for (let i = 0; i < this.pixels.length; i++) this.pixels[i] = (work[i] + 0x80) & 0xff;
    this.palette.set(ctx.palette.colors.subarray(0, 384), 384);
  }

  /** Palette affichée : les 128 premières couleurs de la vidéo, puis celles du fond. */
  combine(videoPalette: Uint8Array): Uint8Array {
    this.palette.set(videoPalette.subarray(0, 384), 0);
    return this.palette;
  }
}

/**
 * Lecture d'une vidéo MUX : décode les images dans l'ordre (le codage inter l'impose) jusqu'à celle qui correspond
 * à un temps donné, `image = floor(temps × images par seconde)`. Le temps vient de la position audio quand il y a du son
 * (engine.md §2.3 : le pas vidéo est asservi au son), sinon de l'horloge.
 */
export class VideoPlayer {
  readonly decoder: MuxDecoder;
  /** Piste son complète (PCM 8 bits non signé), `null` si la vidéo est muette. */
  readonly audio: Uint8Array | null;
  readonly sampleRate: number;
  readonly frameCount: number;
  readonly fps: number;
  /** Numéro (à partir de 0) de la dernière image décodée, −1 avant la première. */
  shown = -1;

  /** `backdrop` : vidéo en surimpression, chaque image se décode sur ce fond. */
  constructor(
    bytes: Uint8Array,
    private readonly backdrop?: VideoBackdrop,
  ) {
    this.decoder = new MuxDecoder(bytes);
    const scan = scanMux(bytes, this.decoder.header.firstChunkOffset);
    this.audio = this.decoder.header.audioFrequency > 0 ? scan.audio : null;
    this.sampleRate = this.decoder.header.audioFrequency;
    this.frameCount = scan.frameCount;
    this.fps = this.decoder.header.framesPerSecond || FALLBACK_FPS;
  }

  /** Durée de l'image en secondes. */
  get duration(): number {
    return this.frameCount / this.fps;
  }

  get pixels(): Uint8Array {
    return this.decoder.pixels;
  }

  get palette(): Uint8Array {
    return this.decoder.palette;
  }

  /** Numéro d'image correspondant à un temps (pas borné par la durée). */
  frameAt(seconds: number): number {
    return Math.floor(Math.max(0, seconds) * this.fps);
  }

  /** Vrai si ce temps est au-delà de la dernière image. */
  endedAt(seconds: number): boolean {
    return this.frameAt(seconds) >= this.frameCount;
  }

  /**
   * Décode jusqu'à l'image `frame` (bornée à la dernière) ; renvoie vrai si l'image affichée a changé.
   * `onFrame` est appelé après chaque image décodée, dans l'ordre, avec son numéro et les marqueurs (chunks 08) qu'elle
   * portait : c'est le rappel par image de `179a:0673` (`179a:016e` range le marqueur en `DS:6DE4`). S'il rend `true`, le
   * décodage s'arrête sur cette image.
   */
  seek(frame: number, onFrame?: (index: number, markers: readonly Uint8Array[]) => boolean | void): boolean {
    const wanted = Math.min(frame, this.frameCount - 1);
    const before = this.shown;
    while (this.shown < wanted) {
      if (this.backdrop) this.decoder.pixels.set(this.backdrop.pixels);
      const decoded = this.decoder.nextFrame();
      if (!decoded) {
        this.shown = this.frameCount;
        break;
      }
      this.shown++;
      if (onFrame?.(this.shown, decoded.markers) === true) break;
    }
    return this.shown !== before;
  }
}

export interface VideoSceneOptions {
  /** Nom d'origine, par ex. `s06a.mux`. */
  file: string;
  /** Échap ou clic gauche (ou Espace) passent la vidéo (drapeaux `0x400 | 0x800` de `179a:0673`). Défaut : vrai. */
  skippable?: boolean;
  /** Fondu au noir à la fin (naturelle ou par saut) avant d'appeler `onEnd`. */
  fadeOutAtEnd?: boolean;
  /** Appelé une fois, à la fin : c'est là qu'on enchaîne (`ctx.scenes.replace(...)`). */
  onEnd(ctx: SceneContext): void;
  /**
   * Rappel par image décodée (le rappel `cb_image` de `179a:0673`) : numéro de l'image (0 = la première) et marqueurs de
   * l'image. Rendre `"stop"` interrompt la vidéo sur cette image (l'original lève le drapeau d'arrêt `DS:6337`) : `onEnd`
   * est alors appelé comme pour une fin normale.
   */
  onFrame?(ctx: SceneContext, frame: number, markers: readonly Uint8Array[]): "stop" | void;
  /** Dessiné par-dessus chaque image affichée (sprites posés par `onFrame`, comme le rappel de l'original dessine dans le tampon). */
  overlay?(ctx: SceneContext): void;
  /** Vidéo en surimpression (`0x1000`) : fond capturé par l'appelant avant le début de la lecture. */
  backdrop?: VideoBackdrop;
}

/**
 * Scène générique de lecture d'une vidéo MUX plein écran : palette de la vidéo, son sur la voie unique,
 * image synchronisée sur le son (ou sur l'horloge si rien ne sort : son muet, sortie audio verrouillée).
 * La musique de fond est retenue pendant la lecture.
 */
export class VideoScene implements Scene {
  /** Une mise à jour par tick : la synchronisation fine se fait sur le temps, pas sur le pas. */
  readonly step = 1;

  private player: VideoPlayer | null = null;
  private startTick = 0;
  private usingAudio = false;
  /** Temps vidéo (s) auquel la piste son a démarré : 0, ou plus si le son s'est débloqué en cours de lecture. */
  private audioOffset = 0;
  private lastAudioTime = 0;
  private audioEndedTick: number | null = null;
  private ending = false;
  private done = false;
  /** Retenue de la musique avant la vidéo, rendue à la sortie (une annonce peut la retenir autour de plusieurs vidéos). */
  private musicHeldBefore = false;

  constructor(private readonly options: VideoSceneOptions) {}

  async load(ctx: SceneContext): Promise<void> {
    this.player = new VideoPlayer(await ctx.resources.bytes(this.options.file), this.options.backdrop);
  }

  enter(ctx: SceneContext): void {
    const player = this.player!;
    ctx.fade.reset();
    this.musicHeldBefore = ctx.voice.musicHeld;
    ctx.voice.holdMusic(true);
    ctx.voice.stop();
    this.usingAudio = false;
    this.startAudio(ctx, 0);
    this.startTick = ctx.clock.ticks;
    this.lastAudioTime = 0;
    this.audioEndedTick = null;
    this.ending = false;
    this.done = false;
    const { onFrame } = this.options;
    player.seek(0, onFrame && ((index, markers) => void onFrame(ctx, index, markers)));
  }

  /**
   * Lance la piste son à partir du temps vidéo `from` (s). Sans effet si la sortie audio est encore verrouillée
   * (aucun geste de l'utilisateur) : `update` réessaie alors à chaque tick, pour que la vidéo retrouve son son
   * dès le premier clic au lieu de rester muette jusqu'au bout.
   */
  private startAudio(ctx: SceneContext, from: number): void {
    const player = this.player!;
    if (!player.audio) return;
    const start = Math.floor(from * player.sampleRate);
    if (start >= player.audio.length) return;
    ctx.voice.playPcm(start === 0 ? player.audio : player.audio.subarray(start), player.sampleRate);
    this.usingAudio = ctx.voice.voicePlaying;
    this.audioOffset = from;
  }

  /** Temps de lecture courant, en secondes. */
  private time(ctx: SceneContext): number {
    if (!this.usingAudio) {
      const clockTime = (ctx.clock.ticks - this.startTick) / TICKS_PER_SECOND;
      this.startAudio(ctx, clockTime);
      if (!this.usingAudio) return clockTime;
    }
    if (ctx.voice.voicePlaying) {
      this.lastAudioTime = this.audioOffset + ctx.voice.position;
      return this.lastAudioTime;
    }
    // Le son est fini avant la vidéo : on continue à l'horloge à partir de là.
    this.audioEndedTick ??= ctx.clock.ticks;
    return this.lastAudioTime + (ctx.clock.ticks - this.audioEndedTick) / TICKS_PER_SECOND;
  }

  update(ctx: SceneContext): void {
    if (this.done) return;
    const player = this.player!;
    if (this.ending) {
      if (!ctx.fade.active) this.finish(ctx);
      return;
    }
    const skip = this.options.skippable !== false && ctx.input.anyJustPressed("skip", "validate");
    const time = this.time(ctx);
    // La piste son déborde un peu la dernière image : on laisse finir le son avant de conclure.
    const framesOver = player.endedAt(time) && !(this.usingAudio && ctx.voice.voicePlaying);
    const { onFrame } = this.options;
    let stopped = false;
    player.seek(player.frameAt(time), onFrame && ((index, markers) => (stopped = onFrame(ctx, index, markers) === "stop")));
    if (skip || stopped || framesOver || player.shown >= player.frameCount) this.end(ctx);
  }

  render(ctx: SceneContext): void {
    const player = this.player!;
    if (player.shown < 0) return;
    const { backdrop } = this.options;
    ctx.palette.load(backdrop ? backdrop.combine(player.palette) : player.palette);
    ctx.surface.drawFullScreen(player.pixels);
    this.options.overlay?.(ctx);
  }

  exit(ctx: SceneContext): void {
    ctx.voice.stop();
    ctx.voice.holdMusic(this.musicHeldBefore);
  }

  private end(ctx: SceneContext): void {
    if (this.options.fadeOutAtEnd) {
      this.ending = true;
      ctx.voice.stop();
      ctx.fade.out();
    } else {
      this.finish(ctx);
    }
  }

  private finish(ctx: SceneContext): void {
    this.done = true;
    this.options.onEnd(ctx);
  }
}
