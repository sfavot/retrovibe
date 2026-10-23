import type { Hy8, Hy8Frame } from "../../../data/hy8";
import { MutFlag } from "../../../data/mut";
import { AnimationPlayer } from "../../../engine/sprites";

/**
 * Logique de la course de S36 « La Mine Désaffectée » (boucle de `23c9:0004`, RE : `docs/teleportaschtroumpf/minigames/s36.md`),
 * sans écran ni son : `MineRun.step` joue **une itération** de la boucle de l'original et dit ce qu'il faut dessiner et jouer.
 */

/** Les trois voies : abscisses du chariot (`DS:6F6E`, `3d50e`). */
export const LANE_LEFT = 0x51;
export const LANE_CENTER = 0xa1;
export const LANE_RIGHT = 0xf1;

/** Défilement par image (`3d624`), hauteur d'un tronçon (0x8c lignes) et position de son haut quand le défilement vaut `scroll`. */
export const SCROLL_SPEED = 10;
export const TILE_HEIGHT = 140;
/** Haut du tronçon courant (le plus bas, `4ec`), du suivant et du suivant encore à l'écran, pour un défilement `scroll` (0..140). */
export const TILE_TOPS = [60, -80, -220] as const;

/** Ordonnée de départ du chariot, bornes et pas du haut / bas (`3d512`, `0x3c..0xaa`, `3d622`). */
export const CART_START_Y = 100;
export const CART_MIN_Y = 0x3c;
export const CART_MAX_Y = 0xaa;
export const CART_STEP_Y = 5;

/** Les trois tronçons visibles au départ : l'original en précharge 3 et s'arrête quand il en reste 3 de moins que la PRC. */
export const PRELOADED_TILES = 3;

/**
 * Position de l'élément du tronçon (aiguillage, obstacle) par rapport à son haut : `ref` = haut + 60 pour l'aiguillage ; l'obstacle est
 * 30 lignes plus haut dans le tronçon. Fenêtres verticales du chariot (ligne du bas du sprite) : aiguillage vers la droite
 * `[ref, ref + 20]`, vers la gauche `[ref, ref + 10]` ; obstacle `[ref − 30, ref − 20]`.
 */
export const SWITCH_ROW = 60;
export const OBSTACLE_OFFSET = 0x1e;
export const SWITCH_WINDOW_RIGHT = 0x14;
export const SWITCH_WINDOW_LEFT = 10;
export const OBSTACLE_WINDOW = 10;
/** L'animation de changement de voie est dessinée 0x41 lignes au-dessus de sa position courante (`3d514 − 0x41`). */
export const SWITCH_SPRITE_RAISE = 0x41;
/** Une touche de direction ne déclenche un aiguillage que pendant ses 3 premières images tenues (`3d522` entre 1 et 3). */
export const SWITCH_PRESS_FRAMES = 3;

/** Animations de `s36a000s.hy8` (`12d7:0144`) et de `s36a001s.hy8`. */
const ANIMATION_ROLL = 0;
const ANIMATION_TO_LEFT = 1;
const ANIMATION_TO_RIGHT = 2;
const ANIMATION_TRAIL_RIGHT = 3;
const ANIMATION_TRAIL_LEFT = 4;
const ANIMATION_CRASH = 0;

export interface MineInput {
  /** Touches tenues (bits 1, 2, 4, 8 de `DS:4BBB`) ; un appui plus court qu'une image compte. */
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Aucune touche tenue à la fin de l'image (`DS:018E == 0`) : le compteur d'appui retombe à 0. */
  idle: boolean;
  /** Un son sort déjà (`15f9:089f(0, 0, 0, 0x10)`) : le son de changement de voie et celui de refus ne sont lancés que s'il n'en sort aucun. */
  soundPlaying: boolean;
}

/** Sons demandés par une image : changement de voie (`s36a001b`), refus (`s36a002b`), choc (`s36a003b`). */
export type MineSound = "switch" | "refuse" | "crash";

/** Un sprite à poser par-dessus les tronçons : `sheet` choisit `s36a000s.hy8` (chariot) ou `s36a001s.hy8` (choc). */
export interface MineSprite {
  sheet: "cart" | "crash";
  frame: Hy8Frame;
  x: number;
  y: number;
}

/** Ce que montre l'image qui vient d'être jouée : tronçons (indice du premier) et défilement avant le changement de tronçon. */
export interface MineView {
  tileIndex: number;
  scroll: number;
}

/** Vrai si `flags` offre la touche `direction` (aiguillage de la voie `lane`). */
export function hasSwitch(flags: number, lane: number, direction: "left" | "right"): boolean {
  if (direction === "right") {
    return ((flags & MutFlag.SwitchLeftToCenter) !== 0 && lane === LANE_LEFT) || ((flags & MutFlag.SwitchCenterToRight) !== 0 && lane === LANE_CENTER);
  }
  return ((flags & MutFlag.SwitchRightToCenter) !== 0 && lane === LANE_RIGHT) || ((flags & MutFlag.SwitchCenterToLeft) !== 0 && lane === LANE_CENTER);
}

