import { pcmSound, soundFrom, type Sound } from "./audio/sound";
import { MuxDecoder } from "./data/mux";
import { VidDecoder } from "./data/vid";
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
    // Un bloc de fin d'image vide ne clôt pas d'image (`MuxDecoder.nextFrame`).
    if (type === CHUNK_END_OF_FRAME) frameCount += size > 0 ? 1 : 0;
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

/** Ce qu'une image de vidéo apporte en plus de ses pixels. */
export interface VideoSourceFrame {
  /** Charges utiles des marqueurs MUX de type 08 lus avec cette image (texte ASCII décimal : « 1 », « 10 », « -1 »). */
  readonly markers: readonly Uint8Array[];
  /** Valeurs des enregistrements de type 0 d'un MUK lus avec cette image (elles écrivent la même globale que les marqueurs). */
  readonly values?: readonly number[];
}

/**
 * Source d'images d'une vidéo, quel que soit son fichier : un `.MUX` d'origine (`MuxDecoder`) ou un conteneur `.vid`
 * (`VidDecoder`, MUX ou MUK réencodé sans perte). Les images se décodent dans l'ordre, une à la fois.
 */
export interface VideoSource {
  /** Cadence de l'en-tête, 0 s'il n'en donne pas (MUK : l'original le déroule sans temporisation, au rythme de l'appelant). */
  readonly framesPerSecond: number;
  readonly frameCount: number;
  /** Image courante cumulée (320×200 indices de palette) : chaque image décodée sur la précédente. */
  readonly pixels: Uint8Array;
  /** Palette courante, 768 octets RVB 8 bits. */
  readonly palette: Uint8Array;
  /** Décode l'image suivante ; `null` après la dernière. */
  nextFrame(): VideoSourceFrame | null;
  /**
   * Applique l'image courante à `target` comme le bloc vidéo d'origine décodé sur ce tampon : seuls les pixels codés sont
   * écrits (le décodeur `2b17:0119` laisse intacts ceux qu'une image inter saute).
   */
  compose(target: Uint8Array): void;
}

/** Une vidéo prête à jouer : ses images, et sa piste son entière (`null` si elle est muette). */
export interface VideoClip {
  readonly source: VideoSource;
  readonly audio: Sound | null;
}

/** Vidéo d'un fichier `.MUX` d'origine : le son (PCM) est dans les blocs du fichier. */
export function muxClip(bytes: Uint8Array): VideoClip {
  const decoder = new MuxDecoder(bytes);
  const scan = scanMux(bytes, decoder.header.firstChunkOffset);
  const rate = decoder.header.audioFrequency;
  return {
    source: {
      framesPerSecond: decoder.header.framesPerSecond,
      frameCount: scan.frameCount,
      pixels: decoder.pixels,
      palette: decoder.palette,
      nextFrame: () => decoder.nextFrame(),
      compose: (target) => decoder.compose(target),
    },
    audio: rate > 0 && scan.audio ? pcmSound(scan.audio, rate) : null,
  };
}

/** Vidéo d'un conteneur `.vid` : le son est à part (`<nom>.mp3`, durée exacte dans `audio.json`), `null` s'il n'y en a pas. */
export function vidClip(bytes: Uint8Array, audio: Sound | null): VideoClip {
  const decoder = new VidDecoder(bytes);
  return {
    source: {
      framesPerSecond: decoder.header.framesPerSecond,
      frameCount: decoder.header.frameCount,
      pixels: decoder.pixels,
      palette: decoder.palette,
      nextFrame: () => decoder.nextFrame(),
      compose: (target) => decoder.compose(target),
    },
    audio,
  };
}

/**
 * Valeur d'un marqueur 08 : `atoi` de son texte (`1948:018e` : `DS:6425 = atoi(texte du bloc)`). Espaces de tête, signe,
 * chiffres ; 0 si le texte n'est pas un nombre.
 */
export function markerValue(text: Uint8Array): number {
  let i = 0;
  while (i < text.length && (text[i] === 0x20 || (text[i] >= 0x09 && text[i] <= 0x0d))) i++;
  const negative = text[i] === 0x2d;
  if (negative || text[i] === 0x2b) i++;
  let value = 0;
  for (; i < text.length && text[i] >= 0x30 && text[i] <= 0x39; i++) value = value * 10 + (text[i] - 0x30);
  return negative ? -value : value;
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
    this.set(ctx.surface.work, ctx.palette.colors);
  }

  /** `13fc:0002(+1)` sur une image et sa palette : pixels + 0x80, couleurs 0..127 recopiées en 128..255. */
  set(pixels: Uint8Array, palette: Uint8Array): void {
    for (let i = 0; i < this.pixels.length; i++) this.pixels[i] = (pixels[i] + 0x80) & 0xff;
    this.palette.set(palette.subarray(0, 384), 384);
  }

  /** Palette affichée : les 128 premières couleurs de la vidéo, puis celles du fond. */
  combine(videoPalette: Uint8Array): Uint8Array {
    this.palette.set(videoPalette.subarray(0, 384), 0);
    return this.palette;
  }
}

