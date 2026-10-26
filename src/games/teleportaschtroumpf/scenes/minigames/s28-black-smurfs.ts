import type { Hy8, Hy8Frame } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import type { Timer } from "../../engine/clock";
import type { Scene, SceneContext } from "../../engine/scene";
import { AnimationPlayer } from "../../engine/sprites";
import type { Game } from "../../game/rules";
import {
  Clip,
  SoundHush,
  goalClip,
  ingredientOutcome,
  minigameLevel,
  minigameRequest,
  sceneIngredient,
  type MinigameDone,
  type MinigameFactory,
} from "./common";

/** Ingrédient de la scène (`1e52:0034(joueur, 6)`). */
const INGREDIENT = sceneIngredient(28)!;

/** Vidéo de réussite : `s28c2` quand l'ingrédient 6 est dans l'objectif (`1e52:0008(6)` vrai, `2573:03c8..03dc`), `s28c1` sinon. */
export function blackSmurfsWinClip(game: Game): string {
  return goalClip(game, INGREDIENT, { inGoal: "s28c2.mux", notInGoal: "s28c1.mux" });
}

/**
 * S28 « Les Schtroumpfs Noirs » (`2573:000f`, 1 001 octets, avec `2573:03f8` pour les cibles et `2573:06e3` pour le clic ; RE :
 * `docs/teleportaschtroumpf/minigames/s28.md`).
 *
 * ### `createBlackSmurfs(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 28) : `level` 0..2 rétrécit la zone qui touche une
 *   cible de 0, 4 ou 8 pixels de chaque côté, `bonus` (indice de l'oiseau) force le niveau 0 ;
 * - joue : des Schtroumpfs noirs sortent de huit trous, l'un après l'autre. Les flèches (ou `Z`, `Q`, `X`, `A`) déplacent le viseur de
 *   5 pixels par image ; la souris le place sous le pointeur. Espace (ou clic gauche) tire, là où le viseur était à l'appui. Une cible qu'on laisse plus de 3 s perd la partie ;
 *   un tir qui rate ne coûte rien. La partie est gagnée quand dix cibles sont apparues sans une seule oubliée ;
 * - rend : `onDone(ctx, { kind: "ingredient", success })` à la fin de la vidéo de fin (`s28c2` si l'ingrédient 6 fait partie de l'objectif
 *   de la partie, `s28c1` sinon, `s28b` en cas d'échec ; toutes passables) ; l'appelant applique l'issue (ingrédient 6).
 */

/** Zone qui touche la cible : `x` dans `]gauche + marge, droite − marge[`, `y` dans `]haut + marge, bas − marge[` (`2573:073c..0975`). */
export interface HitZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TargetSpec {
  /** Fichier HY8 de la cible : `a` = `s28a000s.hy8`, `b` = `s28a001s.hy8`. */
  file: "a" | "b";
  /** Animation de sortie ; la chute est l'animation suivante (`+ 1`). */
  animation: number;
  /** Bord gauche et ligne du bas du sprite (`DS:7525`, `DS:7523`). */
  x: number;
  y: number;
  /** La cible peut être touchée quand le compteur d'images de l'animation dépasse cette valeur (`DS:751B`). */
  rise: number;
  zone: HitZone;
}

/** Les huit cibles, dans l'ordre du tirage `rand × 8` (`2573:042d`, table `CS:06d3`). */
export const TARGETS: readonly TargetSpec[] = [
  { file: "a", animation: 0, x: 0x29, y: 0xa0, rise: 2, zone: { left: 0x17, right: 0x46, top: 0x53, bottom: 0x8f } },
  { file: "a", animation: 2, x: 0xa5, y: 0x8f, rise: 1, zone: { left: 0x6c, right: 0x95, top: 0x57, bottom: 0x8c } },
  { file: "a", animation: 4, x: 0x95, y: 0x9e, rise: 2, zone: { left: 0x81, right: 0xaf, top: 0x53, bottom: 0x8f } },
  { file: "a", animation: 6, x: 0x12d, y: 0xc3, rise: 1, zone: { left: 0xef, right: 0x11a, top: 0x8f, bottom: 0xc1 } },
  { file: "b", animation: 0, x: 0xb9, y: 0x45, rise: 1, zone: { left: 0xda, right: 0xfb, top: 0x14, bottom: 0x4b } },
  { file: "b", animation: 2, x: 0xfa, y: 0xaf, rise: 2, zone: { left: 0xf0, right: 0x116, top: 0x6e, bottom: 0xa5 } },
  { file: "b", animation: 4, x: 0x3a, y: 0x76, rise: 2, zone: { left: 0x34, right: 0x57, top: 0x36, bottom: 0x67 } },
  { file: "b", animation: 6, x: 0x55, y: 0x0e, rise: 5, zone: { left: 0x1c, right: 0x4a, top: 0x23, bottom: 0x6e } },
];

