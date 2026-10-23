import type { Hy8 } from "../../data/hy8";
import { parsePal } from "../../data/mcg";
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

/**
 * S34 « La Cigogne » (`1b05:000b`, 1359 octets, et son rappel par image `1b05:055a` ; RE : `docs/teleportaschtroumpf/minigames/s34.md`).
 *
 * ### `createStork(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 34) : `level` 0..2 donne 3, 5 ou 7 oiseaux à éviter,
 *   `bonus` (indice de l'oiseau) 3 oiseaux (le niveau 0) ;
 * - joue : la vidéo de fond `s34a.mux` (non passable, 373 images) sur laquelle on pilote la cigogne (flèches ou Q / A / Z / X : battre des
 *   ailes, plonger, avancer, reculer) pendant 28 s en évitant les oiseaux qui traversent l'écran ; après 28 s plus aucun oiseau ne part,
 *   et quand l'écran est libre la cigogne s'envole vers la droite. Un oiseau touché fait jouer l'animation de chute puis la vidéo
 *   d'échec `s34b` ; la sortie réussie donne `s34c1` / `s34c2` selon que l'ingrédient 0 fait partie de l'objectif ;
 * - rend : `onDone(ctx, { kind: "ingredient", success })` à la fin de la dernière vidéo (passable par Échap ou Espace) ; l'appelant applique
 *   l'issue.
 */

/** Ingrédient donné par la scène (`MINIGAMES`) : 0. */
const INGREDIENT = sceneIngredient(34)!;

/** Vidéo de réussite : `s34c2` quand l'ingrédient est dans l'objectif (`1e52:0008` vrai), `s34c1` sinon. */
export function storkWinClip(game: Game): string {
  return goalClip(game, INGREDIENT, { inGoal: "s34c2.mux", notInGoal: "s34c1.mux" });
}

/** Nombre d'oiseaux par niveau (`iRam37b21`, `1b05:0047..0071`) ; l'indice de l'oiseau (`iRam3d397 == 0x22`) remet 3, donc le niveau 0. */
export const STORK_BIRDS: readonly number[] = [3, 5, 7];
/** Durée de la traversée, en secondes (`1f33:019a(2) ≥ 0x1c`) : ensuite plus aucun oiseau ne part. */
export const STORK_DURATION = 28;
/** Seuil (s) à partir duquel les oiseaux relancés vont plus vite (`1b05:07b5`). */
export const STORK_FAST_AFTER = 15;

/** Bornes de la cigogne (`1b05:0967..09c8`) et déplacements par image de la vidéo. */
export const STORK_MIN_X = 0x39;
export const STORK_MAX_X = 0x13e;
export const STORK_CEILING = 0x25;
export const STORK_FLAP_CEILING = 0x35;
export const STORK_GROUND = 200;
export const STORK_STEP_X = 7;
export const STORK_DIVE = 5;
export const STORK_FALL = 2;
export const STORK_FLAP_RISE = 0x1c;
/** Sortie : la cigogne tend vers (0x1b6, 100) d'un vingtième par image, réussi dès x ≥ 0x12c. */
export const STORK_EXIT_X = 0x1b6;
export const STORK_EXIT_Y = 100;
export const STORK_EXIT_DIVISOR = 20;
export const STORK_EXIT_DONE_X = 0x12c;

/** Oiseau : entre à droite en x = 0x17c, disparaît en x ≤ −0x28, y entre 15 et 200 (`1b05:06e3..0732`). */
export const BIRD_START_X = 0x17c;
export const BIRD_LEAVE_X = -0x28;
export const BIRD_MIN_Y = 15;
export const BIRD_MAX_Y = 200;
/** Délais de départ en centièmes : 50 à 99 depuis l'arrivée de l'oiseau, et 100 au moins depuis le départ du précédent. */
export const BIRD_WAIT = 50;
export const BIRD_GAP = 100;

/** Animations de `s34a001s.hy8` (`12d7:0144(·, n)`) : oiseau, battement, plané, chute (tête / corps), repos et sortie. */
const ANIMATION_BIRD = 0;
const ANIMATION_FLAP = 1;
const ANIMATION_GLIDE = 2;
const ANIMATION_HIT_HEAD = 3;
const ANIMATION_REST = 4;
const ANIMATION_HIT_BODY = 5;

