/**
 * Solution du jeu (`docs/fotaq/specials.md`, § 7). Deux vues :
 *
 * - `GROUP_SOLUTIONS[N]` : un passage représentatif de chaque groupe, avec son état de départ (`start`) et sa solution (`solve`,
 *   jouée par un `Walkthrough`) ; `test/fotaq/specials/group-N/walkthrough.test.ts` joue les passages du groupe N, chacun seul ;
 * - `PLAY_ORDER` : la partie complète, passage après passage dans l'ordre réel du jeu (un groupe est visité en plusieurs fois, pas
 *   d'un seul bloc), jouée d'un trait sur un seul moteur par `full-game.test.ts` depuis `FULL_GAME_START`. Chaque passage part de
 *   là où le précédent s'arrête ; les trajets entre deux groupes (piton, portes) sont joués ici, à la souris comme le reste.
 */

import { group1Solution, returnToAmazons, solveGroup1 } from "./specials/group-1/solution";
import { GROUP2_SOLUTION, solveGroup2, solveGroup2b } from "./specials/group-2/solution";
import { GROUP_3, solveGroup3 } from "./specials/group-3/solution";
import { group4Solution, solveGroup4, solveGroup4c } from "./specials/group-4/solution";
import { solution as group5Solution, solveCrash, solveFinal } from "./specials/group-5/solution";
import type { Start, Walkthrough } from "./walkthrough";

export interface GroupSolution {
  /** État de départ du passage (le jeu enchaîné y arrive de lui-même). */
  start?: Start;
  /** Joue le passage, de son état de départ à son état d'arrivée. */
  solve?: (w: Walkthrough) => void;
}

// --- Groupe 6 : introduction, générique et piton (jouée sans action : l'introduction se déroule seule) --------------------------

/** Départ : un nouveau jeu, dans la pièce du logo. */
const startGroup6: Start = { room: 95 };

/** L'introduction est finie : `C70D` jouée, Joe libre dans la chambre d'hôtel (pièce 70). */
const introDone = (w: Walkthrough): boolean => w.cutaways.played.includes("C70D.CUT") && w.idle;

/** L'introduction se joue jusqu'au hall de l'hôtel puis à `C70D` ; Joe est ensuite libre, pièce 70. */
function solveGroup6(w: Walkthrough): void {
  w.until(() => introDone(w), 20_000, "la fin de l'introduction");
}

/** Un passage représentatif par groupe ; les autres passages sont exportés par `specials/group-N/solution.ts`. */
export const GROUP_SOLUTIONS: Readonly<Record<number, GroupSolution>> = {
  1: group1Solution,
  2: GROUP2_SOLUTION,
  3: GROUP_3,
  4: group4Solution,
  5: group5Solution,
  6: { start: startGroup6, solve: solveGroup6 },
};

// --- La partie complète -----------------------------------------------------------------------------------------------------

/** Un passage de la partie : `id` du § 7 de `specials.md`, groupe, ce qui s'y joue. */
export interface Passage {
  readonly id: string;
  readonly group: number;
  readonly what: string;
  readonly play: (w: Walkthrough) => void;
}

/** Départ de la partie complète : un nouveau jeu, sans rien posé. */
export const FULL_GAME_START: Start = { room: 95 };

/** Pièces et objets des trajets entre deux passages. */
const Room = { Pinnacle: 7, AmazonEntrance: 16, AmazonHideout: 17, Launch: 76, Bob: 20 } as const;
const Exit = {
  HideoutToEntrance: 106,
  EntranceToPinnacle: 98,
  EntranceToHideout: 101,
  FlodaToPinnacle: 165,
  ShopToBob: 149,
  BobToPinnacle: 135,
} as const;
const Destination = { AmazonFortress: 48, Jetty: 44 } as const;

/** De la cachette des Amazones (pièce 17) au piton, par l'entrée de la forteresse (pièce 16). */
function hideoutToPinnacle(w: Walkthrough): void {
  w.goTo(Exit.HideoutToEntrance);
  w.waitForRoom(Room.AmazonEntrance);
  w.toPinnacle(Exit.EntranceToPinnacle);
}

/** 1d : du camp de la Flöda (pièce 22) à la cachette des Amazones par le piton (`O48`, visible depuis `C16B`), puis la corne. */
function backToAmazons(w: Walkthrough): void {
  w.toPinnacle(Exit.FlodaToPinnacle);
  w.fromPinnacle(Destination.AmazonFortress, Room.AmazonEntrance);
  w.goTo(Exit.EntranceToHideout);
  w.waitForRoom(Room.AmazonHideout);
  returnToAmazons(w);
}

/** 3a et 4b : de la cachette à l'embarcadère (pièce 42) par le piton, puis le temple jusqu'à la cellule de Flöda (pièce 41). */
function temple(w: Walkthrough): void {
  hideoutToPinnacle(w);
  w.fromPinnacle(Destination.Jetty, 42);
  solveGroup3(w);
}

/** 4c : de l'étal de Bob (pièce 21) vers le piton : la fusée pleine et le crâne perdu font jouer `C76A` (pièce 76), puis la vallée. */
function launch(w: Walkthrough): void {
  w.goTo(Exit.ShopToBob);
  w.waitForRoom(Room.Bob);
  w.goTo(Exit.BobToPinnacle);
  w.waitForRoom(Room.Launch);
  solveGroup4c(w);
}

/** L'ordre réel du jeu, passage par passage (`docs/fotaq/specials.md`, § 7, « La solution définitive »). */
export const PLAY_ORDER: readonly Passage[] = [
  { id: "6a", group: 6, what: "introduction, sautée par Échap (pièce 95 jusqu'à C70D, chambre 70)", play: (w) => void w.skipUntil(() => introDone(w)) },
  { id: "4a", group: 4, what: "l'hôtel et la course (70 à 74), jusqu'au dialogue d'Anderson dans l'avion (75)", play: solveGroup4 },
  { id: "5a", group: 5, what: "l'avion (and1.DOG, C75B) et le crash (pièce 1)", play: solveCrash },
  { id: "1a-1c", group: 1, what: "site du crash, jungle, village, forteresse des Amazones (1 à 21 sauf 7), jusqu'à la cachette (17)", play: solveGroup1 },
  {
    id: "2a",
    group: 2,
    what: "de la cachette au piton, Flöda : infiltration et sauvetage d'Azura (22 à 41, 103), jusque devant le camp (22)",
    play: (w) => {
      hideoutToPinnacle(w);
      solveGroup2(w);
    },
  },
  { id: "1d", group: 1, what: "retour aux Amazones par le piton : la corne de tyranno (C18C, 17)", play: backToAmazons },
  { id: "3a+4b", group: 3, what: "le passeur, le temple, l'oracle et le crâne, jusqu'à la corniche de la cellule (41)", play: temple },
  { id: "2b", group: 2, what: "la tasse, l'évasion (C41B), l'alcool de Bob : la fusée pleine (21)", play: solveGroup2b },
  { id: "4c", group: 4, what: "le lancement (C76A, 76) et la vallée (64 à 68), jusqu'au combat (69)", play: launch },
  { id: "5b+6c", group: 5, what: "le combat final (69), C69G, le générique de fin et endGame", play: solveFinal },
];
