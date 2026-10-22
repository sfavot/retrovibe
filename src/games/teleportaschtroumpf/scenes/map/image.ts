import type { Hy8 } from "../../data/hy8";
import { SCREEN_WIDTH } from "../../data/mcg";
import type { SceneContext } from "../../engine/scene";
import { placeSprite } from "../../engine/sprites";
import { MAP_ROWS, MAP_SEGMENTS, VIEW_ROWS, VIEW_TOP, markerOfCell, type Marker } from "./view";

/** Lignes de la bande sauvegardée autour du marqueur (`0x3E80` octets, `DS:C82C`) : elle finit sur la ligne du bas du marqueur. */
const STRIP_ROWS = 50;

/**
 * Fond défilant de la carte (481 lignes de 320 pixels, `DS:C81C`) et son marqueur : le Schtroumpf est peint dans le fond lui-même
 * (bande de 50 lignes sauvegardée puis restaurée à chaque déplacement), la fenêtre de l'écran n'en montre ensuite que 170 lignes.
 */
export class MapImage {
  private readonly pristine: Uint8Array;
  private readonly lit: Uint8Array;
  private strip: { from: number; to: number } | null = null;

  private constructor(pristine: Uint8Array) {
    this.pristine = pristine;
    this.lit = pristine.slice();
  }

  /** Lit les trois morceaux et les empile. */
  static async load(ctx: SceneContext): Promise<MapImage> {
    const pixels = new Uint8Array(MAP_ROWS * SCREEN_WIDTH);
    const mcgs = await Promise.all(MAP_SEGMENTS.map((s) => ctx.resources.mcg(s.file)));
    let row = 0;
    MAP_SEGMENTS.forEach((segment, i) => {
      const from = segment.firstRow * SCREEN_WIDTH;
      pixels.set(mcgs[i].pixels.subarray(from, from + segment.rows * SCREEN_WIDTH), row * SCREEN_WIDTH);
      row += segment.rows;
    });
    return new MapImage(pixels);
  }

  /** Pixel du fond défilant, marqueur compris (pour les tests). */
  pixel(x: number, y: number): number {
    return this.lit[y * SCREEN_WIDTH + x];
  }

  /** Efface le marqueur posé (restaure la bande depuis le fond intact). */
  clearMarker(): void {
    if (!this.strip) return;
    const { from, to } = this.strip;
    this.lit.set(this.pristine.subarray(from * SCREEN_WIDTH, (to + 1) * SCREEN_WIDTH), from * SCREEN_WIDTH);
    this.strip = null;
  }

  /** Pose le marqueur de la case `cell` de `DS:1470` (l'ancien est effacé). */
  setMarker(hy8: Hy8, cell: number): void {
    this.clearMarker();
    const marker = markerOfCell(cell);
    const to = Math.min(MAP_ROWS - 1, marker.footY);
    const from = Math.max(0, marker.footY - (STRIP_ROWS - 1));
    this.strip = { from, to };
    this.drawSprite(hy8, marker, from, to);
  }

  private drawSprite(hy8: Hy8, marker: Marker, from: number, to: number): void {
    for (const placed of placeSprite(hy8, marker.sprite, false)) {
      const { image } = placed;
      const left = marker.x + placed.left;
      const top = marker.footY + placed.top;
      for (let row = 0; row < image.height; row++) {
        const y = top + row;
        if (y < from || y > to) continue;
        for (let col = 0; col < image.width; col++) {
          const x = left + col;
          if (x < 0 || x >= SCREEN_WIDTH) continue;
          const value = image.pixels[row * image.width + (placed.mirror ? image.width - 1 - col : col)];
          if (value !== 0) this.lit[y * SCREEN_WIDTH + x] = value;
        }
      }
    }
  }

  /** Copie la fenêtre (170 lignes à partir de `scroll`) dans les lignes 6 à 175 de l'écran. */
  copyWindow(target: Uint8Array, scroll: number): void {
    target.set(this.lit.subarray(scroll * SCREEN_WIDTH, (scroll + VIEW_ROWS) * SCREEN_WIDTH), VIEW_TOP * SCREEN_WIDTH);
  }
}
