import type { Scene, SceneContext } from "../engine/scene";
import type { Game, GameEvent } from "../game/rules";
import { createStubMinigame, type AftermathFactory, type MinigameDone, type MinigameFactory } from "./minigames/common";
import { createDragon } from "./minigames/s22-dragon";
import { createMusician } from "./minigames/s23-musician";
import { createPuzzle } from "./minigames/s24-puzzle";
import { createObservation } from "./minigames/s25-observation";
import { createSoundGame } from "./minigames/s26-sound-game";
import { createSled } from "./minigames/s27-sled";
import { createBlackSmurfs } from "./minigames/s28-black-smurfs";
import { createBirthday } from "./minigames/s29-birthday";
import { createBridge } from "./minigames/s30-bridge";
import { createTurtles } from "./minigames/s31-turtles";
import { createGargamel } from "./minigames/s32-gargamel";
import { createMagicFormula } from "./minigames/s33-magic-formula";
import { createStork } from "./minigames/s34-stork";
import { createColoring } from "./minigames/s35-coloring";
import { createMine } from "./minigames/s36-mine";
import { createGlasses, createGlassesAftermath } from "./minigames/s38-glasses";
import { createBird, createBirdAftermath } from "./minigames/s39-bird";
import { createQuiz } from "./minigames/s40-quiz";
import { createMagician } from "./minigames/s41-magician";
import { createGifts } from "./minigames/s51-gifts";

export { MinigameStub, STUB_POINTS } from "./minigames/common";
export type { AftermathFactory, MinigameDone, MinigameFactory } from "./minigames/common";

/**
 * Registre des mini-jeux : numéro de scène → fabrique (engine.md §1.7). Un fichier par mini-jeu dans `scenes/minigames/`
 * (`sNN-nom.ts`), tous inscrits ci-dessous : écrire un mini-jeu ne touche que son fichier (recette : `engine-ts.md`, « Écrire un
 * mini-jeu »). Les 20 sont écrits ; la souche commune de `minigames/common.ts` ne sert plus qu'aux tests de parcours (`forceMinigameStubs`).
 *
 * ### `createMinigame(id, game, onDone)`
 *
 * - `id` : 22 à 36, 38 à 41 ou 51 (les 20 mini-jeux de `MINIGAME_IDS` ; S13, le puits aux vœux, est `createWellScene` de `events.ts`) ;
 * - reçoit : `game`, la partie en cours ; la requête du mini-jeu est `game.state.pending` (`MinigameRequest` : `player`, `character`,
 *   `level` 0..2 = difficulté, `bonus` = indice de l'oiseau actif, `successChance` pour S32) ; `game.rollChezGargamel()` (S32) et
 *   `game.canTrade(joueur)` (S41) lisent aussi la partie. Ne **jamais** appeler `game.resolveMinigame` : l'appelant le fait ;
 * - rend : `onDone(ctx, outcome)` avec le `MinigameOutcome` du type attendu par la scène (`ingredient` S22 27 28 31 32 33 34 36,
 *   `points` S23 24 25 26 29 30 35 40 51, `magician` S41, `none` S38 et S39) ; un type inattendu lève une erreur dans `resolveMinigame` ;
 * - appelant : `scenes/game.ts` (porte du plateau : voix d'accroche `sNNa` jouée avant, scène **empilée** avec fondu, retirée par
 *   `ctx.scenes.pop({ fade: true })` dans `onDone`) et la carte libre (`s02-map.ts`, `Game.openMinigame`) ;
 * - écran suivant : le plateau, ou la carte en mode libre ; le chrono de partie continue de tourner pendant le mini-jeu (rien à
 *   gérer ici : `scenes/game.ts` lit l'horloge) ;
 * - références : fonction d'entrée de chaque scène dans `MINIGAMES` (`entry`), en-tête de chaque fichier, `docs/teleportaschtroumpf/minigames/sNN.md`.
 *
 * ### `createMinigameAftermath(id, game, events, onDone)`
 *
 * S38 et S39 présentent après coup ce que `Game.resolveMinigame` a appliqué : la fabrique `createXxxAftermath` du fichier du
 * mini-jeu, inscrite dans `AFTERMATHS`.
 */

/** Numéros de scène des mini-jeux du registre. */
export const MINIGAME_IDS: readonly number[] = [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 51];

/** Un mini-jeu par numéro de scène : la vraie scène de chaque fichier de `minigames/` (le test du registre vérifie qu'aucune n'est la souche). */
const FACTORIES: Readonly<Record<number, MinigameFactory>> = {
  22: createDragon,
  23: createMusician,
  24: createPuzzle,
  25: createObservation,
  26: createSoundGame,
  27: createSled,
  28: createBlackSmurfs,
  29: createBirthday,
  30: createBridge,
  31: createTurtles,
  32: createGargamel,
  33: createMagicFormula,
  34: createStork,
  35: createColoring,
  36: createMine,
  38: createGlasses,
  39: createBird,
  40: createQuiz,
  41: createMagician,
  51: createGifts,
};

/** Présentations d'après-coup (S38, S39). */
const AFTERMATHS: Readonly<Record<number, AftermathFactory>> = {
  38: createGlassesAftermath,
  39: createBirdAftermath,
};

let stubsForced = false;

/**
 * Outil **de test** : remplace tous les mini-jeux par la souche commune (Espace = réussi, Entrée = échoué, gain fixe `STUB_POINTS`) et
 * supprime les présentations d'après-coup (S38, S39). Il sert aux tests du **plateau** et de la partie (`game-flow`, `game-end`,
 * `game-pause`, `grand-schtroumpf`) qui traversent un mini-jeu sans le jouer : ils ne dépendent ainsi d'aucun vrai mini-jeu. À appeler
 * en tête du fichier de test (chaque fichier de test a son propre module, l'effet ne déborde pas) ; jamais en production. Le test du
 * registre vérifie que, hors de cet outil, aucun mini-jeu n'est la souche.
 */
export function forceMinigameStubs(forced = true): void {
  stubsForced = forced;
}

/** Fabrique le mini-jeu `id` (la souche commune si `forceMinigameStubs()` est actif, en test seulement). */
export function createMinigame(id: number, game: Game, onDone: MinigameDone): Scene {
  if (!MINIGAME_IDS.includes(id)) throw new RangeError(`scène ${id} : pas un mini-jeu du registre`);
  if (stubsForced) return createStubMinigame({ id, game, onDone });
  return FACTORIES[id](game, onDone);
}

/**
 * Présentation de ce que `Game.resolveMinigame` vient d'appliquer, jouée par `scenes/game.ts` juste après : S38 (vidéo de promenade
 * `s38a0NN` ou vol d'un ingrédient / point, événement `bespectacled`) et S39 (l'oiseau désigne une scène, événement `bird`).
 * `events` sont les événements rendus par `resolveMinigame`. Rend `null` quand il n'y a rien à montrer (autres numéros, pas d'événement, ou souches forcées).
 * La scène est empilée par l'appelant, qui la retire dans `onDone`.
 */
export function createMinigameAftermath(id: number, game: Game, events: readonly GameEvent[], onDone: (ctx: SceneContext) => void): Scene | null {
  if (stubsForced) return null;
  return AFTERMATHS[id]?.(game, events, onDone) ?? null;
}
