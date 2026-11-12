/**
 * Recherche de chemin d'un personnage (`PathFinder`) : la grille de cheminement de la pièce est décompressée en cases de 16 bits avec une
 * bordure (`RoomPathsData::decompress`, 42 x 26), élargie selon la largeur du personnage ; une vague numérote les cases depuis le
 * départ, passe après passe ; le chemin est relu à rebours depuis l'arrivée (trois essais : ordre standard des directions, ordre
 * alterné, puis le standard si l'alterné n'est pas plus court), en tronçons « direction, pas » (`WalkingActionEntry`) que la marche
 * consomme image par image (`walkingStep`, `movement.ts`).
 *
 * Source (ScummVM, GPL v3+) : `PathFinder::clear`, `reset`, `process`, `processCell`, `scanLine`, `initVars`, `WalkingActionEntry::numSteps`
 * (engines/lure/hotspots.cpp), `PATHFIND_COUNTDOWN` (luredefs.h) ; la décompression (`RoomPathsData::decompress`) est celle des
 * lecteurs (`data/lure-dat.ts`).
 *
 * **Découpage dans le temps.** `process` reprend là où il s'était arrêté (`inProgress`, compteurs de la passe en cours) quand le budget
 * de l'appel (`countdown`, coût 3 par case remplie, 1 par case déjà remplie, 700 pour la décompression) est épuisé. ScummVM a ce
 * mécanisme mais le désactive (`PATHFIND_COUNTDOWN 0` ; l'exécutable d'origine utilisait 4 000, valeur laissée en commentaire) : la
 * recherche s'y termine toujours au premier appel. Le budget par défaut est donc **0** (même cadence que ScummVM) ; 4 000 reste
 * possible (`LureMovement`, tests).
 *
 * L'état (`PathFinderState`) est un objet simple, sérialisable en JSON tel quel : les pointeurs `_pSrc` et `_pDest` sont des indices
 * dans `layer`.
 *
 * Écarts :
 * - une lecture hors de la grille décompressée (balayage `scanLine` qui déborde aux bords, possible dans ScummVM pour une arrivée hors de
 *   l'écran près du coin bas droit) vaut 0, là où ScummVM lit la mémoire voisine ;
 * - la reprise garde tout l'état, y compris `inProgress` (le chargement d'une sauvegarde de ScummVM le remet à faux et recommence la
 *   recherche sur la grille déjà en partie remplie ; sans effet avec le budget 0) ;
 * - reprise corrigée (code mort dans ScummVM, budget 0) : à la reprise, ScummVM perd le résultat provisoire (`result` local reste
 *   `PF_UNFINISHED`, la recherche finie est rendue comme inachevée puis recommencée sur une grille déjà remplie) et remet `_cellPopulated`
 *   à faux au milieu d'une passe (chemin partiel conclu trop tôt). Ici la reprise donne exactement le chemin d'une recherche d'un trait.
 */

import { Direction } from "../data/ids";
import { DECODED_PATHS_WIDTH, ROOM_PATHS_HEIGHT, ROOM_PATHS_WIDTH, decompressPaths } from "../data/lure-dat";
import { FULL_SCREEN_HEIGHT, FULL_SCREEN_WIDTH, MENUBAR_Y_SIZE } from "./ids";

const OCCUPIED = 0xffff;

/** Budget d'un appel de `process` dans ScummVM (`PATHFIND_COUNTDOWN`) : 0, recherche d'un trait. */
export const PATHFIND_COUNTDOWN = 0;
/** Budget de l'exécutable d'origine (commenté dans `luredefs.h`). */
export const ORIGINAL_PATHFIND_COUNTDOWN = 4000;

/** `PathFinderResult`. */
export const PathResult = { UNFINISHED: 0, OK: 1, DEST_OCCUPIED: 2, PART_PATH: 3, NO_WALK: 4 } as const;
export type PathResultValue = (typeof PathResult)[keyof typeof PathResult];

/** `WalkingActionEntry` : une direction et un nombre de pas bruts (8 par case). */
export interface WalkingAction {
  direction: number;
  rawSteps: number;
}

/** `WalkingActionEntry::numSteps` : images de marche du tronçon (2 pixels par image en hauteur, 4 en largeur). */
export function numSteps(entry: WalkingAction): number {
  switch (entry.direction) {
    case Direction.UP:
    case Direction.DOWN:
      return (entry.rawSteps + 1) >> 1;
    case Direction.LEFT:
    case Direction.RIGHT:
      return (entry.rawSteps + 3) >> 2;
    default:
      return 0;
  }
}