/** Marge retirée de chaque côté de la zone selon le niveau 0..2 (`DS:7515` : 0, 4, 8). */
export const HIT_MARGINS: readonly number[] = [0, 4, 8];

/** Nombre d'apparitions comptées avant la fin (`DS:7519 < 10`) : la dixième n'est jamais dessinée. */
export const TARGET_COUNT = 10;

/** Le viseur démarre au centre (`14b3:0039` recentre la souris à `(0xA0, 0x64)` avant la boucle). */
export const START_X = 0xa0;
export const START_Y = 0x64;
/** Pixels par image dans chaque direction (`2573:0222..0243`). */
export const CURSOR_STEP = 5;

/** Une cible attend 2 s (chrono 3, `>= 2`) avant de sortir ; sortie finie, elle reste 3 s (chrono 2, `> 2`). */
const WAIT_SECONDS = 2;
const UP_SECONDS = 2;

/** Cadence de la boucle (`1f33:0348(5)`) : une itération au plus tous les 5 ticks (12 par seconde). */
const LOOP_TICKS = 5;
/** `14b3:000d` attend 2 × 3 centièmes de seconde avant la boucle (≈ 4 ticks). */
const START_GAP_TICKS = 4;
/** Attente après l'échec, écran noir (`1f33:00fc(0x28)`) : 40 centièmes de seconde. */
const FAIL_WAIT_TICKS = 24;

/** Animation d'impact d'un tir raté (`s28a000s.hy8`, 5 images) et sprite du viseur (`s28a001s.hy8`, 56 + 0..3). */
const ANIMATION_MISS = 8;
const CURSOR_SPRITE = 0x38;

/** État de la cible (`DS:7521`). */
export const TARGET_UP = 1;
export const TARGET_WAITING = 2;
export const TARGET_MISSED = 3;
export const TARGET_HIT = 4;
export type TargetState = typeof TARGET_UP | typeof TARGET_WAITING | typeof TARGET_MISSED | typeof TARGET_HIT;

/** Marge de la zone de tir au niveau 0..2. */
export function hitMargin(level: number): number {
  return HIT_MARGINS[level] ?? 0;
}

/** Le tir en `(x, y)` touche la cible : strictement à l'intérieur de la zone réduite de `margin` de chaque côté (`2573:073c..0975`). */
export function isHit(target: TargetSpec, x: number, y: number, margin: number): boolean {
  const { left, right, top, bottom } = target.zone;
  return x > left + margin && x < right - margin && y > top + margin && y < bottom - margin;
}

export type BlackSmurfsPhase = "play" | "hush" | "fadeOut" | "pause" | "result" | "done";

interface Draw {
  frame: Hy8Frame;
  x: number;
  y: number;
}

