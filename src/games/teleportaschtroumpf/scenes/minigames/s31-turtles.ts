import type { Hy8 } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import { Clip, SoundHush, goalClip, ingredientOutcome, minigameLevel, minigameRequest, sceneIngredient, type MinigameDone, type MinigameFactory } from "./common";
import { LEVELS, SMURF_FALLING, Smurf, placeTurtles, touchedHop, type LevelSpec, type SmurfState, type Turtle, type TurtlePhase } from "./s31/turtles";

/**
 * S31 « Les Tortues » (`2f87:0008`, 1 614 octets, avec `2f87:0656` et `2f87:0950` ; RE : `docs/teleportaschtroumpf/minigames/s31.md`).
 *
 * ### `createTurtles(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 31) : `level` 0..2 (teinte du joueur) donne le fond et le
 *   nombre de tortues à traverser (3, 4 ou 5), `bonus` (indice de l'oiseau) force le niveau 0 et ne laisse que des tortues lentes ;
 * - joue : le Schtroumpf traverse la rivière de tortue en tortue. Haut / bas : saut en avant / en arrière, Espace ou clic : saut sur place.
 *   Au doigt, toucher devant ou derrière lui le long de la rivière (ou glisser dans ce sens) le fait sauter de ce côté, le toucher lui-même
 *   sur place. Il se noie s'il atterrit loin d'une tortue ou si la sienne plonge ; il gagne en atteignant l'autre rive. Pas de limite de temps ;
 * - rend : `onDone(ctx, { kind: "ingredient", success })` à la fin de la vidéo de fin (`s31c2` si l'ingrédient 5 est dans l'objectif, `s31c1`
 *   sinon, `s31b` en cas d'échec ; toutes passables) ; l'appelant donne l'ingrédient 5.
 */

/** Ingrédient de la scène (`DS:6EBE`, bit 5). */
const INGREDIENT = sceneIngredient(31) ?? 5;
/** Cadence de la boucle (`1f33:0348(5)`) : une itération tous les 5 ticks. */
const LOOP_TICKS = 5;

/** Vidéo de réussite : `c2` quand l'ingrédient 5 fait partie de l'objectif (`1e52:0008(5)` non nul), `c1` sinon (`2f87:0635..064b`). */
export function turtlesWinClip(game: Game): string {
  return goalClip(game, INGREDIENT, { inGoal: "s31c2.mux", notInGoal: "s31c1.mux" });
}

export const TURTLES_LOSE_CLIP = "s31b.mux";

export type TurtlesPhase = "play" | "hush" | "fadeOut" | "video" | "done";

interface Drawn {
  sprites: Hy8;
  animation: number;
  frame: number;
  x: number;
  y: number;
}