/** État d'un `PathFinder` (membres de la classe de ScummVM, pointeurs remplacés par des indices). */
export interface PathFinderState {
  inUse: boolean;
  /** Tronçons à parcourir, le premier en tête. */
  list: WalkingAction[];
  /** Grille décompressée (`RoomPathsDecompressedData`), vide tant que `reset` n'a pas été appelé. */
  layer: number[];
  stepCtr: number;
  inProgress: boolean;
  countdownCtr: number;
  destX: number;
  destY: number;
  xPos: number;
  yPos: number;
  xCurrent: number;
  yCurrent: number;
  xDestPos: number;
  yDestPos: number;
  xDestCurrent: number;
  yDestCurrent: number;
  destOccupied: boolean;
  cellPopulated: boolean;
  /** Indices des cases de départ et d'arrivée dans `layer` (`_pSrc`, `_pDest`). */
  src: number;
  dest: number;
  xChangeInc: number;
  xChangeStart: number;
  yChangeInc: number;
  yChangeStart: number;
  xCtr: number;
  yCtr: number;
}

/** Ce que la recherche lit du personnage. */
export interface PathWalker {
  readonly x: number;
  readonly y: number;
  readonly widthCopy: number;
  readonly heightCopy: number;
  readonly destX: number;
  readonly destY: number;
}

export function createPathFinder(): PathFinderState {
  return {
    inUse: false,
    list: [],
    layer: [],
    stepCtr: 0,
    inProgress: false,
    countdownCtr: 0,
    destX: 0,
    destY: 0,
    xPos: 0,
    yPos: 0,
    xCurrent: 0,
    yCurrent: 0,
    xDestPos: 0,
    yDestPos: 0,
    xDestCurrent: 0,
    yDestCurrent: 0,
    destOccupied: false,
    cellPopulated: false,
    src: 0,
    dest: 0,
    xChangeInc: 0,
    xChangeStart: 0,
    yChangeInc: 0,
    yChangeStart: 0,
    xCtr: 0,
    yCtr: 0,
  };
}

const int16 = (v: number): number => (v << 16) >> 16;

/** `clear()` : plus de tronçons, plus de recherche en cours. */
export function clearPath(pf: PathFinderState, budget: number): void {
  pf.stepCtr = 0;
  pf.list = [];
  pf.inProgress = false;
  pf.countdownCtr = budget;
}

/** `reset(paths)` : nouvelle recherche sur la grille de la pièce, élargie pour un personnage de largeur `widthCopy` (tableau simple : JSON). */
export function resetPath(pf: PathFinderState, paths: Uint8Array, widthCopy: number, budget: number): void {
  clearPath(pf, budget);
  pf.layer = Array.from(decompressPaths(paths, widthCopy));
  pf.inUse = true;
}

function add(pf: PathFinderState, direction: number, rawSteps: number): void {
  pf.list.unshift({ direction, rawSteps });
}

function addBack(pf: PathFinderState, direction: number, rawSteps: number): void {
  pf.list.push({ direction, rawSteps });
}

function cell(pf: PathFinderState, index: number): number {
  return pf.layer[index] ?? 0;
}

/** `initVars` : départ et arrivée en pixels, ramenés dans l'écran (le débordement est gardé pour les pas de la fin). */
function initVars(pf: PathFinderState, h: PathWalker): void {
  pf.destX = int16(h.destX);
  pf.destY = int16(h.destY);
  if (pf.destX < 10) pf.destX = int16(pf.destX - 50);
  if (pf.destX >= FULL_SCREEN_WIDTH - 10) pf.destX = int16(pf.destX + 50);

  pf.xPos = 0;
  pf.yPos = 0;
  pf.xDestPos = 0;
  pf.yDestPos = 0;

  pf.xCurrent = h.x;
  if (pf.xCurrent < 0) {
    pf.xPos = pf.xCurrent;
    pf.xCurrent = 0;
  }
  let xRight = FULL_SCREEN_WIDTH - h.widthCopy - 1;
  if (pf.xCurrent >= xRight) {
    pf.xPos = pf.xCurrent - xRight;
    pf.xCurrent = xRight;
  }

  pf.yCurrent = int16((h.y & 0xf8) + h.heightCopy - MENUBAR_Y_SIZE - 4);
  if (pf.yCurrent < 0) {
    pf.yPos = pf.yCurrent;
    pf.yCurrent = 0;
  }
  if (pf.yCurrent >= FULL_SCREEN_HEIGHT - MENUBAR_Y_SIZE) {
    pf.yPos = pf.yCurrent - (FULL_SCREEN_HEIGHT - MENUBAR_Y_SIZE);
    pf.yCurrent = FULL_SCREEN_HEIGHT - MENUBAR_Y_SIZE;
  }

  pf.xDestCurrent = pf.destX;
  if (pf.xDestCurrent < 0) {
    pf.xDestPos = pf.xDestCurrent;
    pf.xDestCurrent = 0;
  }
  xRight = FULL_SCREEN_WIDTH - h.widthCopy;
  if (pf.xDestCurrent >= xRight) {
    pf.xDestPos = pf.xDestCurrent - xRight;
    pf.xDestCurrent = xRight;
  }

  pf.yDestCurrent = pf.destY - MENUBAR_Y_SIZE;
  if (pf.yDestCurrent < 0) pf.yDestCurrent = 0;
  if (pf.yDestCurrent >= FULL_SCREEN_HEIGHT - MENUBAR_Y_SIZE) pf.yDestCurrent = FULL_SCREEN_HEIGHT - MENUBAR_Y_SIZE - 1;

  // Temps passé à décompresser la grille.
  pf.countdownCtr -= 700;
}

