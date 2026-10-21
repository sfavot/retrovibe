import { CharacterType, FrameEntry, LAYERS, Layer, TILE_SIZE, type Tile } from "../data/types";
import type { Palette } from "../data/palette";
import type { Assets } from "../engine/assets";
import type { Game } from "../engine/game";
import { DIRECTION_VECTORS, Direction, type Point } from "../engine/geometry";
import type { ZoneState } from "../engine/zone-state";

export const VIEW_TILES = 9;
export const VIEW_PIXELS = VIEW_TILES * TILE_SIZE;

const FACING_ENTRY: Record<Direction, FrameEntry> = {
  [Direction.Up]: FrameEntry.Up,
  [Direction.Down]: FrameEntry.Down,
  [Direction.Left]: FrameEntry.Left,
  [Direction.Right]: FrameEntry.Right,
};

const EXTENSION_ENTRY: Record<Direction, FrameEntry> = {
  [Direction.Up]: FrameEntry.ExtensionUp,
  [Direction.Down]: FrameEntry.ExtensionDown,
  [Direction.Left]: FrameEntry.ExtensionLeft,
  [Direction.Right]: FrameEntry.ExtensionRight,
};

/** Image 8 bits (index de palette) de la vue 9×9. */
export class IndexedFrame {
  readonly pixels = new Uint8Array(VIEW_PIXELS * VIEW_PIXELS);

  clear(): void {
    this.pixels.fill(0);
  }

  copyFrom(other: IndexedFrame): void {
    this.pixels.set(other.pixels);
  }

  drawTile(tile: Tile | undefined, tx: number, ty: number): void {
    if (!tile || tx < 0 || ty < 0 || tx >= VIEW_TILES || ty >= VIEW_TILES) return;
    const src = tile.pixels;
    const dst = this.pixels;
    let o = ty * TILE_SIZE * VIEW_PIXELS + tx * TILE_SIZE;
    for (let y = 0; y < TILE_SIZE; y++, o += VIEW_PIXELS) {
      const row = y * TILE_SIZE;
      for (let x = 0; x < TILE_SIZE; x++) {
        const c = src[row + x];
        if (c !== 0) dst[o + x] = c;
      }
    }
  }
}

/** Décalage de caméra (en cases) : le héros au centre, sans sortir de la zone. */
export function cameraFor(zone: ZoneState, hero: Point): Point {
  const clamp = (v: number, size: number) => Math.max(0, Math.min(size - VIEW_TILES, v));
  return { x: clamp(hero.x - 4, zone.width), y: clamp(hero.y - 4, zone.height) };
}

/** Compose la vue de jeu (couches, héros, attaques, projectiles) dans une image indexée. */
export function composeView(game: Game, frame: IndexedFrame, blinkTile?: { tile: number; at: Point }): Point {
  const assets = game.assets;
  const zone = game.zone;
  const hero = game.hero;
  const camera = cameraFor(zone, hero);
  frame.clear();
  for (let layer = 0; layer < LAYERS; layer++) {
    for (let y = 0; y < VIEW_TILES; y++) {
      for (let x = 0; x < VIEW_TILES; x++) {
        const id = zone.getTile(x + camera.x, y + camera.y, layer);
        if (id >= 0) frame.drawTile(assets.tile(id), x, y);
      }
    }
    if (layer === Layer.Object) drawActors(game, assets, frame, camera);
  }
  // L'objet trouvé clignote au premier plan, par-dessus Indy et les éléments de décor.
  if (blinkTile) frame.drawTile(assets.tile(blinkTile.tile), blinkTile.at.x - camera.x, blinkTile.at.y - camera.y);
  return camera;
}

function drawActors(
  game: Game,
  assets: Assets,
  frame: IndexedFrame,
  camera: Point,
): void {
  const zone = game.zone;
  const hero = game.hero;
  const at = (p: Point, id: number) => {
    if (id >= 0) frame.drawTile(assets.tile(id), p.x - camera.x, p.y - camera.y);
  };

  for (const o of game.overlays) at(o, o.tile);

  const attack = game.attack;
  if (hero.visible) {
    if (attack && attack.weapon.type === CharacterType.Weapon) {
      const pose = attack.weapon.frames[1 + (attack.frame % 2)];
      const tile = pose[FACING_ENTRY[hero.facing]];
      at(hero, tile >= 0 ? tile : heroTile(game));
      if (!attack.projectile && attack.frame < 3) {
        const extension = attack.weapon.frames[attack.frame === 1 ? 2 : 1][EXTENSION_ENTRY[hero.facing]];
        const v = DIRECTION_VECTORS[hero.facing];
        at({ x: hero.x + v.x, y: hero.y + v.y }, extension);
      }
    } else {
      at(hero, heroTile(game));
    }
  }
  if (attack?.projectile && attack.bullet && (attack.bullet.x !== hero.x || attack.bullet.y !== hero.y)) {
    at(attack.bullet, attack.weapon.frames[0][FACING_ENTRY[hero.facing]]);
  }

  for (const m of zone.monsters) {
    if (!m.bullet) continue;
    const weapon = assets.character(m.character.reference);
    if (!weapon) continue;
    const dir = m.bullet.dy < 0 ? Direction.Up : m.bullet.dy > 0 ? Direction.Down : m.bullet.dx < 0 ? Direction.Left : Direction.Right;
    at(m.bullet, weapon.frames[0][FACING_ENTRY[dir]]);
  }

}

function heroTile(game: Game): number {
  const hero = game.hero;
  const character = game.assets.hero;
  const frameIndex = hero.walkFrame === 0 ? 0 : 1 + (hero.walkFrame % 2);
  const tile = character.frames[frameIndex][FACING_ENTRY[hero.facing]];
  return tile >= 0 ? tile : character.frames[0][FACING_ENTRY[hero.facing]];
}

/** Convertit une image indexée en pixels RGBA avec la palette courante. */
export class PaletteBlitter {
  private readonly image: ImageData;
  private readonly rgba: Uint32Array;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) {
    this.image = ctx.createImageData(width, height);
    this.rgba = new Uint32Array(this.image.data.buffer);
  }

  blit(pixels: Uint8Array, palette: Palette, background = 0xff000000): void {
    const rgba = this.rgba;
    for (let i = 0; i < pixels.length; i++) {
      const c = pixels[i];
      rgba[i] = c === 0 ? background : palette[c];
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
}

/** Petite image (canvas) d'une tuile, pour l'inventaire. */
export function tileCanvas(tile: Tile | undefined, palette: Palette, size = TILE_SIZE): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d")!;
  if (tile) {
    const image = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    const rgba = new Uint32Array(image.data.buffer);
    for (let i = 0; i < tile.pixels.length; i++) rgba[i] = palette[tile.pixels[i]];
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}
