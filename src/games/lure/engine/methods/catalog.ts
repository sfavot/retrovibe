/**
 * Les 67 méthodes natives des séquences (`scriptMethods[]`, indices 0 à 66 ; 20 et 65 sont la même fonction `checkCellDoor`) et leur
 * groupe de portage (`docs/lure/engine.md`, § 8). Toutes viennent de `engines/lure/scripts.cpp` (ScummVM, GPL v3+) ; le nom est celui de
 * la fonction C++ (le débogueur de ScummVM affiche `scriptMethodNames`).
 *
 * Groupes : `L1` génériques (portées en G1, `group-1/`), `L2` cellule et Ratpouch, `L3` village, `L4` Goewin, moines, château, `F`
 * combats, `Q` séquences plein écran.
 */

export type MethodGroup = "L1" | "L2" | "L3" | "L4" | "F" | "Q";

export interface MethodInfo {
  index: number;
  name: string;
  group: MethodGroup;
}

export const METHOD_CATALOG: readonly MethodInfo[] = [
  { index: 0, name: "activateHotspot", group: "L1" },
  { index: 1, name: "setHotspotScript", group: "L1" },
  { index: 2, name: "addSound2", group: "L1" },
  { index: 3, name: "setHotspotFlagMask", group: "L1" },
  { index: 4, name: "clearSequenceDelayList", group: "L1" },
  { index: 5, name: "deactivateHotspotSet", group: "L1" },
  { index: 6, name: "deactivateHotspot", group: "L1" },
  { index: 7, name: "resetPathfinder", group: "L1" },
  { index: 8, name: "addDelayedSequence", group: "L1" },
  { index: 9, name: "killSound", group: "L1" },
  { index: 10, name: "characterInRoom", group: "L1" },
  { index: 11, name: "setDesc", group: "L1" },
  { index: 12, name: "setHotspotName", group: "L1" },
  { index: 13, name: "addSound", group: "L1" },
  { index: 14, name: "endgameSequence", group: "Q" },
  { index: 15, name: "setupPigFight", group: "F" },
  { index: 16, name: "displayDialog", group: "L1" },
  { index: 17, name: "setupSkorlFight", group: "F" },
  { index: 18, name: "remoteRoomViewSetup", group: "L1" },
  { index: 19, name: "startSpeakingToNoone", group: "L1" },
  { index: 20, name: "checkCellDoor", group: "L2" },
  { index: 21, name: "stopSound", group: "L1" },
  { index: 22, name: "getDoorBlocked", group: "L1" },
  { index: 23, name: "isSkorlInCell", group: "L2" },
  { index: 24, name: "ratpouchPushBricks", group: "L2" },
  { index: 25, name: "characterChangeRoom", group: "L1" },
  { index: 26, name: "pauseRatpouch", group: "L2" },
  { index: 27, name: "setBlockingHotspotScript", group: "L1" },
  { index: 28, name: "decrInventoryItems", group: "L1" },
  { index: 29, name: "setTalking", group: "L1" },
  { index: 30, name: "setActionCtr", group: "L1" },
  { index: 31, name: "startSpeaking", group: "L1" },
  { index: 32, name: "disableHotspot", group: "L1" },
  { index: 33, name: "cutSack", group: "L3" },
  { index: 34, name: "increaseNumGroats", group: "L1" },
  { index: 35, name: "enableHotspot", group: "L1" },
  { index: 36, name: "displayMessage2", group: "L1" },
  { index: 37, name: "startOilBurner", group: "L4" },
  { index: 38, name: "transformPlayer", group: "L4" },
  { index: 39, name: "townHallClose", group: "L3" },
  { index: 40, name: "checkRoomNumber", group: "L1" },
  { index: 41, name: "makeGoewinFollow", group: "L4" },
  { index: 42, name: "doorClose", group: "L1" },
  { index: 43, name: "fixGoewin", group: "L4" },
  { index: 44, name: "doorOpen", group: "L1" },
  { index: 45, name: "npcWait", group: "L1" },
  { index: 46, name: "checkWakeBrenda", group: "L3" },
  { index: 47, name: "displayMessage", group: "L1" },
  { index: 48, name: "setNewSupportData", group: "L1" },
  { index: 49, name: "setSupportData", group: "L1" },
  { index: 50, name: "givePlayerItem", group: "L1" },
  { index: 51, name: "decreaseNumGroats", group: "L1" },
  { index: 52, name: "makeGoewinWork", group: "L4" },
  { index: 53, name: "moveCharacterToPlayer", group: "L1" },
  { index: 54, name: "setVillageSkorlTickProc", group: "L3" },
  { index: 55, name: "freeGoewin", group: "L4" },
  { index: 56, name: "barmanServe", group: "L3" },
  { index: 57, name: "getNumGroats", group: "L1" },
  { index: 58, name: "checkHasBook", group: "L4" },
  { index: 59, name: "enableGargoylesTalk", group: "L4" },
  { index: 60, name: "normalGoewin", group: "L4" },
  { index: 61, name: "killPlayer", group: "L1" },
  { index: 62, name: "animationLoad", group: "L1" },
  { index: 63, name: "addActions", group: "L1" },
  { index: 64, name: "randomToGeneral", group: "L1" },
  { index: 65, name: "checkCellDoor", group: "L2" },
  { index: 66, name: "checkSound", group: "L1" },
];

export function methodInfo(index: number): MethodInfo | undefined {
  return METHOD_CATALOG[index];
}
