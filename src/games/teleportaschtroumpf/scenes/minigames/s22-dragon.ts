import type { Hy8 } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
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
import {
  Anim,
  DEATH_ANIMATION,
  DEATH_OFFSET_Y,
  DragonRun,
  IDLE_ANIMATION,
  SMURF_X,
  SMURF_Y,
  type Drawn,
  type DragonSound,
} from "./s22/run";

/**
 * S22 « Le Dragon » (`1c78:0005`, 1 847 octets ; RE : `docs/teleportaschtroumpf/minigames/s22.md`).
 *
 * ### `createDragon(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 22). `level` 0..2 raccourcit le délai entre deux dragons
 *   (190, 120 ou 50 centièmes de seconde plus un tirage de 0 à 99) ; `bonus` (indice de l'oiseau) force le niveau 0 (le plus lent) et compte
 *   déjà 5 dragons sur les 10 ;
 * - joue : un Schtroumpf se tient à gauche ; un dragon arrive de la droite sur l'une des trois hauteurs, fonce jusqu'au milieu de l'écran puis
 *   repart. Haut ou bas (flèches, `Q` / `A` ; au doigt, posé au-dessus ou en dessous du Schtroumpf) lui fait prendre une pose qui
 *   esquive certaines hauteurs. Le dixième dragon qui apparaît donne la
 *   victoire ; un dragon qui touche le Schtroumpf, la brûlure (échec) ;
 * - rend : `onDone(ctx, { kind: "ingredient", success })` à la fin de la vidéo de victoire (`s22c1` si l'ingrédient 3 fait partie de l'objectif,
 *   `s22c2` sinon : sens **inverse** de S27 ; passable par Échap ou Espace) ou, en cas d'échec, après le fondu au noir ; l'appelant applique l'issue.
 */

/** Ingrédient donné par la scène (`MINIGAMES`) : 3. */
const INGREDIENT = sceneIngredient(22)!;

/** Cadence de la boucle (`1f33:0348(5)`) : 5 ticks, soit 12 itérations par seconde. */
export const DRAGON_FRAME_TICKS = 5;
/**
 * Au doigt (ajout du port) : ligne du milieu du Schtroumpf au repos (`s22a001s.hy8`, animation 0 : lignes 67 à 176). Un doigt posé
 * au-dessus vaut « haut », en dessous « bas », tant qu'il reste posé ; sur le Schtroumpf, à moins de `TOUCH_DEAD_ZONE` lignes de ce
 * milieu, il ne vaut rien.
 */
export const SMURF_MIDDLE_Y = SMURF_Y - 55;
export const TOUCH_DEAD_ZONE = 10;

/** Direction que vaut un doigt posé en `y` (voir `SMURF_MIDDLE_Y`), ou `null`. */
export function dragonTouchKey(y: number): "up" | "down" | null {
  if (y < SMURF_MIDDLE_Y - TOUCH_DEAD_ZONE) return "up";
  if (y > SMURF_MIDDLE_Y + TOUCH_DEAD_ZONE) return "down";
  return null;
}

/** Pause de 2 s après la victoire (`1f33:0279(2)`). */
const WIN_PAUSE_TICKS = 120;

/** Vidéo de victoire : `s22c1` quand l'ingrédient est dans l'objectif (`1e52:0008(3)` vrai), `s22c2` sinon. */
export function dragonClip(game: Game): string {
  return goalClip(game, INGREDIENT, { inGoal: "s22c1.mux", notInGoal: "s22c2.mux" });
}

export type DragonPhase = "intro" | "play" | "death" | "settle" | "pause" | "fadeOut" | "video" | "done";

