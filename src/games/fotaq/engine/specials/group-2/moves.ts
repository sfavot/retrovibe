/**
 * Mouvements spéciaux de Floda (groupe 2) : 19 (Azura amoureuse), 21 et 22 (lumières éteintes, allumées), 23 (la zone du mannequin
 * de la réception) et 25 (les gardes allumés). Réécriture de `Logic::asmSetAzuraInLove`, `asmSetLightsOff`, `asmSetLightsOn`,
 * `asmSetManequinAreaOn` et `asmTurnGuardOn` (engines/queen/logic.cpp, ScummVM, GPL v3 ou ultérieure).
 *
 * Écarts : aucun. Les lumières passent par `Palette.lightsOff` et `lightsOn` (`render/palette.ts`, `palCustomLightsOff/On`) ; la
 * pièce est celle de Joe, comme `currentRoom()`.
 */

import type { Sequence } from "../../../../../engine/sequence";
import type { FotaqEngine } from "../../loop";
import type { SpecialMove } from "../../script";
import { stageOf } from "../kit";
import { AZURA_IN_LOVE, GUARDS_TURNED_ON, MANNEQUIN_AREA, Room } from "./ids";

/** 19 (`C41A`) : Azura est amoureuse (état 167). */
function* setAzuraInLove(g: FotaqEngine): Sequence {
  g.setGameState(AZURA_IN_LOVE, 1);
}

/** 21 (`C103F`, `C103I` à `C103K`, `C25E`) : la pièce n'a plus de lumière (les couleurs 16 à 223, 32 à 223 à la réception, passent au noir). */
function* setLightsOff(g: FotaqEngine): Sequence {
  stageOf(g).display.palette.lightsOff(g.state.room);
}

/** 22 : la lumière revient (palette de la pièce). */
function* setLightsOn(g: FotaqEngine): Sequence {
  stageOf(g).display.palette.lightsOn(g.state.room);
}

/** 23 (`C103F`) : la zone 7 de la réception (le mannequin) est allumée (`mapNeighbors` repasse en positif). */
function* setMannequinAreaOn(g: FotaqEngine): Sequence {
  const area = g.grid.area(Room.FrontDesk, MANNEQUIN_AREA);
  area.mapNeighbors = Math.abs(area.mapNeighbors);
}

/** 25 (`C63C`) : les gardes sont allumés (état 85). */
function* turnGuardOn(g: FotaqEngine): Sequence {
  g.setGameState(GUARDS_TURNED_ON, 1);
}

export const flodaMoves: Readonly<Record<number, SpecialMove>> = {
  19: setAzuraInLove,
  21: setLightsOff,
  22: setLightsOn,
  23: setMannequinAreaOn,
  25: turnGuardOn,
};