/**
 * Zone de collision (`1b05:0cda`, deux structures de 12 mots en `DS:6414` et `DS:63FC`) : la cigogne en (x, y) y est
 * `[x − back − width, x − back] × [y − up − height, y − up]`, l'oiseau en (bx, by) `[bx, bx + 14] × [by − 10, by + 3]`. Les comparaisons sont
 * strictes, sauf la dernière (le haut de l'oiseau doit dépasser le bas de la zone).
 */
export interface HitBox {
  back: number;
  up: number;
  height: number;
  width: number;
}
/** Premier test (tête, animation 3) puis second (corps, animation 5). */
export const STORK_HEAD: HitBox = { back: 0, up: 7, height: 10, width: 0x24 };
export const STORK_BODY: HitBox = { back: 0x17, up: 0x11, height: 0xf, width: 0xb };
const BIRD_WIDTH = 14;
const BIRD_ABOVE = 10;
const BIRD_BELOW = 3;

/** Un oiseau touche-t-il la zone ? Reprend `1b05:0cda` : les décalages de battement d'ailes s'annulent entre la cigogne et l'oiseau. */
export function birdHits(box: HitBox, storkX: number, storkY: number, birdX: number, birdY: number): boolean {
  const right = storkX - box.back;
  const bottom = storkY - box.up;
  return birdX < right && birdX + BIRD_WIDTH > right - box.width && birdY - BIRD_ABOVE < bottom && birdY + BIRD_BELOW > bottom - box.height;
}

/** Nombre d'oiseaux : celui du niveau, ou 3 avec l'indice de l'oiseau. */
export function birdCount(level: number): number {
  return STORK_BIRDS[level] ?? STORK_BIRDS[0];
}

/** Touches tenues à l'image : haut (battre), bas (plonger), gauche et droite (`DS:4BBB` bits 1, 2, 4, 8). */
export interface StorkKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface Bird {
  /** Parti (`+0x24`) : dessiné et déplacé ; sinon il attend en x = 0x17c. */
  active: boolean;
  /** Centième de seconde de son arrivée à l'attente (`+0x26`). */
  timer: number;
  speed: number;
  /** Il dévie en y quand x passe sous ce seuil (`+0x2c`). */
  threshold: number;
  amplitude: number;
  velocity: number;
  deviating: boolean;
  target: number;
  hit: boolean;
  x: number;
  y: number;
  sprite: number;
  readonly anim: AnimationPlayer;
}

/** Hasard utilisé par le jeu : `rand × n / 0x8000`. */
export interface StorkRandom {
  below(n: number): number;
}

export type StorkEnd = "success" | "failure" | null;

/**
 * La cigogne et les oiseaux, sans écran : `step` rejoue le rappel `1b05:055a` pour une image de la vidéo. L'ordre des tirages est celui
 * de l'original (initialisation, puis par image et par oiseau : relance, départ).
 */
export class StorkRun {
  readonly birds: Bird[] = [];
  x: number;
  y: number;
  /** Ordonnée dessinée (`DS:6746`) et sprite (`DS:6744`) de la cigogne, `null` avant la première image. */
  drawY = 0;
  sprite: number | null = null;
  /** Battement en cours (`DS:673B`) et plafond / sol atteint (`DS:673A`). */
  flapping = false;
  limit = false;
  /**
   * Bruitage de battement (`s34a001b`) demandé par l'image qui vient d'être jouée : début d'un battement (`DS:16C0`, levé par
   * la touche haut et consommé à la première image du battement) ou image de repos au sol ou au plafond. L'original ne le lance
   * que si aucun bruitage ne sonne (`348d:0b42(1, 0)`) : c'est à la scène de le vérifier.
   */
  flapCue = false;
  /** Bruitage de choc (`s34a004b`) à lancer sans condition : un oiseau vient de toucher la cigogne (`1b05:0cba`). */
  hitCue = false;
  private flapPending = false;
  /** Chute en cours (`DS:6738`), puis vidéo d'échec à jouer (`DS:6752`). */
  dying = false;
  failed = false;
  /** Réussi : la cigogne est sortie à droite (`DS:6754`). */
  succeeded = false;
  /** Les 28 s sont passées (`DS:6737`), et la sortie est permise (`DS:6753`). */
  timeUp = false;
  mayExit = false;
  /** Au moins un oiseau est parti (`DS:6736`). */
  anyActive = false;
  private lastLaunch: number;
  private readonly flap: AnimationPlayer;
  private readonly glide: AnimationPlayer;
  private readonly rest: AnimationPlayer;
  private hurt: AnimationPlayer | null = null;

