/**
 * Lanceurs : canon (18), fusée (36), missile (70), feux d'artifice (80). Allumés (+0x24, ou chauffés plus de 20 pas,
 * +0x104), ils animent leur mèche, poussent (±0x400 par pas, bridé à la vitesse terminale) en crachant du feu, tirent
 * un boulet (43) ou explosent. Traduit de TIMWIN.EXE 440718 … 4407d3, 442458 … 4425e4, 4458f8 … 445be7,
 * 44676c … 446849.
 */
import { clampVelocity } from "../../gravity";
import { updateGeometry } from "../../move";
import { F10, type Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import {
  chain,
  flame,
  insertCreated,
  LIST_MOBILE,
  nearby,
  placeAt,
  pyroGlobals,
  recyclePart,
  setAnchor,
  stateFrame,
  usePolygon,
} from "./kernel";
import { startMouseMotor } from "./explosives";

function heat(p: Part): void {
  if (p.f24 === 0 && p.f104 > 0x14) p.f24 = 1;
}

/** Orientation (0 haut, 1 droite, 2 gauche) d'après l'image d'édition et les débuts d'états `b1`, `b2`. */
function orientation(world: World, type: number, p: Part, s1: number, s2: number): number {
  return (p.editFrame >= stateFrame(world, type, s1) ? 1 : 0) + (p.editFrame >= stateFrame(world, type, s2) ? 1 : 0);
}

/** Poussée d'un pas dans l'orientation : vers le haut (contact oublié), la droite ou la gauche, puis 4341cb. */
function thrust(world: World, p: Part, dir: number): void {
  if (dir === 0) {
    p.contact = null;
    p.vy = (p.vy - 0x400) | 0;
  } else if (dir === 1) p.vx = (p.vx + 0x400) | 0;
  else if (dir === 2) p.vx = (p.vx - 0x400) | 0;
  clampVelocity(p, world.types);
}

// ---------------------------------------------------------------------------------------------------------------------
// Canon (18).

/** États des six orientations du canon (0x477ec4), du tir (0x477edc) et de la fin du recul (0x477ef4). */
const CANNON_AIM = [1, 4, 7, 34, 41, 47] as const;
const CANNON_FIRE = [29, 30, 31, 39, 44, 51] as const;
const CANNON_END = [3, 6, 9, 40, 46, 52] as const;
/** 0x477f0c : point de mise à feu (la mèche) de chaque orientation. */
const CANNON_FUSE = [
  [36, 18],
  [43, 14],
  [12, 47],
  [64, 18],
  [58, 14],
  [83, 48],
] as const;
/** 0x477f18 : position du boulet par rapport au canon ; 0x477f48 : sa vitesse (vy négée) ; 0x477f78 : son recul. */
const BALL_AT = [
  [98, 8],
  [114, 34],
  [81, -25],
  [-18, 8],
  [-26, 34],
  [6, -25],
] as const;
const BALL_SPEED = [
  [9216, 4096],
  [12288, 1024],
  [3072, 8192],
  [-9216, 4096],
  [-12288, 1024],
  [-3072, 8192],
] as const;
const BALL_BACK = [
  [18, 8],
  [24, 2],
  [6, 16],
  [-18, 8],
  [-24, 2],
  [-6, 16],
] as const;

/**
 * Orientation du canon : dernière des six dont l'image de visée vaut l'image donnée. Sans correspondance, l'exe garde
 * la valeur d'un registre non initialisé ; on prend 0 (et on le note).
 */
function cannonAim(world: World, frame: number): number {
  let aim = -1;
  for (let i = 0; i < 6; i++) if (stateFrame(world, 0x12, CANNON_AIM[i]!) === frame) aim = i;
  if (aim < 0) {
    world.note(`canon : image ${frame} hors des six orientations`);
    aim = 0;
  }
  return aim;
}

/** 440718 : slot 2 : polygone et point de mise à feu de l'orientation (d'après l'image courante). */
function cannonReset(world: World, p: Part): void {
  const i = cannonAim(world, p.frame);
  usePolygon(world, p, i);
  setAnchor(p, 4, CANNON_FUSE[i]![0], CANNON_FUSE[i]![1]);
}

/** 4407d3 : slot 1 : allumé, la mèche brûle jusqu'au tir (boulet 43 dans les mobiles), puis le canon recule. */
function cannonRun(world: World, p: Part): void {
  heat(p);
  if (p.f24 === 0) return;
  const i = cannonAim(world, p.editFrame);
  if (stateFrame(world, 0x12, CANNON_END[i]!) === p.frame) return;
  p.frame++;
  updateGeometry(world, p);
  if (stateFrame(world, 0x12, CANNON_FIRE[i]!) !== p.frame) return;
  const ball = recyclePart(world, 0x2b);
  if (!ball) return;
  insertCreated(world, world.mobiles, ball);
  ball.px = (BALL_AT[i]![0] + p.px) | 0;
  ball.prevPx = (ball.px - BALL_BACK[i]![0]) | 0;
  ball.vx = BALL_SPEED[i]![0];
  ball.py = (BALL_AT[i]![1] + p.py) | 0;
  ball.prevPy = (BALL_BACK[i]![1] + ball.py) | 0;
  ball.vy = -BALL_SPEED[i]![1] | 0;
  clampVelocity(ball, world.types);
  placeAt(world, ball, ball.px, ball.py);
}

// ---------------------------------------------------------------------------------------------------------------------
// Fusée (36).

/** États de la fusée par orientation : repos (0x477fe8), départ (0x477ff4), poussée (0x478000), boucle (0x47800c), fin (0x478018). */
const ROCKET_IDLE = [2, 12, 25] as const;
const ROCKET_START = [17, 18, 21] as const;
const ROCKET_THRUST = [9, 14, 23] as const;
const ROCKET_LOOP = [8, 15, 24] as const;
const ROCKET_END = [12, 25, -1] as const;
/** 0x478024 : point de mise à feu par orientation. */
const ROCKET_FUSE = [
  [42, 80],
  [4, 42],
  [80, 42],
] as const;
/** Rectangle de la flamme par orientation (x0, x1, y0, y1). */
const ROCKET_FLAME = [
  [0x22, 0x31, 0x3c, 0x60],
  [-0xa, 0x17, 0x23, 0x32],
  [0x3c, 0x60, 0x22, 0x31],
] as const;

function rocketDir(world: World, p: Part): number {
  return orientation(world, 0x24, p, ROCKET_IDLE[1], ROCKET_IDLE[2]);
}

/** 4425e4 : slot 2 : point de mise à feu et polygone de l'orientation (d'après l'image d'édition). */
function rocketReset(world: World, p: Part): void {
  const i = rocketDir(world, p);
  setAnchor(p, 4, ROCKET_FUSE[i]![0], ROCKET_FUSE[i]![1]);
  usePolygon(world, p, i);
}

/**
 * 442458 : slot 1. Allumée, la fusée passe au départ puis pousse en crachant du feu. Éteinte, elle s'agite de temps en
 * temps (compte à rebours global 0x477fe4 relancé à 40 … 239 pas, 4520a4), avec les animations décoratives.
 */
function rocketRun(world: World, p: Part): void {
  heat(p);
  const i = rocketDir(world, p);
  const t = 0x24;
  if (p.f24 !== 0) {
    const start = stateFrame(world, t, ROCKET_START[i]!);
    if (start > p.frame) p.frame = start;
    else p.frame++;
    if (stateFrame(world, t, ROCKET_END[i]!) === p.frame) {
      if (world.animFlags & 1) p.frame = stateFrame(world, t, ROCKET_LOOP[i]!);
      else p.frame = (p.frame - 2) | 0;
    }
    const pushing = stateFrame(world, t, ROCKET_THRUST[i]!) <= p.frame;
    if (pushing) thrust(world, p, i);
    updateGeometry(world, p);
    if (stateFrame(world, t, ROCKET_THRUST[i]!) <= p.frame) {
      const r = ROCKET_FLAME[i]!;
      flame(world, p, r[0], r[1], r[2], r[3]);
    }
    return;
  }
  if (!(world.animFlags & 1)) return;
  const idle = stateFrame(world, t, ROCKET_IDLE[i]!);
  if (idle !== p.frame) {
    p.frame++;
    if (stateFrame(world, t, ROCKET_START[i]!) === p.frame) p.frame = idle;
  }
  const g = pyroGlobals(world);
  g.rocketTimer = (g.rocketTimer - 1) | 0;
  if (g.rocketTimer > 0) return;
  p.frame++;
  g.rocketTimer = (world.rng.next() % 200) + 0x28;
}

// ---------------------------------------------------------------------------------------------------------------------
// Missile (70).

/** États du missile par orientation : départ (0x478198), poussée (0x4781a4), boucle (0x4781b0), fin (0x4781bc). */
const MISSILE_START = [2, 13, 18] as const;
const MISSILE_THRUST = [4, 15, 20] as const;
const MISSILE_LOOP = [3, 16, 21] as const;
const MISSILE_END = [12, 17, 22] as const;
/** 0x4781c8 : point de mise à feu ; 0x4781d0 : rectangle de la flamme (x0, x1, y0, y1). */
const MISSILE_FUSE = [
  [47, 92],
  [2, 47],
  [94, 47],
] as const;
const MISSILE_FLAME = [
  [39, 54, 71, 105],
  [-12, 24, 40, 55],
  [90, 125, 39, 54],
] as const;
/** 0x478200 / 0x478230 : positions des quatre explosions, par explosion puis par orientation. */
const MISSILE_BLAST_X = [
  [-15, 60, 10],
  [15, 60, 10],
  [0, 80, -10],
  [0, 40, 20],
] as const;
const MISSILE_BLAST_Y = [
  [-10, -1, -1],
  [-10, 39, 39],
  [-30, 19, 19],
  [10, 19, 19],
] as const;

function missileDir(world: World, p: Part): number {
  return orientation(world, 0x46, p, MISSILE_START[1], MISSILE_START[2]);
}

/** 445be7 : le missile explose : quatre explosions (41) autour de lui ; image de fin (détruit au slot 1 suivant). */
function explodeMissile(world: World, p: Part): void {
  const i = missileDir(world, p);
  for (let k = 0; k < 4; k++) {
    const e = recyclePart(world, 0x29);
    if (!e) break;
    insertCreated(world, world.statics, e);
    placeAt(world, e, (MISSILE_BLAST_X[k]![i]! + p.px) | 0, (MISSILE_BLAST_Y[k]![i]! + p.py) | 0);
  }
  p.frame = stateFrame(world, 0x46, MISSILE_END[i]!);
}

/** 4458f8 : slot 0 : touché pendant qu'il vole (image après le début de la boucle), il explose. */
function missileAccept(world: World, self: Part, arg: unknown): number {
  const m = arg && typeof arg === "object" ? (arg as Part) : self;
  const c = m.contact!;
  if (stateFrame(world, 0x46, MISSILE_LOOP[missileDir(world, c)]!) < c.frame) explodeMissile(world, c);
  return 1;
}

/** 445a89 : slot 2 : point de mise à feu et polygone de l'orientation. */
function missileReset(world: World, p: Part): void {
  const i = missileDir(world, p);
  setAnchor(p, 4, MISSILE_FUSE[i]![0], MISSILE_FUSE[i]![1]);
  usePolygon(world, p, i);
}

/**
 * 445944 : slot 1 : allumé, le missile part, pousse et crache du feu ; il explose au premier contact (pas posé), +0x24
 * servant de délai (décompté tant qu'il dépasse 1). À l'image de fin, il disparaît.
 */
function missileRun(world: World, p: Part): void {
  const i = missileDir(world, p);
  const t = 0x46;
  heat(p);
  if (p.f24 === 0) return;
  const end = stateFrame(world, t, MISSILE_END[i]!);
  if (end === p.frame) {
    p.flags10 |= F10.GONE;
    return;
  }
  p.frame++;
  if (end === p.frame) p.frame = stateFrame(world, t, MISSILE_LOOP[i]!);
  if (p.f24 > 1) p.f24--;
  else if (stateFrame(world, t, MISSILE_LOOP[i]!) <= p.frame && p.contact && !(p.flags0C & 1)) explodeMissile(world, p);
  if (stateFrame(world, t, MISSILE_THRUST[i]!) <= p.frame) thrust(world, p, i);
  updateGeometry(world, p);
  if (stateFrame(world, t, MISSILE_THRUST[i]!) <= p.frame) {
    const r = MISSILE_FLAME[i]!;
    flame(world, p, r[0], r[1], r[2], r[3]);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Feux d'artifice (80).

/** États par modèle : 0x478290 (montée), 0x47829c (gerbe), 0x4782a8 (explosion), 0x4782b4 (modèle suivant / fin). */
const FIREWORK_RISE = [10, 14, 17] as const;
const FIREWORK_BURST = [11, 15, 18] as const;
const FIREWORK_BLAST = [6, 7, 8] as const;
const FIREWORK_NEXT = [12, 16, -1] as const;

/** 44676c : slot 2 : point de mise à feu et polygone. */
function fireworkReset(world: World, p: Part): void {
  setAnchor(p, 4, 0xd, 0x4b);
  usePolygon(world, p, 0);
}

/**
 * 446849 : slot 1 : allumé, la fusée monte (au plus haut à y = 39) en crachant du feu ; après 20 pas (+0x24 sert de
 * compteur) ou au plafond, elle éclate : les moteurs à souris proches se lancent, puis elle disparaît.
 */
function fireworkRun(world: World, p: Part): void {
  const t = 0x50;
  const i = p.frame < stateFrame(world, t, FIREWORK_NEXT[0]) ? 0 : p.frame < stateFrame(world, t, FIREWORK_NEXT[1]) ? 1 : 2;
  heat(p);
  if (p.f24 === 0) return;
  p.frame++;
  const blast = stateFrame(world, t, FIREWORK_BLAST[i]!);
  if (blast === p.frame) p.frame = stateFrame(world, t, FIREWORK_BURST[i]!);
  if (blast <= p.frame) {
    updateGeometry(world, p);
    nearby(world, p, LIST_MOBILE, -0xa, 0xa, -0xa, 0xa);
    for (const q of chain(p)) if (q.type === 6) startMouseMotor(world, q);
    p.vx = p.vy = 0;
    if (stateFrame(world, t, FIREWORK_NEXT[i]!) === p.frame) {
      p.frame--;
      p.flags10 |= F10.GONE;
    }
  } else if (stateFrame(world, t, FIREWORK_RISE[i]!) <= p.frame) {
    p.contact = null;
    p.vy = (p.vy - 0x800) | 0;
    if (p.vy < -0x2000) p.vy = -0x2000;
    if (p.py < 0x28) {
      p.py = 0x27;
      p.f24 = 0x28;
    }
    p.f24++;
    if (p.f24 > 0x14) p.frame = blast;
    flame(world, p, 5, 0x15, 0x38, 0x5e);
  }
  updateGeometry(world, p);
}

/**
 * Slot 3 (édition) : l'action 15 tourne d'un cran (les autres sont ignorées), puis l'image devient l'image d'édition,
 * slot 2 et géométrie. Les appels d'affichage et 439695 (rafraîchissement des cordes et courroies attachées) sont
 * laissés à l'éditeur (vague U).
 */
function editAndReset(world: World, p: Part, reset: (w: World, p: Part) => void): void {
  p.editFrame = p.frame;
  reset(world, p);
  updateGeometry(world, p);
}

/** 4408dc : canon : orientations 0 → 1 → 4 → 3 → 5 → 2 → 0 (images de visée). */
function cannonEdit(world: World, p: Part, action: number): void {
  if (action === 0xf) {
    const aim = CANNON_AIM.map((s) => stateFrame(world, 0x12, s));
    const next = [1, 4, 0, 5, 3] as const;
    const k = aim.slice(0, 5).indexOf(p.frame);
    p.frame = aim[k === -1 ? 2 : next[k]!]!;
  }
  editAndReset(world, p, cannonReset);
}

/** 4426ee : fusée : haut → droite → gauche → haut (images de repos). */
function rocketEdit(world: World, p: Part, action: number): void {
  if (action === 0xf) {
    const idle = ROCKET_IDLE.map((s) => stateFrame(world, 0x24, s));
    p.frame = p.frame === idle[0] ? idle[1]! : p.frame === idle[1] ? idle[2]! : idle[0]!;
  }
  editAndReset(world, p, rocketReset);
}

/** 445b6f : missile : orientation suivante (image de départ). */
function missileEdit(world: World, p: Part, action: number): void {
  if (action === 0xf) p.frame = stateFrame(world, 0x46, MISSILE_START[(missileDir(world, p) + 1) % 3]!);
  editAndReset(world, p, missileReset);
}

export function register(r: HandlerRegistry): void {
  r.register(0x4408dc, "cannon.edit", (w, p, a) => cannonEdit(w, p, typeof a === "number" ? a : 0));
  r.register(0x4426ee, "rocket.edit", (w, p, a) => rocketEdit(w, p, typeof a === "number" ? a : 0));
  r.register(0x445b6f, "missile.edit", (w, p, a) => missileEdit(w, p, typeof a === "number" ? a : 0));
  r.register(0x440718, "cannon.reset", (w, p) => cannonReset(w, p));
  r.register(0x4407d3, "cannon.run", (w, p) => cannonRun(w, p));
  r.register(0x4425e4, "rocket.reset", (w, p) => rocketReset(w, p));
  r.register(0x442458, "rocket.run", (w, p) => rocketRun(w, p));
  r.register(0x4458f8, "missile.accept", (w, p, a) => missileAccept(w, p, a));
  r.register(0x445a89, "missile.reset", (w, p) => missileReset(w, p));
  r.register(0x445944, "missile.run", (w, p) => missileRun(w, p));
  r.register(0x44676c, "firework.reset", (w, p) => fireworkReset(w, p));
  r.register(0x446849, "firework.run", (w, p) => fireworkRun(w, p));
}
