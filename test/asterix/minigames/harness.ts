import type { MinigameStart } from "../../../src/games/asterix/scenes/minigame";
import type { Player } from "../../../src/games/asterix/game/state";
import { launch, type LaunchOptions, type Launched } from "../game-helpers";

/**
 * Banc des mini-jeux d'Astérix : un mini-jeu lancé seul par sa case (annonce, script inscrit, gains), sur le moteur de
 * test. Gabarit : `docs/asterix/minigames/README.md`.
 */

/** Robot d'un mini-jeu : joue la phase jouable (écran `"minigame"`) jusqu'à sa fin, pour gagner ou pour perdre. */
export type MinigamePlayer = (run: Launched, win: boolean) => Promise<void>;

/** Lance le mini-jeu et avance jusqu'au début de sa phase jouable. Niveaux par défaut : 0, le plus simple. */
export async function launchMinigame(start: MinigameStart, options: LaunchOptions = {}): Promise<Launched> {
  const run = await launch({ ...options, minigame: { reflexion: 0, action: 0, ...start } });
  await run.untilScreen("minigame");
  return run;
}

/** Le joueur du mini-jeu lancé seul. */
export function minigamePlayer(run: Launched): Player {
  return run.rt.game.players[0];
}

/** État vivant du mini-jeu en cours (`beginPlay(rt, module, state)`). */
export function minigameState<T>(run: Launched): T {
  return run.rt.hint.state as T;
}

/** Avance jusqu'à la sortie complète du mini-jeu (résultat, vidéo, gains compris) : le menu principal qui le suit. */
export async function untilMinigameOver(run: Launched, limitMs = 300_000): Promise<void> {
  await run.untilScreen("menu", limitMs);
}