export class BlackSmurfsScene implements Scene {
  readonly step = 1;
  private readonly level: number;
  private mcg!: Mcg;
  private spritesA!: Hy8;
  private spritesB!: Hy8;
  private hitVoc!: Voc;
  private missVoc!: Voc;
  private win!: Clip;
  private fail!: Clip;
  private result: Clip | null = null;
  private phase: BlackSmurfsPhase = "play";
  private started = false;
  private waitTimer: Timer | null = null;
  private upTimer: Timer | null = null;
  private nextAt = 0;
  private count = 0;
  private cursorX = START_X;
  private cursorY = START_Y;
  private keys = { left: false, right: false, up: false, down: false, click: false };
  /** Dernière position lue de la souris : le viseur ne la rejoint que quand elle bouge. */
  private mouse = { x: START_X, y: START_Y };
  /** Tir demandé depuis la dernière itération : position du viseur au moment de l'appui. */
  private shot: { x: number; y: number } | null = null;
  private clickFrames = 0;
  private clicking = false;
  private state: TargetState = TARGET_WAITING;
  private roll = -1;
  private target: TargetSpec = TARGETS[0];
  private targetPlayer: AnimationPlayer | null = null;
  private targetFrame: Hy8Frame | null = null;
  private falling = false;
  private hittable = false;
  private appeared = 0;
  private shots = 0;
  private hits = 0;
  private misses = 0;
  private failed = false;
  private effect: AnimationPlayer | null = null;
  private effectAt = { x: 0, y: 0 };
  private targetDraw: Draw | null = null;
  private effectDraw: Draw | null = null;
  private readonly hushing = new SoundHush();
  private pauseStart = 0;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    this.level = minigameLevel(minigameRequest(game, 28), 0);
  }

  get stage(): BlackSmurfsPhase {
    return this.phase;
  }

  /** Niveau interne (0..2) : celui du joueur, 0 avec l'indice de l'oiseau. */
  get internalLevel(): number {
    return this.level;
  }

  /** Marge retirée de la zone de tir (0, 4 ou 8 pixels). */
  get margin(): number {
    return hitMargin(this.level);
  }

  /** Position du viseur (pour les tests). */
  get cursor(): { x: number; y: number } {
    return { x: this.cursorX, y: this.cursorY };
  }

  /** Image du viseur : 0 au repos, 1 à 3 pendant les trois images qui suivent un tir (sprite `0x38 + n`). */
  get cursorFrame(): number {
    return this.clickFrames;
  }

  get targetState(): TargetState {
    return this.state;
  }

  /** Indice (0..7) de la cible tirée en dernier, −1 avant le premier tirage. */
  get targetIndex(): number {
    return this.roll;
  }

  /** La cible est sortie et peut être touchée (`DS:7511`). */
  get canHit(): boolean {
    return this.hittable;
  }

  /** Cibles apparues (`DS:7519`), touchées, tirs ratés. */
  get appearances(): number {
    return this.appeared;
  }

  /** Tirs comptés (un par appui ; le bouton tenu ne répète pas). */
  get shotCount(): number {
    return this.shots;
  }

  get hitCount(): number {
    return this.hits;
  }

  get missCount(): number {
    return this.misses;
  }

  /** Vrai si une cible est restée trop longtemps : la partie est perdue (`DS:7514`). */
  get hasFailed(): boolean {
    return this.failed;
  }

  /** Itérations de la boucle faites (une toutes les 5 ticks au plus ; pour les tests). */
  get iterations(): number {
    return this.count;
  }

  async load(ctx: SceneContext): Promise<void> {
    this.win = new Clip(blackSmurfsWinClip(this.game), (c) => this.finish(c));
    this.fail = new Clip("s28b.mux", (c) => this.finish(c));
    [this.mcg, this.spritesA, this.spritesB, this.hitVoc, this.missVoc] = await Promise.all([
      ctx.resources.mcg("s28a001d.mcg"),
      ctx.resources.hy8("s28a000s.hy8"),
      ctx.resources.hy8("s28a001s.hy8"),
      ctx.resources.voc("s28a002b.voc"),
      ctx.resources.voc("s28a003b.voc"),
      this.win.load(ctx),
      this.fail.load(ctx),
    ]);
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    this.phase = "play";
    this.started = false;
    this.waitTimer = null;
    this.upTimer = null;
    this.count = 0;
    this.cursorX = START_X;
    this.cursorY = START_Y;
    this.keys = { left: false, right: false, up: false, down: false, click: false };
    this.shot = null;
    this.clickFrames = 0;
    this.clicking = false;
    this.state = TARGET_WAITING;
    this.roll = -1;
    this.targetPlayer = null;
    this.targetFrame = null;
    this.falling = false;
    this.hittable = false;
    this.appeared = 0;
    this.shots = 0;
    this.hits = 0;
    this.misses = 0;
    this.failed = false;
    this.effect = null;
    this.targetDraw = null;
    this.effectDraw = null;
    this.result = null;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "play": {
        if (ctx.fade.active) return;
        if (!this.started) this.start(ctx);
        this.readKeys(ctx);
        if (ctx.clock.ticks >= this.nextAt) this.iterate(ctx);
        return;
      }
      case "hush":
        this.updateHush(ctx);
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        if (this.failed) {
          // `13fc:0411` puis 0,4 s d'écran noir avant la vidéo d'échec.
          this.phase = "pause";
          this.pauseStart = ctx.clock.ticks;
          return;
        }
        this.startResult(ctx, this.win);
        return;
      case "pause":
        if (ctx.clock.ticks - this.pauseStart >= FAIL_WAIT_TICKS) this.startResult(ctx, this.fail);
        return;
      case "result":
        this.result!.update(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    if (this.phase === "result" || this.phase === "done") {
      this.result?.render(ctx);
      return;
    }
    const { surface } = ctx;
    surface.restoreBackground();
    if (this.phase === "fadeOut" || this.phase === "pause") return;
    if (this.targetDraw) surface.drawFrame(this.targetHy8(this.target), this.targetDraw.frame, this.targetDraw.x, this.targetDraw.y);
    if (this.effectDraw) surface.drawFrame(this.spritesA, this.effectDraw.frame, this.effectDraw.x, this.effectDraw.y);
    surface.drawSprite(this.spritesB, CURSOR_SPRITE + this.clickFrames, this.cursorX, this.cursorY);
  }

  exit(ctx: SceneContext): void {
    this.win.stop(ctx);
    this.fail.stop(ctx);
    ctx.voice.holdMusic(false);
    this.hushing.restore(ctx);
  }

  private targetHy8(target: TargetSpec): Hy8 {
    return target.file === "a" ? this.spritesA : this.spritesB;
  }

  /** `14b3:000d` : clavier et souris remis à zéro (le viseur au centre attend que la souris bouge) ; les deux chronos de la partie démarrent. */
  private start(ctx: SceneContext): void {
    this.started = true;
    this.waitTimer = ctx.clock.createTimer();
    this.upTimer = ctx.clock.createTimer();
    this.mouse = { x: ctx.input.mouseX, y: ctx.input.mouseY };
    this.nextAt = ctx.clock.ticks + START_GAP_TICKS;
  }

  /**
   * L'original lit les touches tenues à chaque itération ; la scène tourne à chaque tick, elle retient donc ce qui a été enfoncé depuis
   * la dernière itération (un appui plus court que 5 ticks compte). La souris, elle, place le viseur sous le pointeur dès qu'elle
   * bouge (voir « Écarts ») ; un appui note la position visée à cet instant, le tir part de là à l'itération suivante.
   */
  private readKeys(ctx: SceneContext): void {
    const { input } = ctx;
    if (input.mouseX !== this.mouse.x || input.mouseY !== this.mouse.y) {
      this.mouse = { x: input.mouseX, y: input.mouseY };
      this.cursorX = this.mouse.x;
      this.cursorY = this.mouse.y;
    }
    const keys = this.keys;
    keys.left ||= input.pressed("left") || input.justPressed("left");
    keys.right ||= input.pressed("right") || input.justPressed("right");
    keys.up ||= input.pressed("up") || input.justPressed("up");
    keys.down ||= input.pressed("down") || input.justPressed("down");
    keys.click ||= input.pressed("validate") || input.justPressed("validate");
    if (input.justPressed("validate")) this.shot ??= { x: this.cursorX, y: this.cursorY };
  }

  /** Une itération de la boucle de `2573:015e..0321`. */
  private iterate(ctx: SceneContext): void {
    this.nextAt = ctx.clock.ticks + LOOP_TICKS;
    this.count++;

    // Déplacement au clavier (`2573:019c..0243`) : 5 pixels par direction ; la souris est lue à chaque tick (`readKeys`).
    const keys = this.keys;
    if (keys.right) this.cursorX += CURSOR_STEP;
    if (keys.left) this.cursorX -= CURSOR_STEP;
    if (keys.up) this.cursorY -= CURSOR_STEP;
    if (keys.down) this.cursorY += CURSOR_STEP;
    if (keys.click) this.clicking = true;
    const shot = this.shot;
    this.keys = { left: false, right: false, up: false, down: false, click: false };
    this.shot = null;

    this.stepTarget(ctx);
    const missed = !this.failed && shot !== null && this.handleShot(ctx, shot);

    // Impact d'un tir raté : une seule animation à la fois, posée à l'endroit du tir (`2573:0285..02d0`).
    if (missed && !this.effect) {
      this.effect = new AnimationPlayer(this.spritesA, ANIMATION_MISS);
      this.effectAt = { ...shot };
    }
    this.effectDraw = null;
    if (this.effect) {
      this.effectDraw = { frame: this.effect.frame!, ...this.effectAt };
      this.effect.advance();
      if (this.effect.frameIndex === 0) this.effect = null;
    }

    // Le viseur s'enfonce pendant les trois images qui suivent un tir (`2573:02d4..02e6`).
    if (this.clicking) {
      this.clickFrames++;
      if (this.clickFrames > 3) {
        this.clickFrames = 0;
        this.clicking = false;
      }
    }

    if (this.failed || this.appeared >= TARGET_COUNT) this.startHush(ctx);
  }

  /** `2573:03f8` : une cible à la fois, qui attend, sort, est touchée (chute) ou oubliée (fin de partie). */
  private stepTarget(ctx: SceneContext): void {
    this.targetDraw = null;
    if (this.state === TARGET_WAITING) {
      // Le tirage est refait à chaque itération d'attente : seul le dernier compte (`2573:0409`).
      this.roll = ctx.rng.below(TARGETS.length);
      this.target = TARGETS[this.roll];
      this.targetPlayer = new AnimationPlayer(this.targetHy8(this.target), this.target.animation);
    }
    if (this.state === TARGET_MISSED) this.failed = true;
    if (this.state === TARGET_UP) {
      const player = this.targetPlayer!;
      this.hittable = false;
      if (player.frameIndex > this.target.rise) {
        this.hittable = true;
      } else {
        this.targetFrame = player.frame ?? null;
        player.advance();
        this.upTimer = ctx.clock.createTimer();
      }
      this.targetDraw = this.drawTarget();
      if (this.upTimer!.seconds > UP_SECONDS) this.state = TARGET_MISSED;
    }
    if (this.state === TARGET_WAITING && this.waitTimer!.seconds >= WAIT_SECONDS) {
      this.state = TARGET_UP;
      this.appeared++;
    }
    if (this.state === TARGET_HIT) {
      if (!this.falling) {
        this.targetPlayer = new AnimationPlayer(this.targetHy8(this.target), this.target.animation + 1);
        this.falling = true;
      }
      const player = this.targetPlayer!;
      this.targetFrame = player.frame ?? null;
      player.advance();
      this.targetDraw = this.drawTarget();
      if (player.frameIndex === 0) {
        this.state = TARGET_WAITING;
        this.waitTimer = ctx.clock.createTimer();
        this.falling = false;
      }
    }
  }

  private drawTarget(): Draw | null {
    return this.targetFrame ? { frame: this.targetFrame, x: this.target.x, y: this.target.y } : null;
  }

  /**
   * `2573:06e3` : un tir par appui (le bouton tenu ne répète pas), en `at`, la position visée à l'appui. Touche si la cible est sortie et
   * `at` dans sa zone ; sinon son de raté, sauf pendant la chute d'une cible déjà touchée, où l'original rejoue le son de touche. Rend
   * vrai pour un raté.
   */
  private handleShot(ctx: SceneContext, at: { x: number; y: number }): boolean {
    this.shots++;
    if (this.hittable && this.state === TARGET_UP && isHit(this.target, at.x, at.y, this.margin)) {
      this.state = TARGET_HIT;
      this.hits++;
    }
    if (this.state === TARGET_HIT) {
      ctx.voice.playEffect(this.hitVoc);
      return false;
    }
    ctx.voice.playEffect(this.missVoc);
    this.misses++;
    return true;
  }

  /** Fin de la boucle : le son s'éteint par crans (`1343:0037`), comme à la fin de S29. */
  private startHush(ctx: SceneContext): void {
    this.phase = "hush";
    this.hushing.start(ctx);
    ctx.voice.holdMusic(true);
  }

  private updateHush(ctx: SceneContext): void {
    if (!this.hushing.update(ctx)) return;
    this.phase = "fadeOut";
    ctx.fade.out();
  }

  private startResult(ctx: SceneContext, clip: Clip): void {
    this.phase = "result";
    this.result = clip;
    clip.start(ctx);
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, ingredientOutcome(!this.failed));
  }
}

export const createBlackSmurfs: MinigameFactory = (game, onDone) => new BlackSmurfsScene(game, onDone);
