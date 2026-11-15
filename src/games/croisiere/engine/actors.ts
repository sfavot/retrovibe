/**
 * Acteurs (`actorHead`) : personnages animés et pilotés, à la souris (`ATP_MOUSE`) ou par script (`ATP_TRACK`).
 *
 * Références (ScummVM `engines/cruise/`, GPL v3+, release 2026.4.0, lu puis réécrit) : `actor.h` (`actorStruct`, `animPhase`),
 * `actor.cpp` (`findActor`, `isAnimFinished`, `set_anim`, `processAnimation`), `function.cpp` (`addAnimation`, `removeAnimation`),
 * `staticres.cpp` (`actor_move`, `actor_end`, `actor_stat`, `actor_invstat`).
 *
 * Particularités reproduites dans `processAnimation` :
 * - les `case` de la machine à états tombent les uns dans les autres (rotation sur place, puis marche, puis fin) ;
 * - `animationStart` (clic au sol) est consommé par le premier acteur actif traité, quel que soit son type ;
 * - `moveInfo` et `params` sont des variables locales partagées par tous les acteurs du tour (`params` garde la valeur précédente si
 *   l'objet n'existe pas ; non initialisées dans ScummVM, à zéro ici).
 */
import { getMultipleObjectParam, setObjectPosition, type ObjectQuery } from "./objects";
import { afficheChemin, computeZoom } from "./perso";
import type { EngineState } from "./state";
import { computePathfinding, freePerso, type MovementEntry } from "./walk";

/** Phases d'animation (`animPhase`). */
export const AnimPhase = { WAIT: 0, STATIC: 1, MOVE: 2, STATIC_END: 3, END: 4 } as const;

/** `pathId` particuliers. */
const ANIM_WAIT = -1;
const ANIM_FINISH = -2;

/** Type d'acteur piloté par la souris (`ATP_MOUSE`) ou par script (`ATP_TRACK`). */
export const ATP_MOUSE = 0;
export const ATP_TRACK = 1;

const ACTOR_MOVE = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0],
  [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 0],
  [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 0],
  [-13, -14, -15, -16, -17, -18, -19, -20, -21, -22, -23, -24, 0],
];
/** `actor_end[d][0]` (le reste de la table est à 0). */
export const ACTOR_END = [37, 38, 39, -38];
const ACTOR_STAT = [
  [53, 54, 55, 56, 57, 0, 0, 0, 0, 0, 0, 0, 0],
  [59, 60, 62, 63, 78, 0, 0, 0, 0, 0, 0, 0, 0],
  [-78, -63, -62, -60, -59, 0, 0, 0, 0, 0, 0, 0, 0],
  [-57, -56, -55, -54, -53, 0, 0, 0, 0, 0, 0, 0, 0],
];
const ACTOR_INVSTAT = [
  [-53, -54, -55, -56, -57, 0, 0, 0, 0, 0, 0, 0, 0],
  [57, 56, 55, 54, 53, 0, 0, 0, 0, 0, 0, 0, 0],
  [78, 63, 62, 60, 59, 0, 0, 0, 0, 0, 0, 0, 0],
  [-59, -60, -62, -63, -78, 0, 0, 0, 0, 0, 0, 0, 0],
];

/** Case `[d][c]` d'une table d'animation (`int [4][13]`) : erreur hors de la table. */
function anim(table: number[][], d: number, c: number, what: string): number {
  const v = table[d]?.[c];
  if (v === undefined) throw new RangeError(`${what}[${d}][${c}] hors de la table`);
  return v;
}

/** `actorStruct` (champs dans l'ordre de la trace `AC` du banc). */
export interface Actor {
  overlayNumber: number;
  idx: number;
  type: number;
  x: number;
  y: number;
  x_dest: number;
  y_dest: number;
  phase: number;
  counter: number;
  pathId: number;
  startDirection: number;
  nextDirection: number;
  endDirection: number;
  stepX: number;
  stepY: number;
  poly: number;
  flag: number;
  start: number;
  freeze: number;
}

/** `findActor`. */
export function findActor(e: EngineState, ovl: number, idx: number, type: number): Actor | null {
  for (const a of e.actors) {
    if ((a.overlayNumber === ovl || ovl === -1) && (a.idx === idx || idx === -1) && (a.type === type || type === -1)) return a;
  }
  return null;
}

