/**
 * Zones éteintes du temple (groupe 3) : `Logic::handleSpecialArea` (engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure), les
 * pièces 50 (zombies), 53 (serpent), 55 (rayons du lézard), 100 et 101 (labyrinthe). Le moteur a déjà arrêté et tourné Joe et annulé
 * le changement de pièce ; ces fonctions ne font que la réaction propre à la pièce.
 *
 * Écarts : ScummVM chaîne les cinématiques suivantes dans la fonction (`while (nextCut[0])`) ; ici la fonction rend la première
 * cinématique et le moteur enchaîne la suite (`FotaqEngine.handleSpecialArea`). Seule la pièce 50, qui doit poser un état après
 * les cinématiques (`VAR_BYPASS_ZOMBIES`), les enchaîne elle-même.
 */

import type { Sequence } from "../../../../../engine/sequence";
import type { FotaqEngine } from "../../loop";
import type { Direction } from "../../state";
import type { SpecialAreaHandler } from "../assemble";
import { BYPASS_ZOMBIES, Cut, JoeSays, LEVER_PULLED, MAZE5_AREA, MAZE6_AREA, Room, ZOMBIES_AREA } from "./ids";

/** Joue `file` puis toutes les cinématiques qui s'enchaînent. */
function* playChain(g: FotaqEngine, file: string): Sequence {
  let next = yield* g.playCutaway(file);
  while (next.length > 4 && next.slice(-4).toUpperCase() === ".CUT") next = yield* g.playCutaway(next);
}

/** Pièce 50, zone 6 : la première fois les zombies se présentent (`C50D` puis leur dialogue), ensuite `C50H` à chaque passage. */
const zombies: SpecialAreaHandler = function* (g: FotaqEngine, _facing: Direction, areaNum: number) {
  if (areaNum !== ZOMBIES_AREA) return "";
  switch (g.gameState(BYPASS_ZOMBIES)) {
    case 0:
      yield* playChain(g, Cut.ZombiesFirst);
      g.setGameState(BYPASS_ZOMBIES, 1);
      return "";
    case 1:
      return Cut.ZombiesAgain;
    default:
      return "";
  }
};

/** Pièce 53 : le serpent barre toute la sortie. */
const snake: SpecialAreaHandler = function* () {
  return Cut.Snake;
};

/** Pièce 55 : Joe refuse de traverser les rayons mortels. */
const lizardLaser: SpecialAreaHandler = function* (g: FotaqEngine) {
  yield* g.makeJoeSpeak(JoeSays.LizardLaser);
  return "";
};

/** Pièce 100, zone 7. */
const maze5: SpecialAreaHandler = function* (g: FotaqEngine, _facing: Direction, areaNum: number) {
  if (areaNum === MAZE5_AREA) yield* g.makeJoeSpeak(JoeSays.Maze5);
  return "";
};

/** Pièce 101, zone 5 : tant que le levier de la pièce 100 n'est pas tiré, le sol s'effondre. */
const maze6: SpecialAreaHandler = function* (g: FotaqEngine, _facing: Direction, areaNum: number) {
  return areaNum === MAZE6_AREA && g.gameState(LEVER_PULLED) === 0 ? Cut.Maze6 : "";
};

export const templeAreas: Partial<Record<number, SpecialAreaHandler>> = {
  [Room.Zombies]: zombies,
  [Room.Snake]: snake,
  [Room.LizardLaser]: lizardLaser,
  [Room.Maze5]: maze5,
  [Room.Maze6]: maze6,
};
