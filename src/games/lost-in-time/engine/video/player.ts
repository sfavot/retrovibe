import { ImdDecoder } from "../../data/imd";
import type { GraphicsSystems } from "../graphics";
import { BACK_SURFACE, FRONT_SURFACE } from "../graphics/core";
import { Surface } from "../graphics/surface";
import type { ImdProps, PlayImdArgs, VideoSystem, VmContext } from "../host";

/** Nombre d'emplacements (VideoPlayer::kVideoSlotCount) ; le 0 est le « primaire ». */
export const VIDEO_SLOT_COUNT = 32;
/** Les emplacements 1..6 sont réservés aux vidéos « live » : les autres commencent après. */
export const LIVE_VIDEO_SLOT_COUNT = 6;

// Drapeaux de playImd (VideoPlayer::Flags).
export const VIDEO_FLAG_USE_BACK = 0x40;
export const VIDEO_FLAG_FRONT = 0x80;
export const VIDEO_FLAG_NO_VIDEO = 0x100;
export const VIDEO_FLAG_OTHER_SURFACE = 0x800;
export const VIDEO_FLAG_SCREEN_SURFACE = 0x400000;

/** Touche d'interruption : Lost in Time ignore celle des scripts et accepte toujours Échap (kShortKeyEscape). */
const KEY_ESCAPE_SHORT = 0x1b;

/** Son d'une vidéo, tel qu'offert par le moteur audio (SoundEngine). */
export interface ImdAudio {
  queueImdSlice(pcm: Uint8Array, rate: number): void;
  stopImdAudio(): void;
}

/** VideoPlayer::Properties : tout ce qui décrit une lecture (valeurs par défaut identiques). */
export interface VideoProps {
  /** Surface de destination (index de sprite) ; -1 : aucune. Fixé par evaluateFlags. */
  sprite: number;
  /** Position à l'écran ; -1 : celle du film. */
  x: number;
  y: number;
  flags: number;
  /** Images : première, dernière (-1 : jusqu'à la fin), fin de séquence (pour l'interruption), palette. */
  startFrame: number;
  lastFrame: number;
  endFrame: number;
  palFrame: number;
  /** Autorise le saut dans un film avec son. */
  forceSeek: boolean;
  breakKey: number;
  /** 1 << (flags & 0x3F) : 1 rien, 2/4 fondu après l'image, 8 palette immédiate, 16 fondu avec recopie. */
  palCmd: number;
  palStart: number;
  palEnd: number;
  /** Lecture « live » : une image par appel de `update`, sans bloquer le script. */
  noBlock: boolean;
  loop: boolean;
  fade: boolean;
  /** Attend la durée d'une image (et teste l'interruption) entre deux images. */
  waitEndFrame: boolean;
  canceled: boolean;
}

export function videoProps(init: Partial<VideoProps> = {}): VideoProps {
  return {
    sprite: FRONT_SURFACE,
    x: -1,
    y: -1,
    flags: VIDEO_FLAG_FRONT,
    startFrame: -1,
    lastFrame: -1,
    endFrame: -1,
    palFrame: -1,
    forceSeek: false,
    breakKey: KEY_ESCAPE_SHORT,
    palCmd: 8,
    palStart: 0,
    palEnd: 255,
    noBlock: false,
    loop: false,
    fade: false,
    waitEndFrame: true,
    canceled: false,
    ...init,
  };
}

/** Vidéos qui gardent le curseur affiché pendant leur lecture (Lost in Time). */
const VIDEOS_WITH_CURSOR = new Set(["PORTA03", "PORTA03A", "CALE1", "AMIL2", "AMIL3B", "DELB", "DELG"]);

interface Slot {
  decoder: ImdDecoder;
  fileName: string;
  /** Index de sprite de la destination ; -1 : surface propre au film (`scratch`). */
  sprite: number;
  scratch: Surface | null;
  live: boolean;
  props: VideoProps;
  /** Cadence en images par seconde : celle du son, sinon celle du jeu. */
  frameRate: number;
  startTime: number;
  soundEnabled: boolean;
  noCursorSwitch: boolean;
  needBlit: boolean;
}

