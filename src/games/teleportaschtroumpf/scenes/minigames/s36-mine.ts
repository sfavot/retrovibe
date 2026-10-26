import type { Hy8 } from "../../data/hy8";
import { type Mut, parseMut, parsePrc } from "../../data/mut";
import { parsePal } from "../../data/mcg";
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
import { CART_STEP_Y, LANE_CENTER, LANE_LEFT, LANE_RIGHT, MineRun, TILE_TOPS, type MineSound } from "./s36/run";

/**
 * S36 « La Mine Désaffectée » (`23c9:0004`, 3 505 octets ; RE : `docs/teleportaschtroumpf/minigames/s36.md`, format des tronçons :
 * `docs/teleportaschtroumpf/mut.md`).
 *
 * ### `createMine(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 36) : `level` 0..2 choisit une paire de variantes de la mine,
 *   `bonus` (indice de l'oiseau) force le niveau 3 (paire `s36j` / `s36k`). Défaut de l'original corrigé (2026-10-23) : S36 comparait
 *   l'indice de l'oiseau à 0x1B (la valeur de S27) ; `MINIGAMES` lui donne maintenant le sien, 0x24 (S27 garde le sien) ;
 * - joue : un chariot sur trois voies que le décor fait défiler vers le bas, 10 px par image (12 images par seconde) ; haut / bas le déplacent
 *   dans l'écran, gauche / droite changent de voie là où le tronçon a un aiguillage (dans la fenêtre verticale de celui-ci) ; au doigt,
 *   posé sur la voie du chariot, il l'attire vers le haut ou le bas, posé sur une autre voie, il vaut la flèche de ce côté ; un obstacle
 *   sur la voie du chariot l'arrête. Un tirage (`rand × 2`) choisit la variante dans la paire du niveau ;
 * - rend : `onDone(ctx, { kind: "ingredient", success })` à la fin de la vidéo de fin (`s36b` après un choc, `s36c1` / `s36c2` selon que
 *   l'ingrédient 1 fait partie de l'objectif), passable par Échap ou Espace ; l'appelant applique l'issue.
 */

/** Ingrédient donné par la scène (`MINIGAMES`) : 1. */
const INGREDIENT = sceneIngredient(36)!;

/** Vidéo de réussite : `s36c2` quand l'ingrédient est dans l'objectif (`1e52:0008` vrai), `s36c1` sinon. */
export function mineWinClip(game: Game): string {
  return goalClip(game, INGREDIENT, { inGoal: "s36c2.mux", notInGoal: "s36c1.mux" });
}

/** Variantes de la mine par niveau interne (0..2, 3 = indice de l'oiseau) : `[tirage nul, sinon]` (`CS:23c9:0DB5`, puis `rand × 2 / 0x8000`). */
export const MINE_VARIANTS: readonly (readonly [string, string])[] = [
  ["s36l", "s36g"],
  ["s36f", "s36h"],
  ["s36e", "s36i"],
  ["s36j", "s36k"],
];

/** Variante dont le chariot part sur la voie de droite (`strcmp(nom, "s36j")`). */
export const MINE_RIGHT_START = "s36j";

/** Cadence de l'image (`DS:71C6 = 5` pour `1f33:0348`) : 5 ticks, soit 12 images par seconde. */
export const MINE_FRAME_TICKS = 5;

/** Variante de la mine : le niveau effectif (celui du joueur, 3 avec l'indice de l'oiseau) et le tirage `rand × 2` (0 ou 1). */
export function mineVariant(level: number, roll: number): string {
  const [zero, other] = MINE_VARIANTS[level] ?? MINE_VARIANTS[0];
  return roll === 0 ? zero : other;
}

/**
 * Au doigt (ajout du port) : milieu vertical du chariot sous son ordonnée (`s36a000s.hy8`, animation 0 : lignes −3 à 38, centrée sur
 * l'abscisse). Un doigt posé sur une autre voie que celle du chariot (à plus d'une demi-voie de son abscisse) vaut la flèche de ce côté
 * tenue (aiguillage, ou refus hors aiguillage, comme au clavier) ; sur sa voie, il vaut haut ou bas tenu jusqu'à ce que le milieu du
 * chariot soit à moins d'un pas du doigt.
 */
export const CART_MIDDLE_DY = 18;
export const LANE_HALF_WIDTH = (LANE_CENTER - LANE_LEFT) / 2;

export interface MineKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** Flèches que vaut un doigt posé en (`fingerX`, `fingerY`) pour un chariot en (`x`, `y`). */
export function mineTouchKeys(x: number, y: number, fingerX: number, fingerY: number): MineKeys {
  const keys = { up: false, down: false, left: false, right: false };
  if (fingerX < x - LANE_HALF_WIDTH) keys.left = true;
  else if (fingerX > x + LANE_HALF_WIDTH) keys.right = true;
  else if (fingerY < y + CART_MIDDLE_DY - CART_STEP_Y) keys.up = true;
  else if (fingerY > y + CART_MIDDLE_DY + CART_STEP_Y) keys.down = true;
  return keys;
}

export type MinePhase = "run" | "fadeOut" | "sound" | "result" | "done";