  constructor(
    private readonly hy8: Hy8,
    count: number,
    private readonly rng: StorkRandom,
    now: number,
  ) {
    for (let i = 0; i < count; i++) {
      const anim = new AnimationPlayer(hy8, ANIMATION_BIRD);
      this.birds.push({
        active: false,
        timer: 0,
        speed: 0,
        threshold: 0,
        amplitude: 0,
        velocity: 0,
        deviating: false,
        target: 0,
        hit: false,
        x: BIRD_START_X,
        y: i * 0x2d,
        sprite: 0,
        anim,
      });
    }
    this.flap = new AnimationPlayer(hy8, ANIMATION_FLAP);
    this.glide = new AnimationPlayer(hy8, ANIMATION_GLIDE);
    this.rest = new AnimationPlayer(hy8, ANIMATION_REST);
    // Chaque oiseau commence sur une image au hasard de son animation (`1b05:00c1..0105`).
    for (const bird of this.birds) {
      for (let n = this.rng.below(bird.anim.animation.frames.length); n > 0; n--) this.advance(bird);
    }
    for (const bird of this.birds) {
      bird.timer = now;
      bird.speed = this.rng.below(10) + 3;
      bird.threshold = this.rng.below(200) + 0x6e;
      const down = this.rng.below(2) === 0;
      bird.velocity = this.rng.below(5) + 1;
      bird.amplitude = this.rng.below(180);
      if (!down) {
        bird.velocity = -bird.velocity;
        bird.amplitude = -bird.amplitude;
      }
    }
    this.lastLaunch = now;
    this.x = this.rng.below(40) + 0x78;
    this.y = this.rng.below(40) + 0x78;
  }

  /** Image de l'animation de l'oiseau affichée, puis suivante (`12d7:00c1`). */
  private advance(bird: Bird): void {
    bird.sprite = bird.anim.frame!.sprite;
    bird.anim.advance();
  }

  /** Sprite courant d'une animation, puis frame suivante ; vrai si l'animation vient de reboucler (compteur retombé à 0). */
  private play(player: AnimationPlayer): { sprite: number; wrapped: boolean } {
    const sprite = player.frame!.sprite;
    player.advance();
    return { sprite, wrapped: player.frameIndex === 0 };
  }

  /**
   * Une image de la vidéo : `now` en centièmes de seconde, `elapsed` en secondes depuis le début (`1f33:019a(2)`). Rend `"stop"` quand la
   * partie est finie (la vidéo s'arrête sur cette image).
   */
  step(keys: StorkKeys, now: number, elapsed: number): "stop" | void {
    this.flapCue = false;
    this.hitCue = false;
    this.timeUp = elapsed >= STORK_DURATION;
    if (this.timeUp) this.mayExit = !this.dying;
    if (this.failed) return "stop";
    this.moveStork(keys);
    this.moveBirds(now, elapsed);
    this.collide();
    if (this.succeeded) return "stop";
  }

  /** `1b05:0929` : touches, bornes, puis animation selon l'état. */
  private moveStork(keys: StorkKeys): void {
    if (keys.right) this.x += STORK_STEP_X;
    if (keys.left) this.x -= STORK_STEP_X;
    if (keys.down) this.y += STORK_DIVE;
    if (keys.up) {
      this.flapping = true;
      this.flapPending = true;
    }
    this.limit = false;
    this.x = Math.min(STORK_MAX_X, Math.max(STORK_MIN_X, this.x));
    if (this.y < STORK_CEILING && !this.flapping) this.y = STORK_CEILING;
    if (this.y < STORK_FLAP_CEILING && this.flapping) {
      this.y = STORK_CEILING;
      this.limit = true;
    }
    if (this.y >= STORK_GROUND && !this.flapping) {
      this.y = STORK_GROUND;
      this.limit = true;
    }
    if (this.mayExit && !this.anyActive) {
      // Sortie : un vingtième du chemin vers (0x1b6, 100) à chaque image, divisions entières tronquées.
      const dx = Math.trunc((STORK_EXIT_X - this.x) / STORK_EXIT_DIVISOR);
      const dy = Math.trunc((STORK_EXIT_Y - this.y) / STORK_EXIT_DIVISOR);
      this.sprite = this.play(this.rest).sprite;
      this.x += dx;
      this.y += dy;
      this.drawY = this.y;
      if (this.x >= STORK_EXIT_DONE_X) this.succeeded = true;
    } else if (this.dying) {
      const { sprite, wrapped } = this.play(this.hurt!);
      this.sprite = sprite;
      this.drawY = this.y;
      if (wrapped) {
        this.dying = false;
        this.failed = true;
      }
    } else if (this.flapping && !this.limit) {
      if (this.flapPending) {
        this.flapPending = false;
        this.flapCue = true;
      }
      const { sprite, wrapped } = this.play(this.flap);
      this.sprite = sprite;
      this.drawY = this.y;
      if (wrapped) {
        this.flapping = false;
        this.flapPending = false;
        this.y -= STORK_FLAP_RISE;
      }
    } else if (this.limit) {
      this.flapCue = true;
      this.sprite = this.play(this.rest).sprite;
      this.drawY = this.y;
      this.flapping = false;
    } else {
      this.sprite = this.play(this.glide).sprite;
      this.drawY = this.y;
      this.y += STORK_FALL;
    }
  }

