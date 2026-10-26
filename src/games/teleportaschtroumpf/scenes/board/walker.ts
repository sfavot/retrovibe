import type { Hy8, Hy8Frame } from "../../data/hy8";
import { TICKS_PER_SECOND } from "../../engine/clock";

/**
 * Poses du Schtroumpf sur le plateau (`DS:28A0`, `2bd4:02bd` pour le choix, `2bd4:0093` pour le dessin et le déplacement).
 * Chaque pose joue une animation de `s01a000s.hy8` (`291e:000e`, `POSE_ANIMATION`).
 */
export const POSE_IDLE_RIGHT = 0;
export const POSE_IDLE_LEFT = 1;
export const POSE_WALK_RIGHT = 2;
export const POSE_WALK_LEFT = 3;
export const POSE_JUMP_RIGHT = 4;
export const POSE_JUMP_LEFT = 5;
export const POSE_RUN_RIGHT = 6;
export const POSE_RUN_LEFT = 7;
/** Le Schtroumpf s'impatiente (immobile depuis 8 s). */
export const POSE_FIDGET_RIGHT = 8;
export const POSE_FIDGET_LEFT = 9;
/** Arrivée après une téléportation (`2bd4:0093`, poses 10 et 11 ; l'original n'en lance que la 10). */
export const POSE_ARRIVE = 10;

/** Animation de `s01a000s.hy8` jouée par chaque pose (`291e:000e` : `12d7:0144(objet, n)`). */
export const POSE_ANIMATION: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 9, 0xb, 0xc, 0xd];

/** Marche continue avant de courir, et immobilité avant de s'impatienter (`1f33:019a(6)` : `< 5`, `< 8`). */
export const RUN_AFTER_SECONDS = 5;
export const FIDGET_AFTER_SECONDS = 8;
/** Bruitages : bips préchargés (`s01a002b` = 1, `s01a001b` = 2). */
export const BEEP_ARRIVE = 1;
export const BEEP_JUMP = 2;
/** Image de l'animation de saut (0-based) à laquelle le bruitage part (`iRam3df63 == 2`). */
const JUMP_SOUND_FRAME = 2;

export interface WalkerInput {
  left: boolean;
  right: boolean;
  /** « Haut » tenu : un saut, vers la direction tenue ou, sans direction, du côté où regarde le pion. */
  up: boolean;
  /** Le bouton a été pressé à cette image : le pion s'arrête. */
  press: boolean;
}

/** Ce que l'image demande à la partie. */
export interface WalkerStep {
  /** Une image de marche (`run` : course) ; la partie applique `Game.walk`. */
  walk?: { dir: -1 | 1; run: boolean };
  /** Le saut précédent est fini : la partie applique `Game.jump` (68 px). */
  jump?: -1 | 1;
  /** Bruitage à jouer (`ctx.voice.playBeep`). */
  beep?: number;
}

/**
 * Machine à états du Schtroumpf (`2bd4:02bd` + `2bd4:0093`), appelée une fois par image du plateau (4 ticks) :
 *
 * - gauche / droite tenus : marche à 4 px par image ; passé 5 s de marche continue dans le même sens, course à 8 px ;
 * - haut (+ direction) : saut de 10 images (pas d'entrée pendant ce temps), puis déplacement de 68 px à la dernière ; sans
 *   direction, l'original ne saute pas, le port saute du côté où regarde le pion ;
 * - immobile : pose d'attente, puis impatience au bout de 8 s ;
 * - le bouton arrête la marche. Le chrono de pose (`slot 6`) repart à chaque changement de pose, sauf marche → course et
 *   attente → impatience.
 *
 * L'ordre des priorités est celui de l'original : saut à droite, saut à gauche, puis marche à gauche l'emporte sur la
 * marche à droite. Aucun accès à l'horloge ni au dessin : testable seul.
 */
export class Walker {
  pose = POSE_IDLE_RIGHT;
  frame = 0;
  private startTick = 0;
  private jumpDir: -1 | 1 | null = null;
  private jumpEnded = false;
  private arrived = false;
  /** Le bruitage du saut n'est armé qu'après un premier saut terminé (`DS:8FFE`, nul au démarrage). */
  private soundArmed = false;
  /** Index de la frame dessinée par le dernier `step` (la frame courante avant l'avance). */
  private shownFrame = 0;

  /** Vrai pendant un saut ou l'animation d'arrivée : les touches sont ignorées. */
  get busy(): boolean {
    return this.pose === POSE_JUMP_RIGHT || this.pose === POSE_JUMP_LEFT || this.pose === POSE_ARRIVE;
  }

  get facingRight(): boolean {
    return this.pose % 2 === 0 || this.pose === POSE_ARRIVE;
  }

  /** Nouvelle position affichée : pose d'attente dans le sens voulu. */
  reset(facingRight: boolean, nowTicks: number): void {
    this.setPose(facingRight ? POSE_IDLE_RIGHT : POSE_IDLE_LEFT, nowTicks, true);
    this.jumpDir = null;
    this.jumpEnded = false;
    this.arrived = false;
  }

  /** Relance le chrono de pose (`1f33:0181(6)`, `291e:0b72` : quand le joueur prend la main) : l'impatience attend 8 s de plus. */
  restartPoseTimer(nowTicks: number): void {
    this.startTick = nowTicks;
  }

  /** Animation d'arrivée (`de32` : après une téléportation), puis attente tourné vers la droite. */
  startArrival(nowTicks: number): void {
    this.setPose(POSE_ARRIVE, nowTicks, true);
    this.jumpDir = null;
    this.jumpEnded = false;
    this.arrived = false;
  }

