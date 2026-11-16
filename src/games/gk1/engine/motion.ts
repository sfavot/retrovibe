/**
 * Déplacement des acteurs : calculs purs derrière les fonctions du noyau `InitBresen`, `DoBresen`, `SetJump`, `DirLoop`,
 * `BaseSetter` et `CantBeHere` (`kernel/motion.ts` lit et écrit les propriétés des objets).
 *
 * Références : `engines/sci/engine/kmovement.cpp` (`kInitBresen`, `kDoBresen`, `kSetJump`), `kgraphics.cpp`
 * (`kDirLoopWorker`), `kgraphics32.cpp` (`kBaseSetter32`) et `graphics/compare.cpp` (`kernelCantBeHere32`,
 * `canBeHereCheckRectList`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - **Ligne de Bresenham** : un acteur avance de (`dx`, `dy`) par pas ; l'axe le plus long avance de son pas entier,
 *   l'autre de la partie entière de la pente, et le terme d'erreur `di` ajoute de temps en temps `incr` (±1) sur l'axe
 *   court. Quand l'acteur est à moins d'un pas de sa cible sur l'axe long, il s'y pose.
 * - **Saut** (`SetJump`) : vitesses initiales d'une parabole sous la gravité `gy`, pour un saut de (`dx`, `dy`).
 * - **Orientation** (`DirLoop`) : boucle de la vue selon le cap, en degrés, 0 vers le haut de l'écran : 3 de dos, 2 de
 *   face, 0 vers la droite, 1 vers la gauche. Une vue de moins de quatre boucles n'a ni dos ni face.
 * - **Base** (`BaseSetter`) : le rectangle des pieds, large comme le cel et haut de `yStep`, qui sert aux collisions.
 * - **Collision** (`CantBeHere`) : deux bases se gênent si elles se recouvrent strictement (se toucher ne compte pas).
 *
 * Les entiers suivent le C de l'original : divisions tronquées vers zéro, propriétés sur 16 bits signés.
 */

/** Bits de la propriété `signal` d'un acteur que l'interpréteur lit ou écrit. */
export const SIGNAL_HIDDEN = 0x0008;
export const SIGNAL_HIT_OBSTACLE = 0x0400;
export const SIGNAL_DOESNT_TURN = 0x0800;
export const SIGNAL_IGNORE_ACTOR = 0x4000;

/** Boucles d'une vue d'acteur selon son cap. */
export const HeadingLoop = { East: 0, West: 1, South: 2, North: 3 } as const;
/** Une vue doit avoir au moins ce nombre de boucles pour se montrer de face et de dos. */
const LOOPS_WITH_FRONT_AND_BACK = 4;

function int16(value: number): number {
  return (value << 16) >> 16;
}

/** État d'une ligne de Bresenham : les propriétés `dx`, `dy`, `b-i1`, `b-i2`, `b-di`, `b-incr`, `b-xAxis` d'un `Motion`. */
export interface BresenhamLine {
  dx: number;
  dy: number;
  i1: number;
  i2: number;
  di: number;
  incr: number;
  xAxis: boolean;
}

/**
 * Prépare la ligne d'un acteur en (`clientX`, `clientY`), de pas (`xStep`, `yStep`), vers (`targetX`, `targetY`).
 * Sur une ligne plutôt horizontale dont la pente dépasserait `yStep`, le pas horizontal est réduit jusqu'à ce qu'elle tienne.
 */
export function initBresenham(clientX: number, clientY: number, targetX: number, targetY: number, xStep: number, yStep: number, stepFactor = 1): BresenhamLine {
  let stepX = int16(xStep * stepFactor);
  const stepY = int16(yStep * stepFactor);
  let attempts = (stepX < stepY ? stepY : stepX) * 2;
  const deltaX = int16(targetX - clientX);
  const deltaY = int16(targetY - clientY);
  for (;;) {
    let dx = stepX;
    let dy = stepY;
    let incr = 1;
    let i1: number;
    let i2: number;
    let di: number;
    if (Math.abs(deltaX) < Math.abs(deltaY)) {
      if (deltaY < 0) dy = -dy;
      dx = deltaY !== 0 ? Math.trunc((dy * deltaX) / deltaY) : 0;
      i1 = (dy * deltaX - dx * deltaY) * 2;
      if (deltaX < 0) {
        incr = -1;
        i1 = -i1;
      }
      i2 = i1 - deltaY * 2;
      di = i1 - deltaY;
      if (deltaY < 0) {
        i1 = -i1;
        i2 = -i2;
        di = -di;
      }
      return { dx, dy, i1, i2, di, incr, xAxis: false };
    }
    if (deltaX < 0) dx = -dx;
    dy = deltaX !== 0 ? Math.trunc((dx * deltaY) / deltaX) : 0;
    i1 = (dx * deltaY - dy * deltaX) * 2;
    if (deltaY < 0) {
      incr = -1;
      i1 = -i1;
    }
    i2 = i1 - deltaX * 2;
    di = i1 - deltaX;
    if (deltaX < 0) {
      i1 = -i1;
      i2 = -i2;
      di = -di;
    }
    if (stepX <= stepY || stepX === 0 || stepY >= Math.abs(dy + incr)) return { dx, dy, i1, i2, di, incr, xAxis: true };
    if (--attempts === 0) throw new Error("GK1 : InitBresen ne trouve pas de pas");
    stepX--;
  }
}

