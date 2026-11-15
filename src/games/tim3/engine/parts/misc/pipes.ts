/**
 * Tuyaux et accélérateur : tuyau coudé 57, tuyaux droits 97 et 98 (embouchures), accélérateur 88, tuyau 47 (polygone
 * par image) et bloc de couleur 127. Traduit de TIMWIN.EXE 443dc0, 443de8, 444c68, 444cb9, 444ce1, 446c94, 446cd0,
 * 446d4c, 446d89, 4473d0, 44742b, 44750d, 447584, 4475e2, 448268, 44827f et du parcours des tuyaux 43d59c, 43d711,
 * 43d972, 43d9a8, 43da1a. OpenTIM (`parts/pipe.rs`) n'a que le tuyau de TIM1 : ici le binaire fait foi.
 *
 * Une pièce qui touche l'embouchure d'un tuyau (slot 0 : rend 0, pas de rebond) y est avalée : 43d59c suit la chaîne de
 * tuyaux jusqu'à la sortie, suspend la pièce (+0x14 & 0x4000) pendant le temps du trajet (+0x104), puis la repose à la
 * sortie avec une vitesse de 1/4 de sa vitesse d'entrée (accélérateur : 0x2000 ; phazer : 0x3000).
 */
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import { Polygon } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { stateFirst } from "./anim";

const T_PIPE_CURVE = 57; // 0x39
const T_ACCEL = 88; // 0x58
const T_PIPE_STRAIGHT = 97; // 0x61
const T_PIPE_SHORT = 98; // 0x62

/** Table 478138 (embouchure du côté 0 du tuyau coudé, selon l'image) et 478148 (côté 7). */
const CURVE_DIR_0 = [0, 3, 2, 1];
const CURVE_DIR_7 = [3, 1, 0, 2];

/** Direction « invalide » : l'exe rend alors un registre quelconque (43d711, cas non prévu) ; aucun cas ne s'y arrête. */
const BAD_DIR = -1;

/**
 * Pièces qui reçoivent un callback à leur sortie du tuyau (43da1a : 0x36 → 444adc, 0x46 → 445c9e, 0x6d → 447b19), portées
 * par les autres groupes : elles inscrivent ici leur fonction (type → `(world, pièce, direction)`).
 */
export const pipeExitHooks = new Map<number, (world: World, ball: Part, dir: number) => void>();
const EXIT_ADDRESS: Record<number, number> = { 0x36: 0x444adc, 0x46: 0x445c9e, 0x6d: 0x447b19 };

/**
 * 0x4815b4 : poignée de redimensionnement de l'éditeur (0x8003 … 0x8006), lue par le slot 4 du tuyau 97. Hors simulation :
 * valeur posée par l'éditeur (besoin de noyau : champ de `World`).
 */
export function setResizeHandle(world: World, handle: number): void {
  world.resizeHandle = handle;
}

function ensurePoly(p: Part): Polygon {
  p.poly ??= new Polygon(p.vertexCount);
  return p.poly;
}