/**
 * Lecteur de vidéos IMD (VideoPlayer de ScummVM) : les films sont décodés directement sur la surface de
 * destination (les zones « creuses » laissent donc le décor visible), la palette du film est recopiée
 * dans celle du jeu selon `palCmd`, et le son est confié au moteur audio.
 *
 * API pour les animations (mult) : `openVideo` / `playVideo` / `closeVideo`, les accesseurs par
 * emplacement (`frameCount`, `currentFrame`, `width`, `height`, `flags`…) et `copyFrame`.
 */
export class VideoPlayer implements VideoSystem {
  private vm: VmContext | null = null;
  private readonly slots: (Slot | null)[] = new Array(VIDEO_SLOT_COUNT).fill(null);

  constructor(
    private readonly gfx: GraphicsSystems,
    private readonly getAudio: () => ImdAudio | undefined = () => undefined,
  ) {}

  attach(vm: VmContext): void {
    this.vm = vm;
  }

  // --- VideoSystem (opcodes) -------------------------------------------------------------------

  async open(name: string, args: PlayImdArgs): Promise<number> {
    const props = videoProps({ x: args.x, y: args.y, flags: args.flags });
    this.evaluateFlags(props);
    return this.openVideo(true, name, props);
  }

  async play(slot: number, p: ImdProps, args: PlayImdArgs): Promise<void> {
    const props = videoProps({
      x: args.x,
      y: args.y,
      flags: args.flags,
      startFrame: p.startFrame,
      lastFrame: p.lastFrame,
      noBlock: p.noBlock,
      breakKey: args.breakKey,
      palCmd: args.palCmd,
      palStart: args.palStart,
      palEnd: args.palEnd,
    });
    await this.playVideo(slot, props);
  }

  /** `slot` -1 : toutes les vidéos (closeAll). */
  close(slot: number): void {
    if (slot < 0) this.closeAll();
    else this.closeVideo(slot);
  }

  async writeInfo(name: string, varX: number, varY: number, varFrames: number, varWidth: number, varHeight: number): Promise<void> {
    const vars = this.vm!.vars;
    const slot = this.openVideo(false, name, videoProps());
    const video = this.slot(slot);
    if (!video) {
      for (const v of [varX, varY, varFrames, varWidth, varHeight]) vars.writeOff32(v, -1);
      return;
    }
    const { header } = video.decoder;
    vars.writeOff32(varX, header.x);
    vars.writeOff32(varY, header.y);
    vars.writeOff32(varFrames, header.frameCount);
    vars.writeOff32(varWidth, header.width);
    vars.writeOff32(varHeight, header.height);
    this.closeVideo(slot);
  }

  /** Les films sont gardés en mémoire : fermer une archive ne les invalide pas. */
  reopenAll(): void {}

  // --- ouverture -------------------------------------------------------------------------------

  /** VideoPlayer::evaluateFlags : choisit la surface de destination d'après les drapeaux. */
  evaluateFlags(props: VideoProps): void {
    if (props.flags & VIDEO_FLAG_FRONT) props.sprite = FRONT_SURFACE;
    else if (props.flags & VIDEO_FLAG_OTHER_SURFACE) {
      props.sprite = props.x;
      props.x = 0;
    } else if (props.flags & VIDEO_FLAG_SCREEN_SURFACE) props.sprite = 0;
    else if (props.flags & VIDEO_FLAG_NO_VIDEO) props.sprite = 0;
    else props.sprite = BACK_SURFACE;
    if (props.noBlock && props.sprite === FRONT_SURFACE) props.sprite = BACK_SURFACE;
  }

