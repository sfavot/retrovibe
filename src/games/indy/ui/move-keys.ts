import { HeldInput } from "../../../ui/held-input";
import type { Point } from "../engine/geometry";

type Dir = "up" | "down" | "left" | "right";

/** Touches de déplacement, par `KeyboardEvent.code` (position physique : ZQSD en AZERTY = WASD). */
const BINDINGS: Record<Dir, { keys: string[] }> = {
  up: { keys: ["ArrowUp", "KeyW"] },
  down: { keys: ["ArrowDown", "KeyS"] },
  left: { keys: ["ArrowLeft", "KeyA"] },
  right: { keys: ["ArrowRight", "KeyD"] },
};

const MOVE_CODES = new Set(Object.values(BINDINGS).flatMap((b) => b.keys));

/** État du clavier pour le déplacement : touches maintenues, plus les appuis brefs entre deux ticks. */
export class MoveKeys {
  private readonly input = new HeldInput<Dir>(BINDINGS);

  static handles(code: string): boolean {
    return MOVE_CODES.has(code);
  }

  press(code: string): void {
    this.input.keyDown(code);
  }

  release(code: string): void {
    this.input.keyUp(code);
  }

  clear(): void {
    this.input.clear();
  }

  /** Direction (composantes dans −1..1) de toutes les touches actives ; consomme les appuis brefs. */
  direction(): Point {
    const i = this.input;
    const active = (a: Dir) => i.isHeld(a) || i.wasTapped(a);
    const x = Number(active("right")) - Number(active("left"));
    const y = Number(active("down")) - Number(active("up"));
    i.endTick();
    return { x, y };
  }
}
