import type { Action } from "../engine/input";
import type { Scene, SceneContext } from "../engine/scene";
import type { Game, GameEvent } from "../game/rules";
import type { MinigameOutcome } from "../game/state";
import { INGREDIENT_COUNT, minigameInfo } from "../game/tables";
import { hasIngredient } from "../game/state";
import { StubScene } from "./common/stub";

/**
 * Registre des mini-jeux : numéro de scène → fabrique (engine.md §1.7). SOUCHE (phase E2) : tant qu'un mini-jeu n'est pas
 * écrit, `createMinigame` rend la souche commune ci-dessous.
 *
 * ### `createMinigame(id, game, onDone)`
 *
 * - `id` : 22 à 36, 38 à 41 ou 51 (les 21 codes de `MINIGAMES`, `game/tables.ts` ; S13 est `createWellScene` de `events.ts`) ;
 * - reçoit : `game`, la partie en cours ; la requête du mini-jeu est `game.state.pending` (`MinigameRequest` : `player`,
 *   `character`, `level` 0..2 = difficulté, `bonus` = indice de l'oiseau actif, `successChance` pour S32) ; `game.rollChezGargamel()`
 *   (S32) et `game.canTrade(joueur)` (S41) lisent aussi la partie. Ne **jamais** appeler `game.resolveMinigame` : l'appelant le fait ;
 * - rend : `onDone(ctx, outcome)` avec le `MinigameOutcome` du type attendu par la scène (`ingredient` S22 27 28 31 32 33 34 36,
 *   `points` S23 24 25 26 29 30 35 40 51, `magician` S41, `none` S38 et S39) ; un type inattendu lève une erreur dans `resolveMinigame` ;
 * - appelant : `scenes/game.ts` (porte du plateau : voix d'accroche `sNNa` jouée avant, scène **empilée** avec fondu, retirée par
 *   `ctx.scenes.pop({ fade: true })` dans `onDone`) et la carte libre (`s02-map.ts`, `Game.openMinigame`) ;
 * - écran suivant : le plateau, ou la carte en mode libre ; le chrono de partie continue de tourner pendant le mini-jeu (rien à
 *   gérer ici : `scenes/game.ts` lit l'horloge) ;
 * - références : fonction d'entrée de chaque scène dans `MINIGAMES` (`entry`), `docs/teleportaschtroumpf/minigames/sNN.md`.
 *
 * Pour brancher un mini-jeu : écrire `scenes/minigames/sNN-nom.ts` qui exporte une `MinigameFactory`, l'importer ici et l'ajouter
 * à `FACTORIES` sous son numéro de scène.
 *
 * ### Souche commune
 *
 * Affiche le fond du mini-jeu (`STUB_BACKGROUNDS`, noir s'il n'y a pas de MCG simple), Espace = réussi, Entrée = échoué :
 * ingrédient obtenu ou non, 2 points ou 0, échange avec le magicien du premier ingrédient manquant (refus s'il ne peut pas) ou rien,
 * et `none` pour S38 / S39.
 */
export type MinigameDone = (ctx: SceneContext, outcome: MinigameOutcome) => void;
export type MinigameFactory = (game: Game, onDone: MinigameDone) => Scene;

/** Numéros de scène des mini-jeux du registre. */
export const MINIGAME_IDS: readonly number[] = [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 51];

/** Mini-jeux écrits, par numéro de scène (vide : tout passe par la souche). */
const FACTORIES: Readonly<Partial<Record<number, MinigameFactory>>> = {};

/** Fond MCG de la souche (premier fond simple de chaque scène ; absent : S27, S32, S34, S36, S39, qui n'ont que des vidéos). */
const STUB_BACKGROUNDS: Readonly<Record<number, string>> = {
  22: "s22a001d.mcg",
  23: "s23a001d.mcg",
  24: "s24a001d.mcg",
  25: "s25aa01d.mcg",
  26: "s26a001d.mcg",
  28: "s28a001d.mcg",
  29: "s29a001d.mcg",
  30: "s30c001d.mcg",
  31: "s31a001d.mcg",
  33: "s33a001d.mcg",
  35: "s35a000d.mcg",
  38: "s38a000d.mcg",
  40: "s40a001d.mcg",
  41: "s41b002d.mcg",
  51: "s51a001d.mcg",
};

/** Points donnés par la souche en cas de réussite. */
export const STUB_POINTS = 2;

function stubOutcome(id: number, game: Game, success: boolean): MinigameOutcome {
  const info = minigameInfo(id);
  switch (info?.kind) {
    case "ingredient":
      return { kind: "ingredient", success };
    case "points":
      return { kind: "points", points: success ? STUB_POINTS : 0 };
    case "trade": {
      const index = game.state.pending?.player ?? game.state.current;
      const player = game.state.players[index];
      let missing = 0;
      while (missing < INGREDIENT_COUNT && hasIngredient(player, missing)) missing++;
      return { kind: "magician", choice: success && missing < INGREDIENT_COUNT && game.canTrade(index) ? missing : null };
    }
    case "steal":
    case "bird":
      return { kind: "none" };
    default:
      throw new RangeError(`scène ${id} : pas un mini-jeu du registre`);
  }
}

/** Souche commune des mini-jeux (nommée pour que les tests reconnaissent l'écran). */
export class MinigameStub extends StubScene {}

/** Fabrique le mini-jeu `id` (la vraie scène si elle est branchée, sinon la souche commune). */
export function createMinigame(id: number, game: Game, onDone: MinigameDone): Scene {
  if (!MINIGAME_IDS.includes(id)) throw new RangeError(`scène ${id} : pas un mini-jeu du registre`);
  const factory = FACTORIES[id];
  if (factory) return factory(game, onDone);
  const keys: Action[] = ["validate", "cancel"];
  return new MinigameStub({
    mcg: STUB_BACKGROUNDS[id],
    fadeIn: true,
    keys,
    onDone: (ctx, action) => onDone(ctx, stubOutcome(id, game, action === "validate")),
  });
}

/**
 * Présentation de ce que `Game.resolveMinigame` vient d'appliquer, jouée par `scenes/game.ts` juste après : S38 (vidéo de promenade
 * `s38a0NN` ou vol d'un ingrédient / point, événement `bespectacled`) et S39 (l'oiseau désigne une scène, événement `bird`).
 * `events` sont les événements rendus par `resolveMinigame`. Rend `null` quand il n'y a rien à montrer (souche : toujours).
 * La scène est empilée par l'appelant, qui la retire dans `onDone`.
 */
export function createMinigameAftermath(id: number, game: Game, events: readonly GameEvent[], onDone: (ctx: SceneContext) => void): Scene | null {
  void id;
  void game;
  void events;
  void onDone;
  return null;
}