export class DragonScene implements Scene {
  readonly step = 1;
  private readonly bonus: boolean;
  private readonly level: number;
  private readonly game: Game;
  private mcg!: Mcg;
  private dragonSheet!: Hy8;
  private smurfSheet!: Hy8;
  private music!: Voc;
  private voices!: Record<DragonSound, Voc>;
  private win!: Clip;
  private deathAnim!: Anim;
  private run!: DragonRun;
  private phase: DragonPhase = "intro";
  private nextAt = 0;
  private markTicks = 0;
  private won = false;
  private done = false;
  /** Fond sonore en cours (`s22a005b`) : un bruitage ne doit pas attendre qu'il finisse, il le coupe. */
  private held = { up: false, down: false };
  private readonly finger = new HeldFinger();
  private drawn: { dragon: Drawn | null; smurf: Drawn | null; death: Drawn | null } = { dragon: null, smurf: null, death: null };

  constructor(
    game: Game,
    private readonly onDone: MinigameDone,
  ) {
    const request = minigameRequest(game, 22);
    this.game = game;
    this.bonus = request.bonus;
    this.level = minigameLevel(request, 0);
  }

  get stage(): DragonPhase {
    return this.phase;
  }

  get hasBonus(): boolean {
    return this.bonus;
  }

  /** Niveau interne : celui du joueur, 0 avec l'indice de l'oiseau. */
  get internalLevel(): number {
    return this.level;
  }

  /** La course en cours (pour les tests). */
  get course(): DragonRun {
    return this.run;
  }

  get hasWon(): boolean {
    return this.won;
  }

  /** Fichier de la vidéo de victoire (pour les tests). */
  get endVideo(): string {
    return this.win.file;
  }

