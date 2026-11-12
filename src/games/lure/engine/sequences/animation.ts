/**
 * `AnimationSequence` (constructeur, `show`, `step`, `showInitialScreen`) : une animation plein écran (écran de départ, puis images en
 * différences), jouée sur l'écran des séquences avec ses sons.
 *
 * Source (ScummVM, GPL v3+) : engines/lure/animseq.cpp ; le décodage des images est `AnimationSequence` de `data/anim.ts`.
 *
 * Écarts volontaires : VGA seulement (l'EGA n'est pas porté) ; l'attente de ScummVM (`delay`) est `SequenceKit.interruptableDelay` (horloge
 * du moteur) ; `AnimationSequence::~AnimationSequence` réactive la sauvegarde (`_saveLoadAllowed`) : ici elle est refusée tant que la
 * séquence tourne (`LureEngine.busy`) ; l'événement `MAINMENU` n'existe pas.
 */

import type { Sequence } from "../../../../engine/sequence";
import { AnimationSequence as AnimationFrames } from "../../data/anim";
import { type Palette } from "../../data/palette";
import type { SequenceKit } from "./kit";

/** `AnimAbortType` : fin normale, abandon de toute la suite (Échap), passage à la scène suivante (clic ou autre touche). */
export type AnimAbort = "none" | "endIntro" | "nextScene";

/** `AnimSoundSequence` : son lancé à la première image d'un paquet de `numFrames` images. */
export interface AnimSound {
  numFrames: number;
  adlibSoundId: number;
  rolandSoundId: number;
  channelNum: number;
  music: boolean;
}

export interface AnimOptions {
  /** Fondu entrant de la palette (sinon palette posée d'un coup). */
  fadeIn: boolean;
  /** Durée d'une image en 50e de seconde (`frameDelay`, 7 par défaut). */
  frameDelay?: number;
  sounds?: readonly AnimSound[];
  /** Nombre de passages (`loops`, 1 par défaut). */
  loops?: number;
}

const DEFAULT_FRAME_DELAY = 7;
/** `rolandSoundId` d'une entrée sans son. */
const NO_SOUND = 0xff;

export class ScreenAnimation {
  private readonly frames: AnimationFrames;
  private readonly frameDelay: number;
  private readonly sounds: readonly AnimSound[] | undefined;
  private loops: number;

  private constructor(
    private readonly kit: SequenceKit,
    animId: number,
    private readonly palette: Palette,
    options: AnimOptions,
  ) {
    const resources = kit.ctx.data.resources;
    this.frames = new AnimationFrames(resources.get(animId), resources.get(animId + 1));
    this.frameDelay = options.frameDelay ?? DEFAULT_FRAME_DELAY;
    this.sounds = options.sounds;
    this.loops = options.loops ?? 1;
  }

  /**
   * Constructeur de `AnimationSequence` : palette vidée, écran de départ, palette (en fondu ou d'un coup). Le fondu rend la main
   * pendant 1,3 s environ (comme ScummVM, qui y est bloqué).
   */
  static *open(kit: SequenceKit, animId: number, palette: Palette, options: AnimOptions): Sequence<ScreenAnimation> {
    const animation = new ScreenAnimation(kit, animId, palette, options);
    kit.emptyPalette();
    animation.showInitialScreen();
    if (options.fadeIn) yield* kit.fadeIn(palette);
    else kit.setPalette(palette);
    return animation;
  }

  /** `showInitialScreen`. */
  private showInitialScreen(): void {
    this.kit.screen.pixels.set(this.frames.initialScreen);
  }

  /** `show` : joue les images (une toutes les `frameDelay` / 50 s), puis une attente de plus à la fin de chaque passage, comme ScummVM. */
  *show(): Sequence<AnimAbort> {
    const kit = this.kit;
    let soundIndex = 0;
    let frameCtr = 0;
    while (this.loops > 0) {
      const sound = this.sounds?.[soundIndex];
      if (this.frames.hasFrame) {
        if (sound && sound.rolandSoundId !== NO_SOUND && frameCtr === 0) kit.ctx.sound.playMusic(sound.adlibSoundId, sound.music);
        this.frames.applyNextFrame(kit.screen.pixels);
      } else {
        // Fin d'un passage : on recommence si d'autres sont demandés (l'attente suit dans tous les cas).
        this.loops--;
        if (this.loops > 0) {
          this.frames.rewind();
          this.showInitialScreen();
        }
      }

      const result = yield* animationDelay(kit, (this.frameDelay * 1000) / 50);
      if (result !== "none") return result;

      if (sound && ++frameCtr === sound.numFrames) {
        frameCtr = 0;
        soundIndex++;
      }
    }
    return "none";
  }

  /** `step` : l'image suivante, palette posée d'un coup ; faux s'il n'y en a plus. */
  step(): boolean {
    if (!this.frames.hasFrame) return false;
    this.frames.applyNextFrame(this.kit.screen.pixels);
    this.kit.setPalette(this.palette);
    return true;
  }
}

/** `AnimationSequence::delay` : Échap abandonne toute la suite, un clic ou une autre touche passe à la scène suivante. */
function* animationDelay(kit: SequenceKit, ms: number): Sequence<AnimAbort> {
  const hit = yield* kit.interruptableDelay(ms);
  if (hit === "escape") return "endIntro";
  return hit === "none" ? "none" : "nextScene";
}
