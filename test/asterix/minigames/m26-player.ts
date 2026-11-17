import { PHASE_SEARCH, type BrouillardState, type FogZone } from "../../../src/games/asterix/scenes/minigames/m26";
import { minigameState, type MinigamePlayer } from "./harness";

const WIDTH = 320;
const HEIGHT = 200;

/** Vrai si (x, y) est dans la zone, au sens du jugement `1f31:00f1` (bords haut et gauche compris, bas et droit exclus). */
export function inZone(zone: FogZone, x: number, y: number): boolean {
  return zone.x1 <= x && zone.y1 <= y && x < zone.x2 && y < zone.y2;
}

/** Centre de la partie visible de la zone. */
export function zoneCentre(zone: FogZone): { x: number; y: number } {
  return {
    x: Math.floor((Math.max(0, zone.x1) + Math.min(WIDTH, zone.x2)) / 2),
    y: Math.floor((Math.max(0, zone.y1) + Math.min(HEIGHT, zone.y2)) / 2),
  };
}

/** Un coin de l'écran hors de la zone. */
export function outsideZone(zone: FogZone): { x: number; y: number } {
  const corners = [
    { x: 0, y: 0 },
    { x: WIDTH - 1, y: 0 },
    { x: 0, y: HEIGHT - 1 },
    { x: WIDTH - 1, y: HEIGHT - 1 },
  ];
  const corner = corners.find(({ x, y }) => !inZone(zone, x, y));
  if (!corner) throw new Error("la zone couvre tout l'écran");
  return corner;
}

/** Robot du Brouillard : dès que la flèche est là, clique l'animal qui a crié pour gagner, un coin vide pour perdre. */
export const playM26: MinigamePlayer = async (run, win) => {
  const state = minigameState<BrouillardState>(run);
  await run.until(() => state.phase === PHASE_SEARCH || run.screen !== "minigame", 5_000);
  const zone = state.zones[state.target];
  const { x, y } = win ? zoneCentre(zone) : outsideZone(zone);
  await run.click(x, y);
  await run.until(() => run.screen !== "minigame", 5_000);
};
