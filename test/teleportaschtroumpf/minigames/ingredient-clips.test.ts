import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import { sceneIngredient } from "../../../src/games/teleportaschtroumpf/scenes/minigames/common";
import { dragonClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s22-dragon";
import { sledWinClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s27-sled";
import { blackSmurfsWinClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s28-black-smurfs";
import { turtlesWinClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s31-turtles";
import { gargamelClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s32-gargamel";
import { formulaWinClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s33-magic-formula";
import { storkWinClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s34-stork";
import { mineWinClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s36-mine";
import type { Game } from "../../../src/games/teleportaschtroumpf/game/rules";

/**
 * Vidéo de réussite des 8 mini-jeux à ingrédient selon que l'ingrédient fait partie de l'objectif (`1e52:0008`). Le sens n'est pas
 * universel : S22 et S33 jouent `c1` dans l'objectif, les six autres `c2` (`cd2` pour S32). Chaque ligne est relue dans le
 * désassemblage (voir `docs/teleportaschtroumpf/minigames/sNN.md`).
 */
const CASES: ReadonlyArray<[scene: number, clip: (game: Game) => string, inGoal: string, notInGoal: string]> = [
  [22, dragonClip, "s22c1.mux", "s22c2.mux"],
  [27, sledWinClip, "s27c2.mux", "s27c1.mux"],
  [28, blackSmurfsWinClip, "s28c2.mux", "s28c1.mux"],
  [31, turtlesWinClip, "s31c2.mux", "s31c1.mux"],
  [32, (game) => gargamelClip(game, true), "s32cd2.mux", "s32cd1.mux"],
  [33, formulaWinClip, "s33c1.mux", "s33c2.mux"],
  [34, storkWinClip, "s34c2.mux", "s34c1.mux"],
  [36, mineWinClip, "s36c2.mux", "s36c1.mux"],
];

describe("mini-jeux à ingrédient : vidéo de réussite selon l'objectif", () => {
  it.each(CASES)("S%i", (scene, clip, inGoal, notInGoal) => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    const bit = 1 << sceneIngredient(scene)!;
    game.state.goal.ingredients |= bit;
    expect(clip(game)).toBe(inGoal);
    game.state.goal.ingredients &= ~bit;
    expect(clip(game)).toBe(notInGoal);
  });
});
