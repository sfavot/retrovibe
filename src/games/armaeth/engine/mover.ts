import {
  MAX_P,
  MAX_X,
  MAX_Y,
  cellIndex,
  groundHeight,
  highAt,
  isFlyer,
  isWalkable,
  lowAt,
  terrainCollision,
  typeAt,
  type Terrain,
} from "./ground";
import { PLACE_EMPTY_WINDOW, PLACE_OK, PLACE_TYPE_CHANGED, placeObject, searchPosition, type PlaceBody, type PlaceEnv } from "./placement";

/**
 * Déplacement d'un objet mobile, un pas par appel à vitesse constante : `179d:0004` (`docs/armaeth/movement.md` § 2), pour
 * `Dep` 0 (marche), 1 (vol), 2 et 4 (zones) et 3 (chute). Module pur : l'objet est modifié en place, les contacts avec les
 * autres objets, le filtre de types de case (`13a8:000a`), les barrages et l'animation sont fournis par l'appelant.
 */

/** `Err` produits par le déplacement (`movement.md` § 2.10). */
export const ERR_WALL = 1;
export const ERR_GROUND_REFUSED = 2;
export const ERR_DEPTH_MASK = 4;
export const ERR_NO_GROUND = 5;
export const ERR_STEP_TOO_HIGH = 6;
export const ERR_LANDED = 7;
export const ERR_BLOCKED_BY_OBJECT = 8;
export const ERR_TOUCHED_OBJECT = 9;
export const ERR_TOUCHED_EDGE = 0x0a;
export const ERR_EXIT = 0x0b;
export const ERR_EDGE_IMMATERIAL = 0x0c;
export const ERR_VANISHED = 0x0e;
export const ERR_BARRIER = 0x0f;
export const ERR_PLACED_TYPE_CHANGED = 0x11;
export const ERR_NOT_IN_ROOM = 0x15;
export const ERR_SECOND_PLACEMENT = 0x16;

/** Côtés de la salle (numérotation de `engine.md` § 5.1) : fond, droite, avant, gauche, haut, bas. */
export const SIDE_BACK = 0;
export const SIDE_RIGHT = 1;
export const SIDE_FRONT = 2;
export const SIDE_LEFT = 3;
export const SIDE_TOP = 4;
export const SIDE_BOTTOM = 5;

export interface MoverBody extends PlaceBody {
  /** `Typ` (+0x04) : 0 = interface. */
  typ: number;
  /** `Hor`, `Ver`, `Prf` (+0x60..+0x62) : vitesses -1, 0, +1. */
  speedX: number;
  speedY: number;
  speedP: number;
  /** `dpX`, `dpY`, `dpP` (+0x45..+0x47) : pas par tic (`rec[2]`, `rec[3]`, 1 de l'enregistrement d'animation). */
  stepX: number;
  stepY: number;
  stepP: number;
  /** `Col` (+0x3C) : `Ser` du dernier objet touché. */
  col: number;
  /** `Tim` : compteur de chute (`Dep 3`). */
  tim: number;
}

/** La salle qui contient l'objet : sorties et barrages par emplacement (`engine.md` § 5.1). */
export interface MoverRoom {
  exits: readonly number[];
  barriers: readonly number[];
}

export interface MoverEnv extends PlaceEnv {
  room: MoverRoom;
  /** `1414:0006(code, mode, o)` : 0 = libre, autre = bloqué. Sans lui aucun barrage ne bloque. */
  barrier?: (code: number, mode: number, body: MoverBody) => number;
  /** `animStep(o, mode)` (`engine.md` § 6.3) : met à jour `Hau` / `Lar` (mode 0) ou l'animation de chute (mode 7). */
  animate?: (body: MoverBody, mode: number) => void;
}

export interface MoveResult {
  /** `Err` de l'objet après l'appel. */
  err: number;
  /** `Inf` : côté, emplacement de sortie ou type de case selon le code. */
  info: number;
  /** Vrai si la nouvelle position a été conservée (`Err` 0, 9, 0x0A ou 0x11). */
  moved: boolean;
  /** Emplacement de sortie franchi (`Err` 0x0B) : la procédure de l'objet change de salle (`186d:000c`). */
  exit: number | null;
}

const sgn = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

export interface WalkPosition {
  x: number;
  y: number;
  p: number;
  plane: number;
  ground: number;
}

export interface WalkStep {
  /** 0, 1 (mur), 5 (pas de sol ou sol trop bas) ou 6 (marche trop haute). */
  err: number;
  y: number;
  plane: number;
  ground: number;
}

