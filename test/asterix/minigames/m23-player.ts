import type { BardeState } from "../../../src/games/asterix/scenes/minigames/m23";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/** Touche de chaque corde, de gauche à droite (`STRING_DIRS` : gauche, haut, bas, droite). */
export const STRING_KEYS = ["ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"] as const;

/** Attend que le jeu lise une direction ; rend faux si le mini-jeu s'est terminé avant. */
export async function untilWaiting(run: Launched, state: BardeState): Promise<boolean> {
  while (run.screen === "minigame" && !state.waiting) await run.frame();
  return run.screen === "minigame";
}

/** Rejoue la note attendue (ou une fausse note avec `wrong`) dès que le jeu lit une direction. */
export async function playNote(run: Launched, state: BardeState, wrong = false): Promise<boolean> {
  if (!(await untilWaiting(run, state))) return false;
  const expected = state.sequence[state.index];
  await run.tap(STRING_KEYS[wrong ? (expected + 1) % STRING_KEYS.length : expected]);
  return true;
}

/** Réussit `rounds` suites entières, puis ne touche plus à rien (la suite d'après s'éteint au bout de ses 15 secondes). */
export async function playRounds(run: Launched, rounds: number): Promise<void> {
  const state = minigameState<BardeState>(run);
  while (run.screen === "minigame") {
    if (state.length <= rounds && state.phase === "input") await playNote(run, state);
    else await run.frame();
  }
}

/** Robot du Barde : rejoue tout sans faute jusqu'au bout du temps pour gagner, joue une fausse note pour perdre. */
export const playM23: MinigamePlayer = async (run, win) => {
  const state = minigameState<BardeState>(run);
  while (await playNote(run, state, !win));
};
