import type { Hy8 } from "../../data/hy8";
import type { Voc } from "../../data/voc";
import { AnimationPlayer } from "../../engine/sprites";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import {
  Clip,
  goalClip,
  ingredientOutcome,
  minigameLevel,
  minigameRequest,
  sceneIngredient,
  type MinigameDone,
  type MinigameFactory,
} from "./common";
import { HeldFinger } from "./held-finger";

/**
 * S27 « La Luge » (`1f84:000e`, 696 octets ; RE : `docs/teleportaschtroumpf/minigames/s27.md`).
 *
 * ### `createSled(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 27) : `level` 0..2 choisit la vidéo de la descente, `bonus`
 *   (indice de l'oiseau) la remplace par le niveau 3 ;
 * - joue : une descente en vidéo MUX (`s27e/f`, `s27h`, `s27i/j`, `s27l`) sur laquelle on pilote la luge (gauche / droite : `Z`, `X` ou
 *   les flèches ; au doigt, la luge va vers le doigt posé) pour éviter les obstacles que la vidéo signale par ses marqueurs. Un obstacle
 *   touché interrompt la descente (animation de chute, son `s27a003b`, vidéo d'échec `s27b`) ; arriver au bout donne la vidéo `s27c1` /
 *   `s27c2` selon que l'ingrédient 2 fait partie de l'objectif ;
 * - rend : `onDone(ctx, { kind: "ingredient", success })` à la fin de la dernière vidéo (passable par Échap ou Espace) ; l'appelant applique
 *   l'issue.
 */

/** Ingrédient donné par la scène (`MINIGAMES`) : 2. */
const INGREDIENT = sceneIngredient(27)!;

/** Vidéo de réussite : `s27c2` quand l'ingrédient est dans l'objectif (`1e52:0008` vrai), `s27c1` sinon. */
export function sledWinClip(game: Game): string {
  return goalClip(game, INGREDIENT, { inGoal: "s27c2.mux", notInGoal: "s27c1.mux" });
}

/** Position de départ de la luge (`DS:6FA9`) et ligne du bas du sprite (`DS:6FA7`). */
export const SLED_START_X = 0xa0;
export const SLED_Y = 0x7e;
/** Déplacement par image de la vidéo et bornes (`1f84:0331..03aa`). */
export const SLED_STEP = 0x1e;
export const SLED_MIN_X = 0x40;
export const SLED_MAX_X = 0x100;
/**
 * Au doigt (ajout du port) : la luge (`s27a000s.hy8`, animation 0, centrée sur son abscisse) va vers le doigt posé, d'un pas par image
 * comme une flèche tenue, et s'arrête quand il est à moins d'un demi-pas de son milieu.
 */
export const SLED_TOUCH_DEAD_ZONE = SLED_STEP / 2;

/** Direction que vaut un doigt posé en `fingerX` pour une luge en `x`, ou `null`. */
export function sledTouchKey(x: number, fingerX: number): "left" | "right" | null {
  if (fingerX < x - SLED_TOUCH_DEAD_ZONE) return "left";
  if (fingerX > x + SLED_TOUCH_DEAD_ZONE) return "right";
  return null;
}

/** Limites des trois couloirs (`1f84:03d0`) : gauche `x < 0x69`, centre `0x69 < x < 0xd7`, droite `x > 0xd7`. */
export const LANE_LEFT_LIMIT = 0x69;
export const LANE_RIGHT_LIMIT = 0xd7;

/** Bits d'un marqueur (`DS:6DE4`) : obstacle à gauche, au centre, à droite ; la valeur 1 exacte marque l'arrivée. */
export const MARKER_LEFT = 2;
export const MARKER_CENTER = 4;
export const MARKER_RIGHT = 8;
export const MARKER_FINISH = 1;

/** Vidéos de la descente par niveau (0..2, 3 = indice de l'oiseau) : `[tirage nul, sinon]` (`1f84:00df..0186`). */
export const SLED_VIDEOS: readonly (readonly [string, string])[] = [
  ["s27f.mux", "s27e.mux"],
  ["s27h.mux", "s27h.mux"],
  ["s27j.mux", "s27i.mux"],
  ["s27l.mux", "s27i.mux"],
];

/** Animations de `s27a000s.hy8` : la luge qui glisse (8 images, `12d7:0144(·, 0)`) et la chute (2 images, `12d7:0144(·, 1)`). */
const ANIMATION_RIDE = 0;
const ANIMATION_CRASH = 1;

/** Durée d'une image de l'animation de chute (`1f33:00fc(0x19)` : 25 centièmes de seconde). */
const CRASH_FRAME_TICKS = 15;

