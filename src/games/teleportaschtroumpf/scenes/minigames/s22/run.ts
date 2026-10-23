import type { Hy8, Hy8Frame } from "../../../data/hy8";
import { AnimationPlayer } from "../../../engine/sprites";

/**
 * Logique de S22 « Le Dragon » (boucle de `1c78:0005`, RE : `docs/teleportaschtroumpf/minigames/s22.md`), sans écran ni son :
 * `DragonRun.step` joue **une itération** de la boucle de l'original (toutes les 5 ticks) et dit ce qu'il faut dessiner et jouer.
 */

/** Abscisse de départ et de repos du dragon, hors de l'écran à droite (`DS:cd75 = 0x2a7`). */
export const DRAGON_REST_X = 0x2a7;
/** Le dragon sort de son repos quand il est au-delà de cette abscisse (`0x2a6`), et revient quand il passe en deçà de `DRAGON_TURN_X`. */
export const DRAGON_REST_LIMIT = 0x2a6;
export const DRAGON_TURN_X = 0x15f;
/** Il rugit en passant sous `DRAGON_ROAR_X`, et peut toucher le Schtroumpf en deçà de `DRAGON_HIT_X`. */
export const DRAGON_ROAR_X = 0x28b;
export const DRAGON_HIT_X = 0x191;
/** Pas du dragon par itération, dans les deux sens (`0x19`). */
export const DRAGON_STEP = 0x19;
/** Position du Schtroumpf (pieds) et ordonnée du dragon par voie : `0x46 + 0x32 × voie` (haute, médiane, basse). */
export const SMURF_X = 0x46;
export const SMURF_Y = 0xb0;
export const LANE_COUNT = 3;
export const LANE_FIRST_Y = 0x46;
export const LANE_SPACING = 0x32;
/** Décalage vertical de l'animation de brûlure par rapport à l'ordonnée du dragon (`+ 0x28`). */
export const DEATH_OFFSET_Y = 0x28;
/** Nombre de dragons à voir apparaître : le dixième ferme la partie (`DS:cd7d == 10`) ; l'indice de l'oiseau part de 5. */
export const DRAGONS_TO_WIN = 10;
export const BIRD_START_COUNT = 5;
/** Délai avant que le dragon bouge, en centièmes de seconde : `base + rand × 100`, `base` selon le niveau (2, 1, 0 ou l'oiseau). */
export const DELAY_BASES: readonly number[] = [0xbe, 0x78, 0x32];
export const DELAY_SPREAD = 100;

/** Animations : `s22a000s.hy8` (dragon 0, Schtroumpf « haut » 1) et `s22a001s.hy8` (repos 0, « bas » 1, brûlure 2). */
export const DRAGON_ANIMATION = 0;
export const UP_ANIMATION = 1;
export const IDLE_ANIMATION = 0;
export const DOWN_ANIMATION = 1;
export const DEATH_ANIMATION = 2;

/** Le Schtroumpf : au repos, ou dans l'une des deux poses (`DS:cd71`, `cd6e` « haut », `cd6f` « bas »). */
export type SmurfPose = "idle" | "up" | "down";

/** Sons de l'itération : le rugissement `s22a001b`, la pose haute `s22a003c`, la basse `s22a004c`, la brûlure `s22a002b`. */
export type DragonSound = "roar" | "up" | "down" | "burn";

export interface DragonInput {
  /** Touches tenues pendant l'itération (bits 1 et 2 de `DS:4BBB` : haut, bas) ; un appui plus court qu'une itération compte. */
  up: boolean;
  down: boolean;
}

export interface DragonContext {
  /** Centièmes de seconde écoulés (`1764:0300`) : le délai se mesure depuis l'apparition du dragon. */
  centiseconds: number;
  /** Un son de bruitage sort (hors musique de fond) : le rugissement attend la fin du précédent. */
  soundPlaying: boolean;
  /** `rand × n / 0x8000`. */
  roll(n: number): number;
}

export interface Drawn {
  /** Feuille HY8 qui contient l'image. */
  sheet: Hy8;
  frame: Hy8Frame;
  x: number;
  y: number;
}

/** Image dessinée d'une animation et fin de boucle (`12d7:00c1` : on dessine l'image courante, le compteur retombe à 0 après la dernière). */
export class Anim {
  private readonly player: AnimationPlayer;

  constructor(
    private readonly sheet: Hy8,
    index: number,
  ) {
    this.player = new AnimationPlayer(sheet, index);
  }

  /** Image à dessiner, puis passage à la suivante ; `finished` quand l'animation vient de dessiner sa dernière image. */
  step(): { sheet: Hy8; frame: Hy8Frame; finished: boolean } {
    const frame = this.player.frame!;
    this.player.advance();
    return { sheet: this.sheet, frame, finished: this.player.frameIndex === 0 };
  }
}

/** Voie de dragon à l'ordonnée `y` (0 haute, 1 médiane, 2 basse). */
export function laneY(lane: number): number {
  return LANE_FIRST_Y + LANE_SPACING * lane;
}

/**
 * Le dragon touche-t-il le Schtroumpf ? (`1c78:0005`, après le dessin du dragon) : voie haute (`0x46`) touche la pose « haut » ;
 * voie médiane (`0x78`) touche la pose « haut » et le repos ; voie basse (`0xaa`) touche la pose « bas » et le repos.
 * La pose « bas » est donc l'esquive des deux voies hautes, la pose « haut » celle de la voie basse, le repos celle de la voie haute.
 */