/**
 * Lecture d'une vidéo (MUX d'origine ou conteneur `.vid`) : décode les images dans l'ordre (le codage inter l'impose)
 * jusqu'à celle qui correspond à un temps donné, `image = floor(temps × images par seconde)`. Le temps vient de la
 * position audio quand il y a du son (engine.md §2.3 : le pas vidéo est asservi au son), sinon de l'horloge.
 *
 * Les trois compositions du lecteur d'origine (docs/asterix/engine.md §4.6) :
 *  1. **plein écran** : `pixels` est l'image cumulée ;
 *  2. **surimpression** (`0x1000`) : avec un `backdrop`, `pixels` est le fond sur lequel seule l'image courante est posée ;
 *  3. **rappel d'image** (`0x80`) : l'appelant compose lui-même, en recopiant un rectangle de `pixels` ou en reposant
 *     l'image courante sur son propre décor avec `compose(cible)`.
 */
export class VideoPlayer {
  private readonly source: VideoSource;
  /** Piste son complète, `null` si la vidéo est muette. */
  readonly audio: Sound | null;
  /** Fréquence d'origine du son en Hz, 0 si la vidéo est muette. */
  readonly sampleRate: number;
  readonly frameCount: number;
  readonly fps: number;
  /** Numéro (à partir de 0) de la dernière image décodée, −1 avant la première. */
  shown = -1;
  /**
   * La globale `DS:6425` du lecteur d'origine : valeur du dernier marqueur 08 lu (`atoi` de son texte) ou du dernier
   * enregistrement de type 0 d'un MUK. Le lecteur ne fait que l'écrire ; ce sont les rappels des modules qui la lisent,
   * agissent, puis la remettent à 0 ou à −1 (d'où le champ modifiable). 0 tant qu'aucun marqueur n'a été lu.
   */
  marker = 0;
  /** Tampon de la surimpression : le fond, puis l'image courante. */
  private readonly overlaid: Uint8Array | null;

  /** `backdrop` : vidéo en surimpression, chaque image se pose sur ce fond. */
  constructor(
    clip: VideoClip,
    private readonly backdrop?: VideoBackdrop,
  ) {
    this.source = clip.source;
    this.audio = clip.audio;
    this.sampleRate = clip.audio?.sampleRate ?? 0;
    this.frameCount = clip.source.frameCount;
    this.fps = clip.source.framesPerSecond || FALLBACK_FPS;
    this.overlaid = backdrop ? new Uint8Array(clip.source.pixels.length) : null;
  }

  /** Durée de l'image en secondes. */
  get duration(): number {
    return this.frameCount / this.fps;
  }

  /** Image à afficher : l'image cumulée, ou en surimpression le fond recouvert par l'image courante. */
  get pixels(): Uint8Array {
    return this.overlaid ?? this.source.pixels;
  }

  get palette(): Uint8Array {
    return this.source.palette;
  }

  /** Pose l'image courante sur `target` : seuls les pixels que la vidéo code sont écrits (composition par rappel d'image). */
  compose(target: Uint8Array): void {
    this.source.compose(target);
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
   * portait : c'est le rappel par image de `179a:0673` (`179a:016e` range le marqueur en `DS:6DE4`). `marker` est déjà à
   * jour (un marqueur peut ainsi être écrasé par le suivant si plusieurs images sont rattrapées d'un coup, comme dans
   * l'original). S'il rend `true`, le décodage s'arrête sur cette image.
   */
  seek(frame: number, onFrame?: (index: number, markers: readonly Uint8Array[]) => boolean | void): boolean {
    const wanted = Math.min(frame, this.frameCount - 1);
    const before = this.shown;
    while (this.shown < wanted) {
      const decoded = this.source.nextFrame();
      if (!decoded) {
        this.shown = this.frameCount;
        break;
      }
      if (this.overlaid) {
        this.overlaid.set(this.backdrop!.pixels);
        this.source.compose(this.overlaid);
      }
      for (const marker of decoded.markers) this.marker = markerValue(marker);
      // Deux octets rangés tels quels dans la globale, qui est un entier signé (`19b9:000c`).
      for (const value of decoded.values ?? []) this.marker = (value << 16) >> 16;
      this.shown++;
      if (onFrame?.(this.shown, decoded.markers) === true) break;
    }
    return this.shown !== before;
  }
}

export interface VideoSceneOptions {
  /**
   * Nom d'origine, par ex. `s06a.mux`, `m06ab.mux` ou `m34ag.muk` : `Resources.video` choisit le fichier d'origine ou
   * son conteneur `.vid`.
   */
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
  /**
   * Composition par rappel d'image (`0x80` de `1948:04cc`) : au lieu d'afficher l'image en plein écran, la scène appelle
   * `draw` à chaque rendu, et c'est lui qui dessine dans `ctx.surface` (recopie d'un rectangle de `video.pixels`,
   * `video.compose` sur un décor…). `overlay` est appelé ensuite, comme pour les autres modes.
   */
  draw?(ctx: SceneContext, video: VideoPlayer): void;
  /** La palette de la vidéo est ignorée, la palette courante reste (`0x4` de `1948:04cc`). */
  keepPalette?: boolean;
}

/**
 * Scène générique de lecture d'une vidéo (plein écran, en surimpression ou par rappel d'image) : palette de la vidéo, son sur la voie unique,
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
    this.player = new VideoPlayer(await ctx.resources.video(this.options.file), this.options.backdrop);
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
    if (start >= player.audio.sampleCount) return;
    ctx.voice.play(soundFrom(player.audio, start));
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
    const { backdrop, draw, keepPalette } = this.options;
    if (!keepPalette) ctx.palette.load(backdrop ? backdrop.combine(player.palette) : player.palette);
    if (draw) draw(ctx, player);
    else ctx.surface.drawFullScreen(player.pixels);
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