export class TurtlesScene implements Scene {
  readonly step = 1;
  private readonly levelIndex: number;
  private readonly slowOnly: boolean;
  private readonly spec: LevelSpec;
  private mcg!: Mcg;
  private smurfSprites!: Hy8;
  private turtleSprites!: Hy8;
  private jumpSound!: Voc;
  private splashSound!: Voc;
  private win!: Clip;
  private lose!: Clip;
  private result: Clip | null = null;
  private turtles: Turtle[] = [];
  private smurf!: Smurf;
  private drawn: Drawn[] = [];
  private phase: TurtlesPhase = "play";
  private nextAt = 0;
  private count = 0;
  private up = false;
  private down = false;
  private click = false;
  private won = false;
  private lostGame = false;
  private ended = false;
  private readonly hushing = new SoundHush();
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    const request = minigameRequest(game, 31);
    // L'indice de l'oiseau (`DS:6F37 == 0x1F`) : niveau 0 et tortues lentes seulement (`DS:D3A1 = 1`).
    this.slowOnly = request.bonus;
    this.levelIndex = minigameLevel(request, 0);
    this.spec = LEVELS[this.levelIndex];
  }

  get stage(): TurtlesPhase {
    return this.phase;
  }

  /** Niveau interne (0..2) : celui du joueur, 0 avec l'indice de l'oiseau. */
  get internalLevel(): number {
    return this.levelIndex;
  }

  get hasSlowTurtlesOnly(): boolean {
    return this.slowOnly;
  }

  /** Case occupée par le Schtroumpf (−1 / 0 / 1 : départ ; 0 à 4 : tortue ; 5 : arrivée). */
  get position(): number {
    return this.smurf.current;
  }

  /** Coordonnées du Schtroumpf (ligne du bas de son sprite). */
  get coordinates(): { x: number; y: number } {
    return { x: this.smurf.x, y: this.smurf.y };
  }

  get smurfState(): SmurfState {
    return this.smurf.state;
  }

  /** Les cinq tortues (les premières ne sont pas en jeu aux niveaux 0 et 1 ; pour les tests). */
  get allTurtles(): readonly Turtle[] {
    return this.turtles;
  }

  get turtlePhases(): TurtlePhase[] {
    return this.turtles.map((t) => t.phase);
  }

  get iterations(): number {
    return this.count;
  }

  get hasWon(): boolean {
    return this.won;
  }

  get hasLost(): boolean {
    return this.lostGame;
  }

  /** Nom de la vidéo de fin (`undefined` tant que la partie n'est pas finie). */
  get clipFile(): string | undefined {
    return this.result?.file;
  }

  async load(ctx: SceneContext): Promise<void> {
    this.win = new Clip(turtlesWinClip(this.game), (c) => this.finish(c));
    this.lose = new Clip(TURTLES_LOSE_CLIP, (c) => this.finish(c));
    [this.mcg, this.smurfSprites, this.turtleSprites, this.jumpSound, this.splashSound] = await Promise.all([
      ctx.resources.mcg(this.spec.background),
      ctx.resources.hy8("s31a000s.hy8"),
      ctx.resources.hy8("s31a001s.hy8"),
      ctx.resources.voc("s31a002b.voc"),
      ctx.resources.voc("s31a003b.voc"),
      this.win.load(ctx),
      this.lose.load(ctx),
    ]);
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    this.turtles = placeTurtles(ctx.rng, this.slowOnly);
    this.smurf = new Smurf(this.spec);
    this.drawn = [];
    this.phase = "play";
    this.nextAt = 0;
    this.count = 0;
    this.up = false;
    this.down = false;
    this.click = false;
    this.won = false;
    this.lostGame = false;
    this.ended = false;
    this.result = null;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "play": {
        if (ctx.fade.active) return;
        // Les touches sont lues tenues à chaque itération de l'original ; la scène tourne à chaque tick et retient ce qui a été enfoncé depuis.
        // Au doigt, le geste désigne le saut (`touchedHop`) ; l'appui « valider » de son posé ne fait pas sauter sur place.
        const { input } = ctx;
        const gesture = input.touchGesture;
        const touched = gesture ? touchedHop(this.smurf.x, this.smurf.y, gesture) : null;
        this.up ||= input.pressed("up") || input.justPressed("up") || touched === "up";
        this.down ||= input.pressed("down") || input.justPressed("down") || touched === "down";
        this.click ||= (input.pressed("validate") && !input.validateByTouch) || input.validateNotTouch || touched === "click";
        if (ctx.clock.ticks < this.nextAt) return;
        if (this.ended) return this.startHush(ctx);
        this.iterate(ctx);
        return;
      }
      case "hush":
        this.updateHush(ctx);
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        this.phase = "video";
        this.result = this.won ? this.win : this.lose;
        this.result.start(ctx);
        return;
      case "video":
        this.result!.update(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    if (this.phase === "video" || this.phase === "done") {
      this.result?.render(ctx);
      return;
    }
    const { surface } = ctx;
    surface.restoreBackground();
    for (const d of this.drawn) surface.drawFrame(d.sprites, d.sprites.animations[d.animation].frames[d.frame], d.x, d.y);
  }

  exit(ctx: SceneContext): void {
    this.win.stop(ctx);
    this.lose.stop(ctx);
    ctx.voice.holdMusic(false);
    this.hushing.restore(ctx);
  }

  /**
   * Une itération de la boucle de `2f87:050a..0586` : les tortues puis le Schtroumpf, dans cet ordre pour que celui-ci soit au-dessus ;
   * pendant sa chute, c'est l'inverse (il passe derrière la tortue).
   */
  private iterate(ctx: SceneContext): void {
    this.nextAt = ctx.clock.ticks + LOOP_TICKS;
    this.count++;
    const keys = { up: this.up, down: this.down, click: this.click };
    this.up = false;
    this.down = false;
    this.click = false;
    this.drawn = [];
    const swim = () => {
      // De la plus lointaine (4) à la plus proche : les premières tortues sont dessinées dessous.
      for (let i = this.turtles.length - 1; i > this.spec.start; i--) {
        const d = this.turtles[i].step();
        this.drawn.push({ sprites: this.turtleSprites, ...d });
      }
    };
    const hop = () => {
      const result = this.smurf.step(keys, this.turtles);
      // Bruitages mélangés `348d:0b42` : lancés seulement si aucun bruitage ne sonne, la musique continue.
      if (result.sound === "jump" && !ctx.voice.effectPlaying) ctx.voice.playEffect(this.jumpSound);
      if (result.sound === "splash" && !ctx.voice.effectPlaying) ctx.voice.playEffect(this.splashSound);
      this.drawn.push({ sprites: this.smurfSprites, ...result.draw });
      if (result.won) this.won = true;
      if (result.lost) this.lostGame = true;
    };
    if (this.smurf.state === SMURF_FALLING) {
      hop();
      swim();
    } else {
      swim();
      hop();
    }
    if (this.won || this.lostGame) this.ended = true;
  }

  /** Fin de la boucle : fondu sonore (le volume baisse d'un cran toutes les 20 centièmes de seconde), puis le son est coupé et l'écran s'éteint. */
  private startHush(ctx: SceneContext): void {
    this.phase = "hush";
    this.hushing.start(ctx);
  }

  private updateHush(ctx: SceneContext): void {
    if (!this.hushing.update(ctx)) return;
    ctx.voice.holdMusic(true);
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

export const createTurtles: MinigameFactory = (game, onDone) => new TurtlesScene(game, onDone);