/**
 * Pas de marche de `Dep 0` vers `(x, p)` à l'intérieur des limites de la salle (`movement.md` § 2.2) : à chaque changement de case
 * le plan est choisi parmi ceux dont le sol est proche de la hauteur actuelle (priorité à la marche à niveau), puis la hauteur du
 * sol doit rester à `stepY` près. `txt` : un objet immatériel (`Txt 2`) traverse les murs pleins.
 */
export function walkStep(terrain: Terrain, from: WalkPosition, x: number, p: number, stepY: number, txt = 0): WalkStep {
  const { grid } = terrain;
  const col = x >> 2;
  const row = p >> 3;
  let plane = from.plane;
  let ground = from.ground;
  if (col !== from.x >> 2 || row !== from.p >> 3) {
    let levelDist = 0xfff;
    let levelType = 0;
    let levelPlane = 0;
    let belowDist = 0xfff;
    let belowType = 0;
    let belowPlane = 0;
    for (let candidate = terrain.planes - 1; candidate >= 0; candidate--) {
      const index = cellIndex(candidate, row, col);
      const type = typeAt(grid, index);
      if (type === 0) continue;
      const d = lowAt(grid, index) - from.y;
      if (d > 0) {
        // sol plus bas que les pieds (y compris un type 1, jamais choisi plus loin)
        if (d < belowDist) {
          belowDist = d;
          belowType = type;
          belowPlane = candidate;
        }
        continue;
      }
      if (isWalkable(type) && -d < levelDist) {
        levelDist = -d;
        levelType = type;
        levelPlane = candidate;
      }
      if (highAt(grid, index) < from.y) continue; // l'intervalle finit au-dessus des pieds
      if (isWalkable(type)) break; // pieds dans l'intervalle d'un sol
      if (txt === 2) continue;
      return { err: ERR_WALL, y: from.y, plane: from.plane, ground: from.ground };
    }
    let useLevel: boolean;
    if (!isWalkable(levelType)) {
      if (!isWalkable(belowType)) return { err: ERR_NO_GROUND, y: from.y, plane: from.plane, ground: from.ground };
      useLevel = false;
    } else if (!isWalkable(belowType)) useLevel = true;
    else if (stepY < levelDist) useLevel = false;
    else useLevel = belowDist >= levelDist;
    plane = useLevel ? levelPlane : belowPlane;
    ground = useLevel ? levelType : belowType;
  }
  const y = groundHeight(grid, plane, x, p);
  const delta = y - from.y;
  if (Math.abs(delta) > stepY) return { err: delta > 0 ? ERR_NO_GROUND : ERR_STEP_TOO_HIGH, y: from.y, plane: from.plane, ground: from.ground };
  return { err: 0, y, plane, ground };
}

interface Box {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  pMin: number;
  pMax: number;
}

const MAX_BOX: Box = { xMin: 0, xMax: MAX_X, yMin: 0, yMax: MAX_Y, pMin: 0, pMax: MAX_P };

/**
 * Un pas de `179d:0004`. Ne fait rien tant que `Err` n'a pas été traité et remis à 0 par la procédure de l'objet (y compris
 * pour les « succès » 9, 0x0A et 0x11). Retour : voir `MoveResult` ; l'objet est restauré si le pas échoue.
 */
