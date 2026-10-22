import type { Cursor } from "../data/resources";
import type { Point } from "../engine/geometry";

/**
 * Identifiants des 8 flèches directionnelles de DESKADV.EXE (ressources CURSOR 11 à 18),
 * dans l'ordre : ←, →, ↑, ↓, ↖, ↗, ↙, ↘.
 */
const ARROW_IDS = [
  { x: -1, y: 0, id: 11 },
  { x: 1, y: 0, id: 12 },
  { x: 0, y: -1, id: 13 },
  { x: 0, y: 1, id: 14 },
  { x: -1, y: -1, id: 15 },
  { x: 1, y: -1, id: 16 },
  { x: -1, y: 1, id: 17 },
  { x: 1, y: 1, id: 18 },
];

/** Pas d'Indy vers une case cible : signe de l'écart, comme pour le déplacement à la souris. */
export function stepToward(from: Point, target: Point): Point {
  return { x: Math.sign(target.x - from.x), y: Math.sign(target.y - from.y) };
}

/** Identifiant du curseur-flèche pour un pas donné, ou null sur place. */
export function arrowCursorId(step: Point): number | null {
  return ARROW_IDS.find((a) => a.x === step.x && a.y === step.y)?.id ?? null;
}

/** Valeur CSS `cursor` pour chaque flèche, rendue en pixels nets à une échelle entière. */
export class WalkCursors {
  private readonly cache = new Map<string, string>();

  constructor(private readonly cursors: Map<number, Cursor>) {}

  /** Échelle entière (1 à 3) qui approche la taille d'une case affichée, sur la base des 32 px d'origine. */
  static scaleFor(tileDisplaySize: number): number {
    return Math.min(3, Math.max(1, Math.round(tileDisplaySize / 32)));
  }

  /** `cursor` CSS pour ce pas, ou null (case d'Indy, ou curseur absent). */
  css(step: Point, scale: number): string | null {
    const id = arrowCursorId(step);
    const cursor = id === null ? undefined : this.cursors.get(id);
    if (!cursor) return null;
    const key = `${cursor.id}@${scale}`;
    let value = this.cache.get(key);
    if (value === undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = cursor.width * scale;
      canvas.height = cursor.height * scale;
      const small = document.createElement("canvas");
      small.width = cursor.width;
      small.height = cursor.height;
      small.getContext("2d")!.putImageData(new ImageData(cursor.rgba as Uint8ClampedArray<ArrayBuffer>, cursor.width, cursor.height), 0, 0);
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
      value = `url(${canvas.toDataURL("image/png")}) ${cursor.hotspotX * scale} ${cursor.hotspotY * scale}, auto`;
      this.cache.set(key, value);
    }
    return value;
  }
}