export interface BresenhamStep {
  x: number;
  y: number;
  /** Nouveau terme d'erreur. */
  di: number;
  /** L'acteur s'est posé sur la cible. */
  completed: boolean;
}

/** Avance d'un pas un acteur en (`x`, `y`) le long de `line`, vers (`targetX`, `targetY`). */
export function stepBresenham(line: BresenhamLine, x: number, y: number, targetX: number, targetY: number): BresenhamStep {
  const completed = line.xAxis ? Math.abs(targetX - x) <= Math.abs(line.dx) : Math.abs(targetY - y) <= Math.abs(line.dy);
  if (completed) return { x: targetX, y: targetY, di: line.di, completed };
  x += line.dx;
  y += line.dy;
  let di = line.di;
  if (di < 0) di += line.i1;
  else {
    di += line.i2;
    if (line.xAxis) y += line.incr;
    else x += line.incr;
  }
  return { x: int16(x), y: int16(y), di, completed };
}

/**
 * Pas initiaux (`xStep`, `yStep`) d'un saut de (`dx`, `dy`) sous la gravité `gy`. `yStep` est toujours vers le haut ;
 * les deux sont des entiers pour un déplacement pas à pas, pas de vraies vitesses.
 */
export function jumpSteps(dx: number, dy: number, gy: number): { xStep: number; yStep: number } {
  const leftward = dx < 0;
  dx = Math.abs(dx);
  let slope = 1;
  if (dx !== 0) {
    if (dx + dy < 0) slope = Math.trunc((2 * Math.abs(dy)) / dx);
    else slope = Math.max(Math.trunc((Math.trunc((dx * 3) / 2) - dy) / dx), 1);
  }
  const drop = slope * dx + dy;
  let xStep = drop !== 0 && dx !== 0 ? int16(Math.trunc(dx * Math.sqrt(gy / (2 * drop)))) : 0;
  if (leftward) xStep = -xStep;
  const yStep = dy < 0 && xStep === 0 ? Math.trunc(Math.sqrt(gy * Math.abs(2 * dy))) + 1 : slope * xStep;
  return { xStep, yStep: -Math.abs(yStep) };
}

/**
 * Boucle d'un acteur pour ce cap (0 à 359), ou `undefined` s'il faut garder la boucle courante : une vue de moins de
 * quatre boucles ne sait se montrer ni de face ni de dos.
 */
export function loopForHeading(heading: number, loopCount: number): number | undefined {
  let loop: number;
  if (heading > 315 || heading < 45) loop = HeadingLoop.North;
  else if (heading > 135 && heading < 225) loop = HeadingLoop.South;
  else return heading >= 180 ? HeadingLoop.West : HeadingLoop.East;
  return loopCount >= LOOPS_WITH_FRONT_AND_BACK ? loop : undefined;
}

/** Rectangle d'une base, bords compris (`brLeft`, `brTop`, `brRight`, `brBottom`). */
export interface BaseRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Base d'un acteur en (`x`, `y`) : la largeur de son cel (ancré en `originX`, retourné ou non), `yStep` lignes sous ses pieds. */
export function baseRect(x: number, y: number, yStep: number, celWidth: number, originX: number, mirrored: boolean): BaseRect {
  const left = x - (mirrored ? celWidth - originX : originX);
  return { left, top: y + 1 - yStep, right: left + celWidth - 1, bottom: y + 1 };
}

export function isValidBase(rect: BaseRect): boolean {
  return rect.left <= rect.right && rect.top <= rect.bottom;
}

/** Deux bases se recouvrent-elles ? Se toucher par un bord ne compte pas. */
export function basesCollide(a: BaseRect, b: BaseRect): boolean {
  return b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom;
}
