import type { GameSetup } from "../game/rules";
import { PictureScene } from "../engine/picture";
import type { Scene, SceneContext } from "../engine/scene";

/**
 * Partie (S01 et ses enchaînements, engine.md §1.4, `28a3:00ad`). SOUCHE (E2) : seul le fond du plateau est affiché.
 *
 * - reçoit : `setup`, les joueurs choisis à S09 / S08 et les options parents (`newGame(setup, ctx.rng)`) ;
 * - rend : `onDone(ctx)` à la fin de la partie (victoire, temps écoulé ou abandon général) ;
 * - écran suivant (décidé par `flow.ts`) : menu S07 ;
 * - fonds : `s01a001d.mcg`.
 *
 * La souche rend la main au premier clic.
 */
export function createGamePlaceholder(setup: GameSetup, onDone: (ctx: SceneContext) => void): Scene {
  void setup;
  return new PictureScene({
    mcg: "s01a001d.mcg",
    fadeIn: true,
    seconds: Infinity,
    onEnd: onDone,
  });
}

/**
 * Mode « Schtroumpf » / carte libre (S02, engine.md §1.3, `1a3c:002a`). SOUCHE (E2) : seul le fond de la carte est affiché.
 *
 * - reçoit : rien ;
 * - rend : `onDone(ctx)` quand le joueur quitte la carte (`k == 1`) ;
 * - écran suivant (décidé par `flow.ts`) : menu S07 ;
 * - fonds : `s02a001d.mcg`.
 */
export function createFreeMapPlaceholder(onDone: (ctx: SceneContext) => void): Scene {
  return new PictureScene({
    mcg: "s02a001d.mcg",
    fadeIn: true,
    seconds: Infinity,
    onEnd: onDone,
  });
}