  /**
   * Ouvre une vidéo (VideoPlayer::openVideo). `primary` : emplacement 0, sinon le premier libre.
   * Retourne l'emplacement, ou -1 si le film est introuvable. La variable 7 reçoit le nombre d'images.
   */
  openVideo(primary: boolean, file: string, props: VideoProps): number {
    const vm = this.vm!;
    let index = 0;
    if (!primary) {
      index = this.nextFreeSlot();
      if (index < 0) return -1;
    }

    let video = this.slots[index];
    if (video && video.fileName.toLowerCase() !== file.toLowerCase()) {
      this.closeVideo(index);
      video = null;
    }

    if (!video) {
      const decoder = this.loadDecoder(file);
      if (!decoder) return -1;
      video = this.createSlot(decoder, file, primary, props);
      this.slots[index] = video;
    }

    video.decoder.setXY(props.x, props.y);
    if (primary) video.needBlit = (props.flags & VIDEO_FLAG_USE_BACK) !== 0 && props.sprite === FRONT_SURFACE;
    video.frameRate = video.decoder.header.sound
      ? video.decoder.header.sound.frequency / video.decoder.header.sound.sliceSize
      : vm.timer.frameRate;
    vm.vars.writeVar32(7, video.decoder.header.frameCount);
    return index;
  }

  private createSlot(decoder: ImdDecoder, file: string, primary: boolean, props: VideoProps): Slot {
    const { draw, core } = this.gfx;
    const { header } = decoder;
    const base = file.toUpperCase().replace(/\.IMD$/, "");
    const video: Slot = {
      decoder,
      fileName: file,
      sprite: -1,
      scratch: null,
      live: false,
      props,
      frameRate: 12,
      startTime: 0,
      soundEnabled: header.sound !== null,
      noCursorSwitch: primary && VIDEOS_WITH_CURSOR.has(base),
      needBlit: false,
    };

    const noVideo = (props.flags & VIDEO_FLAG_NO_VIDEO) !== 0;
    if (!noVideo && props.sprite >= 0) {
      const own = props.sprite !== FRONT_SURFACE && props.sprite !== BACK_SURFACE;
      const screenSize = (props.flags & VIDEO_FLAG_SCREEN_SURFACE) !== 0;
      if (own) {
        const width = screenSize ? core.screenWidth : header.width;
        const height = screenSize ? core.screenHeight : header.height;
        if (width > 0 && height > 0) draw.initSpriteSurf(props.sprite, width, height);
      }
      if (own && !draw.sprites[props.sprite]) {
        props.sprite = -1;
        props.x = props.y = 0;
      } else {
        video.sprite = props.sprite;
        if (!own || screenSize) {
          if (props.x >= 0 || props.y >= 0) {
            if (props.x < 0) props.x = 0xffff;
            if (props.y < 0) props.y = 0xffff;
          } else props.x = props.y = -1;
        } else props.x = props.y = 0;
      }
    } else {
      props.sprite = -1;
      props.x = props.y = 0;
    }

    if (video.sprite < 0) video.scratch = Surface.sprite(Math.max(header.width, 1), Math.max(header.height, 1));
    return video;
  }

  /** Cherche le film dans les archives ouvertes (insensible à la casse, extension .IMD par défaut). */
  private loadDecoder(file: string): ImdDecoder | null {
    const vm = this.vm!;
    const dot = file.lastIndexOf(".");
    const base = dot >= 0 ? file.slice(0, dot) : file;
    const data = vm.getFile(`${base}.IMD`);
    if (!data) return null;
    try {
      return new ImdDecoder(data, new Surface(1, 1));
    } catch {
      return null;
    }
  }

  private nextFreeSlot(): number {
    for (let i = LIVE_VIDEO_SLOT_COUNT + 1; i < VIDEO_SLOT_COUNT; i++) if (!this.slots[i]) return i;
    return -1;
  }

  // --- fermeture et accesseurs --------------------------------------------------------------

  closeVideo(slot: number): boolean {
    const video = this.slot(slot);
    if (!video) return false;
    if (video.decoder.header.sound) this.getAudio()?.stopImdAudio();
    this.slots[slot] = null;
    return true;
  }

  closeAll(): void {
    for (let i = 0; i < VIDEO_SLOT_COUNT; i++) this.closeVideo(i);
  }

  /** Ferme les vidéos live (emplacements 1 et suivants). */
  closeLiveVideos(): void {
    for (let i = 1; i < VIDEO_SLOT_COUNT; i++) if (this.slots[i]?.live) this.closeVideo(i);
  }