  /** `1b05:05c7` : déplacement, déviation en y, relance et départ des oiseaux, dessin. */
  private moveBirds(now: number, elapsed: number): void {
    this.anyActive = false;
    for (const bird of this.birds) {
      if (bird.active) {
        bird.x -= bird.speed;
        if (bird.x < bird.threshold && !bird.deviating) {
          bird.deviating = true;
          bird.target = bird.amplitude + bird.y;
        }
        if ((bird.velocity < 0 && bird.y < bird.target) || (bird.velocity > 0 && bird.target < bird.y)) bird.deviating = false;
        if (bird.deviating) bird.y += bird.velocity;
        if (bird.y < BIRD_MIN_Y) {
          bird.y = BIRD_MIN_Y;
          bird.deviating = false;
        }
        if (bird.y > BIRD_MAX_Y) {
          bird.y = BIRD_MAX_Y;
          bird.deviating = false;
        }
      }
      if (bird.x <= BIRD_LEAVE_X || bird.hit) {
        bird.x = BIRD_START_X;
        bird.y = this.rng.below(180) + BIRD_MIN_Y;
        bird.timer = now;
        bird.active = false;
        bird.hit = false;
        bird.speed = elapsed < STORK_FAST_AFTER ? this.rng.below(10) + 3 : this.rng.below(6) + 7;
      }
      const wait = this.rng.below(50) + BIRD_WAIT;
      if (bird.timer + wait < now && !bird.active && now - this.lastLaunch > BIRD_GAP) {
        bird.active = true;
        this.lastLaunch = now;
      }
      // Après les 28 s les oiseaux à l'arrêt ne partent plus : leur délai redémarre.
      if (!bird.active && this.timeUp) bird.timer = now;
      if (bird.active) this.anyActive = true;
      if (bird.active) this.advance(bird);
    }
  }

  /** `1b05:0b96` : le premier oiseau qui touche la tête (animation 3) ou le corps (animation 5) fait tomber la cigogne. */
  private collide(): void {
    for (const bird of this.birds) {
      const head = birdHits(STORK_HEAD, this.x, this.y, bird.x, bird.y);
      let animation = -1;
      if (head && !this.dying) animation = ANIMATION_HIT_HEAD;
      else if (birdHits(STORK_BODY, this.x, this.y, bird.x, bird.y) && !this.dying) animation = ANIMATION_HIT_BODY;
      if (animation < 0) continue;
      bird.active = false;
      this.hurt = new AnimationPlayer(this.hy8, animation);
      bird.hit = true;
      this.dying = true;
      this.hitCue = true;
    }
  }

  /** Issue de la partie. */
  get end(): StorkEnd {
    return this.succeeded ? "success" : this.failed ? "failure" : null;
  }
}

export type StorkPhase = "ride" | "hitSound" | "fadeOut" | "result" | "done";

