import type { Hy8, Hy8Frame } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { TICKS_PER_SECOND, type Timer } from "../../engine/clock";
import type { Scene, SceneContext } from "../../engine/scene";
import { AnimationPlayer } from "../../engine/sprites";
import type { Game } from "../../game/rules";
import { Clip, SoundHush, levelTimeLimit, minigameLevel, minigameRequest, pointsOutcome, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S29 « L'Anniversaire » (`1da0:0009`, 2 004 octets ; RE : `docs/teleportaschtroumpf/minigames/s29.md`).
 *
 * ### `createBirthday(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 29) : `level` 0..2 raccourcit le temps imparti
 *   (30, 26 ou 22 s), `bonus` (indice de l'oiseau) force le niveau 0 ;
 * - joue : un gâteau de huit bougies allumées. Gauche / droite (flèches, `Z` / `X`) déplacent le curseur d'une bougie à chaque appui,
 *   Espace (ou clic gauche) souffle la bougie visée. Une bougie soufflée se rallume toute seule 3 à 7 s plus tard : il faut que
 *   les huit soient éteintes **en même temps** avant la fin du temps ;
 * - rend : `onDone(ctx, { kind: "points", points })` à la fin de la vidéo de fin (`s29c` si réussi, `s29b` sinon, passables) ; 1 à 3 points
 *   selon le temps mis (moins de 10 s : 3, moins de 20 s : 2, sinon 1), 0 en cas d'échec ; l'appelant applique l'issue.
 */

/** Positions (bord gauche, ligne du bas) des huit bougies (`DS:6A99..6DD5`). */
export const CANDLE_POSITIONS: readonly (readonly [number, number])[] = [
  [0x2f, 0x44],
  [0x50, 0x40],
  [0x6f, 0x4d],
  [0x90, 0x43],
  [0xab, 0x4e],
  [0xd0, 0x46],
  [0xf3, 0x51],
  [0x114, 0x4d],
];

/** Temps imparti : `30 − 4 × niveau` secondes (`1da0:0703`) ; dépassé quand les secondes écoulées lui sont strictement supérieures. */
export const TIME_LIMIT_SECONDS = 30;
export const TIME_LIMIT_PER_LEVEL = 4;

/** Une bougie éteinte se rallume `3 + rand × 5` secondes après avoir été soufflée (`1da0:0490`). */
export const RELIGHT_MIN_SECONDS = 3;
export const RELIGHT_SPREAD_SECONDS = 5;

/** Cadence de la boucle (`1f33:0348(5)`) : une itération au plus tous les 5 ticks (12 par seconde). */
const LOOP_TICKS = 5;
/** `1f33:030e` attend le relâchement des flèches, au plus 500 centièmes de seconde. */
const RELEASE_CAP_TICKS = 5 * TICKS_PER_SECOND;

/** Animations de `s29a000s.hy8` : flamme au repos (0 ou 1, tirée par bougie), rallumage, extinction, curseur. */
const ANIMATION_RELIGHT = 2;
const ANIMATION_BLOW = 3;
const ANIMATION_CURSOR = 4;
const IDLE_ANIMATIONS = 2;

/** État d'une bougie (`DS:6A1D + 0x76 × i`). */
export const CANDLE_OUT = 0;
export const CANDLE_LIT = 1;
export const CANDLE_BLOWING = 2;
export const CANDLE_RELIGHTING = 3;
export type CandleState = typeof CANDLE_OUT | typeof CANDLE_LIT | typeof CANDLE_BLOWING | typeof CANDLE_RELIGHTING;

/** Temps imparti (secondes) au niveau interne 0..2. */
export function timeLimit(level: number): number {
  return levelTimeLimit(TIME_LIMIT_SECONDS, TIME_LIMIT_PER_LEVEL, level);
}

/** Gouttes de rosée données selon les secondes écoulées à la fin (`1da0:07dd`) : moins de 10 s, 3 ; moins de 20 s, 2 ; sinon 1. */
export function pointsForTime(seconds: number): number {
  if (seconds < 10) return 3;
  if (seconds < 20) return 2;
  return 1;
}

export type BirthdayPhase = "play" | "release" | "hush" | "fadeOut" | "result" | "done";

interface Candle {
  x: number;
  y: number;
  state: CandleState;
  /** Seconde (du chrono) à partir de laquelle une bougie éteinte se rallume. */
  due: number;
  idle: AnimationPlayer;
  blow: AnimationPlayer;
  relight: AnimationPlayer;
  /** Image dessinée à cette itération, `null` si la bougie est éteinte. */
  frame: Hy8Frame | null;
}

export class BirthdayScene implements Scene {
  readonly step = 1;
  private readonly level: number;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private blowVoc!: Voc;
  private missVoc!: Voc;
  private relightVoc!: Voc;
  private win!: Clip;
  private fail!: Clip;
  private result: Clip | null = null;
  private candles: Candle[] = [];
  private cursorPlayer!: AnimationPlayer;
  private cursorFrame: Hy8Frame | null = null;
  private phase: BirthdayPhase = "play";
  private timer: Timer | null = null;
  /** Bougie visée, de 1 à 8 (`DS:697A`). */
  private cursor = 1;
  private nextAt = 0;
  private count = 0;
  private left = false;
  private right = false;
  private blow = false;
  private releaseStart = 0;
  private readonly hushing = new SoundHush();
  private over = false;
  private allOut = false;
  private timedOut = false;
  /** Vrai quand les huit bougies sont éteintes à la fin : l'écran est alors vidé de ses bougies et du curseur (`13fc:078c`). */
  private cleared = false;
  private earned = 0;
  private done = false;

  constructor(
    game: Game,
    private readonly onDone: MinigameDone,
  ) {
    this.level = minigameLevel(minigameRequest(game, 29), 0);
  }

  get stage(): BirthdayPhase {
    return this.phase;
  }

  /** Niveau interne (0..2) : celui du joueur, 0 avec l'indice de l'oiseau. */
  get internalLevel(): number {
    return this.level;
  }

  /** Bougie visée, de 1 à 8 (pour les tests). */
  get position(): number {
    return this.cursor;
  }

  /** État des huit bougies (pour les tests). */
  get states(): readonly CandleState[] {
    return this.candles.map((c) => c.state);
  }

  /** Nombre d'itérations de la boucle faites (une toutes les 5 ticks au plus ; pour les tests). */
  get iterations(): number {
    return this.count;
  }

  /** Secondes écoulées depuis le début de la partie (pour les tests). */
  get seconds(): number {
    return this.timer?.seconds ?? 0;
  }

  /** Vrai si le temps est écoulé (la fin est alors un échec même si les huit bougies sont éteintes). */
  get hasTimedOut(): boolean {
    return this.timedOut;
  }

  /** Vrai si les huit bougies étaient éteintes ensemble à la fin de la boucle. */
  get hasWon(): boolean {
    return this.allOut && !this.timedOut;
  }

  /** Gouttes de rosée gagnées (0 tant que la partie n'est pas finie ou en cas d'échec). */
  get points(): number {
    return this.earned;
  }

  async load(ctx: SceneContext): Promise<void> {
    this.win = new Clip("s29c.mux", (c) => this.finish(c));
    this.fail = new Clip("s29b.mux", (c) => this.finish(c));
    [this.mcg, this.sprites, this.blowVoc, this.missVoc, this.relightVoc] = await Promise.all([
      ctx.resources.mcg("s29a001d.mcg"),
      ctx.resources.hy8("s29a000s.hy8"),
      ctx.resources.voc("s29a001b.voc"),
      ctx.resources.voc("s29a002b.voc"),
      ctx.resources.voc("s29a003b.voc"),
      this.win.load(ctx),
      this.fail.load(ctx),
    ]);
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    // Même ordre de tirages que l'original : une flamme par bougie, puis le décalage de chacune, puis la bougie de départ.
    this.candles = CANDLE_POSITIONS.map(([x, y]) => ({
      x,
      y,
      state: CANDLE_LIT,
      due: 0,
      idle: new AnimationPlayer(this.sprites, ctx.rng.below(IDLE_ANIMATIONS)),
      blow: new AnimationPlayer(this.sprites, ANIMATION_BLOW),
      relight: new AnimationPlayer(this.sprites, ANIMATION_RELIGHT),
      frame: null,
    }));
    for (const candle of this.candles) {
      for (let n = ctx.rng.below(candle.idle.animation.frames.length); n > 0; n--) candle.idle.advance();
    }
    this.cursor = ctx.rng.below(CANDLE_POSITIONS.length - 1) + 1;
    // Première image des bougies (dessinée avant le fondu d'entrée) ; le curseur n'apparaît qu'à la première itération.
    for (const candle of this.candles) {
      candle.frame = candle.idle.frame ?? null;
      candle.idle.advance();
    }
    this.cursorPlayer = new AnimationPlayer(this.sprites, ANIMATION_CURSOR);
    this.cursorFrame = null;
    this.phase = "play";
    this.timer = null;
    this.count = 0;
    this.result = null;
    this.left = false;
    this.right = false;
    this.blow = false;
    this.over = false;
    this.allOut = false;
    this.timedOut = false;
    this.cleared = false;
    this.earned = 0;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "play":
      case "release": {
        if (ctx.fade.active) return;
        this.timer ??= ctx.clock.createTimer();
        this.readKeys(ctx);
        if (this.phase === "release") return this.updateRelease(ctx);
        if (ctx.clock.ticks >= this.nextAt) this.iterate(ctx);
        return;
      }
      case "hush":
        this.updateHush(ctx);
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        this.phase = "result";
        this.result = this.hasWon ? this.win : this.fail;
        this.result.start(ctx);
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
    if (this.cleared) return;
    for (const candle of this.candles) {
      if (candle.frame) surface.drawFrame(this.sprites, candle.frame, candle.x, candle.y);
    }
    if (this.cursorFrame) {
      const target = this.candles[this.cursor - 1];
      surface.drawFrame(this.sprites, this.cursorFrame, target.x, target.y);
    }
  }

  exit(ctx: SceneContext): void {
    this.win.stop(ctx);
    this.fail.stop(ctx);
    ctx.voice.holdMusic(false);
    this.hushing.restore(ctx);
  }

  /**
   * Les touches sont lues tenues à chaque itération de l'original ; la scène tourne à chaque tick, elle retient donc ce qui a été
   * enfoncé depuis la dernière itération (un appui plus court que 5 ticks compte). Pendant l'attente du relâchement, seule la
   * validation est retenue : la flèche tenue ne doit pas déclencher un second pas au relâchement.
   */
  private readKeys(ctx: SceneContext): void {
    const { input } = ctx;
    if (this.phase === "play") {
      this.left ||= input.pressed("left") || input.justPressed("left");
      this.right ||= input.pressed("right") || input.justPressed("right");
    }
    this.blow ||= input.justPressed("validate");
  }

  private arrowHeld(ctx: SceneContext): boolean {
    const { input } = ctx;
    return input.pressed("up") || input.pressed("down") || input.pressed("left") || input.pressed("right");
  }

  /** Une itération de la boucle de `1da0:03a4..073b`. */
  private iterate(ctx: SceneContext): void {
    this.nextAt = ctx.clock.ticks + LOOP_TICKS;
    this.count++;
    const seconds = this.timer!.seconds;

    // Déplacement du curseur : gauche d'abord, puis droite (`1da0:03f0..0434`).
    if (this.left && this.cursor > 1) this.cursor--;
    if (this.right && this.cursor < CANDLE_POSITIONS.length) this.cursor++;
    this.left = false;
    this.right = false;

    // Souffle (`1da0:0439..04c5`) : sur une bougie allumée, elle s'éteint et se rallumera plus tard ; sinon, simple bruit.
    if (this.blow) {
      this.blow = false;
      const target = this.candles[this.cursor - 1];
      if (target.state === CANDLE_LIT) {
        ctx.voice.playEffect(this.blowVoc);
        target.state = CANDLE_BLOWING;
        target.due = seconds + ctx.rng.below(RELIGHT_SPREAD_SECONDS) + RELIGHT_MIN_SECONDS;
      } else {
        ctx.voice.playEffect(this.missVoc);
      }
    }

    // Rallumage des bougies éteintes dont l'heure est passée (`1da0:04cd`).
    for (const candle of this.candles) {
      if (candle.state === CANDLE_OUT && seconds > candle.due) {
        ctx.voice.playEffect(this.relightVoc);
        candle.state = CANDLE_RELIGHTING;
      }
    }

    // Animation et dessin de chaque bougie, avec les changements d'état en fin d'animation (`1da0:0533..0681`).
    for (const candle of this.candles) {
      candle.frame = null;
      if (candle.state === CANDLE_LIT) {
        candle.frame = candle.idle.frame ?? null;
        candle.idle.advance();
      } else if (candle.state === CANDLE_BLOWING) {
        candle.frame = candle.blow.frame ?? null;
        candle.blow.advance();
        if (candle.blow.looped) {
          candle.blow.restart();
          candle.state = CANDLE_OUT;
        }
      } else if (candle.state === CANDLE_RELIGHTING) {
        candle.frame = candle.relight.frame ?? null;
        candle.relight.advance();
        if (candle.relight.looped) {
          candle.relight.restart();
          candle.state = CANDLE_LIT;
        }
      }
    }
    this.cursorFrame = this.cursorPlayer.frame ?? null;
    this.cursorPlayer.advance();

    this.allOut = this.candles.every((c) => c.state === CANDLE_OUT);
    if (seconds > timeLimit(this.level)) this.timedOut = true;
    this.over = this.allOut || this.timedOut;

    if (this.arrowHeld(ctx)) {
      this.phase = "release";
      this.releaseStart = ctx.clock.ticks;
    } else if (this.over) {
      this.startHush(ctx);
    }
  }

  /** `1f33:030e` : tant qu'une flèche est tenue (5 s au plus), la boucle attend. Le chrono, lui, continue. */
  private updateRelease(ctx: SceneContext): void {
    if (this.arrowHeld(ctx) && ctx.clock.ticks - this.releaseStart < RELEASE_CAP_TICKS) return;
    this.left = false;
    this.right = false;
    if (this.over) this.startHush(ctx);
    else this.phase = "play";
  }

  /** Fin de la boucle : si les huit sont éteintes, l'écran est vidé ; puis le son s'éteint par crans (`1343:0037`). */
  private startHush(ctx: SceneContext): void {
    this.cleared = this.allOut;
    this.phase = "hush";
    this.hushing.start(ctx);
    ctx.voice.holdMusic(true);
  }

  private updateHush(ctx: SceneContext): void {
    if (!this.hushing.update(ctx)) return;
    // Les points se lisent après le fondu sonore, qui dure jusqu'à 3 s au volume maximal (`1da0:07af`).
    this.earned = this.timedOut ? 0 : pointsForTime(this.timer!.seconds);
    this.phase = "fadeOut";
    ctx.fade.out();
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, pointsOutcome(this.earned));
  }
}

export const createBirthday: MinigameFactory = (game, onDone) => new BirthdayScene(game, onDone);
