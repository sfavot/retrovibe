import type { Point } from "../engine/geometry";

/** Touches de déplacement, par `KeyboardEvent.code` (position physique : ZQSD en AZERTY = WASD). */
const MOVE_KEYS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

/** État du clavier pour le déplacement : touches maintenues, plus les appuis brefs entre deux ticks. */
export class MoveKeys {
  private readonly held = new Set<string>();
  /** Touches appuyées depuis le dernier tick : un appui bref compte pour un pas. */
  private readonly tapped = new Set<string>();

  static handles(code: string): boolean {
    return code in MOVE_KEYS;
  }

  press(code: string): void {
    if (!MoveKeys.handles(code)) return;
    this.held.add(code);
    this.tapped.add(code);
  }

  release(code: string): void {
    this.held.delete(code);
  }

  clear(): void {
    this.held.clear();
    this.tapped.clear();
  }

  /** Direction (composantes dans −1..1) de toutes les touches actives ; consomme les appuis brefs. */
  direction(): Point {
    let x = 0;
    let y = 0;
    for (const code of new Set([...this.held, ...this.tapped])) {
      x += MOVE_KEYS[code].x;
      y += MOVE_KEYS[code].y;
    }
    this.tapped.clear();
    return { x: Math.sign(x), y: Math.sign(y) };
  }
}