  private slot(slot: number): Slot | null {
    return slot >= 0 && slot < VIDEO_SLOT_COUNT ? this.slots[slot] : null;
  }

  slotIsOpen(slot: number): boolean {
    return this.slot(slot) !== null;
  }

  fileName(slot: number): string {
    return this.slot(slot)?.fileName ?? "";
  }

  frameCount(slot: number): number {
    return this.slot(slot)?.decoder.header.frameCount ?? 0;
  }

  /** Dernière image décodée (-1 avant la première). */
  currentFrame(slot: number): number {
    return this.slot(slot)?.decoder.currentFrame ?? 0;
  }

  width(slot: number): number {
    return this.slot(slot)?.decoder.header.width ?? 0;
  }

  height(slot: number): number {
    return this.slot(slot)?.decoder.header.height ?? 0;
  }

  defaultX(slot: number): number {
    return this.slot(slot)?.decoder.header.x ?? 0;
  }

  defaultY(slot: number): number {
    return this.slot(slot)?.decoder.header.y ?? 0;
  }

  /** Drapeaux de l'en-tête du film (0x800, 0x1000, 0x8000… lus par les animations). */
  flags(slot: number): number {
    return this.slot(slot)?.decoder.header.flags ?? 0;
  }

  hasSound(slot: number): boolean {
    return this.slot(slot)?.decoder.header.sound != null;
  }

  /** Image attendue d'après l'horloge (-1 si le film n'a pas commencé ou est fini). */
  expectedFrame(slot: number): number {
    const video = this.slot(slot);
    if (!video || video.decoder.done || video.decoder.currentFrame < 0) return -1;
    const elapsed = this.vm!.host.now() - video.startTime;
    return elapsed < 0 ? -1 : Math.trunc((elapsed * video.frameRate) / 1000);
  }

  /** Millisecondes avant l'image suivante d'après l'horloge du film (getTimeToNextFrame). */
  timeToNextFrame(slot: number): number {
    const video = this.slot(slot);
    if (!video || video.decoder.done || video.decoder.currentFrame < 0) return 0;
    const elapsed = this.vm!.host.now() - video.startTime;
    const next = Math.trunc(((video.decoder.currentFrame + 1) * 1000) / video.frameRate);
    return next <= elapsed ? 0 : next - elapsed;
  }

  /** Copie une partie de l'image courante vers `dest` (VideoPlayer::copyFrame) ; `transp` -1 : opaque. */
  copyFrame(
    slot: number,
    dest: Surface,
    left: number,
    top: number,
    width: number,
    height: number,
    x: number,
    y: number,
    transp: number,
    mirror: boolean,
  ): boolean {
    const video = this.slot(slot);
    const src = video && this.surfaceOf(video);
    if (!src) return false;
    dest.blit(src, left, top, left + width - 1, top + height - 1, x, y, transp, mirror);
    return true;
  }

  private surfaceOf(video: Slot): Surface | null {
    if (video.sprite < 0) return video.scratch;
    if (video.sprite === FRONT_SURFACE) return this.gfx.draw.front;
    if (video.sprite === BACK_SURFACE) return this.gfx.draw.back;
    return this.gfx.draw.sprites[video.sprite] ?? null;
  }

  // --- lecture ---------------------------------------------------------------------------------

  private lastFrameReached(video: Slot, props: VideoProps): boolean {
    return props.startFrame === props.lastFrame || props.startFrame >= video.decoder.header.frameCount - 1;
  }