/** Un obstacle du tronçon barre-t-il la voie `lane` ? */
export function hasObstacle(flags: number, lane: number): boolean {
  return (
    ((flags & MutFlag.ObstacleLeft) !== 0 && lane === LANE_LEFT) ||
    ((flags & MutFlag.ObstacleCenter) !== 0 && lane === LANE_CENTER) ||
    ((flags & MutFlag.ObstacleRight) !== 0 && lane === LANE_RIGHT)
  );
}

/** Animation HY8 vue comme `12d7:00c1` : rend la frame courante puis avance ; `counter` retombe à 0 après la dernière. */
class Cycle {
  private readonly player: AnimationPlayer;

  constructor(hy8: Hy8, index: number) {
    this.player = new AnimationPlayer(hy8, index);
  }

  next(): Hy8Frame {
    const frame = this.player.frame!;
    this.player.advance();
    return frame;
  }

  get counter(): number {
    return this.player.frameIndex;
  }
}

export class MineRun {
  /** Défilement dans le tronçon courant (0..140) et nombre de tronçons déjà passés. */
  scroll = -SCROLL_SPEED;
  tileIndex = 0;
  x: number;
  y = CART_START_Y;
  /** Ce qui a été joué par la dernière image (voir `MineView`), les sprites à dessiner et les sons à lancer. */
  view: MineView = { tileIndex: 0, scroll: 0 };
  sprites: MineSprite[] = [];
  sounds: MineSound[] = [];
  /** Nombre d'images jouées. */
  frames = 0;
  /** Le chariot a heurté un obstacle. */
  crashed = false;

  private visible = true; // `3d605` : le chariot roule (faux pendant un changement de voie ou un choc)
  private rightEnabled = true; // `3d606` : la touche droite agit (faux sur la voie de droite)
  private leftEnabled = true; // `3d607`
  private toRight = false; // `3d608`
  private toLeft = false; // `3d609`
  private crashOver = false; // `3d60b`
  private pressFrames = 0; // `3d522`
  private switchY = 0; // `3d514`
  private readonly roll: Cycle;
  private readonly toLeftAnimation: Cycle;
  private readonly toRightAnimation: Cycle;
  private readonly trailRight: Cycle;
  private readonly trailLeft: Cycle;
  private readonly crashAnimation: Cycle;

  /**
   * `sequence` : la PRC (indices dans `tileFlags`) ; `tileFlags[i]` : drapeaux du i-ième tronçon du MUT ; `startX` : voie de départ
   * (`LANE_CENTER`, `LANE_RIGHT` pour la variante `s36j`).
   */
  constructor(
    private readonly sequence: readonly number[],
    private readonly tileFlags: readonly number[],
    cart: Hy8,
    crash: Hy8,
    startX: number = LANE_CENTER,
  ) {
    this.x = startX;
    this.roll = new Cycle(cart, ANIMATION_ROLL);
    this.toLeftAnimation = new Cycle(cart, ANIMATION_TO_LEFT);
    this.toRightAnimation = new Cycle(cart, ANIMATION_TO_RIGHT);
    this.trailRight = new Cycle(cart, ANIMATION_TRAIL_RIGHT);
    this.trailLeft = new Cycle(cart, ANIMATION_TRAIL_LEFT);
    this.crashAnimation = new Cycle(crash, ANIMATION_CRASH);
  }

  /** La course est finie : choc, ou la PRC consommée jusqu'à l'avant-dernier élément (`3d52c < 3d8ba`, `3d8ba = n − 1`). */
  get ended(): boolean {
    return this.crashOver || this.tileIndex + PRELOADED_TILES >= this.sequence.length - 1;
  }

  /** Nombre d'images d'une course sans choc : la première (défilement 0), puis 14 par tronçon. */
  get totalFrames(): number {
    return 1 + ((TILE_HEIGHT / SCROLL_SPEED) * (this.sequence.length - 1 - PRELOADED_TILES));
  }

  /** Vrai pendant un changement de voie. */
  get switching(): boolean {
    return this.toLeft || this.toRight;
  }

  /** Drapeaux du tronçon `offset` (0 = le plus bas) à partir du tronçon courant. */
  flagsAt(offset: number): number {
    return this.tileFlags[this.sequence[this.tileIndex + offset]] ?? 0;
  }

  /**
   * Le tronçon sous le chariot et sa référence verticale (`3d502`, `3d518`) pour un défilement `scroll` : le tronçon courant
   * si le chariot est à son niveau ou en dessous de son haut, sinon le suivant, rarement le troisième.
   */
  private under(scroll: number): { flags: number; ref: number } {
    const lower = scroll + TILE_TOPS[0];
    const middle = scroll + TILE_TOPS[1];
    if (this.y >= lower) return { flags: this.flagsAt(0), ref: lower + SWITCH_ROW };
    if (this.y > middle) return { flags: this.flagsAt(1), ref: middle + SWITCH_ROW };
    return { flags: this.flagsAt(2), ref: middle - TILE_HEIGHT + SWITCH_ROW };
  }

  /** Le tronçon et sa référence que verra la prochaine image (pour un pilote automatique : les tests). */
  peek(): { flags: number; ref: number } {
    return this.under(this.scroll + SCROLL_SPEED);
  }

