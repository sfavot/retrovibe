import type { Input } from "../../src/games/teleportaschtroumpf/engine/input";

/**
 * Doigts simulés, comme l'hôte du navigateur les transmet (`ui/browser-host.ts`) : position, bouton gauche venu d'un doigt,
 * puis le geste au relâchement. Coordonnées en pixels 320×200. Entre le posé et le relâchement, la scène voit le doigt tenu
 * (`touchHeldAt`) et l'appui « valider » venu du doigt (`validateByTouch`).
 */
export function touchDown(input: Input, x: number, y: number): void {
  input.mouseMove(x, y);
  input.touchStarted(x, y);
  input.mouseDown(0, true);
}

/** Le doigt posé glisse jusqu'en (x, y). */
export function touchMove(input: Input, x: number, y: number): void {
  input.pointerHovering = false;
  input.mouseMove(x, y);
}

/** Le doigt se lève en (x, y) : toucher ou glissement selon la distance au posé. */
export function touchUp(input: Input, x: number, y: number): void {
  input.mouseMove(x, y);
  input.mouseUp(0);
  input.touchEnded(x, y);
}

/** Toucher bref en (x, y), posé et levé d'un coup (la scène voit l'appui du doigt et le geste au même pas). */
export function tap(input: Input, x: number, y: number): void {
  touchDown(input, x, y);
  touchUp(input, x, y);
}

/** Appui long en (x, y) : l'hôte signale l'appui long, puis le doigt se lève (sans autre geste). */
export function longPress(input: Input, x: number, y: number): void {
  touchDown(input, x, y);
  input.touchLongPressed();
  touchUp(input, x, y);
}

/** Glissement de (x, y) de (dx, dy). */
export function swipe(input: Input, x: number, y: number, dx: number, dy: number): void {
  touchDown(input, x, y);
  touchMove(input, x + dx, y + dy);
  touchUp(input, x + dx, y + dy);
}
