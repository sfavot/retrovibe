import type { Sequence } from "../../../engine/sequence";
import type { FotaqEngine } from "./loop";
import type { RoomUpdate } from "./camera";
import type { Direction } from "./state";

/**
 * Points d'extension du moteur pour la logique codée en dur de ScummVM (vague L, `docs/fotaq/engine.md`, § 9). Chaque point
 * correspond à un endroit nommé d'engines/queen/logic.cpp où le code générique appelle du code propre à une pièce ; le moteur fait
 * le reste. Tous sont facultatifs : sans eux, le jeu suit les données (`QUEEN.JAS`, `.CUT`, `.DOG`).
 *
 * Convention (celle de Drascula) : un point qui parle, marche ou attend est une séquence (`Sequence`) ; les numéros magiques
 * (pièces, objets, états) ont un nom dans le dossier du groupe de pièces (`specials/group-N/ids.ts`).
 */

/** Mouvement spécial (`Logic::executeSpecialMove`, `asm*`) : lancé par un objet de cinématique (champ `specialMove`, vague C). */
export type SpecialMove = (g: FotaqEngine) => Sequence;

export interface GameScript {
  /**
   * Mouvements spéciaux par numéro (`LogicGame::setupSpecialMoveTable`, 1 à 39 ; la version DOS en définit 37). Un numéro absent
   * ne fait rien, comme dans ScummVM.
   */
  specialMoves?: Partial<Record<number, SpecialMove>>;
  /**
   * `LogicGame::changeToSpecialRoom` : au changement de pièce, avant `displayRoom`. Rend vrai s'il a pris la pièce en charge (le
   * sommet du piton, pièce 7 ; le logo, pièce 95, avec l'introduction). Faux : la pièce s'affiche normalement.
   */
  changeToSpecialRoom?: (g: FotaqEngine) => Sequence<boolean>;
  /**
   * `Logic::handleSpecialArea` (partie propre aux pièces) : Joe marche dans une zone éteinte (`walkDataNum` : rang de l'étape
   * de marche). Le moteur a déjà tourné Joe et annulé le changement de pièce ; rend la cinématique à enchaîner (`""` : aucune).
   */
  handleSpecialArea?: (g: FotaqEngine, facing: Direction, areaNum: number, walkDataNum: number) => Sequence<string>;
  /**
   * Animations propres à une pièce, appelées à chaque image après la caméra (course de voiture de la pièce 74, combat final de la
   * pièce 69 : `Graphics::update` appelle `BamScene`). Le moteur les enregistre dans `GameStage.roomUpdates` à sa création.
   */
  roomUpdates?: Partial<Record<number, RoomUpdate>>;
}
