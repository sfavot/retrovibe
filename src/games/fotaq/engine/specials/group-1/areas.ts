/**
 * Zones éteintes du groupe 1 (jungle et Amazones) : les `case` de `Logic::handleSpecialArea` des pièces 4, 6, 14, 16 et 17
 * (engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure, lu et réécrit). Le moteur (`FotaqEngine.handleSpecialArea`) a déjà arrêté
 * Joe, l'a tourné, annulé le changement de pièce demandé et remis l'objet d'entrée à zéro ; il enchaîne ensuite les cinématiques
 * dont le nom est rendu (la boucle finale de ScummVM sur `nextCut`).
 *
 * - pièce 4 (pont) : Joe dit sa réplique 16 ; aucune cinématique ;
 * - pièce 6 (gorille) : `C6C.CUT` ; pièce 14 (faux dinosaure) : `C14B.CUT` ;
 * - pièce 16 (entrée des Amazones) : `C16A.CUT` seulement dans la zone 3 ;
 * - pièce 17 (cachette) : `C17A.CUT` à la 4e étape de marche, `C17B.CUT` à la 2e (ScummVM teste `walkDataNum`, pas la zone).
 *
 * Écart : `playCutaway` rend ici le nom de la cinématique suivante (le `nextCut` de ScummVM), que le moteur enchaîne ; le résultat
 * est le même.
 */

import type { Sequence } from "../../../../../engine/sequence";
import type { FotaqEngine } from "../../loop";
import type { Direction } from "../../state";
import type { SpecialAreaHandler } from "../assemble";
import {
  AMAZON_ENTRANCE_AREA,
  BRIDGE_REPLY,
  Cutaway,
  HIDEOUT_WALK_STEP_A,
  HIDEOUT_WALK_STEP_B,
  Room,
} from "./ids";

/** Pièce 4 : Joe commente le pont, sans cinématique. */
function* bridge(g: FotaqEngine): Sequence<string> {
  yield* g.makeJoeSpeak(BRIDGE_REPLY);
  return "";
}

/** Une cinématique à jouer dès que Joe entre dans la zone éteinte (pièces 6 et 14). */
const cutawayOnEntry =
  (file: string): SpecialAreaHandler =>
  (g) =>
    g.playCutaway(file);

/** Pièce 16 : seule la zone 3 joue `C16A`. */
function* amazonEntrance(
  g: FotaqEngine,
  _facing: Direction,
  areaNum: number,
): Sequence<string> {
  return areaNum === AMAZON_ENTRANCE_AREA
    ? yield* g.playCutaway(Cutaway.AmazonEntrance)
    : "";
}

/** Pièce 17 : `C17A` à la 4e étape de marche, `C17B` à la 2e. */
function* amazonHideout(
  g: FotaqEngine,
  _facing: Direction,
  _areaNum: number,
  walkDataNum: number,
): Sequence<string> {
  if (walkDataNum === HIDEOUT_WALK_STEP_A)
    return yield* g.playCutaway(Cutaway.HideoutA);
  if (walkDataNum === HIDEOUT_WALK_STEP_B)
    return yield* g.playCutaway(Cutaway.HideoutB);
  return "";
}

export const amazonAreas: Readonly<Record<number, SpecialAreaHandler>> = {
  [Room.JungleBridge]: bridge,
  [Room.JungleGorilla1]: cutawayOnEntry(Cutaway.Gorilla1),
  [Room.JungleGorilla2]: cutawayOnEntry(Cutaway.Gorilla2),
  [Room.AmazonEntrance]: amazonEntrance,
  [Room.AmazonHideout]: amazonHideout,
};
