/**
 * Sprite temporaire des sauvegardes Coktel : port de `TempSpriteHandler` et `SavePartSprite` de ScummVM
 * (`engines/gob/save/savehandler.cpp`, `savepart.cpp` ; GPL v3+), commun à Lost in Time (SaveLoad_v3,
 * `intro.$$$`) et à Ween (SaveLoad_v2, `save.inf`).
 *
 * Le script écrit un sprite (et sa palette) à une « taille » négative : `-taille - 1` est le numéro du sprite,
 * au-delà de -1000 la palette est aussi concernée, au-delà de -3000 encore 1000 de plus. Le sprite vit en
 * mémoire seulement, comme ScummVM. Les sprites 20 (écran) et 21 (fond) sont réaffichés à la relecture.
 */
import type { GraphicsSystems } from "../graphics";

const SPRITE_COUNT = 100;
export const PALETTE_BYTES = 768;

/** Image 8 bits indexée et sa palette (768 octets, 6 bits par composante) : SavePartSprite. */
export interface SpritePart {
  width: number;
  height: number;
  pixels: Uint8Array;
  palette: Uint8Array;
}

/** Ce que les sauvegardes lisent et écrivent dans l'affichage (sous-ensemble de GraphicsSystems). */
export type SaveGraphics = {
  core: Pick<GraphicsSystems["core"], "wanted" | "setFullPalette" | "touch">;
  draw: { readonly sprites: ArrayLike<{ width: number; height: number; pixels: Uint8Array } | null>; forceBlit(): void };
};

export class TempSpriteHandler {
  private sprite: SpritePart | null = null;

  /** Sans `gfx`, aucun sprite ne peut être désigné : le fichier reste vu absent. */
  constructor(private readonly gfx: SaveGraphics | null) {}

  /** Index de sprite codé dans une « taille » négative (-1 - index) ; -1000 : avec la palette, -3000 en plus. */
  static spriteIndex(size: number): number {
    if (size < -3000) size += 3000;
    if (size < -1000) size += 1000;
    return -size - 1;
  }

  /** Sprite de l'affichage désigné par une « taille » négative ; null si elle ne désigne rien. */
  spriteAt(size: number) {
    if (size >= 0 || !this.gfx) return null;
    const index = TempSpriteHandler.spriteIndex(size);
    if (index < 0 || index >= SPRITE_COUNT) return null;
    return this.gfx.draw.sprites[index] ?? null;
  }

  /** TempSpriteHandler::createSprite + readSprite (+ readPalette) : copie le sprite désigné. */
  capture(size: number): SpritePart | null {
    const sprite = this.spriteAt(size);
    if (!sprite) return null;
    return {
      width: sprite.width,
      height: sprite.height,
      pixels: sprite.pixels.slice(),
      palette: size < -1000 ? this.gfx!.core.wanted.slice(0, PALETTE_BYTES) : new Uint8Array(PALETTE_BYTES),
    };
  }

  /** writeSprite (+ writePalette), puis réaffichage : le sprite 21 est recopié à l'écran, le 20 est l'écran. */
  restore(part: SpritePart, size: number): boolean {
    const target = this.spriteAt(size);
    if (!target) return false;
    target.pixels.set(part.pixels.subarray(0, target.pixels.length));
    if (size < -1000) {
      this.gfx!.core.wanted.set(part.palette.subarray(0, PALETTE_BYTES));
      this.gfx!.core.setFullPalette();
    }
    const index = TempSpriteHandler.spriteIndex(size);
    if (index === 21) this.gfx!.draw.forceBlit();
    else if (index === 20) this.gfx!.core.touch();
    return true;
  }

  /** Taille du fichier : en-tête (4 + 4 + 1), pixels, palette ; -1 tant qu'aucun sprite n'est écrit. */
  getSize(): number {
    return this.sprite ? 4 + 4 + 1 + this.sprite.pixels.length + PALETTE_BYTES : -1;
  }

  /** Taille nulle : succès sans effet. Même nombre de pixels exigé que le sprite mémorisé. */
  load(size: number): boolean {
    if (size === 0) return true;
    const sprite = this.sprite;
    if (!sprite) return false;
    const target = this.spriteAt(size);
    if (!target || target.width * target.height !== sprite.width * sprite.height) return false;
    return this.restore(sprite, size);
  }

  save(size: number): boolean {
    if (size === 0) return true;
    const part = this.capture(size);
    if (!part) return false;
    this.sprite = part;
    return true;
  }
}