  async load(ctx: SceneContext): Promise<void> {
    this.win = new Clip(dragonClip(this.game), (c) => this.finish(c));
    const { resources } = ctx;
    const [mcg, dragonSheet, smurfSheet, roar, burn, up, down, music] = await Promise.all([
      resources.mcg("s22a001d.mcg"),
      resources.hy8("s22a000s.hy8"),
      resources.hy8("s22a001s.hy8"),
      resources.voc("s22a001b.voc"),
      resources.voc("s22a002b.voc"),
      resources.voc("s22a003c.voc"),
      resources.voc("s22a004c.voc"),
      resources.voc("s22a005b.voc"),
      this.win.load(ctx),
    ]);
    this.mcg = mcg;
    this.dragonSheet = dragonSheet;
    this.smurfSheet = smurfSheet;
    this.music = music;
    this.voices = { roar, burn, up, down };
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    // Le fond sonore remplace la musique du plateau (`15f9:089f` relancé par la boucle tant que rien ne sort).
    ctx.voice.holdMusic(true);
    this.phase = "intro";
    this.won = false;
    this.done = false;
    this.held = { up: false, down: false };
    this.finger.reset();
    this.deathAnim = new Anim(this.smurfSheet, DEATH_ANIMATION);
    this.run = new DragonRun({ dragonSheet: this.dragonSheet, smurfSheet: this.smurfSheet }, this.level, this.bonus, ctx.clock.centiseconds);
    // Avant le fondu d'entrée, le Schtroumpf au repos est déjà dessiné (`1c78:00b2`).
    this.drawn = { dragon: null, smurf: { sheet: this.smurfSheet, frame: this.smurfSheet.animations[IDLE_ANIMATION].frames[0], x: SMURF_X, y: SMURF_Y }, death: null };
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "intro":
        if (ctx.fade.active) return;
        // `14b3:000d` (entrées remises à zéro), `1f33:0181(2)` (chrono) et `1f33:0364` (cadence).
        ctx.input.justPressed("up");
        ctx.input.justPressed("down");
        this.run = new DragonRun({ dragonSheet: this.dragonSheet, smurfSheet: this.smurfSheet }, this.level, this.bonus, ctx.clock.centiseconds);
        this.nextAt = ctx.clock.ticks;
        this.phase = "play";
        return;
      case "play":
        this.latchKeys(ctx);
        if (ctx.clock.ticks < this.nextAt) return;
        this.nextAt = ctx.clock.ticks + DRAGON_FRAME_TICKS;
        this.iterate(ctx);
        return;
      case "death":
        if (ctx.clock.ticks < this.nextAt) return;
        this.nextAt = ctx.clock.ticks + DRAGON_FRAME_TICKS;
        this.iterateDeath();
        return;
      case "settle":
        // `348d:0b42(1)` : on attend la fin du bruitage, puis le fond sonore est coupé (`15f9:089f(0, 0x400000)`).
        if (this.soundPlaying(ctx)) return;
        ctx.voice.stop();
            if (this.won) {
          this.markTicks = ctx.clock.ticks;
          this.phase = "pause";
        } else {
          // Échec : le fond est recopié sans sprites (`13fc:0411`, `03f9`) avant le fondu.
          this.drawn = { dragon: null, smurf: null, death: null };
          this.beginFadeOut(ctx);
        }
        return;
      case "pause":
        if (ctx.clock.ticks - this.markTicks < WIN_PAUSE_TICKS) return;
        this.beginFadeOut(ctx);
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        if (this.won) {
          this.phase = "video";
          this.win.start(ctx);
        } else {
          this.finish(ctx);
        }
        return;
      case "video":
        this.win.update(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    if (this.phase === "video") {
      this.win.render(ctx);
      return;
    }
    const { surface } = ctx;
    surface.restoreBackground();
    // Le dragon est dessiné avant le Schtroumpf.
    for (const item of [this.drawn.dragon, this.drawn.smurf, this.drawn.death]) {
      if (item) surface.drawFrame(item.sheet, item.frame, item.x, item.y);
    }
  }

  exit(ctx: SceneContext): void {
    this.win.stop(ctx);
    ctx.voice.holdMusic(false);
  }

  /** Touches retenues jusqu'à l'itération suivante ; le doigt posé au-dessus ou en dessous du Schtroumpf vaut haut ou bas tenu. */
  private latchKeys(ctx: SceneContext): void {
    const { input } = ctx;
    const finger = this.finger.read(input);
    const touched = finger ? dragonTouchKey(finger.y) : null;
    for (const key of ["up", "down"] as const) this.held[key] ||= input.pressed(key) || input.justPressed(key) || touched === key;
  }

  /** Un bruitage (pas le fond sonore) sort : `348d:0b42(1, 0) != 0`. */
  private soundPlaying(ctx: SceneContext): boolean {
    return ctx.voice.effectPlaying;
  }

  /** Bruitage mélangé `348d:0b42(2, son)` : il se superpose au fond sonore sans le couper. */
  private play(ctx: SceneContext, sound: DragonSound): void {
    ctx.voice.playEffect(this.voices[sound]);
  }

  /** Une itération de la boucle (`1c78:0066..0295`). */
  private iterate(ctx: SceneContext): void {
    // Fond sonore relancé quand plus rien ne sort.
    if (!ctx.voice.playing) {
      ctx.voice.play(this.music);
    }
    const keys = this.held;
    this.held = { up: false, down: false };
    const result = this.run.step(keys, {
      centiseconds: ctx.clock.centiseconds,
      soundPlaying: this.soundPlaying(ctx),
      roll: (n) => ctx.rng.below(n),
    });
    for (const sound of result.sounds) this.play(ctx, sound);
    this.drawn = { dragon: result.dragon, smurf: result.smurf, death: null };
    if (this.run.burned) {
      // `1c78:0295..02dc` : l'animation de brûlure se joue en entier, une image par itération, sous le dragon touché.
      this.phase = "death";
      this.nextAt = ctx.clock.ticks + DRAGON_FRAME_TICKS;
      this.iterateDeath();
    } else if (this.run.won) {
      this.won = true;
      this.phase = "settle";
    }
  }

  private iterateDeath(): void {
    const step = this.deathAnim.step();
    this.drawn = { dragon: null, smurf: null, death: { sheet: step.sheet, frame: step.frame, x: SMURF_X, y: this.run.y + DEATH_OFFSET_Y } };
    if (step.finished) this.phase = "settle";
  }

  private beginFadeOut(ctx: SceneContext): void {
    this.phase = "fadeOut";
    ctx.fade.out();
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, ingredientOutcome(this.won));
  }
}

export const createDragon: MinigameFactory = (game, onDone) => new DragonScene(game, onDone);