  /** Une itération de la boucle de `23c9:0004`. */
  step(input: MineInput): void {
    this.sprites = [];
    this.sounds = [];
    this.frames++;
    this.scroll += SCROLL_SPEED;
    const { scroll } = this;
    this.view = { tileIndex: this.tileIndex, scroll };

    // Haut / bas : seulement entre deux changements de voie (le choc ne bloque pas).
    if (!this.switching) {
      if (input.up && this.y > CART_MIN_Y) this.y -= CART_STEP_Y;
      if (input.down && this.y < CART_MAX_Y) this.y += CART_STEP_Y;
    }

    const { flags, ref } = this.under(scroll);

    if (this.rightEnabled && input.right) {
      this.pressFrames++;
      if (!hasSwitch(flags, this.x, "right")) this.refuse(input);
      else if (this.y >= ref && this.y <= ref + SWITCH_WINDOW_RIGHT && this.pressFrames > 0 && this.pressFrames <= SWITCH_PRESS_FRAMES) {
        this.toRight = true;
        this.visible = false;
      }
    }
    if (this.leftEnabled && input.left) {
      this.pressFrames++;
      if (!hasSwitch(flags, this.x, "left")) this.refuse(input);
      else if (this.y >= ref && this.y <= ref + SWITCH_WINDOW_LEFT && this.pressFrames > 0 && this.pressFrames <= SWITCH_PRESS_FRAMES) {
        this.toLeft = true;
        this.visible = false;
      }
    }

    const obstacle = ref - OBSTACLE_OFFSET;
    if (!this.switching && hasObstacle(flags, this.x) && this.y >= obstacle && this.y <= obstacle + OBSTACLE_WINDOW) {
      this.crashed = true;
      this.visible = false;
    }

    if (this.visible) this.draw("cart", this.roll.next(), this.x, this.y);

    if (this.toLeft) this.advanceSwitch(input, ref, "left");
    if (this.toRight) this.advanceSwitch(input, ref, "right");

    if (this.crashed) {
      this.sounds.push("crash");
      this.draw("crash", this.crashAnimation.next(), this.x, this.y);
      // Défaut de l'original corrigé (2026-10-23) : il testait le compteur de l'animation « vers la droite » (`DS:712B`, toujours 0), donc
      // la course s'arrêtait à la 1re image du choc ; on teste celui de l'animation de choc : elle se joue en entier (6 images).
      if (this.crashAnimation.counter === 0) this.crashOver = true;
    }

    if (scroll === TILE_HEIGHT) {
      this.tileIndex++;
      this.scroll = 0;
    }
    if (input.idle) this.pressFrames = 0;
  }

  private draw(sheet: MineSprite["sheet"], frame: Hy8Frame, x: number, y: number): void {
    this.sprites.push({ sheet, frame, x, y });
  }

  /** Touche sans aiguillage possible : son de refus et les deux rebonds, sur place. */
  private refuse(input: MineInput): void {
    if (!input.soundPlaying) this.sounds.push("refuse");
    this.draw("cart", this.trailLeft.next(), this.x, this.y);
    this.draw("cart", this.trailRight.next(), this.x, this.y);
  }

  /**
   * Une image du changement de voie (huit images) : l'animation est dessinée sur la voie visée, 0x41 lignes au-dessus d'une ordonnée
   * qui descend de 10 par image avec le décor ; pendant les deux premières images, le rebond de la voie quittée.
   */
  private advanceSwitch(input: MineInput, ref: number, direction: "left" | "right"): void {
    if (!input.soundPlaying) this.sounds.push("switch");
    const left = direction === "left";
    const target = left ? (this.x === LANE_CENTER ? LANE_LEFT : LANE_CENTER) : this.x === LANE_CENTER ? LANE_RIGHT : LANE_CENTER;
    if (this.switchY === 0) this.switchY = ref;
    const move = left ? this.toLeftAnimation : this.toRightAnimation;
    this.draw("cart", move.next(), target, this.switchY - SWITCH_SPRITE_RAISE);
    if (move.counter === 1 || move.counter === 2) this.draw("cart", (left ? this.trailRight : this.trailLeft).next(), this.x, this.switchY);
    this.switchY += SCROLL_SPEED;
    if (move.counter !== 0) return;
    // Fin de l'animation : le chariot reprend sa course sur la nouvelle voie, à l'ordonnée où l'animation s'est arrêtée.
    this.y = this.switchY - SWITCH_SPRITE_RAISE - SCROLL_SPEED;
    this.switchY = 0;
    this.visible = true;
    if (left) {
      this.toLeft = false;
      this.rightEnabled = true;
      if (this.x === LANE_CENTER) {
        this.x = LANE_LEFT;
        this.leftEnabled = false;
      } else this.x = LANE_CENTER;
    } else {
      this.toRight = false;
      this.leftEnabled = true;
      if (this.x === LANE_CENTER) {
        this.x = LANE_RIGHT;
        this.rightEnabled = false;
      } else this.x = LANE_CENTER;
    }
  }
}