/** `processCell` : une case libre prend la plus petite valeur voisine + 1. */
function processCell(pf: PathFinderState, p: number): void {
  const layer = pf.layer;
  if (layer[p] === 0) {
    let vMax = 0xffff;
    for (const q of [p - DECODED_PATHS_WIDTH, p + DECODED_PATHS_WIDTH, p - 1, p + 1]) {
      const v = cell(pf, q);
      if (v !== 0 && v < vMax) vMax = v;
    }
    if (vMax !== 0xffff) {
      layer[p] = vMax + 1;
      pf.cellPopulated = true;
    }
    pf.countdownCtr -= 3;
  } else {
    pf.countdownCtr--;
  }
}

/** `scanLine` : case remplie la plus proche de l'arrivée dans une direction (au plus `numScans` cases). */
function scanLine(pf: PathFinderState, numScans: number, changeAmount: number, found: { end: number; v: number }): void {
  let pTemp = pf.dest;
  for (let ctr = 1; ctr <= numScans; ctr++) {
    pTemp += changeAmount;
    const value = cell(pf, pTemp);
    if (value !== 0 && value !== OCCUPIED) {
      if (found.v < ctr || (found.v === ctr && value >= cell(pf, found.end))) return;
      found.end = pTemp;
      found.v = ctr;
      break;
    }
  }
}

/**
 * `process()` : une étape de la recherche ; `UNFINISHED` si le budget est épuisé (la suite au prochain appel). `budget` 0 : d'un trait.
 */