export class MineScene implements Scene {
  readonly step = 1;
  private cart!: Hy8;
  private crash!: Hy8;
  private mut!: Mut;
  private sequence!: number[];
  private palette!: Uint8Array;
  private voices!: Record<MineSound, Voc>;
  private win!: Clip;
  private fail!: Clip;
  private result: Clip | null = null;
  private run!: MineRun;
  private phase: MinePhase = "run";
  private name = "";
  private lastFrame = 0;
  private done = false;
  /** Touches vues depuis la dernière image : un appui plus court qu'une image compte (l'original lit les touches tenues à chaque image). */
  private held = { up: false, down: false, left: false, right: false };
  private readonly finger = new HeldFinger();

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 36);
  }

  get stage(): MinePhase {
    return this.phase;
  }

  /** Variante choisie, `s36e`..`s36l` (pour les tests). */
  get variant(): string {
    return this.name;
  }

  /** La course en cours (pour les tests). */
  get course(): MineRun {
    return this.run;
  }

  get hasCrashed(): boolean {
    return this.run.crashed;
  }

  /** Fichier de la vidéo de fin (pour les tests) : `s36b.mux`, `s36c1.mux` ou `s36c2.mux` ; `null` avant la fin de la course. */
  get endVideo(): string | null {
    return this.result?.file ?? null;
  }

  async load(ctx: SceneContext): Promise<void> {
    const level = minigameLevel(minigameRequest(this.game, 36), 3);
    this.name = mineVariant(level, ctx.rng.below(2));
    this.win = new Clip(mineWinClip(this.game), (c) => this.finish(c));
    this.fail = new Clip("s36b.mux", (c) => this.finish(c));
    const { resources } = ctx;
    const [cart, crash, mut, prc, pal, switchVoc, refuseVoc, crashVoc] = await Promise.all([
      resources.hy8("s36a000s.hy8"),
      resources.hy8("s36a001s.hy8"),
      resources.bytes(`${this.name}.mut`),
      resources.bytes(`${this.name}.prc`),
      resources.bytes(`${this.name}.pal`),
      resources.voc("s36a001b.voc"),
      resources.voc("s36a002b.voc"),
      resources.voc("s36a003b.voc"),
      this.win.load(ctx),
      this.fail.load(ctx),
    ]);
    this.cart = cart;
    this.crash = crash;
    this.mut = parseMut(mut);
    this.sequence = parsePrc(prc);
    this.palette = parsePal(pal);
    this.voices = { switch: switchVoc, refuse: refuseVoc, crash: crashVoc };
  }

  enter(ctx: SceneContext): void {
    this.phase = "run";
    this.done = false;
    this.result = null;
    this.held = { up: false, down: false, left: false, right: false };
    this.finger.reset();
    this.run = new MineRun(
      this.sequence,
      this.mut.tiles.map((tile) => tile.flags),
      this.cart,
      this.crash,
      this.name === "s36j" ? LANE_RIGHT : LANE_CENTER,
    );
    ctx.palette.load(this.palette);
    this.lastFrame = ctx.clock.ticks;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "run":
        this.updateRun(ctx);
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        this.phase = "sound";
        return;
      case "sound":
        // `1f33:03a7(0)` : on attend la fin du son (le choc) avant la vidéo.
        if (ctx.voice.voicePlaying) return;
        this.phase = "result";
        this.result = this.run.crashed ? this.fail : this.win;
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
      case "run":
      case "fadeOut":
      case "sound":
        this.drawCourse(ctx);
        return;
      case "result":
        this.result!.render(ctx);
        return;
      case "done":
        return;
    }
  }

  exit(ctx: SceneContext): void {
    this.win.stop(ctx);
    this.fail.stop(ctx);
  }

  private updateRun(ctx: SceneContext): void {
    const { input } = ctx;
    // Au doigt : la flèche que vaut sa position (voir `mineTouchKeys`), tenue tant qu'il est posé.
    const finger = this.finger.read(input);
    const touched = finger ? mineTouchKeys(this.run.x, this.run.y, finger.x, finger.y) : null;
    for (const key of ["up", "down", "left", "right"] as const) {
      this.held[key] ||= input.pressed(key) || input.justPressed(key) || touched?.[key] === true;
    }
    if (ctx.clock.ticks - this.lastFrame < MINE_FRAME_TICKS) return;
    this.lastFrame = ctx.clock.ticks;
    const { held } = this;
    const fingerHeld = input.touchHeldAt !== null && touched !== null && (touched.up || touched.down || touched.left || touched.right);
    this.run.step({
      ...held,
      idle: !(input.pressed("up") || input.pressed("down") || input.pressed("left") || input.pressed("right") || fingerHeld),
      soundPlaying: ctx.voice.voicePlaying,
    });
    this.held = { up: false, down: false, left: false, right: false };
    for (const sound of this.run.sounds) ctx.voice.play(this.voices[sound]);
    if (this.run.ended) {
      // `1523:01fa(0x10)` : fondu au noir sur la dernière image.
      this.phase = "fadeOut";
      ctx.fade.out();
    }
  }

  /** Les trois tronçons visibles puis les sprites de l'image (`30bb:000a` ×3, puis `31fe:0481`). */
  private drawCourse(ctx: SceneContext): void {
    const { tileIndex, scroll } = this.run.view;
    const { surface } = ctx;
    for (let offset = 0; offset < 3; offset++) {
      surface.blitImage(this.mut.tiles[this.sequence[tileIndex + offset]], 0, scroll + TILE_TOPS[offset], { opaque: true });
    }
    for (const sprite of this.run.sprites) surface.drawFrame(sprite.sheet === "cart" ? this.cart : this.crash, sprite.frame, sprite.x, sprite.y);
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, ingredientOutcome(!this.run.crashed));
  }
}

export const createMine: MinigameFactory = (game, onDone) => new MineScene(game, onDone);