export function dragonHits(lane: number, pose: SmurfPose): boolean {
  switch (lane) {
    case 0:
      return pose === "up";
    case 1:
      return pose === "up" || pose === "idle";
    default:
      return pose === "down" || pose === "idle";
  }
}

/** Délai de base selon le niveau interne (`cd3a2` : 2 → 50, 1 → 120, sinon 190 centièmes) ; l'oiseau compte comme le niveau 0. */
export function delayBase(level: number): number {
  return DELAY_BASES[level] ?? DELAY_BASES[0];
}

export interface DragonStepResult {
  sounds: DragonSound[];
  /** Dragon dessiné cette itération (seulement une fois son délai écoulé). */
  dragon: Drawn | null;
  /** Schtroumpf dessiné cette itération (repos ou pose en cours). */
  smurf: Drawn;
}

export interface DragonSprites {
  dragonSheet: Hy8;
  smurfSheet: Hy8;
}

export class DragonRun {
  private readonly dragonAnim: Anim;
  private readonly idleAnim: Anim;
  private readonly upAnim: Anim;
  private readonly downAnim: Anim;
  /** `cd75`, `cd77` : position du dragon ; `cd7b` : voie ; `cd79` : voie précédente (4 = aucune). */
  x = DRAGON_REST_X;
  y = LANE_FIRST_Y;
  lane = 0;
  private previousLane = 4;
  /** `cd6c` (le dragon avance), `cd6d` (il repart), `cd6e` / `cd6f` / `cd71` (pose du Schtroumpf). */
  approaching = false;
  returning = true;
  pose: SmurfPose = "idle";
  /** `cd72` : touché ; `cd74` : le dixième dragon est apparu. */
  burned = false;
  won = false;
  /** `cd7d` : dragons apparus ; `cd7f` : délai (centièmes) ; chrono 2 : instant d'apparition ; `37c9e` : rugissement à jouer. */
  count: number;
  delay = 0;
  private spawnedAt = 0;
  private roarPending = false;

  constructor(
    sprites: DragonSprites,
    private readonly level: number,
    bird: boolean,
    startCentiseconds: number,
  ) {
    this.dragonAnim = new Anim(sprites.dragonSheet, DRAGON_ANIMATION);
    this.idleAnim = new Anim(sprites.smurfSheet, IDLE_ANIMATION);
    this.upAnim = new Anim(sprites.dragonSheet, UP_ANIMATION);
    this.downAnim = new Anim(sprites.smurfSheet, DOWN_ANIMATION);
    this.count = bird ? BIRD_START_COUNT : 0;
    this.spawnedAt = startCentiseconds;
  }

  /** Une itération de la boucle (`1c78:0066..0295`), dans l'ordre de l'original. */
  step(input: DragonInput, ctx: DragonContext): DragonStepResult {
    const sounds: DragonSound[] = [];
    // Apparition d'un dragon : le précédent est reparti hors de l'écran.
    if (this.x > DRAGON_REST_LIMIT && this.returning) {
      this.returning = false;
      this.approaching = true;
      this.delay = delayBase(this.level) + ctx.roll(DELAY_SPREAD);
      do this.lane = ctx.roll(300) % LANE_COUNT;
      while (this.lane === this.previousLane);
      this.y = laneY(this.lane);
      this.count++;
      if (this.count === DRAGONS_TO_WIN) this.won = true;
      this.previousLane = this.lane;
      this.spawnedAt = ctx.centiseconds;
      this.roarPending = true;
    }
    // Rugissement quand le dragon entre dans l'écran, une fois par dragon, si aucun bruitage ne sort.
    if (this.x < DRAGON_ROAR_X && this.approaching && !ctx.soundPlaying && this.roarPending) {
      sounds.push("roar");
      this.roarPending = false;
    }
    // Demi-tour au milieu de l'écran (le rugissement est rattrapé s'il n'a pas pu sortir).
    if (this.x < DRAGON_TURN_X && this.approaching) {
      if (!ctx.soundPlaying && this.roarPending) {
        sounds.push("roar");
        this.roarPending = false;
      }
      this.approaching = false;
      this.returning = true;
    }
    let dragon: Drawn | null = null;
    if (ctx.centiseconds - this.spawnedAt >= this.delay) {
      if (this.approaching) this.x -= DRAGON_STEP;
      if (this.returning) this.x += DRAGON_STEP;
      const { sheet, frame } = this.dragonAnim.step();
      dragon = { sheet, frame, x: this.x, y: this.y };
    }
    // Brûlure : le dragon est assez près et la pose du Schtroumpf ne l'esquive pas.
    if (this.x < DRAGON_HIT_X && this.approaching && dragonHits(this.lane, this.pose)) {
      sounds.push("burn");
      this.burned = true;
    }
    // Touches : une pose à la fois ; « bas » est lu avant « haut ».
    if (input.down && this.pose === "idle") {
      sounds.push("down");
      this.pose = "down";
    }
    if (input.up && this.pose === "idle") {
      sounds.push("up");
      this.pose = "up";
    }
    const step = (this.pose === "idle" ? this.idleAnim : this.pose === "up" ? this.upAnim : this.downAnim).step();
    const smurf: Drawn = { sheet: step.sheet, frame: step.frame, x: SMURF_X, y: SMURF_Y };
    if (this.pose !== "idle" && step.finished) this.pose = "idle";
    return { sounds, dragon, smurf };
  }
}