export function processPath(pf: PathFinderState, h: PathWalker, budget: number): PathResultValue {
  let returnFlag = pf.inProgress;
  const breakFlag = budget !== 0;
  pf.countdownCtr = budget;
  let scanFlag = false;
  let result: PathResultValue = PathResult.UNFINISHED;
  let skipToFinalStep = false;

  if (!pf.inProgress) {
    pf.inProgress = true;
    initVars(pf, h);

    const diffY = pf.destY - pf.yCurrent;
    pf.xCurrent >>= 3;
    pf.yCurrent >>= 3;
    pf.xDestCurrent >>= 3;
    pf.yDestCurrent >>= 3;
    if (pf.xCurrent === pf.xDestCurrent && pf.yCurrent === pf.yDestCurrent) {
      // Déplacement dans la même case.
      if (pf.xDestPos > 0) add(pf, Direction.RIGHT, pf.xDestPos);
      else if (pf.xDestPos < 0) add(pf, Direction.LEFT, -pf.xDestPos);
      else if (diffY > 0) add(pf, Direction.DOWN, diffY);
      else add(pf, Direction.UP, -diffY);
      pf.inProgress = false;
      result = PathResult.OK;
      skipToFinalStep = true;
    } else {
      pf.destX >>= 3;
      pf.destY >>= 3;
      pf.src = (pf.yCurrent + 1) * DECODED_PATHS_WIDTH + 1 + pf.xCurrent;
      pf.dest = (pf.yDestCurrent + 1) * DECODED_PATHS_WIDTH + 1 + pf.xDestCurrent;
      pf.layer[pf.src] = 1;
      pf.destOccupied = cell(pf, pf.dest) !== 0;
      result = pf.destOccupied ? PathResult.DEST_OCCUPIED : PathResult.OK;
      pf.layer[pf.dest] = 0;

      if (pf.xCurrent >= pf.xDestCurrent) {
        pf.xChangeInc = -1;
        pf.xChangeStart = ROOM_PATHS_WIDTH;
      } else {
        pf.xChangeInc = 1;
        pf.xChangeStart = 1;
      }
      if (pf.yCurrent >= pf.yDestCurrent) {
        pf.yChangeInc = -1;
        pf.yChangeStart = ROOM_PATHS_HEIGHT;
      } else {
        pf.yChangeInc = 1;
        pf.yChangeStart = 1;
      }
    }
  } else {
    // Reprise : résultat provisoire du premier appel (ScummVM le perd, voir l'en-tête).
    result = pf.destOccupied ? PathResult.DEST_OCCUPIED : PathResult.OK;
  }

  if (!skipToFinalStep) {
    // ScummVM remet aussi ce drapeau à faux à la reprise d'une passe (voir l'en-tête).
    if (!returnFlag) pf.cellPopulated = false;
    for (;;) {
      if (!returnFlag) pf.yCtr = 0;
      while (returnFlag || pf.yCtr < ROOM_PATHS_HEIGHT) {
        if (!returnFlag) pf.xCtr = 0;
        while (returnFlag || pf.xCtr < ROOM_PATHS_WIDTH) {
          if (!returnFlag) {
            processCell(
              pf,
              (pf.yChangeStart + pf.yCtr * pf.yChangeInc) * DECODED_PATHS_WIDTH + (pf.xChangeStart + pf.xCtr * pf.xChangeInc),
            );
            if (breakFlag && pf.countdownCtr <= 0) return PathResult.UNFINISHED;
          } else {
            returnFlag = false;
          }
          pf.xCtr++;
        }
        pf.yCtr++;
      }
      if (cell(pf, pf.dest) !== 0) break;
      if (pf.cellPopulated) {
        pf.cellPopulated = false;
      } else {
        result = PathResult.PART_PATH;
        scanFlag = true;
        break;
      }
    }
    pf.inProgress = false;

    if (scanFlag || pf.destOccupied) {
      // L'arrivée est occupée ou inaccessible : case remplie la plus proche dans les quatre directions.
      if (pf.destOccupied) {
        pf.layer[pf.dest] = OCCUPIED;
        pf.destOccupied = false;
      }
      const found = { end: pf.dest, v: 0xff };
      scanLine(pf, pf.destX, -1, found);
      scanLine(pf, ROOM_PATHS_WIDTH - pf.destX, 1, found);
      scanLine(pf, pf.destY, -DECODED_PATHS_WIDTH, found);
      scanLine(pf, ROOM_PATHS_HEIGHT - pf.destY, DECODED_PATHS_WIDTH, found);
      if (found.end === pf.dest) {
        clearPath(pf, budget);
        return PathResult.NO_WALK;
      }
      pf.dest = found.end;
    }

    // Chemin relu à rebours depuis l'arrivée.
    let savedSteps = 0;
    for (let stageCtr = 0; stageCtr < 3; stageCtr++) {
      clearPath(pf, budget);
      const altFlag = stageCtr === 1;
      let pCurrent = pf.dest;
      let steps = 0;
      let currDirection: number = Direction.NONE;
      for (;;) {
        const v = cell(pf, pCurrent) - 1;
        if (v === 0) break;
        let newDirection: number = Direction.NONE;
        if (!altFlag && currDirection !== Direction.LEFT && currDirection !== Direction.RIGHT) {
          if (cell(pf, pCurrent - DECODED_PATHS_WIDTH) === v) newDirection = Direction.DOWN;
          else if (cell(pf, pCurrent + DECODED_PATHS_WIDTH) === v) newDirection = Direction.UP;
          else if (cell(pf, pCurrent + 1) === v) newDirection = Direction.LEFT;
          else if (cell(pf, pCurrent - 1) === v) newDirection = Direction.RIGHT;
        } else {
          if (cell(pf, pCurrent + 1) === v) newDirection = Direction.LEFT;
          else if (cell(pf, pCurrent - 1) === v) newDirection = Direction.RIGHT;
          else if (cell(pf, pCurrent - DECODED_PATHS_WIDTH) === v) newDirection = Direction.DOWN;
          else if (cell(pf, pCurrent + DECODED_PATHS_WIDTH) === v) newDirection = Direction.UP;
        }
        if (newDirection === Direction.NONE) throw new Error("recherche de chemin : échec de la relecture du chemin");
        if (newDirection !== currDirection) add(pf, newDirection, 0);
        switch (newDirection) {
          case Direction.UP:
            pCurrent += DECODED_PATHS_WIDTH;
            break;
          case Direction.DOWN:
            pCurrent -= DECODED_PATHS_WIDTH;
            break;
          case Direction.LEFT:
            pCurrent++;
            break;
          case Direction.RIGHT:
            pCurrent--;
            break;
          default:
            break;
        }
        steps++;
        pf.list[0]!.rawSteps += 8;
        currDirection = newDirection;
      }
      if (stageCtr === 0) savedSteps = steps;
      if (stageCtr === 1 && steps <= savedSteps) break;
    }

    if (result === PathResult.OK) {
      if (pf.xDestPos < 0) addBack(pf, Direction.LEFT, -pf.xDestPos);
      else if (pf.xDestPos > 0) addBack(pf, Direction.RIGHT, pf.xDestPos);
    }
  }

  // Dernière étape : le départ hors de l'écran.
  if (pf.xPos < 0) add(pf, Direction.RIGHT, -pf.xPos);
  else if (pf.xPos > 0) add(pf, Direction.LEFT, pf.xPos);
  return result;
}