export class StorkScene implements Scene {
  readonly step = 1;
  private hy8!: Hy8;
  private hitVoc!: Voc;
  private flapVoc!: Voc;
  /** `s34a.pal` : entrées 0 à 127, chargées par l'original avant la vidéo (`1523:0235(pal, 0, 0x80)`, la vidéo ne touche pas à la palette). */
  private palette!: Uint8Array;
  private ride!: Clip;
  private fail!: Clip;
  private win!: Clip;
  private result: Clip | null = null;
  private phase: StorkPhase = "ride";
  private run!: StorkRun;
  private startCs = 0;
  private won = false;
  private keys: StorkKeys = { up: false, down: false, left: false, right: false };
  private frame = -1;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 34);
  }

  get stage(): StorkPhase {
    return this.phase;
  }

  /** La partie en cours (pour les tests). */
  get state(): StorkRun {
    return this.run;
  }

  /** Numéro de la dernière image de la vidéo traitée, −1 avant la première (pour les tests). */
  get currentFrame(): number {
    return this.frame;
  }

  /** Vrai si la cigogne est sortie à droite. */
  get escaped(): boolean {
    return this.won;
  }

  async load(ctx: SceneContext): Promise<void> {
    this.ride = new Clip("s34a.mux", (c) => this.rideEnded(c), {
      skippable: false,
      onFrame: (c, frame) => this.onFrame(c, frame),
      overlay: (c) => this.draw(c),
    });
    this.fail = new Clip("s34b.mux", (c) => this.finish(c));
    this.win = new Clip(storkWinClip(this.game), (c) => this.finish(c));
    const [hy8, hitVoc, flapVoc, palette] = await Promise.all([
      ctx.resources.hy8("s34a001s.hy8"),
      ctx.resources.voc("s34a004b.voc"),
      ctx.resources.voc("s34a001b.voc"),
      ctx.resources.bytes("s34a.pal"),
      this.ride.load(ctx),
      this.fail.load(ctx),
      this.win.load(ctx),
    ]);
    this.hy8 = hy8;
    this.hitVoc = hitVoc;
    this.flapVoc = flapVoc;
    this.palette = parsePal(palette);
  }

  enter(ctx: SceneContext): void {
    // L'indice de l'oiseau remet 3 oiseaux (`iRam37b21 = 3`) : le niveau 0.
    const level = minigameLevel(minigameRequest(this.game, 34), 0);
    this.phase = "ride";
    this.startCs = ctx.clock.centiseconds;
    this.run = new StorkRun(this.hy8, birdCount(level), ctx.rng, this.startCs);
    this.keys = { up: false, down: false, left: false, right: false };
    this.frame = -1;
    this.won = false;
    this.done = false;
    this.ride.start(ctx);
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "ride": {
        // Un appui plus court qu'une image de la vidéo compte quand même (comme S27) : l'original lit les touches tenues à chaque image.
        const { input } = ctx;
        for (const key of ["up", "down", "left", "right"] as const) this.keys[key] ||= input.pressed(key) || input.justPressed(key);
        this.ride.update(ctx);
        return;
      }
      case "hitSound":
        // La chute finie, on laisse sonner le bruitage du choc avant le fondu.
        if (!ctx.voice.effectPlaying) {
          this.phase = "fadeOut";
          ctx.fade.out();
        }
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        this.phase = "result";
        this.result = this.won ? this.win : this.fail;
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
    switch (this.phase) {
      case "ride":
      case "hitSound":
      case "fadeOut":
        this.ride.render(ctx);
        return;
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

  /** Rappel par image (`1b05:055a`). */
  private onFrame(ctx: SceneContext, frame: number): "stop" | void {
    this.frame = frame;
    const now = ctx.clock.centiseconds;
    const keys = this.keys;
    this.keys = { up: false, down: false, left: false, right: false };
    const result = this.run.step(keys, now, Math.floor((now - this.startCs) / 100));
    // Bruitages mélangés `348d:0b42(2, ptr)` : ils s'ajoutent au son de la vidéo sans le couper. Le battement attend que le
    // bruitage précédent soit fini (`0b42(1, 0)`), le choc remplace tout (`1b05:0cba`, sans test).
    if (this.run.flapCue && !ctx.voice.effectPlaying) ctx.voice.playEffect(this.flapVoc);
    if (this.run.hitCue) ctx.voice.playEffect(this.hitVoc);
    return result;
  }

  private draw(ctx: SceneContext): void {
    // La vidéo recharge sa propre palette à chaque rendu : celle de la scène (sprites et décor) reprend les entrées 0 à 127.
    ctx.palette.load(this.palette, 0, 128);
    const { run } = this;
    if (!run || run.sprite === null) return;
    ctx.surface.drawSprite(this.hy8, run.sprite, run.x, run.drawY);
    for (const bird of run.birds) if (bird.active) ctx.surface.drawSprite(this.hy8, bird.sprite, bird.x, bird.y);
  }

  /** Fin de la vidéo de fond : sortie réussie, chute finie, ou vidéo arrivée au bout (rien n'est joué, comme l'original). */
  private rideEnded(ctx: SceneContext): void {
    this.won = this.run.succeeded;
    if (this.won) {
      this.phase = "fadeOut";
      ctx.fade.out();
    } else if (this.run.failed) {
      this.phase = "hitSound";
    } else {
      this.finish(ctx);
    }
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, ingredientOutcome(this.won));
  }
}

export const createStork: MinigameFactory = (game, onDone) => new StorkScene(game, onDone);
