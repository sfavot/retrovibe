/**
 * Avancement d'un trajet, tour par tour.
 *
 * Références (ScummVM `engines/cruise/`, GPL v3+, release 2026.4.0, lu puis réécrit) : `perso.cpp` (`direction`, `cor_droite`,
 * `processActorWalk`, `affiche_chemin`), `function.cpp` (`computeZoom`, `subOp23`).
 *
 * Le trajet (`persoStruct`) est un tableau d'int16 à plat (disposition `PERSO_*` de `walk.ts`) : un pas négatif (zoom négatif) fait
 * lire avant les coordonnées, comme dans ScummVM ; seule une lecture hors de la structure lève une erreur.
 */
import { int16 } from "./memory";
import type { EngineState } from "./state";
import {
  freePerso,
  getPixel,
  PERSO_COORDS,
  PERSO_DIR,
  PERSO_INC_CHEMIN,
  PERSO_INC_DROITE,
  PERSO_INC_DROITE0,
  PERSO_INC_JO0,
  PERSO_INC_JO1,
  PERSO_INC_JO2,
  PERSO_SOLUTION,
  type MovementEntry,
} from "./walk";

/** `computeZoom` : interpolation linéaire en Y posée par `Op_SetZoom` (division C tronquée). */
export function computeZoom(e: EngineState, y: number): number {
  const den = e.var45 - e.var46;
  if (den === 0) throw new Error("computeZoom : division par 0");
  return int16(Math.trunc(((y - e.var46) * (e.var39 - e.var42)) / den) + e.var42);
}

/** `subOp23` : `(a × b) >> 8`, en int16. */
export function subOp23(a: number, b: number): number {
  return int16(Math.imul(a, b) >> 8);
}

/**
 * `cor_droite` : points de la droite de Bresenham de (x1, y1) à (x2, y2), le premier compris. Une droite de longueur nulle ferait
 * boucler ScummVM (`while (--cx)` à partir de 0) : erreur ici.
 */
export function corDroite(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  const out: [number, number][] = [[x1, y1]];
  let dx = x2 - x1;
  let dy = y2 - y1;
  let mD0 = 1;
  let mD1 = 1;
  if (dx < 0) {
    dx = -dx;
    mD0 = -1;
  }
  if (dy < 0) {
    dy = -dy;
    mD1 = -1;
  }
  let mA0: number;
  let mA1: number;
  let bp: number;
  let cx: number;
  if (dx < dy) {
    mA0 = 0;
    bp = dx;
    cx = dy;
    mA1 = mD1;
  } else {
    mA1 = 0;
    bp = dy;
    cx = dx;
    mA0 = mD0;
  }
  if (cx === 0) throw new Error("cor_droite : droite de longueur nulle");
  bp *= 2;
  let d = bp - cx;
  const si = d - cx;
  let ax = x1;
  let bx = y1;
  while (--cx) {
    if (d > 0) {
      ax += mD0;
      bx += mD1;
      d += si;
    } else {
      ax += mA0;
      bx += mA1;
      d += bp;
    }
    out.push([ax, bx]);
  }
  return out;
}

/** `direction` : 0 haut, 1 droite, 2 bas, 3 gauche ; pose `inc_jo` (pas horizontal, vertical, ou leur différence en diagonale). */
export function direction(e: EngineState, x1: number, y1: number, x2: number, y2: number, incJo1: number, incJo2: number): number {
  const h1 = x1 - x2;
  const h = Math.abs(h1);
  const v1 = y1 - y2;
  const v = Math.abs(v1);
  if (v > h) {
    e.walk.incJo = h > 30 ? incJo1 - incJo2 : incJo2;
    return v1 < 0 ? 2 : 0;
  }
  e.walk.incJo = incJo1;
  return h1 < 0 ? 1 : 3;
}

function at(perso: Int16Array, index: number): number {
  if (index < 0 || index >= perso.length) throw new RangeError(`persoStruct : lecture hors de la structure (${index})`);
  return perso[index]!;
}

/** `processActorWalk` (via `affiche_chemin`) : position suivante du trajet `num`, ou `x = −1` à la fin (trajet libéré). */
export function afficheChemin(e: EngineState, num: number, res: MovementEntry): void {
  const perso = e.walk.persoTable[num];
  if (!perso) throw new Error(`affiche_chemin : trajet ${num} absent`);
  const sol = (i: number, k: 0 | 1) => at(perso, PERSO_SOLUTION + i * 2 + k);
  let u = 0;
  e.walk.incJo = perso[PERSO_INC_JO0]!;
  let i = perso[PERSO_INC_CHEMIN]!;

  if (!perso[PERSO_INC_DROITE]) {
    const x1 = sol(i, 0);
    const y1 = sol(i, 1);
    i++;
    if (sol(i, 0) !== -1) {
      do {
        if (sol(i, 0) !== -2) {
          const x2 = sol(i, 0);
          const y2 = sol(i, 1);
          if (x1 === x2 && y1 === y2) {
            res.x = -1;
            res.y = -1;
            freePerso(e, num);
            return;
          }
          const points = corDroite(x1, y1, x2, y2);
          if (PERSO_COORDS + points.length * 2 > PERSO_SOLUTION) throw new RangeError("cor_droite : plus de 400 points");
          points.forEach(([x, y], k) => {
            perso[PERSO_COORDS + k * 2] = x;
            perso[PERSO_COORDS + k * 2 + 1] = y;
          });
          e.flagObstacle = 0;
          perso[PERSO_INC_DROITE0] = points.length;
          perso[PERSO_DIR] = res.direction = direction(e, x1, y1, x2, y2, perso[PERSO_INC_JO1]!, perso[PERSO_INC_JO2]!);
          perso[PERSO_INC_JO0] = e.walk.incJo;
          u = 1;
        } else {
          i++;
        }
      } while (sol(i, 0) !== -1 && !u);
    }
    if (!u) {
      res.x = -1;
      res.y = -1;
      freePerso(e, num);
      return;
    }
    perso[PERSO_INC_CHEMIN] = i;
  }

  const step = perso[PERSO_INC_DROITE]!;
  res.x = at(perso, PERSO_COORDS + step * 2);
  res.y = at(perso, PERSO_COORDS + step * 2 + 1);
  res.direction = perso[PERSO_DIR]!;
  res.zoom = computeZoom(e, res.y);
  getPixel(e, res.x, res.y);
  res.poly = e.walk.numPoly;

  u = subOp23(res.zoom, e.walk.incJo);
  if (!u) u = 1;
  perso[PERSO_INC_DROITE] = perso[PERSO_INC_DROITE]! + u;
  if (perso[PERSO_INC_DROITE]! >= perso[PERSO_INC_DROITE0]!) {
    perso[PERSO_INC_DROITE] = 0;
    res.x = sol(perso[PERSO_INC_CHEMIN]!, 0);
    res.y = sol(perso[PERSO_INC_CHEMIN]!, 1);
  }
}
