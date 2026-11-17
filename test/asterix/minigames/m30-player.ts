import { GAUGE_VALUES, type OlympiquesState } from "../../../src/games/asterix/scenes/minigames/m30";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/** Jauge du meilleur lancer : la dernière case avant « trop tard » (3 sesterces). */
export const BEST_LEVEL = GAUGE_VALUES.lastIndexOf(3);

/** Attend que la jauge atteigne `level` cases et clique aussitôt (la case suivante s'allume 5 ticks plus tard). */
export async function throwAt(run: Launched, state: OlympiquesState, level: number): Promise<void> {
  await run.until(() => state.level >= level || run.screen !== "minigame", 20_000);
  if (run.screen === "minigame" && state.level === level) await run.click(160, 100);
}

/** Robot des Jeux olympiques : lance jauge au maximum pour gagner, ne lance pas pour perdre. */
export const playM30: MinigamePlayer = async (run, win) => {
  if (win) await throwAt(run, minigameState<OlympiquesState>(run), BEST_LEVEL);
  while (run.screen === "minigame") await run.frame();
};
