import type { Hy8, Hy8Animation, Hy8Frame, Hy8Image } from "../data/hy8";
import { HY8_FLAG_MIRROR_X, HY8_PART_IMAGE, HY8_PART_SUB_SPRITE } from "../data/hy8";

/** Rectangle d'une image posée (coordonnées relatives à l'ancre du sprite). */
export interface PlacedImage {
  image: Hy8Image;
  left: number;
  top: number;
  mirror: boolean;
}

/** Bit 0x8000 du mot d'indice d'un sprite / d'une frame : miroir horizontal (`31fe:0481`). */
export const SPRITE_MIRROR_X = 0x8000;
/** Les 12 bits bas du mot d'indice sont le numéro du sprite. */
export const SPRITE_INDEX_MASK = 0x0fff;

/**
 * Pose les images d'un sprite composé. Ancrage : x = bord gauche, y = ligne du bas de l'image ;
 * en miroir x, le bord droit est sur le point (`x -= largeur`, voir docs/teleportaschtroumpf/hy8.md).
 * Le miroir de frame (0x8000) inverse les x des points et le miroir de chaque partie.
 */
export function placeSprite(hy8: Hy8, spriteIndex: number, frameMirror: boolean, ox = 0, oy = 0, depth = 0): PlacedImage[] {
  const sprite = hy8.sprites[spriteIndex];
  if (!sprite) throw new Error(`sprite ${spriteIndex} absent (${hy8.sprites.length} sprites)`);
  if (depth > 8) throw new Error("sprites imbriqués trop profondément");
  const placed: PlacedImage[] = [];
  for (const part of sprite.parts) {
    const point = part.points[0] ?? { x: 0, y: 0 };
    const x = ox + (frameMirror ? -point.x : point.x);
    const y = oy + point.y;
    const mirror = ((part.flags & HY8_FLAG_MIRROR_X) !== 0) !== frameMirror;
    if (part.kind === HY8_PART_IMAGE) {
      const image = hy8.images[part.target];
      if (!image) throw new Error(`image ${part.target} absente (${hy8.images.length} images)`);
      placed.push({ image, left: mirror ? x - image.width : x, top: y - image.height + 1, mirror });
    } else if (part.kind === HY8_PART_SUB_SPRITE) {
      placed.push(...placeSprite(hy8, part.target, frameMirror, x, y, depth + 1));
    }
  }
  return placed;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(placed: PlacedImage[], into?: Bounds): Bounds {
  const b = into ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of placed) {
    b.minX = Math.min(b.minX, p.left);
    b.minY = Math.min(b.minY, p.top);
    b.maxX = Math.max(b.maxX, p.left + p.image.width);
    b.maxY = Math.max(b.maxY, p.top + p.image.height);
  }
  return b;
}

/** Frames d'une animation -> images posées. */
export function placeFrame(hy8: Hy8, frame: Hy8Frame): PlacedImage[] {
  return placeSprite(hy8, frame.sprite, (frame.flags & SPRITE_MIRROR_X) !== 0);
}

/**
 * Lecteur d'animation HY8 (`12d7:0008` / `12d7:00c1`) : une frame courante, avancée à la demande
 * (typiquement une fois par `update` de scène) ; revient à la frame 0 après la dernière (boucle).
 * `looped` devient vrai au passage de la dernière frame à la première : le jeu s'en sert pour détecter
 * la fin d'une animation (`iRam0003cd16 == 0`).
 */
export class AnimationPlayer {
  readonly animation: Hy8Animation;
  frameIndex = 0;
  /** Vrai à partir du premier retour à la frame 0 ; remis à faux par `restart()`. */
  looped = false;

  constructor(
    readonly hy8: Hy8,
    animationIndex: number,
  ) {
    const animation = hy8.animations[animationIndex];
    if (!animation) throw new Error(`animation ${animationIndex} absente (${hy8.animations.length} animations)`);
    this.animation = animation;
  }

  get frame(): Hy8Frame | undefined {
    return this.animation.frames[this.frameIndex];
  }

  /** Passe à la frame suivante ; sans effet sur une animation vide. */
  advance(): void {
    const count = this.animation.frames.length;
    if (count === 0) return;
    this.frameIndex++;
    if (this.frameIndex >= count) {
      this.frameIndex = 0;
      this.looped = true;
    }
  }

  restart(): void {
    this.frameIndex = 0;
    this.looped = false;
  }
}
