import { holeZone, type LoupePiece, type LoupeState } from "../../../src/games/asterix/scenes/minigames/m24";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/** Centre du trou d'un morceau, à l'écran. */
export function holeCentre(piece: LoupePiece): { x: number; y: number } {
  const zone = holeZone(piece);
  return { x: (zone.x1 + zone.x2) >> 1, y: (zone.y1 + zone.y2) >> 1 };
}

/** Un trou qui n'est pas celui du morceau demandé (il en reste toujours un tant que la partie se joue). */
export function wrongPiece(state: LoupeState): LoupePiece {
  return state.pieces.find((piece, i) => !piece.found && i !== state.target)!;
}

/** Robot de la Loupe : clique le trou du morceau demandé pour gagner, un autre trou pour perdre. */
export const playM24: MinigamePlayer = async (run, win) => {
  const state = minigameState<LoupeState>(run);
  while (run.screen === "minigame") {
    const { x, y } = holeCentre(win ? state.pieces[state.target] : wrongPiece(state));
    await run.click(x, y);
  }
};

/** Mène le pointeur libre en (x, y) aux flèches, à 2 pixels près (le pas est de 4 pixels par tick). */
export async function steerPointer(run: Launched, x: number, y: number): Promise<void> {
  const { input } = run.host;
  const hold = async (code: string, done: () => boolean): Promise<void> => {
    if (done()) return;
    input.keyDown(code);
    await run.until(done, 5_000);
    input.keyUp(code);
    await run.frame();
  };
  await hold(input.mouseX < x ? "ArrowRight" : "ArrowLeft", () => Math.abs(input.mouseX - x) <= 2);
  await hold(input.mouseY < y ? "ArrowDown" : "ArrowUp", () => Math.abs(input.mouseY - y) <= 2);
}