/** `isAnimFinished` : vrai si aucun acteur correspondant n'a de trajet en cours. */
export function isAnimFinished(e: EngineState, ovl: number, idx: number, type: number): boolean {
  for (const a of e.actors) {
    if ((a.overlayNumber === ovl || ovl === -1) && (a.idx === idx || idx === -1) && (a.type === type || type === -1)) {
      if (a.pathId !== ANIM_FINISH) return false;
    }
  }
  return true;
}

/** `addAnimation` : acteur ajouté en queue de liste. */
export function addAnimation(e: EngineState, ovl: number, idx: number, startDirection: number, type: number): Actor {
  const actor: Actor = {
    overlayNumber: ovl,
    idx,
    type,
    x: 0,
    y: 0,
    x_dest: 0,
    y_dest: 0,
    phase: AnimPhase.WAIT,
    counter: 0,
    pathId: -1,
    startDirection,
    nextDirection: -1,
    endDirection: 0,
    stepX: 5,
    stepY: 2,
    poly: 0,
    flag: 0,
    start: 0,
    freeze: 0,
  };
  e.actors.push(actor);
  return actor;
}

/** `removeAnimation` : retire les acteurs correspondants (et leurs trajets) ; rend la direction du dernier retiré, 0 sinon. */
export function removeAnimation(e: EngineState, ovl: number, idx: number, type: number): number {
  for (const a of e.actors) {
    if ((a.overlayNumber === ovl || ovl === -1) && (a.idx === idx || idx === -1) && (a.type === type || type === -1)) a.type = -1;
  }
  let dir = 0;
  for (let i = 0; i < e.actors.length; ) {
    const a = e.actors[i]!;
    if (a.type !== -1) {
      i++;
      continue;
    }
    dir = a.startDirection;
    if (a.pathId >= 0) freePerso(e, a.pathId);
    e.actors.splice(i, 1);
  }
  return dir;
}

/** `set_anim` : position, zoom (signé par le miroir), frame `|mat| - 1 + start` et zone de l'objet. */
function setAnim(e: EngineState, ovl: number, obj: number, start: number, x: number, y: number, mat: number, state: number): void {
  const newf = Math.abs(mat) - 1;
  let zoom = computeZoom(e, y);
  if (mat < 0) zoom = -zoom;
  setObjectPosition(e, ovl, obj, 0, x);
  setObjectPosition(e, ovl, obj, 1, y);
  setObjectPosition(e, ovl, obj, 2, y);
  setObjectPosition(e, ovl, obj, 4, zoom);
  setObjectPosition(e, ovl, obj, 3, newf + start);
  setObjectPosition(e, ovl, obj, 5, state);
}

const i16 = (v: number) => (v << 16) >> 16;

/** Trajet introuvable : rotation finale si une direction d'arrivée est demandée, sinon fin immédiate. */
function noPath(a: Actor): void {
  if (a.endDirection !== -1 && a.endDirection !== a.startDirection) {
    a.phase = AnimPhase.STATIC_END;
    a.nextDirection = a.endDirection;
    a.endDirection = -1;
    a.counter = 0;
  } else {
    a.pathId = ANIM_FINISH;
    a.flag = 0;
    a.endDirection = -1;
    a.phase = AnimPhase.WAIT;
  }
}

function finish(a: Actor): void {
  a.pathId = ANIM_FINISH;
  a.flag = 0;
  a.endDirection = -1;
  a.phase = AnimPhase.WAIT;
}

/** `processAnimation` : un pas de chaque acteur actif (départ d'un trajet, rotation sur place, marche, arrêt). */
export function processAnimation(e: EngineState): void {
  let params: ObjectQuery = { X: 0, Y: 0, baseFileIdx: 0, fileIdx: 0, scale: 0, state: 0, state2: 0, nbState: 0 };
  const moveInfo: MovementEntry = { x: 0, y: 0, direction: 0, zoom: 0, poly: 0 };

  for (const a of [...e.actors]) {
    if (a.freeze || (a.type !== ATP_MOUSE && a.type !== ATP_TRACK)) continue;
    params = getMultipleObjectParam(e, a.overlayNumber, a.idx) ?? params;

    if (
      ((e.animationStart && !a.flag) || (!e.animationStart && a.x_dest !== -1 && a.y_dest !== -1)) &&
      a.type === ATP_MOUSE
    ) {
      // Marche à la souris.
      if (!e.animationStart) {
        e.aniX = a.x_dest;
        e.aniY = a.y_dest;
        a.x_dest = -1;
        a.y_dest = -1;
        a.flag = 1;
      }
      a.pathId = computePathfinding(e, moveInfo, params.X, params.Y, e.aniX, e.aniY, a.stepX, a.stepY, a.pathId);
      if (a.pathId === ANIM_WAIT) noPath(a);
      else {
        a.phase = AnimPhase.STATIC;
        a.counter = -1;
      }
    } else if (a.type === ATP_TRACK && a.x_dest !== -1 && a.y_dest !== -1) {
      // Marche pilotée par script.
      a.pathId = computePathfinding(e, moveInfo, params.X, params.Y, a.x_dest, a.y_dest, a.stepX, a.stepY, a.pathId);
      a.x_dest = -1;
      a.y_dest = -1;
      if (a.pathId === ANIM_WAIT) noPath(a);
      else {
        a.phase = AnimPhase.STATIC;
        a.counter = -1;
      }
    }

    e.animationStart = false;

    if (a.pathId >= 0 || a.phase === AnimPhase.STATIC_END) stepActor(e, a, params, moveInfo);
  }
}

