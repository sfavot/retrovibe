import type { Hy8 } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import { AnimationPlayer } from "../../engine/sprites";
import type { Game } from "../../game/rules";
import { Clip, minigameRequest, pointsOutcome, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S30 « Le Pont de la Rivière Schtroumpfs » (`2d6b:0008`, 745 octets, et son rappel par image `2d6b:02f1` ; RE : `docs/teleportaschtroumpf/minigames/s30.md`).
 *
 * ### `createBridge(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 30) : `bonus` (indice de l'oiseau : `local_3 = 3`) ; le niveau du joueur n'est pas lu ;
 * - joue : la vidéo `s30a` (non passable) pendant laquelle un clic (Espace / clic gauche) aux images 0x36 à 0x3E fait sauter le Schtroumpf ; l'image du clic
 *   décide : trop tôt (0x36..0x38) il tombe à l'eau (`s30z`), puis 1 point (0x39..0x3B), 2 points (0x3C, 0x3D) ou 3 points (0x3E) ; hors fenêtre ou sans clic : rien ;
 * - rend : `onDone(ctx, { kind: "points", points })` (0 sans gain, sinon 1 à 3 ; 3 avec l'indice de l'oiseau) ; l'appelant applique l'issue.
 */

/** Fenêtre de clic (images de la vidéo, `2d6b:02f1`). */
export const FIRST_FRAME = 0x36;
export const LAST_FRAME = 0x3e;
/** Avant cette image un clic est oublié ; aux images 0x34 et 0x35 et après 0x3E il est perdu (une seule tentative). */
export const FORGET_BEFORE = 0x34;
export const SNAPSHOT_FRAME = 0x35;

/** Abscisse du sprite de saut par image de la fenêtre (`CS:2d6b:0434`), ordonnée 0xA5. */
export const JUMP_X: readonly number[] = [0x6a, 0x74, 0x7e, 0x88, 0x92, 0xa8, 0xbc, 0xca, 0xe0];
const JUMP_Y = 0xa5;

export type Landing = { kind: "fall" } | { kind: "land"; x: number; y: number; points: number; voice: number };

/** Issue d'un clic à l'image `frame` (`CS:2d6b:0422`) : `null` hors fenêtre. */
export function landingAt(frame: number, bonus: boolean): Landing | null {
  const d = frame - FIRST_FRAME;
  if (d < 0 || d > 8) return null;
  if (d <= 2) return { kind: "fall" };
  if (d <= 5) return { kind: "land", x: 0x80, y: 0xad, points: bonus ? 3 : 1, voice: 3 };
  if (d <= 7) return { kind: "land", x: 0xb5, y: 0xa9, points: bonus ? 3 : 2, voice: 2 };
  return { kind: "land", x: 0xf2, y: 0xa8, points: 3, voice: 1 };
}

const MS_TICKS = (cs: number) => Math.round(cs * 0.6);
const JUMP_FRAME_TICKS = MS_TICKS(5);
const LAND_FRAME_TICKS = 3;

export type BridgePhase = "video" | "jump" | "fall" | "land" | "voice" | "pause" | "wait" | "done";

export class BridgeScene implements Scene {
  readonly step = 1;
  private sprites!: Hy8;
  private mcg!: Mcg;
  private video!: Clip;
  private fallClip!: Clip;
  private voices: Voc[] = [];
  private phase: BridgePhase = "video";
  private latch = false;
  private consumed = false;
  private frame = -1;
  private snapshot: Uint8Array | null = null;
  private hit: Landing | null = null;
  private jumpX = 0;
  private player!: AnimationPlayer;
  private shown = 0;
  private points = 0;
  private since = 0;
  private skipVoice = false;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 30);
  }

  get stage(): BridgePhase {
    return this.phase;
  }

  /** Dernière image de `s30a` traitée (pour les tests). */
  get currentFrame(): number {
    return this.frame;
  }

  /** Issue du clic (pour les tests) : `null` sans clic valable. */
  get landing(): Landing | null {
    return this.hit;
  }

  async load(ctx: SceneContext): Promise<void> {
    this.video = new Clip("s30a.mux", (c) => this.videoEnded(c), {
      skippable: false,
      onFrame: (c, f) => this.onFrame(c, f),
      overlay: (c) => this.overlay(c),
    });
    this.fallClip = new Clip("s30z.mux", (c) => this.fellEnded(c), { skippable: false });
    const names = [voiceName("s30c", 3), voiceName("s30c", 2), voiceName("s30c", 1)];
    const [sprites, mcg, c3, c2, c1, b1, b2] = await Promise.all([
      ctx.resources.hy8("s30c001s.hy8"),
      ctx.resources.mcg("s30c001d.mcg"),
      ...names.map((n) => ctx.resources.voc(n)),
      ctx.resources.voc(voiceName("s30b", 1)),
      ctx.resources.voc(voiceName("s30b", 2)),
    ]);
    await Promise.all([this.video.load(ctx), this.fallClip.load(ctx)]);
    this.sprites = sprites;
    this.mcg = mcg;
    this.voices = [c3, c2, c1];
    this.badVoices = [b1, b2];
  }

  private badVoices: Voc[] = [];

  enter(ctx: SceneContext): void {
    this.phase = "video";
    this.latch = false;
    this.consumed = false;
    this.frame = -1;
    this.snapshot = null;
    this.hit = null;
    this.points = 0;
    this.done = false;
    this.video.start(ctx);
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "video":
        this.latch ||= ctx.input.pressed("validate") || ctx.input.justPressed("validate");
        this.video.update(ctx);
        return;
      case "jump": {
        const n = Math.floor((ctx.clock.ticks - this.since) / JUMP_FRAME_TICKS);
        if (n >= this.player.animation.frames.length) {
          if (this.hit?.kind === "fall") {
            this.phase = "fall";
            this.fallClip.start(ctx);
          } else {
            ctx.surface.background.set(this.mcg.pixels);
            this.player = new AnimationPlayer(this.sprites, 1);
            this.phase = "land";
            this.since = ctx.clock.ticks;
          }
          return;
        }
        this.shown = n;
        return;
      }
      case "fall":
        this.fallClip.update(ctx);
        return;
      case "land": {
        const n = Math.floor((ctx.clock.ticks - this.since) / LAND_FRAME_TICKS);
        if (n >= this.player.animation.frames.length) {
          if (this.hit?.kind === "land") this.playVoice(ctx, this.voices[3 - this.hit.voice], false);
          return;
        }
        this.shown = n;
        return;
      }
      case "voice":
        if (this.skipVoice && ctx.input.justPressed("validate")) ctx.voice.stop();
        if (ctx.voice.voicePlaying) return;
        if (this.hit?.kind === "land") {
          // `1f33:00fc(0x32)` : une demi-seconde, puis les points.
          this.phase = "pause";
          this.since = ctx.clock.ticks;
        } else {
          this.phase = "wait";
          this.since = ctx.clock.ticks;
        }
        return;
      case "pause":
        if (ctx.clock.ticks - this.since >= MS_TICKS(0x32)) {
          this.points = this.hit?.kind === "land" ? this.hit.points : 0;
          this.phase = "wait";
          this.since = ctx.clock.ticks;
        }
        return;
      case "wait":
        // `1f33:00fc(0xfa)` : 2,5 s avant de rendre la main.
        if (ctx.clock.ticks - this.since >= MS_TICKS(0xfa)) this.finish(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    const { surface } = ctx;
    switch (this.phase) {
      case "video":
        this.video.render(ctx);
        return;
      case "fall":
        this.fallClip.render(ctx);
        return;
      case "jump":
        surface.restoreBackground();
        surface.drawFrame(this.sprites, this.player.animation.frames[this.shown], this.jumpX, JUMP_Y);
        return;
      case "land":
        surface.restoreBackground();
        if (this.hit?.kind === "land") surface.drawFrame(this.sprites, this.player.animation.frames[this.shown], this.hit.x, this.hit.y);
        return;
      default:
        return;
    }
  }

  exit(ctx: SceneContext): void {
    this.video.stop(ctx);
    this.fallClip.stop(ctx);
  }

  /** Rappel par image de `s30a` (`2d6b:02f1`) : un clic dans la fenêtre fait sauter le Schtroumpf et arrête la vidéo. */
  private onFrame(_ctx: SceneContext, frame: number): "stop" | void {
    this.frame = frame;
    const click = this.latch;
    this.latch = false;
    if (this.consumed || !click) return;
    this.consumed = true;
    const landing = landingAt(frame, minigameRequest(this.game, 30).bonus);
    if (landing) {
      this.hit = landing;
      this.jumpX = JUMP_X[frame - FIRST_FRAME];
      return "stop";
    }
    if (frame < FORGET_BEFORE) this.consumed = false;
  }

  /** L'image 0x35 est gardée : elle sert de fond au saut (`12ec:037c(A, B)` dans le rappel). */
  private overlay(ctx: SceneContext): void {
    if (this.snapshot === null && this.frame >= SNAPSHOT_FRAME) this.snapshot = Uint8Array.from(ctx.surface.work);
  }

  private videoEnded(ctx: SceneContext): void {
    if (this.hit) {
      ctx.surface.background.set(this.snapshot ?? ctx.surface.work);
      this.player = new AnimationPlayer(this.sprites, 0);
      this.phase = "jump";
      this.since = ctx.clock.ticks;
      this.shown = 0;
      return;
    }
    // Sans clic valable : voix `s30b00N` (`rand × 2`), attente de sa fin (un clic la coupe).
    this.playVoice(ctx, this.badVoices[ctx.rng.below(2)], true);
  }

  private fellEnded(ctx: SceneContext): void {
    this.playVoice(ctx, this.badVoices[ctx.rng.below(2)], true);
  }

  private playVoice(ctx: SceneContext, voc: Voc, skippable: boolean): void {
    this.phase = "voice";
    this.skipVoice = skippable;
    ctx.voice.play(voc);
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, pointsOutcome(this.points));
  }
}

export const createBridge: MinigameFactory = (game, onDone) => new BridgeScene(game, onDone);
