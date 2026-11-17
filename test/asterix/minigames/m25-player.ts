import type { AnachronismesState } from "../../../src/games/asterix/scenes/minigames/m25";
import { minigameState, type MinigamePlayer } from "./harness";

/** Centre de la zone de l'anachronisme. */
export function zoneCentre(state: AnachronismesState): { x: number; y: number } {
  return { x: (state.zone.x1 + state.zone.x2) >> 1, y: (state.zone.y1 + state.zone.y2) >> 1 };
}

/** Un point de l'image hors de la zone : le coin opposé (aucune zone ne dépasse x = 300 ni ne touche les quatre coins). */
export function outsideZone(state: AnachronismesState): { x: number; y: number } {
  return { x: state.zone.x1 > 160 ? 5 : 314, y: state.zone.y1 > 100 ? 5 : 194 };
}

/** Robot des Anachronismes : un seul clic, dans la zone pour gagner, à côté pour perdre. */
export const playM25: MinigamePlayer = async (run, win) => {
  const state = minigameState<AnachronismesState>(run);
  const { x, y } = win ? zoneCentre(state) : outsideZone(state);
  while (run.screen === "minigame") await run.click(x, y);
};