/** Valeur numérique d'un marqueur MUX : `atoi` de son texte (`179a:01ae`, `1000:1728`). */
export function parseMarker(payload: Uint8Array): number {
  let text = "";
  for (const byte of payload) {
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return Number.parseInt(text, 10) || 0;
}

/** Valeur du marqueur d'une image : le dernier chunk 08 l'emporte (`DS:6DE4` est réécrit à chaque chunk) ; 0 sans marqueur. */
export function frameMarker(markers: readonly Uint8Array[]): number {
  return markers.length > 0 ? parseMarker(markers[markers.length - 1]) : 0;
}

/** La luge en `x` touche-t-elle un obstacle du marqueur (`1f84:03d0`) ? */
export function sledHits(x: number, marker: number): boolean {
  return (
    ((marker & MARKER_LEFT) !== 0 && x < LANE_LEFT_LIMIT) ||
    ((marker & MARKER_RIGHT) !== 0 && x > LANE_RIGHT_LIMIT) ||
    ((marker & MARKER_CENTER) !== 0 && x < LANE_RIGHT_LIMIT && x > LANE_LEFT_LIMIT)
  );
}

/** Nouvelle abscisse après une image avec les touches données (`1f84:0331` : la droite d'abord, puis la gauche). */
export function steer(x: number, left: boolean, right: boolean): number {
  let next = x;
  if (right) next = Math.min(SLED_MAX_X, next + SLED_STEP);
  if (left) next = Math.max(SLED_MIN_X, next - SLED_STEP);
  return next;
}

/**
 * La luge fait-elle un pas franc, qui déclenche le bruit `s27a002b` (`1f84:0331..03aa`) ? Après chaque pas, l'original ne lance le
 * bruit que si l'abscisse n'a pas été ramenée à sa borne : droite `x + 0x1E < 0x100`, gauche `x − 0x1E > 0x40` (la droite d'abord).
 */
export function sledStepSound(x: number, left: boolean, right: boolean): boolean {
  let next = x;
  let sound = false;
  if (right) {
    next += SLED_STEP;
    if (next < SLED_MAX_X) sound = true;
    else next = SLED_MAX_X;
  }
  if (left) {
    next -= SLED_STEP;
    if (next > SLED_MIN_X) sound = true;
  }
  return sound;
}

/** Vidéo de la descente : niveau effectif (le niveau du joueur, 3 avec l'indice de l'oiseau) et tirage `rand × 2` (0 ou 1). */
export function sledVideo(level: number, roll: number): string {
  const [zero, other] = SLED_VIDEOS[level] ?? SLED_VIDEOS[0];
  return roll === 0 ? zero : other;
}

export type SledPhase = "ride" | "crash" | "fadeOut" | "result" | "done";

export class SledScene implements Scene {
  readonly step = 1;
  private sprites!: Hy8;
  private crashVoc!: Voc;
  private stepVoc!: Voc;
  private ride!: Clip;
  private fail!: Clip;
  private win!: Clip;
  private result: Clip | null = null;
  private phase: SledPhase = "ride";
  private x = SLED_START_X;
  private rider!: AnimationPlayer;
  private shown: number | null = null;
  private crashed = false;
  private finished = false;
  private crashStart = 0;
  private crashFrame = -1;
  private left = false;
  private right = false;
  private readonly finger = new HeldFinger();
  private frame = -1;
  private fileName = "";
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 27);
  }

  get stage(): SledPhase {
    return this.phase;
  }

  /** Abscisse de la luge (pour les tests). */
  get position(): number {
    return this.x;
  }

  /** Numéro de la dernière image de la descente traitée, −1 avant la première (pour les tests). */
  get currentFrame(): number {
    return this.frame;
  }

  /** Vidéo de la descente choisie (pour les tests). */
  get video(): string {
    return this.fileName;
  }

  /** Vrai si la descente s'est terminée sur un obstacle. */
  get hasCrashed(): boolean {
    return this.crashed;
  }

  /** Vrai si la descente a pris fin sur le marqueur d'arrivée plutôt qu'à la fin de la vidéo. */
  get reachedFinish(): boolean {
    return this.finished;
  }

  async load(ctx: SceneContext): Promise<void> {
    const level = minigameLevel(minigameRequest(this.game, 27), 3);
    // Le tirage a lieu même au niveau 1, où les deux issues sont la même vidéo (`1f84:0139`).
    this.fileName = sledVideo(level, ctx.rng.below(2));
    this.ride = new Clip(this.fileName, (c) => this.rideEnded(c), {
      skippable: false,
      onFrame: (c, frame, markers) => this.onFrame(c, frame, markers),
      overlay: (c) => this.drawSled(c),
    });
    this.fail = new Clip("s27b.mux", (c) => this.finish(c));
    this.win = new Clip(sledWinClip(this.game), (c) => this.finish(c));
    [this.sprites, this.crashVoc, this.stepVoc] = await Promise.all([
      ctx.resources.hy8("s27a000s.hy8"),
      ctx.resources.voc("s27a003b.voc"),
      ctx.resources.voc("s27a002b.voc"),
      this.ride.load(ctx),
      this.fail.load(ctx),
      this.win.load(ctx),
    ]);
  }

  enter(ctx: SceneContext): void {
    this.phase = "ride";
    this.x = SLED_START_X;
    this.rider = new AnimationPlayer(this.sprites, ANIMATION_RIDE);
    this.shown = null;
    this.crashed = false;
    this.finished = false;
    this.left = false;
    this.right = false;
    this.finger.reset();
    this.frame = -1;
    this.done = false;
    this.ride.start(ctx);
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "ride": {
        // Un appui plus court qu'une image de la vidéo (≈ 5,5 ticks) compte quand même : l'original lit les touches tenues à chaque image.
        // Au doigt : vers le doigt posé, comme la flèche de son côté tenue.
        const { input } = ctx;
        const finger = this.finger.read(input);
        const touched = finger ? sledTouchKey(this.x, finger.x) : null;
        this.left ||= input.pressed("left") || input.justPressed("left") || touched === "left";
        this.right ||= input.pressed("right") || input.justPressed("right") || touched === "right";
        this.ride.update(ctx);
        return;
      }
      case "crash": {
        const elapsed = ctx.clock.ticks - this.crashStart;
        this.crashFrame = Math.min(1, Math.floor(elapsed / CRASH_FRAME_TICKS) - 1);
        // `1f33:03a7(0)` : on attend la fin du son de chute avant le fondu.
        if (this.crashFrame >= 1 && !ctx.voice.voicePlaying) {
          this.phase = "fadeOut";
          ctx.fade.out();
        }
        return;
      }
      case "fadeOut":
        if (ctx.fade.active) return;
        this.phase = "result";
        this.result = this.fail;
        this.fail.start(ctx);
        return;
      case "result":
        this.result!.update(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    switch (this.phase) {
      case "ride":
        this.ride.render(ctx);
        return;
      case "crash":
      case "fadeOut": {
        // Le fond de la chute est la dernière image avec la luge dessinée (`12ec:037c` dans le rappel) ; la chute se dessine par-dessus.
        const { surface } = ctx;
        surface.restoreBackground();
        if (this.crashFrame >= 0) surface.drawFrame(this.sprites, this.sprites.animations[ANIMATION_CRASH].frames[this.crashFrame], this.x, SLED_Y);
        return;
      }
      case "result":
        this.result!.render(ctx);
        return;
      case "done":
        return;
    }
  }

  exit(ctx: SceneContext): void {
    this.ride.stop(ctx);
    this.fail.stop(ctx);
    this.win.stop(ctx);
  }

  /** Rappel par image de la descente (`1f84:02ce`) : direction, animation de la luge, obstacles et arrivée. */
  private onFrame(ctx: SceneContext, frame: number, markers: readonly Uint8Array[]): "stop" | void {
    this.frame = frame;
    // Bruitage mélangé `348d:0b42` : s'ajoute au son de la vidéo, seulement si aucun bruitage ne sonne.
    if (sledStepSound(this.x, this.left, this.right) && !ctx.voice.effectPlaying) ctx.voice.playEffect(this.stepVoc);
    this.x = steer(this.x, this.left, this.right);
    this.left = false;
    this.right = false;
    this.shown = this.rider.frameIndex;
    this.rider.advance();
    const marker = frameMarker(markers);
    if (sledHits(this.x, marker)) this.crashed = true;
    else if (marker === MARKER_FINISH) this.finished = true;
    if (this.crashed || this.finished) return "stop";
  }

  private drawSled(ctx: SceneContext): void {
    if (this.shown === null) return;
    ctx.surface.drawFrame(this.sprites, this.sprites.animations[ANIMATION_RIDE].frames[this.shown], this.x, SLED_Y);
  }

  /** Fin de la descente : obstacle (animation de chute) ou arrivée (vidéo de réussite, sans fondu). */
  private rideEnded(ctx: SceneContext): void {
    if (this.crashed) {
      ctx.surface.commitBackground();
      this.phase = "crash";
      this.crashStart = ctx.clock.ticks;
      this.crashFrame = -1;
      ctx.voice.play(this.crashVoc);
      return;
    }
    this.phase = "result";
    this.result = this.win;
    this.win.start(ctx);
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, ingredientOutcome(!this.crashed));
  }
}

export const createSled: MinigameFactory = (game, onDone) => new SledScene(game, onDone);