  /**
   * VideoPlayer::play : joue de `startFrame` à `lastFrame` (inclus ; plus petit : à l'envers) en attendant
   * la durée d'une image. `noBlock` : la lecture continue d'image en image par `update`.
   */
  async playVideo(slot: number, props: VideoProps): Promise<boolean> {
    const video = this.slot(slot);
    if (!video) return false;
    const vm = this.vm!;
    const primary = slot === 0;
    const { decoder } = video;

    if (props.startFrame < 0) props.startFrame = decoder.currentFrame + 1;
    if (props.lastFrame < 0) props.lastFrame = decoder.header.frameCount - 1;
    if (props.endFrame < 0) props.endFrame = props.lastFrame;
    if (props.palFrame < 0) props.palFrame = props.startFrame;
    props.startFrame--;
    props.endFrame--;
    props.palFrame--;

    if (primary) {
      this.gfx.core.showCursor = video.noCursorSwitch ? 3 : 0;
      if (props.fade) await this.gfx.palette.fade(null, -2);
    }

    const backwards = props.startFrame > props.lastFrame;
    props.canceled = false;

    if (props.noBlock) {
      props.waitEndFrame = false;
      video.live = true;
      video.props = props;
      await this.updateVideo(slot, true);
      return true;
    }

    // Lost in Time : toutes les vidéos s'interrompent par Échap, quelle que soit la touche du script.
    props.breakKey = KEY_ESCAPE_SHORT;

    while (!this.lastFrameReached(video, props) && !vm.quit) {
      await this.playFrame(slot, props);
      if (props.canceled) break;
      props.startFrame += backwards ? -1 : 1;
      if (primary && props.fade) {
        await this.gfx.palette.fade(this.gfx.core.wanted, -2);
        props.fade = false;
      }
      // Écart avec l'original : les vidéos « à curseur » sont aussi cadencées (sinon elles s'exécuteraient d'un trait).
      if (props.waitEndFrame) await this.waitEndFrame(slot);
    }
    return true;
  }

  /** Attend la durée d'une image du film (au moins une image d'affichage). */
  async waitEndFrame(slot: number, onlySound = false): Promise<void> {
    const video = this.slot(slot);
    if (!video) return;
    const hasSound = video.decoder.header.sound !== null;
    if (onlySound && !hasSound) return;
    const wait = hasSound ? this.timeToNextFrame(slot) : Math.trunc(1000 / video.frameRate);
    await this.vm!.sleep(Math.max(1, wait));
  }

  /**
   * Un pas de lecture pour les vidéos live (updateVideos) : décode l'image suivante si son heure est
   * venue ; la fin du film libère l'emplacement et met la variable 53 à -1.
   */
  async update(force = false): Promise<void> {
    for (let i = 0; i < VIDEO_SLOT_COUNT; i++) await this.updateVideo(i, force);
  }

  private async updateVideo(slot: number, force: boolean): Promise<void> {
    const video = this.slot(slot);
    if (!video || !video.live) return;
    const vars = this.vm!.vars;
    const props = video.props;
    const live = [...this.slots].filter((s) => s?.live).length;

    if (props.startFrame >= video.decoder.header.frameCount - 1) {
      if (!props.loop) {
        if (!(props.flags & VIDEO_FLAG_NO_VIDEO) || live === 1) vars.writeVar32(53, -1);
        this.closeVideo(slot);
        return;
      }
      video.decoder.seek(-1);
      props.startFrame = -1;
    }
    if (props.startFrame === props.lastFrame) return;
    if (!force && this.timeToNextFrame(slot) > 0) return;
    if (!(props.flags & VIDEO_FLAG_NO_VIDEO) || live === 1) vars.writeVar32(53, props.startFrame + 1);

    const backwards = props.startFrame > props.lastFrame;
    await this.playFrame(slot, props);
    props.startFrame += backwards ? -1 : 1;
    if (props.fade) {
      await this.gfx.palette.fade(this.gfx.core.wanted, -2);
      props.fade = false;
    }
  }

