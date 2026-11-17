import { PALETTE_X, SWATCH_STEP, SWATCH_X1, TARGET_SHIFT, ZONE_END, ZONE_FIRST, type ColoriagesState } from "../../../src/games/asterix/scenes/minigames/m35";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

const WIDTH = 320;
const HEIGHT = 200;

const sameColor = (colors: Uint8Array, a: number, b: number): boolean =>
  colors[a * 3] === colors[b * 3] && colors[a * 3 + 1] === colors[b * 3 + 1] && colors[a * 3 + 2] === colors[b * 3 + 2];

/** Vrai tant que la couleur de palette `color` est au blanc des zones effacées. */
export function isBlank(run: Launched, state: ColoriagesState, color: number): boolean {
  const { colors } = run.rt.ctx.palette;
  return colors[color * 3] === state.blank && colors[color * 3 + 1] === state.blank && colors[color * 3 + 2] === state.blank;
}

/** Couleur de palette de la pastille `index` (le pixel que lit le jeu). */
export function swatchColor(state: ColoriagesState, index: number): number {
  return state.pixels[(index * SWATCH_STEP + 1) * WIDTH + SWATCH_X1];
}

/** Rang de la pastille qui porte la couleur attendue de la zone, −1 si aucune (zone qui doit rester blanche). */
export function swatchFor(run: Launched, state: ColoriagesState, zone: number): number {
  const { colors } = run.rt.ctx.palette;
  for (let index = 0; index < state.count; index++) if (sameColor(colors, zone + TARGET_SHIFT, swatchColor(state, index))) return index;
  return -1;
}

/** Zones encore à colorier : blanches, et dont la couleur attendue ne l'est pas. */
export function zonesLeft(run: Launched, state: ColoriagesState): number[] {
  const zones: number[] = [];
  for (let zone = ZONE_FIRST; zone < ZONE_END; zone++) if (isBlank(run, state, zone) && !isBlank(run, state, zone + TARGET_SHIFT)) zones.push(zone);
  return zones;
}

/**
 * Un pixel de la zone dans le dessin, sans autre zone parmi ses neuf voisins (le trait et le fond n'en sont pas) : le
 * clic n'y touche qu'elle.
 */
export function zonePixel(state: ColoriagesState, zone: number): { x: number; y: number } {
  const alone = (color: number): boolean => color === zone || color < ZONE_FIRST || color >= ZONE_END;
  for (let y = 1; y < HEIGHT - 1; y++) {
    for (let x = 1; x < PALETTE_X - 1; x++) {
      if (state.pixels[y * WIDTH + x] !== zone) continue;
      let clear = true;
      for (let i = 0; i < 9 && clear; i++) clear = alone(state.pixels[(y - 1 + Math.floor(i / 3)) * WIDTH + x - 1 + (i % 3)]);
      if (clear) return { x, y };
    }
  }
  throw new Error(`zone ${zone} : aucun pixel isolé dans le dessin`);
}

/** Centre de la pastille `index`. */
export function swatchPoint(index: number): { x: number; y: number } {
  return { x: 286, y: index * SWATCH_STEP + 12 };
}

/** Choisit la pastille `index` d'un clic. */
export async function selectSwatch(run: Launched, state: ColoriagesState, index: number): Promise<void> {
  if (state.selected === index) return;
  const { x, y } = swatchPoint(index);
  await run.click(x, y);
  await run.until(() => state.selected === index, 2_000);
}

/** Colorie une zone de sa bonne couleur : la pastille, puis un clic dans la zone. */
export async function paintZone(run: Launched, state: ColoriagesState, zone: number): Promise<void> {
  await selectSwatch(run, state, swatchFor(run, state, zone));
  const before = state.painted;
  const { x, y } = zonePixel(state, zone);
  await run.click(x, y);
  await run.until(() => state.painted > before, 2_000);
}

/** Pose une mauvaise couleur sur la première zone encore blanche. */
export async function paintWrong(run: Launched, state: ColoriagesState): Promise<void> {
  const zone = zonesLeft(run, state)[0];
  const right = swatchFor(run, state, zone);
  await selectSwatch(run, state, right === 0 ? 1 : 0);
  const { x, y } = zonePixel(state, zone);
  await run.click(x, y);
  await run.until(() => state.lost, 2_000);
}

/** Robot des Coloriages : colorie toutes les zones pour gagner, pose une mauvaise couleur pour perdre. */
export const playM35: MinigamePlayer = async (run, win) => {
  const state = minigameState<ColoriagesState>(run);
  if (win) {
    for (let zones = zonesLeft(run, state); zones.length > 0 && run.screen === "minigame"; zones = zonesLeft(run, state)) await paintZone(run, state, zones[0]);
  } else await paintWrong(run, state);
  await run.until(() => run.screen !== "minigame", 5_000);
};
