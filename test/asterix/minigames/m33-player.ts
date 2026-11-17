import { COLUMNS, columnZone, paletteZone, type HieroglyphesState } from "../../../src/games/asterix/scenes/minigames/m33";
import type { Zone } from "../../../src/games/asterix/scenes/runtime";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

const centre = (zone: Zone): [number, number] => [(zone.x1 + zone.x2) >> 1, (zone.y1 + zone.y2) >> 1];

/** Compose `combination` au clic : pour chaque colonne à changer, la colonne puis le hiéroglyphe proposé. */
export async function compose(run: Launched, combination: readonly number[]): Promise<void> {
  const state = minigameState<HieroglyphesState>(run);
  for (let column = 0; column < COLUMNS; column++) {
    if (state.guess[column] === combination[column]) continue;
    if (state.column !== column) {
      await run.click(...centre(columnZone(column)));
      await run.until(() => state.column === column, 2_000);
    }
    await run.click(...centre(paletteZone(combination[column])));
    await run.until(() => state.guess[column] === combination[column], 2_000);
  }
}

/** Valide la combinaison en cours (Espace) et attend la fin des trois réponses. */
export async function validate(run: Launched): Promise<void> {
  const state = minigameState<HieroglyphesState>(run);
  const tries = state.tries;
  while (state.tries === tries && run.screen === "minigame") await run.tap("Space");
  // Trois réponses de 50 cs chacune.
  if (run.screen === "minigame") await run.run(1_600);
}

/** Robot des Hiéroglyphes : compose la combinaison lue dans l'état et la valide ; pour perdre, laisse passer le temps. */
export const playM33: MinigamePlayer = async (run, win) => {
  const state = minigameState<HieroglyphesState>(run);
  if (win) {
    await compose(run, state.secret);
    await validate(run);
  }
  while (run.screen === "minigame") await run.frame();
};