export function moveObject(body: MoverBody, env: MoverEnv): MoveResult {
  if (body.err !== 0) return { err: body.err, info: body.info, moved: false, exit: null };
  const { terrain, inRoom } = env;
  const { limits } = terrain;
  const flying = isFlyer(body.dep);
  const box: Box =
    !inRoom || (body.typ === 0 && flying)
      ? MAX_BOX
      : { xMin: limits.xMin, xMax: limits.xMax, yMin: limits.yMin, yMax: limits.yMax, pMin: limits.pMin, pMax: limits.pMax };

  if (body.presence === 1) {
    // l'objet vient d'entrer dans la salle chargée : placement sur une case du même type (mode 5)
    if (inRoom) {
      const placed = placeObject(body, 5, env);
      if (placed !== PLACE_OK && placed !== PLACE_TYPE_CHANGED) return { err: body.err, info: body.info, moved: false, exit: null };
    }
  } else if (body.presence === 2 && !inRoom) body.presence = 1;

  const ground0 = body.ground;
  const saved = {
    x: body.x,
    y: body.y,
    p: body.p,
    plane: body.plane,
    ground: body.ground,
    presence: body.presence,
    height: body.height,
    width: body.width,
    speedX: body.speedX,
    speedY: body.speedY,
    speedP: body.speedP,
    stepX: body.stepX,
    stepY: body.stepY,
    stepP: body.stepP,
    tim: body.tim,
  };
  if (inRoom) env.animate?.(body, 0);
  const height = body.height;
  const width = body.width;

  let plane = flying ? 0 : saved.plane;
  let ground = flying ? 0 : saved.ground;
  let x = body.x + sgn(body.speedX) * saved.stepX;
  let p = body.p + sgn(body.speedP) * (saved.stepP !== 0 ? 1 : 0);
  let y = body.y + (body.speedY !== 0 && body.dep !== 0 ? sgn(body.speedY) * saved.stepY : 0);

  let err = 0;
  let info = body.info;
  let col = body.col;
  let touched = false;
  let side = 0;
  let exitSide = -1;
  let ok = true;

  const accepts = (type: number, effect: number): boolean =>
    env.acceptsGround ? env.acceptsGround(type, effect, body) : type >= 2;

  /** `appliquer` : écrit la position puis contacts, terrain et changement de type de case (`movement.md` § 2.7). */
  const apply = (nx: number, ny: number, np: number, nplane: number): boolean => {
    body.x = nx;
    body.y = ny;
    body.p = np;
    body.plane = nplane;
    const contact = env.contact?.(body);
    err = contact ? contact.err : 0;
    if (contact && contact.err !== 0) col = contact.col;
    if (err !== 0 && err !== ERR_TOUCHED_OBJECT) return false;
    if (inRoom) {
      const hit = terrainCollision(terrain, body, env.depthBlocked);
      if (hit.code !== 0) {
        err = hit.code;
        info = hit.info;
        return false;
      }
      if (ground !== ground0) {
        if (!accepts(ground, 7)) {
          err = ERR_GROUND_REFUSED;
          info = ground;
          return false;
        }
        if (err === 0) err = ERR_PLACED_TYPE_CHANGED;
      }
      body.ground = ground;
    }
    return true;
  };

  switch (body.dep) {
    case 0: {
      if (!inRoom || x < limits.xMin || x > limits.xMax || p < limits.pMin || p > limits.pMax) {
        ok = apply(x, y, p, plane);
      } else {
        const step = walkStep(terrain, { x: body.x, y: body.y, p: body.p, plane, ground }, x, p, saved.stepY, body.txt);
        if (step.err !== 0) {
          err = step.err;
          ok = false;
        } else {
          y = step.y;
          plane = step.plane;
          ground = step.ground;
          ok = apply(x, y, p, plane);
        }
      }
      break;
    }
    case 1:
      ok = apply(x, y, p, 0);
      break;
    case 2:
    case 4: {
      if (!inRoom) {
        err = ERR_NOT_IN_ROOM;
        ok = false;
        break;
      }
      const c = x >> 2;
      const r = p >> 3;
      const zone = terrain.zones.find((z) => z.row === r && z.colStart <= c && c <= z.colEnd && z.low <= y && y <= z.high);
      if (!zone) {
        err = ERR_NO_GROUND;
        ok = false;
        break;
      }
      ground = zone.type;
      plane = 0;
      ok = apply(x, y, p, 0);
      break;
    }
    case 3: {
      // hypothèse (movement.md § 2.6) : jamais exercé par CFG, port du seul décompilat
      const drop = saved.stepY !== 0 ? saved.stepY : 4;
      const bottom = body.y + drop;
      const top = bottom - height + 1;
      if (inRoom) {
        for (let candidate = terrain.planes - 1; candidate >= 0; candidate--) {
          const index = cellIndex(candidate, body.p >> 3, body.x >> 2);
          const type = typeAt(terrain.grid, index);
          const lo = lowAt(terrain.grid, index);
          if (isWalkable(type) && top <= lo && lo <= bottom) {
            err = ERR_LANDED;
            info = type;
            ok = false;
            break;
          }
        }
      } else if (top <= limits.yMax && limits.yMax <= bottom) {
        err = ERR_LANDED;
        info = 2;
        ok = false;
      }
      if (!ok) break;
      body.y = bottom - 1;
      const request = { side: 6, signX: 0, tolX: -1, type: 0, tolP: -1, signP: 0, tolY: Math.max(height, 4), signY: 1 };
      const placed = searchPosition(body, env, request);
      if (placed === PLACE_EMPTY_WINDOW) exitSide = SIDE_BOTTOM;
      else if (placed !== PLACE_OK && placed !== PLACE_TYPE_CHANGED) {
        if (body.x - (width >> 1) < limits.xMin) exitSide = SIDE_LEFT;
        else if (body.x + (width >> 1) > limits.xMax) exitSide = SIDE_RIGHT;
        else if (body.p - 2 < limits.pMin) exitSide = SIDE_BACK;
        else if (body.p + 2 > limits.pMax) exitSide = SIDE_FRONT;
        else {
          const second = searchPosition(body, env, { ...request, tolY: -1 });
          if (second === PLACE_EMPTY_WINDOW) exitSide = SIDE_BOTTOM;
          else if (second !== PLACE_OK && second !== PLACE_TYPE_CHANGED) {
            err = ERR_SECOND_PLACEMENT;
            ok = false;
            break;
          }
        }
      }
      if (exitSide >= 0) break;
      body.tim += 1;
      if (body.tim > 4) {
        body.speedX = sgn(saved.x - body.x);
        body.speedP = sgn(saved.p - body.p);
        body.speedY = 1;
        if (body.speedX !== 0 || body.speedP !== 0) env.animate?.(body, 7);
      }
      // `179d:05ba` : après un placement réussi la chute passe directement au contrôle des bords (`179d:07b8`) : ni contact
      // (`1a50:0006`) ni collision de terrain (`1c96:0102`), la position écrite par `gm_object_behavior_main` fait foi
      ground = body.ground;
      plane = body.plane;
      break;
    }
    default:
      throw new RangeError(`Classe de déplacement invalide : ${body.dep}`);
  }

  /** Bords et sorties, jugés sur la nouvelle position (`movement.md` § 2.8). */
  const resolveExit = (edge: number): void => {
    const slot = inRoom ? terrain.inversePermutation[edge]! : edge;
    info = slot;
    const code = env.room.barriers[slot] ?? 0;
    if (code !== 0 && env.barrier && env.barrier(code, 1, body) !== 0) err = ERR_BARRIER;
    else if ((env.room.exits[slot] ?? 0) !== 0) err = ERR_EXIT;
    else if (body.txt === 2) err = ERR_EDGE_IMMATERIAL;
    else err = inRoom ? ERR_VANISHED : ERR_WALL;
  };

  if (exitSide >= 0) resolveExit(exitSide);
  else if (ok) {
    let leaves = false;
    if (body.p < box.pMin) {
      side = SIDE_BACK;
      leaves = true;
    } else if (body.p > box.pMax) {
      side = SIDE_FRONT;
      leaves = true;
    } else {
      const left = body.x - (width >> 1);
      if (left < box.xMin) {
        touched = true;
        side = SIDE_LEFT;
        if (body.x < box.xMin) leaves = true;
      } else if (left + width - 1 > box.xMax) {
        touched = true;
        side = SIDE_RIGHT;
        if (body.x > box.xMax) leaves = true;
      }
      if (!leaves) {
        if (body.y - height + 1 < box.yMin) {
          touched = true;
          side = SIDE_TOP;
          if (body.y < box.yMin) leaves = true;
        } else if (body.y > box.yMax) {
          touched = true;
          side = SIDE_BOTTOM;
          leaves = true;
        }
      }
    }
    if (leaves) resolveExit(side);
  }

  const succeeded = exitSide < 0 && ok && (err === 0 || err === ERR_TOUCHED_OBJECT || err === ERR_PLACED_TYPE_CHANGED);
  if (succeeded) {
    if (touched) {
      err = ERR_TOUCHED_EDGE;
      info = side;
    }
  } else {
    // le mouvement est annulé ; `Inf` et `Col` survivent
    body.x = saved.x;
    body.y = saved.y;
    body.p = saved.p;
    body.plane = saved.plane;
    body.ground = saved.ground;
    body.presence = saved.presence;
    body.height = saved.height;
    body.width = saved.width;
    body.speedX = saved.speedX;
    body.speedY = saved.speedY;
    body.speedP = saved.speedP;
    body.stepX = saved.stepX;
    body.stepY = saved.stepY;
    body.stepP = saved.stepP;
    body.tim = saved.tim;
  }
  body.err = err;
  body.info = info;
  body.col = col;
  return { err, info, moved: succeeded, exit: err === ERR_EXIT ? info : null };
}
