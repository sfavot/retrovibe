import type { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import type { Pilot } from "./pilots";
import type { RobotHost } from "./host";

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;

/**
 * Joueur au hasard, pour les mini-jeux sans pilote : toutes les 100 à 600 ms simulées il change de geste. Il tient une ou deux
 * flèches, tape Espace, passe (Échap) ou déplace le pointeur avant de cliquer. Les vidéos de fin se passent ainsi toutes seules.
 */
export function randomPlayer(host: RobotHost, rng: BorlandRandom): Pilot {
  const held = new Set<string>();
  let nextAt = 0;
  const set = (code: string, down: boolean) => {
    if (down === held.has(code)) return;
    if (down) {
      held.add(code);
      host.input.keyDown(code);
    } else {
      held.delete(code);
      host.input.keyUp(code);
    }
  };
  const releaseAll = () => {
    for (const code of [...held]) set(code, false);
  };
  return {
    step() {
      if (host.time < nextAt) return;
      releaseAll();
      const roll = rng.below(100);
      let duration = 100 + rng.below(500);
      if (roll < 40) {
        set(ARROWS[rng.below(4)], true);
        if (rng.below(3) === 0) set(ARROWS[rng.below(4)], true);
        duration += 300;
      } else if (roll < 65) {
        set("Space", true);
        duration = 100;
      } else if (roll < 75) {
        set("Escape", true);
        duration = 100;
      } else if (roll < 90) {
        host.input.mouseMove(rng.below(320), rng.below(200));
        set("Space", true);
        duration = 150;
      }
      nextAt = host.time + duration;
    },
    release: releaseAll,
  };
}