/** Polygone de l'image courante du type (443dc0, 444cb9) : `polygons[image]`, angles des côtés. */
function polyOfFrame(world: World, p: Part): void {
  p.poly = world.types.get(p.type).polygons![p.frame]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** 443de8 / 444ce1 : retournement de l'éditeur (action 0xF) : 0 → 2, 1 → 0, 2 → 3, 3 → 1. */
function rotateFrame(p: Part, arg: unknown): void {
  if (arg !== 0xf) return;
  switch (p.frame) {
    case 0:
      p.frame = 2;
      break;
    case 1:
      p.frame = 0;
      break;
    case 2:
      p.frame = 3;
      break;
    case 3:
      p.frame = 1;
      break;
  }
}

/** 43d972 : direction de sortie d'un accélérateur (image avant ou après l'état 0x15, retournement). */
function accelDir(world: World, a: Part): number {
  const first = stateFirst(world, T_ACCEL, 0x15);
  if (a.frame < first) return a.flags10 & 0x20 ? 3 : 2;
  return a.flags10 & 0x10 ? 1 : 0;
}

/**
 * 43d711 : points d'entrée (`entry`) et de sortie (`exit`) du tuyau `pipe` en pixels, et direction après le tuyau, pour
 * une pièce qui y entre dans la direction `dir` (0 vers la droite, 1 vers la gauche, 2 vers le bas, 3 vers le haut).
 * Les tableaux sont ceux de l'appelant : les cases non écrites gardent leur valeur (comme les variables de pile).
 */
function pipeEnds(pipe: Part, dir: number, entry: Int32Array, exit: Int32Array): number {
  let out = dir;
  if (pipe.type === T_PIPE_CURVE) {
    entry[0] = -100;
    switch (pipe.frame) {
      case 0:
        if (dir === 0) {
          out = 2;
          entry[0] = 0;
          entry[1] = 0;
          exit[0] = 0x20;
          exit[1] = 0x40;
        } else if (dir === 3) {
          out = 1;
          entry[0] = 0x20;
          entry[1] = 0x40;
          exit[0] = 0;
          exit[1] = 0;
        } else out = BAD_DIR;
        break;
      case 1:
        if (dir === 1) {
          out = 2;
          entry[0] = 0x40;
          entry[1] = 0;
          exit[0] = 0;
          exit[1] = 0x40;
        } else if (dir === 3) {
          out = 0;
          entry[0] = 0;
          entry[1] = 0x40;
          exit[0] = 0x40;
          exit[1] = 0;
        } else out = BAD_DIR;
        break;
      case 2:
        if (dir === 0) {
          out = 3;
          entry[0] = 0;
          entry[1] = 0x20;
          exit[0] = 0x20;
          exit[1] = 0;
        } else if (dir === 2) {
          out = 1;
          entry[0] = 0x20;
          entry[1] = 0;
          exit[0] = 0;
          exit[1] = 0x20;
        } else out = BAD_DIR;
        break;
      case 3:
        if (dir === 1) {
          out = 3;
          entry[0] = 0x40;
          entry[1] = 0x20;
          exit[0] = 0;
          exit[1] = 0;
        } else if (dir === 2) {
          out = 0;
          entry[0] = 0;
          entry[1] = 0;
          exit[0] = 0x40;
          exit[1] = 0x20;
        } else out = BAD_DIR;
        break;
      default:
        out = BAD_DIR;
    }
  } else if (pipe.type === T_PIPE_STRAIGHT || pipe.type === T_ACCEL) {
    const horizontal = pipe.frameW % 16 === 0;
    if (horizontal) {
      entry[0] = -100;
      exit[1] = 0;
      entry[1] = 0;
      if (dir === 0) {
        entry[0] = 0;
        exit[0] = pipe.frameW;
      } else if (dir === 1) {
        entry[0] = pipe.frameW;
        exit[0] = 0;
      }
    } else {
      exit[0] = 0;
      entry[0] = 0;
      entry[1] = -100;
      if (dir === 2) {
        entry[1] = 0;
        exit[1] = pipe.frameH;
      } else if (dir === 3) {
        entry[1] = pipe.frameH;
        exit[1] = 0;
      }
    }
  } else {
    // 98 : embouchure de 0x50 de long et 0x10 de large, au centre de la pièce.
    switch (dir) {
      case 0:
        entry[0] = 0;
        exit[0] = 0x50;
        exit[1] = 0x10;
        entry[1] = 0x10;
        break;
      case 1:
        entry[0] = 0x50;
        exit[0] = 0;
        exit[1] = 0x10;
        entry[1] = 0x10;
        break;
      case 2:
        entry[1] = 0;
        exit[1] = 0x50;
        exit[0] = 0x10;
        entry[0] = 0x10;
        break;
      case 3:
        exit[1] = 0;
        entry[1] = 0x50;
        exit[0] = 0x10;
        entry[0] = 0x10;
        break;
    }
  }
  entry[0] = (entry[0]! + pipe.px) | 0;
  entry[1] = (entry[1]! + pipe.py) | 0;
  exit[0] = (exit[0]! + pipe.px) | 0;
  exit[1] = (exit[1]! + pipe.py) | 0;
  return out;
}

/**
 * 43d9a8 : tuyau (parmi 57, 97, 98, 88 des pièces statiques, autre que `cur`) dont le point d'entrée, pour la direction
 * `dir.value`, est le point de sortie `exit` ; `dir.value` devient la direction après ce tuyau.
 */
function nextPipe(world: World, cur: Part, dir: { value: number }, exit: Int32Array): Part | null {
  const entry = new Int32Array(2);
  const out = new Int32Array(2);
  for (const c of world.statics) {
    if (c.type !== T_PIPE_CURVE && c.type !== T_PIPE_STRAIGHT && c.type !== T_PIPE_SHORT && c.type !== T_ACCEL) continue;
    if (c === cur) continue;
    const d = pipeEnds(c, dir.value, entry, out);
    if (entry[0] === exit[0] && entry[1] === exit[1]) {
      dir.value = d;
      return c;
    }
  }
  return null;
}

/** 43da1a : repose la pièce à la sortie du dernier tuyau, avec sa nouvelle vitesse (puis callback propre à son type). */
function exitPipe(world: World, pipe: Part, ball: Part, dir: number, exit: Int32Array, has88: boolean, has57: boolean): void {
  let speed: number;
  if (ball.type === 0x14) speed = 0x3000;
  else if (has88) speed = 0x2000;
  else speed = (Math.abs(ball.vx) + Math.abs(ball.vy)) >> 2;
  let size: number;
  if (pipe.type === T_PIPE_CURVE) size = 0x1e;
  else if (pipe.type === T_PIPE_SHORT) size = 0x10;
  else size = 0x20;
  const push = has88 || has57;
  switch (dir) {
    case 2:
      if (push) {
        ball.vx = 0;
        ball.vy = speed;
        if (has57) ball.px = (exit[0]! + 1) | 0;
      }
      if (size > ball.boxH) size = ball.boxH;
      ball.py = (exit[1]! - size) | 0;
      break;
    case 3:
      if (push) {
        ball.vx = 0;
        ball.vy = -speed | 0;
        if (has57) ball.px = (exit[0]! + 1) | 0;
      }
      if (size > ball.boxH) size = ball.boxH;
      ball.py = (size + (exit[1]! - ball.boxH)) | 0;
      break;
    case 0:
      if (push) {
        ball.vx = speed;
        ball.vy = 0;
        if (has57) ball.py = (exit[1]! - ball.boxH + 0x25) | 0;
      }
      if (size > ball.boxW) size = ball.boxW;
      ball.px = (exit[0]! - size) | 0;
      break;
    case 1:
      if (push) {
        ball.vx = -speed | 0;
        ball.vy = 0;
        if (has57) ball.py = (exit[1]! - ball.boxH + 0x25) | 0;
      }
      if (size > ball.boxW) size = ball.boxW;
      ball.px = (size + (exit[0]! - ball.boxW)) | 0;
      break;
  }
  ball.prevPx = ball.px;
  ball.prevPy = ball.py;
  updateGeometry(world, ball);
  ball.prevDrawX = ball.drawX;
  ball.prevDrawY = ball.drawY;
  ball.fx = ball.px << 9;
  ball.fy = ball.py << 9;
  const address = EXIT_ADDRESS[ball.type];
  if (address !== undefined) {
    // Crochet inscrit ici, sinon fonction spéciale de la famille du type (444adc : `creatures`, Mel).
    const hook = pipeExitHooks.get(ball.type);
    if (hook) hook(world, ball, dir);
    else world.special(address, ball, dir);
  }
}

/**
 * 43d59c(pièce, tuyau, direction) : la pièce `ball` entre dans le tuyau `pipe0` par son embouchure `dir0` ; suit la chaîne
 * des tuyaux, puis la suspend le temps du trajet et la repose à la sortie. Rend 1 si elle est partie (ou détruite), 0 si
 * elle est retenue par une corde.
 */
function enterPipe(world: World, ball: Part, pipe0: Part, dir0: number): number {
  let dir = dir0;
  let length = 0; // ebp-0x1c : durée du trajet
  let changes = 0; // ebp-0x20 : changements de direction imposés par des accélérateurs
  let has88 = false; // ebp-0x24
  let has57 = false; // ebp-0x28
  let guard = 0; // ebp-0x2c
  if (ball.flags10 & 4 && ball.ropes[0]) return 0;
  let cur: Part | null = pipe0;
  if (pipe0.type === T_ACCEL) {
    has88 = true;
    const d = accelDir(world, pipe0);
    if (dir !== d) {
      dir = d;
      changes = 1;
    }
  }
  const entry = new Int32Array(2);
  const exit = new Int32Array(2);
  const finalDir = { value: 0 };
  let last: Part = pipe0;
  while (cur) {
    last = cur;
    if (cur.type === T_PIPE_CURVE) has57 = true;
    const sum = (cur.frameW + cur.frameH) | 0;
    length = (length + ((sum + (sum < 0 ? 15 : 0)) >> 4)) | 0;
    dir = pipeEnds(cur, dir, entry, exit);
    finalDir.value = dir;
    let next = nextPipe(world, cur, finalDir, exit);
    if (next && next.type === T_ACCEL) {
      has88 = true;
      const d = accelDir(world, next);
      if (dir !== d) {
        dir = d;
        changes++;
        if (changes > 1) next = null;
      }
    }
    cur = next;
    if (guard++ > 0x190) {
      ball.flags10 |= 0x2000;
      return 1;
    }
  }
  if (has57 && (ball.boxW > 0x25 || ball.boxH > 0x25)) {
    ball.flags10 |= 0x2000;
    return 1;
  }
  if (changes > 1) {
    ball.flags10 |= 0x2000;
    return 1;
  }
  ball.f104 = length;
  ball.flags14 |= 0x4000;
  exitPipe(world, last, ball, finalDir.value, exit, has88, has57);
  return 1;
}

/** Embouchure de la pièce `arg` (qui touche `pipe`) : l'indice du côté touché est dans `ball.contactIndex`. */
function ballOf(arg: unknown): Part {
  return arg as Part;
}

// ---- Tuyau 47 (443dc0, 443de8) -------------------------------------------------------------------------------------

function pipe47Edit(world: World, p: Part, arg: unknown): void {
  rotateFrame(p, arg);
  p.editFrame = p.frame;
  polyOfFrame(world, p);
}

// ---- Tuyau coudé 57 (444c68, 444cb9, 444ce1) -----------------------------------------------------------------------

function curve57Accept(world: World, pipe: Part, arg: unknown): number {
  const ball = ballOf(arg);
  const idx = ball.contactIndex;
  if ((idx === 0 || idx === 7) && !(ball.flags10 & 0x1000)) {
    const dir = idx === 0 ? CURVE_DIR_0[pipe.frame]! : CURVE_DIR_7[pipe.frame]!;
    enterPipe(world, ball, pipe, dir);
    return 0;
  }
  return 1;
}

// ---- Accélérateur 88 (446c94 … 446d89) -----------------------------------------------------------------------------

function accelAccept(world: World, pipe: Part, arg: unknown): number {
  const ball = ballOf(arg);
  const idx = ball.contactIndex;
  if (idx === 0 || idx === 4) {
    enterPipe(world, ball, pipe, accelDir(world, pipe));
    return 0;
  }
  return 1;
}

/** 446cd0 : polygone 0 avant l'état 0x15, 1 ensuite. */
function accelReset(world: World, p: Part): void {
  const first = stateFirst(world, T_ACCEL, 0x15);
  p.poly = world.types.get(p.type).polygons![p.frame < first ? 0 : 1]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** 446d4c : animation (état 0x15 : fond qui boucle). */
function accelRun(world: World, p: Part): void {
  if (!(world.animFlags & 1)) return;
  p.frame = (p.frame + 1) | 0;
  const first = stateFirst(world, T_ACCEL, 0x15);
  if (p.frame === first) {
    p.frame = 1;
    return;
  }
  if (p.frame === stateFirst(world, T_ACCEL, -1)) p.frame = (first + 1) | 0;
}

/** 446d89 : retournement (0xF) : bascule entre l'image 0 et l'image du retournement. */
function accelEdit(world: World, p: Part, arg: unknown): void {
  if (arg === 0xf) {
    const first = stateFirst(world, T_ACCEL, 0x15);
    if (p.frame < first) {
      p.frame = first;
      if (!(p.flags10 & 0x20)) p.flags10 |= 0x10;
      p.flags10 &= ~0x20;
    } else {
      p.frame = 0;
      if (p.flags10 & 0x10) p.flags10 |= 0x20;
      p.flags10 &= ~0x10;
    }
  }
  p.editFrame = p.frame;
  accelReset(world, p);
  updateGeometry(world, p);
}

// ---- Tuyau droit 97 (4473d0, 44742b, 44750d) ----------------------------------------------------------------------

function straight97Accept(world: World, pipe: Part, arg: unknown): number {
  const ball = ballOf(arg);
  const idx = ball.contactIndex;
  if (idx === 0 || idx === 4) {
    let dir: number;
    if (pipe.frameW > pipe.frameH) dir = idx === 0 ? 0 : 1;
    else dir = idx === 0 ? 2 : 3;
    enterPipe(world, ball, pipe, dir);
    return 0;
  }
  return 1;
}

/** 44742b : polygone à 8 sommets (deux embouchures de 0x20) propre à la pièce, couché ou debout selon sa forme. */
function straight97Reset(_world: World, p: Part): void {
  const poly = ensurePoly(p);
  const x = poly.x;
  const y = poly.y;
  if (p.frameW > p.frameH) {
    x[1] = x[0] = 0x20;
    x[7] = x[2] = 0;
    x[6] = x[3] = (p.frameW - 1) | 0;
    x[5] = x[4] = (p.frameW - 0x21) | 0;
    y[7] = y[6] = y[5] = y[0] = 0x25;
    y[4] = y[3] = y[2] = y[1] = 0;
  } else {
    x[7] = x[6] = x[5] = x[0] = 0;
    x[4] = x[3] = x[2] = x[1] = 0x25;
    y[1] = y[0] = 0x20;
    y[7] = y[2] = 0;
    y[6] = y[3] = (p.frameH - 1) | 0;
    y[5] = y[4] = (p.frameH - 0x21) | 0;
  }
  computeEdgeAngles(poly, p.vertexCount);
}

/** Division entière par 16 (arrondie vers 0) puis ×16, comme l'exe (`sar` après correction du signe). */
function floor16(v: number): number {
  return ((v + (v < 0 ? 15 : 0)) >> 4) << 4;
}

/** 44750d : redimensionnement de l'éditeur : un côté arrondi à 16, l'autre fixé à 0x26. */
function straight97Resize(world: World, p: Part): void {
  const handle = world.resizeHandle;
  const k = (handle - 0x8003) | 0;
  if (k >= 0 && k < 2) {
    p.boxW = floor16(p.boxW);
    p.boxH = 0x26;
  } else if (k >= 2 && k < 4) {
    p.boxW = 0x26;
    p.boxH = floor16(p.boxH);
  }
  p.frameW = p.boxW;
  p.frameH = p.boxH;
  straight97Reset(world, p);
}

// ---- Tuyau court 98 (447584, 4475e2) -------------------------------------------------------------------------------

function short98Accept(world: World, pipe: Part, arg: unknown): number {
  const ball = ballOf(arg);
  let dir: number;
  switch (ball.contactIndex) {
    case 0:
      dir = 2;
      break;
    case 5:
      dir = 1;
      break;
    case 10:
      dir = 3;
      break;
    case 14:
      dir = 0;
      break;
    default:
      return 1;
  }
  enterPipe(world, ball, pipe, dir);
  return 0;
}

/** 4475e2 : polygone unique du type. */
function short98Reset(world: World, p: Part): void {
  p.poly = world.types.get(p.type).polygons![0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

// ---- Bloc de couleur 127 (448268, 44827f) --------------------------------------------------------------------------

/** 448268 : l'image prend la taille de la boîte. */
function colorBlockResize(_world: World, p: Part): void {
  p.frameW = p.boxW;
  p.frameH = p.boxH;
}

export function registerPipes(r: HandlerRegistry): void {
  // 47
  r.register(0x443dc0, "pipe47.reset", (w, p) => polyOfFrame(w, p));
  r.register(0x443de8, "pipe47.edit", (w, p, a) => {
    pipe47Edit(w, p, a);
    // 443e31 → 43087b, 439695 : zones à redessiner (affichage).
  });
  // 57
  r.register(0x444c68, "curve57.accept", (w, p, a) => curve57Accept(w, p, a));
  r.register(0x444cb9, "curve57.reset", (w, p) => polyOfFrame(w, p));
  r.register(0x444ce1, "curve57.edit", (w, p, a) => {
    pipe47Edit(w, p, a);
    updateGeometry(w, p);
  });
  // 88
  r.register(0x446c94, "accel88.accept", (w, p, a) => accelAccept(w, p, a));
  r.register(0x446d4c, "accel88.run", (w, p) => accelRun(w, p));
  r.register(0x446cd0, "accel88.reset", (w, p) => accelReset(w, p));
  r.register(0x446d89, "accel88.edit", (w, p, a) => accelEdit(w, p, a));
  // 97
  r.register(0x4473d0, "straight97.accept", (w, p, a) => straight97Accept(w, p, a));
  r.register(0x44742b, "straight97.reset", (w, p) => straight97Reset(w, p));
  r.register(0x44750d, "straight97.resize", (w, p) => straight97Resize(w, p));
  // 98
  r.register(0x447584, "short98.accept", (w, p, a) => short98Accept(w, p, a));
  r.register(0x4475e2, "short98.reset", (w, p) => short98Reset(w, p));
  // 127
  r.register(0x448268, "colorBlock127.resize", (w, p) => colorBlockResize(w, p));
  r.register(0x44827f, "colorBlock127.draw", () => undefined);
}