/** Le `switch (phase)` de `processAnimation`, chutes comprises. */
function stepActor(e: EngineState, a: Actor, params: ObjectQuery, moveInfo: MovementEntry): void {
  let phase = a.phase;
  // case STATIC_END / STATIC : rotation sur place.
  if (phase === AnimPhase.STATIC_END || phase === AnimPhase.STATIC) {
    if (a.counter === -1 && a.phase === AnimPhase.STATIC) {
      afficheChemin(e, a.pathId, moveInfo);
      if (moveInfo.x === -1) {
        finish(a);
        return;
      }
      a.x = i16(moveInfo.x);
      a.y = i16(moveInfo.y);
      a.nextDirection = moveInfo.direction;
      a.poly = moveInfo.poly;
      a.counter = 0;
      if (a.startDirection === a.nextDirection) a.phase = AnimPhase.MOVE;
    }
    if (a.counter >= 0 && (a.phase === AnimPhase.STATIC_END || a.phase === AnimPhase.STATIC)) {
      let inc = 1;
      let tInc = a.startDirection - 1;
      if (tInc < 0) tInc = 3;
      if (a.nextDirection === tInc) inc = -1;
      let newA = anim(inc > 0 ? ACTOR_STAT : ACTOR_INVSTAT, a.startDirection, a.counter++, "actor_stat");
      if (newA === 0) {
        a.startDirection += inc;
        if (a.startDirection > 3) a.startDirection = 0;
        if (a.startDirection < 0) a.startDirection = 3;
        a.counter = 0;
        if (a.startDirection === a.nextDirection) {
          a.phase = a.phase === AnimPhase.STATIC ? AnimPhase.MOVE : AnimPhase.END;
        } else {
          newA = anim(ACTOR_STAT, a.startDirection, a.counter++, "actor_stat");
          if (inc === -1) newA = -newA;
          setAnim(e, a.overlayNumber, a.idx, a.start, params.X, params.Y, newA, a.poly);
          return;
        }
      } else {
        setAnim(e, a.overlayNumber, a.idx, a.start, params.X, params.Y, newA, a.poly);
        return;
      }
    }
    phase = AnimPhase.MOVE;
  }

  // case MOVE : marche.
  if (phase === AnimPhase.MOVE) {
    if (a.counter >= 1) {
      afficheChemin(e, a.pathId, moveInfo);
      if (moveInfo.x === -1) {
        if (a.endDirection === -1 || a.endDirection === a.nextDirection) a.phase = AnimPhase.END;
        else {
          a.phase = AnimPhase.STATIC_END;
          a.nextDirection = a.endDirection;
        }
        a.counter = 0;
        return;
      }
      a.x = i16(moveInfo.x);
      a.y = i16(moveInfo.y);
      a.nextDirection = moveInfo.direction;
      a.poly = moveInfo.poly;
    }
    if (a.phase === AnimPhase.MOVE) {
      a.startDirection = a.nextDirection;
      let newA = anim(ACTOR_MOVE, a.startDirection, a.counter++, "actor_move");
      if (!newA) {
        a.counter = 0;
        newA = anim(ACTOR_MOVE, a.startDirection, a.counter++, "actor_move");
      }
      setAnim(e, a.overlayNumber, a.idx, a.start, a.x, a.y, newA, a.poly);
      return;
    }
    phase = AnimPhase.END;
  }

  // case END : arrêt.
  if (phase === AnimPhase.END) {
    const newA = anim([ACTOR_END], 0, a.startDirection, "actor_end");
    setAnim(e, a.overlayNumber, a.idx, a.start, a.x, a.y, newA, a.poly);
    finish(a);
    return;
  }
  e.warn(`processAnimation : phase ${a.phase} non gérée`);
}