  /**
   * Change de pose : l'animation repart de zéro (`12d7:0144`) ; le chrono de pose repart aussi, sauf marche → course et
   * attente → impatience (`2bd4:02bd`, fin), ou si la pose ne change pas.
   */
  private setPose(pose: number, nowTicks: number, force = false): void {
    const previous = this.pose;
    const keepTimer =
      (previous === POSE_WALK_RIGHT && pose === POSE_RUN_RIGHT) ||
      (previous === POSE_WALK_LEFT && pose === POSE_RUN_LEFT) ||
      (previous === POSE_IDLE_RIGHT && pose === POSE_FIDGET_RIGHT) ||
      (previous === POSE_IDLE_LEFT && pose === POSE_FIDGET_LEFT);
    if (force || pose !== previous) this.frame = 0;
    if (force || (pose !== previous && !keepTimer)) this.startTick = nowTicks;
    this.pose = pose;
  }

  private seconds(nowTicks: number): number {
    return Math.floor((nowTicks - this.startTick) / TICKS_PER_SECOND);
  }

  /** Une image : décide de la pose d'après les touches, renvoie le mouvement demandé et avance l'animation. */
  step(input: WalkerInput, nowTicks: number, hy8: Hy8): WalkerStep {
    const out: WalkerStep = {};

    // Fin d'un saut (`de48` / `de47`) ou de l'arrivée (`de31`), constatée à l'image suivante.
    if (this.jumpEnded && this.jumpDir !== null) {
      out.jump = this.jumpDir;
      this.setPose(this.jumpDir === 1 ? POSE_IDLE_RIGHT : POSE_IDLE_LEFT, nowTicks, true);
      this.jumpDir = null;
      this.jumpEnded = false;
    }
    if (this.arrived) {
      this.arrived = false;
      this.setPose(POSE_IDLE_RIGHT, nowTicks, true);
    }

    if (!this.busy) {
      if (input.up && !input.press) {
        // Écart : l'original ne saute qu'avec une direction ; « haut » seul saute ici du côté où regarde le pion.
        const dir = input.right ? 1 : input.left ? -1 : this.facingRight ? 1 : -1;
        this.jumpDir = dir;
        this.setPose(dir === 1 ? POSE_JUMP_RIGHT : POSE_JUMP_LEFT, nowTicks, true);
      } else if (input.press) {
        // Le bouton arrête la marche (`2bd4:02bd` : poses 2, 3, 6, 7 → attente).
        if (this.pose === POSE_WALK_RIGHT || this.pose === POSE_RUN_RIGHT) this.setPose(POSE_IDLE_RIGHT, nowTicks, true);
        else if (this.pose === POSE_WALK_LEFT || this.pose === POSE_RUN_LEFT) this.setPose(POSE_IDLE_LEFT, nowTicks, true);
      } else if (input.left) {
        this.setPose(this.seconds(nowTicks) < RUN_AFTER_SECONDS || (this.pose !== POSE_WALK_LEFT && this.pose !== POSE_RUN_LEFT) ? POSE_WALK_LEFT : POSE_RUN_LEFT, nowTicks);
      } else if (input.right) {
        this.setPose(this.seconds(nowTicks) < RUN_AFTER_SECONDS || (this.pose !== POSE_WALK_RIGHT && this.pose !== POSE_RUN_RIGHT) ? POSE_WALK_RIGHT : POSE_RUN_RIGHT, nowTicks);
      } else {
        const right = this.facingRight;
        const idle = right ? POSE_IDLE_RIGHT : POSE_IDLE_LEFT;
        const fidget = right ? POSE_FIDGET_RIGHT : POSE_FIDGET_LEFT;
        // Un pas de marche ou de course laisse la pose d'attente du même côté ; l'attente dure 8 s avant l'impatience.
        const resting = this.pose === idle || this.pose === fidget;
        if (!resting) this.setPose(idle, nowTicks, true);
        else this.setPose(this.seconds(nowTicks) < FIDGET_AFTER_SECONDS ? idle : fidget, nowTicks);
      }
    }

    // `2bd4:0093` : déplacement de la pose, puis frame suivante de son animation.
    switch (this.pose) {
      case POSE_WALK_RIGHT:
        out.walk = { dir: 1, run: false };
        break;
      case POSE_WALK_LEFT:
        out.walk = { dir: -1, run: false };
        break;
      case POSE_RUN_RIGHT:
        out.walk = { dir: 1, run: true };
        break;
      case POSE_RUN_LEFT:
        out.walk = { dir: -1, run: true };
        break;
    }
    const animation = hy8.animations[POSE_ANIMATION[this.pose]];
    const frames = animation?.frames.length ?? 1;
    const shown = this.frame;
    this.frame = (this.frame + 1) % Math.max(1, frames);
    const wrapped = this.frame === 0;
    if (this.pose === POSE_JUMP_RIGHT || this.pose === POSE_JUMP_LEFT) {
      if (this.soundArmed && shown === JUMP_SOUND_FRAME - 1) {
        out.beep = BEEP_JUMP;
        this.soundArmed = false;
      }
      if (wrapped) {
        this.jumpEnded = true;
        this.soundArmed = true;
      }
    } else if (this.pose === POSE_ARRIVE && wrapped) {
      this.arrived = true;
      out.beep = BEEP_ARRIVE;
    }
    this.shownFrame = shown;
    return out;
  }

  /** Frame d'animation à dessiner pour la pose courante (`undefined` si l'animation est vide). */
  currentFrame(hy8: Hy8): Hy8Frame | undefined {
    return hy8.animations[POSE_ANIMATION[this.pose]]?.frames[this.shownFrame];
  }
}
