import type { Anm, AnmCommand, AnmFrame, AnmState } from "../../../src/games/tim3/data/anm";
import type { Bitmap, BitmapFrame } from "../../../src/games/tim3/data/bitmap";
import type { Part } from "../../../src/games/tim3/engine/part";
import { Part as PartClass } from "../../../src/games/tim3/engine/part";
import type { World } from "../../../src/games/tim3/engine/world";
import { RenderAssets } from "../../../src/games/tim3/render";
import type { Surface } from "../../../src/games/tim3/render";

/** Image indexée de test, pixels donnés ligne par ligne (0 = transparent). */
export function image(rows: number[][]): BitmapFrame {
  return { width: rows[0]!.length, height: rows.length, pixels: Uint8Array.from(rows.flat()) };
}

export function frame(x: number, y: number, width: number, height: number, commands: AnmCommand[]): AnmFrame {
  return { x, y, width, height, commandOffset: 0, commands };
}

export function bitmapCmd(frameNo: number, x = 0, y = 0, flip = 0): AnmCommand {
  return { op: "bitmap", image: 1, frame: frameNo, x, y, flip };
}

export function anm(width: number, height: number, frames: AnmFrame[], states: AnmState[] = [], sequence: number[] = []): Anm {
  return { version: 1001, width, height, sequence, frames, states, commands: [], images: [{ id: 1, name: "T.BMP" }], labels: [] };
}

/** Ressources fabriquées : une seule image `T.BMP` et un ANM par type de pièce. */
export class FakeAssets extends RenderAssets {
  constructor(
    private readonly fakeBitmap: Bitmap,
    private readonly fakeAnms: Map<number, Anm>,
  ) {
    super(undefined as never);
  }
  override bitmap(): Bitmap | null {
    return this.fakeBitmap;
  }
  override partAnm(type: number): Anm | null {
    return this.fakeAnms.get(type) ?? null;
  }
}

/** Pièce posée en (x, y), avec la taille donnée (le moteur remplit ces champs au chargement). */
export function part(type: number, x: number, y: number, w: number, h: number, flags10 = 0): Part {
  const p = new PartClass();
  Object.assign(p, { type, px: x, py: y, frameW: w, frameH: h, shapeW: w, shapeH: h, flags10 });
  return p;
}

export const WORLD = { animFlags: 7 } as World;

/** Somme de contrôle FNV-1a des pixels d'une surface. */
export function checksum(s: Surface): string {
  let h = 0x811c9dc5;
  for (const v of s.pixels) h = Math.imul(h ^ v, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Lignes de la surface sous forme de chaînes de chiffres (pour des comparaisons lisibles). */
export function rows(s: Surface, x: number, y: number, w: number, h: number): string[] {
  const out: string[] = [];
  for (let yy = y; yy < y + h; yy++) out.push(Array.from({ length: w }, (_, i) => s.pixels[yy * s.width + x + i]!.toString(16)).join(""));
  return out;
}
