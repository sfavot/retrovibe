/**
 * Solution du groupe 5 (`docs/fotaq/specials.md`, § 7, passages 5a et 5b ; corrections dans `docs/fotaq/specials-group-5.md`). Le groupe
 * est visité en deux temps, séparés par tout le reste du jeu : 5a (l'avion de la pièce 75 : `and1.DOG`, `C75B`, l'arrivée au site du
 * crash) et 5b (le combat final de la pièce 69 jusqu'à la fin de la partie). Un `GroupSolution` n'a qu'un départ : `solution` est le
 * passage 5b, qui mène à la fin du jeu ; `crashSolution` est le passage 5a.
 */

import { Item } from "../../../../src/games/fotaq/engine/state";
import type { GroupSolution } from "../../solutions";
import type { Start, Walkthrough } from "../../walkthrough";

/** Objets de la pièce 69 (numéros globaux de `QUEEN.JAS`). */
export const Fight = { Frank: 513, Faye: 516, Sparky: 517, Gun: 521 } as const;
/** Objets d'inventaire (`Item`). */
export const Gun = 47;
export const CleanDeathMask = 15;

/** Pièce du passage de la vallée au combat (4c, étape 77) et état de départ de 5a. */
const VALLEY_ROOM = 67;
const PLANE_ROOM = 75;
const CRASH_ROOM = 1;
/** Le dialogue de fin de `C74A` : Anderson (objet 599) dans l'avion. */
const ANDERSON_DIALOGUE = "and1.dog";
const ANDERSON_OBJECT = 599;

// --- 5a : l'avion et le crash -------------------------------------------------------------------------------------------------

/** Départ de 5a : la fin de la course de voiture, Joe est dans l'avion (pièce 75), `and1.DOG` démarre tout seul. */
export const crashStart: Start = { room: PLANE_ROOM, items: [Item.Clothes] };

/** 5a, étape 33 : `and1.DOG` (2/3 « Sur MON avion… », 2/4 « Attends! C'est pas tout! »), puis `C75B` : l'orage, le crash, la pièce 1. */
export function solveCrash(w: Walkthrough): void {
  // Dans le jeu enchaîné, `C74A` (groupe 4) lance le dialogue en finissant ; un départ isolé le lance de la même façon.
  if (!w.engine.input.dialogueRunning) {
    const { engine } = w;
    engine.run(
      (function* () {
        let next = yield* engine.startDialogue(ANDERSON_DIALOGUE, ANDERSON_OBJECT - engine.currentRoomData);
        while (next.length > 4 && next.slice(-4).toUpperCase() === ".CUT") next = yield* engine.playCutaway(next);
      })(),
    );
  }
  w.waitForChoices();
  w.choose(1);
  w.waitForChoices();
  w.choose(1);
  w.waitForRoom(CRASH_ROOM);
}

export const crashSolution: GroupSolution = { start: crashStart, solve: solveCrash };

// --- 5b : le combat final ----------------------------------------------------------------------------------------------------

/**
 * Départ de 5b (étape 77 de 4c, juste avant le passage O502) : dans la vallée (pièce 67), avec le masque mortuaire propre (I15) et les
 * états de la fin de la vallée. L'arrivée en pièce 69 est la cinématique `C69Z`, qui lance les mouvements 9, 11 et 12 du groupe.
 */
export const finalStart: Start = {
  room: VALLEY_ROOM,
  items: [CleanDeathMask],
  states: { 3: 1, 50: 1, 98: 1, 104: 1, 105: 1, 138: 1, 139: 2 },
};

/**
 * 5b : étapes 77 à 7. Le passage O502 de la vallée est la dernière action du groupe 4 ; dans un départ isolé (la zone 67/2 que `c67b`
 * allume n'est pas posée) la cinématique `C69Z` est jouée directement.
 */
export function solveFinal(w: Walkthrough): void {
  prepareFight(w);
  finalBlow(w);
  w.until(() => w.engine.ended, 20_000, "la fin de la partie");
}

/** Étapes 77 à 6 : de la vallée jusqu'à Sparky rendu à la normale (tout est prêt pour le dernier coup). */
export function prepareFight(w: Walkthrough): void {
  if (w.room === VALLEY_ROOM) {
    w.engine.run(w.engine.playCutaway("C69Z.CUT"));
    w.waitForRoom(69);
  }
  // 2 : le pistolet à rayon dino.
  w.act("PickUp", Fight.Gun);
  // 3 : le pistolet sur Frank, qui détourne le rayon (gs151 = 1).
  w.useItem(Gun, Fight.Frank);
  // 4 : Faye, `faye3.DOG` : « tourner votre miroir » (3/3), puis deux répliques sans choix ; gs150 = 1.
  w.act("Talk", Fight.Faye);
  w.chooseText("tourniez votre miroir");
  w.settle();
  // 5 : le pistolet sur Frank, le rayon touche Sparky (gs151 = 2).
  w.useItem(Gun, Fight.Frank);
  // 6 : le masque sur Sparky devenu tricératops (gs149 = 1).
  w.useItem(CleanDeathMask, Fight.Sparky, "Give");
}

/** Étape 7 : « Hasta la vista, Frank! », `C69G`, le générique : la partie se termine par le mouvement 14 (le clic rend la main à la fin de l'action ou de la cinématique). */
export function finalBlow(w: Walkthrough): void {
  w.useItem(Gun, Fight.Frank);
}

export const solution: GroupSolution = { start: finalStart, solve: solveFinal };