  /** VideoPlayer::playFrame : décode (et affiche) une image. */
  private async playFrame(slot: number, props: VideoProps): Promise<boolean> {
    const video = this.slot(slot);
    if (!video) return false;
    const vm = this.vm!;
    const { core, draw } = this.gfx;
    const { decoder } = video;
    const primary = slot === 0;

    if (decoder.currentFrame !== props.startFrame) {
      if (props.startFrame !== -1) {
        // Saut au milieu du film : impossible avec du son, sauf si on le force
        if (video.soundEnabled) {
          if (props.forceSeek) {
            this.disableSound(video);
            decoder.seek(props.startFrame);
          }
        } else decoder.seek(props.startFrame);
      } else {
        // Retour au début
        this.disableSound(video);
        decoder.seek(-1);
        if (decoder.header.sound) video.soundEnabled = true;
      }
    }

    // Le film est déjà plus loin que l'image voulue
    if (decoder.currentFrame > props.startFrame) return true;

    const target = this.surfaceOf(video)!;
    const onBack = video.sprite === BACK_SURFACE;
    let modifiedPal = false;
    if (primary) {
      if (props.startFrame === props.palFrame || (props.startFrame === props.endFrame && props.palCmd === 8)) {
        modifiedPal = true;
        core.applyPal = true;
        if (props.palCmd >= 4) this.copyPalette(video, props.palStart, props.palEnd);
      }
      if (modifiedPal && props.palCmd === 8 && !onBack) core.setFullPalette();
      if (video.needBlit) draw.forceBlit();
    }

    decoder.surface = target;
    const frame = decoder.decodeNextFrame();
    if (frame) {
      if (decoder.currentFrame === 0) video.startTime = vm.host.now();
      if (frame.audio && video.soundEnabled && decoder.header.sound) {
        this.getAudio()?.queueImdSlice(frame.audio, decoder.header.sound.frequency);
      }
    }
    vm.vars.writeVar32(11, decoder.currentFrame);

    if (frame && primary) {
      if (video.needBlit) draw.back.blitAll(draw.front);
      if (modifiedPal && props.palCmd === 16) {
        if (onBack) draw.forceBlit();
        await this.gfx.palette.fade(core.wanted, -2);
        draw.noInvalidated = true;
        core.touch();
      }
      if (props.palCmd > 1) {
        this.copyPalette(video, props.palStart, props.palEnd);
        if (!onBack) core.setFullPalette();
        else core.applyPal = true;
      }
      if (modifiedPal && props.palCmd === 8 && onBack) core.setFullPalette();

      const rect = frame.rect;
      if (onBack) {
        if (rect) draw.invalidateRect(rect.left, rect.top, rect.right - 1, rect.bottom - 1);
        if (!video.live) draw.blitInvalidated();
      } else if (video.sprite === FRONT_SURFACE) {
        core.touch();
      }
      if (modifiedPal && (props.palCmd === 2 || props.palCmd === 4)) await this.gfx.palette.fade(core.wanted, -2);
    }

    if (primary && props.waitEndFrame) this.checkAbort(video, props);
    // Une image que l'on ne voulait pas a été jouée : on ne compte pas ce pas
    if (decoder.currentFrame - 1 < props.startFrame) props.startFrame--;
    return true;
  }

  /** Recopie la plage [palStart, palEnd] de la palette du film dans celle du jeu (6 bits dans les deux). */
  private copyPalette(video: Slot, palStart: number, palEnd: number): void {
    if (palStart < 0) palStart = 0;
    if (palEnd < 0) palEnd = 255;
    const from = video.decoder.palette;
    this.gfx.core.wanted.set(from.subarray(palStart * 3, (palEnd + 1) * 3), palStart * 3);
  }

  /** VideoPlayer::checkAbort : Échap interrompt et se place sur la dernière image de la séquence. */
  private checkAbort(video: Slot, props: VideoProps): void {
    const vm = this.vm!;
    if (vm.quit) {
      this.disableSound(video);
      props.canceled = true;
      return;
    }
    if (props.breakKey === 0) return;
    vm.storeKey(vm.host.input.popKey());
    let pressed = vm.vars.readVar32(0) === props.breakKey;
    if (props.breakKey === 4 && vm.vars.readVar32(0) !== 0) pressed = true;
    if (props.breakKey < 4 && (vm.mouseButtons & props.breakKey) !== 0) pressed = true;
    if (!pressed) return;
    this.disableSound(video);
    // Certains scripts comptent sur cette position
    video.decoder.seek(props.endFrame);
    props.canceled = true;
  }

  private disableSound(video: Slot): void {
    if (video.decoder.header.sound) this.getAudio()?.stopImdAudio();
    video.soundEnabled = false;
  }
}
