/**
 * Objets simples du groupe `misc` : ballon (4), panier à linge (11), aquarium (15), punaise (53), boîtes (71) et
 * cheville (72). Traduit de TIMWIN.EXE 43f1c8 … 43f9b5 (4, 11), 440364 … 440454 (15), 444320 … 444489 (53),
 * 445cbc … 445db6 (71, 72). Sans équivalent dans OpenTIM (pièces propres à TIM3, ou trop différentes de TEMIM).
 *
 * Besoins de noyau (vague Φ2, groupe `mechanics`) :
 * - le slot 5 (43f40b, 43f9b5, 445db6) est appelé par la tension des cordes (`World.pull`, 43a8f1) avec la signature
 *   commune `(world, soi, autre, emplacement, mode, masse, quantité de mouvement)`.
 */
import { type Part } from "../../part";
import { insertCreated, recyclePart } from "../../zone";
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { TypeTable } from "../../types";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { stateFirst } from "./anim";

/** +0xB0 / +0xB1 de la pièce : ancrage de la corde (x, y) en pixels, fixé par le slot 2 du type. */
export function anchorOf(p: Part): [number, number] {
  return [p.ropeAnchor[0]!, p.ropeAnchor[1]!];
}

const setAnchor = (p: Part, x: number, y: number): void => {
  p.ropeAnchor[0] = x;
  p.ropeAnchor[1] = y;
};

/** Polygone n° `index` du type de la pièce, angles des côtés recalculés (… 439e38). */
function setPoly(world: World, p: Part, index: number): void {
  p.poly = world.types.get(p.type).polygons![index]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

// ---------------------------------------------------------------------------------------------------------------
// Réaction commune aux pièces au bout d'une corde : ballon (43f40b), panier (43f9b5), cheville (445db6).

/**
 * 43f40b / 43f9b5 / 445db6 (slot 5) : `other` = pièce qui tire, `self` = pièce accrochée, `mode` (1 : tension simple,
 * 2 : arrachement du panier), `momentum` = quantité de mouvement de `other`. Rend 1 si la corde tient (la pièce
 * accrochée est plus lourde que l'effort), 0 si elle cède. Les paniers (11) enfoncent leur position de 20 px au mode 2.
 */
export function reactToCollision(world: World, other: Part, self: Part, mode: number, momentum: number, basket: boolean): number {
  if (mode === 1) {
    const rope = self.ropes[0];
    if (rope) rope.n18 = (rope.n18 + 1) | 0;
    return 0;
  }
  // Bascules (3) et 0x8b : seuil simple ; autres pièces : le double.
  if (other.type === 3 || other.type === 0x8b) {
    if (momentum < self.momentum) return 1;
  } else if (momentum < ((self.momentum + self.momentum) | 0)) return 1;
  if (basket && mode === 2) {
    self.py = (self.py - 0x14) | 0;
    self.f24 = (self.f24 + 1) | 0;
    updateGeometry(world, self);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Ballon (4)

/** 43f1c8 : image → polygone et ancrage (état 0, 2, 4 ou autre), angles des côtés. */
function balloonReset(world: World, p: Part): void {
  const a2 = stateFirst(world, 4, 2);
  const a4 = stateFirst(world, 4, 4);
  let idx = 3;
  if (p.frame === 0) idx = 0;
  else if (p.frame === a2) idx = 1;
  else if (p.frame === a4) idx = 2;
  const ANCHOR = [[0x10, 0x2d], [0x15, 0x2e], [0x16, 0x2e], [0x11, 0x23]] as const; // 0x477e30
  setAnchor(p, ANCHOR[idx]![0], ANCHOR[idx]![1]);
  setPoly(world, p, idx);
}

/** 43f2b4 : une balle de phazer (20) qui touche le ballon le fait éclater (+0x24 = 1). */
function balloonAccept(_w: World, p: Part, arg?: number | Part | null): number {
  const toucher = typeof arg === "object" && arg ? arg : p;
  if (toucher.type === 0x14) (toucher.contact ?? p).f24 = 1;
  return 1;
}

/**
 * 43f2d4 : un ballon éclaté (+0x24 ≠ 0) avance son animation ; à la fin (un état commence à l'image suivante), il
 * disparaît. À l'éclatement, une corde (+0xA8) reprendrait un bout de corde (432d00(0x31)) : voir `spawnRopeEnd`.
 */
function balloonRun(world: World, p: Part): void {
  if (p.f24 === 0) return;
  p.flags10 |= 0x40;
  if (p.frame === p.editFrame) p.frame++;
  else {
    p.frame++;
    if (world.types.anims[4]?.stateAt(p.frame) !== 0) {
      p.frame--;
      // 43087b(p, 3) : zone à redessiner (affichage).
      p.flags10 |= 0x2000;
    }
  }
  if (p.flags10 & 0x2000) return;
  if (p.f24 === 1 && p.ropes[0]) spawnRopeEnd(world, p);
  updateGeometry(world, p);
}

/**
 * 43f34d … 43f3f7 : crée un bout de corde (type 0x31, 432d00) à la place du ballon, l'insère dans les mobiles (4393e0),
 * lui passe la corde (+0xA8) et le lien (+0x90, et le lien retour 43a093), le place à l'extrémité de la corde, puis
 * détache le ballon (+0xA8 et +0x90 à 0).
 */
function spawnRopeEnd(world: World, p: Part): void {
  const rope = p.ropes[0]!;
  const end = recyclePart(world, 0x31);
  if (!end) return;
  insertCreated(world, world.mobiles, end);
  end.ropes[0] = rope;
  const link = p.links[0] ?? null;
  end.links[0] = link;
  if (link) {
    const i = link.links[0] === p ? 0 : link.links[1] === p ? 1 : -1;
    if (i !== -1) link.links[i] = end;
  }
  if (p === rope.end1) {
    rope.end1 = end;
    end.px = rope.ends[0]!;
    end.py = rope.ends[1]!;
  } else {
    rope.end2 = end;
    end.px = rope.ends[2]!;
    end.py = rope.ends[3]!;
  }
  end.fx = end.px << 9;
  end.fy = end.py << 9;
  updateGeometry(world, end);
  p.ropes[0] = null;
  p.links[0] = null;
}

// ---------------------------------------------------------------------------------------------------------------
// Panier à linge (11)

/** 43f954 : ancrage (0x1f, 2), polygone 0. */
function basketReset(world: World, p: Part): void {
  setAnchor(p, 0x1f, 2);
  setPoly(world, p, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Aquarium (15)

interface TankStates {
  /** 0x481660 : première image d'un état (de 1 à …) ; 0x481db8 : la suivante. */
  a: number;
  b: number;
}
const tankCache = new WeakMap<TypeTable, TankStates>();

function tankStates(world: World): TankStates {
  let s = tankCache.get(world.types);
  if (!s) {
    const anim = world.types.anims[15]!;
    let i = 1;
    while (anim.stateAt(i) === 0) i++;
    const a = i;
    i++;
    while (anim.stateAt(i) === 0) i++;
    s = { a, b: i };
    tankCache.set(world.types, s);
  }
  return s;
}

/** 440364 : polygone 0 (les images de l'état sont cherchées une fois, `tankStates`). */
function tankReset(world: World, p: Part): void {
  tankStates(world);
  setPoly(world, p, 0);
}

/** 4403ca : un objet qui touche l'aquarium encore au repos le fait basculer vers l'image d'eau (440454) et passe à travers. */
function tankAccept(world: World, p: Part, arg?: number | Part | null): number {
  const tank = (typeof arg === "object" && arg ? arg.contact : null) ?? p;
  const { a } = tankStates(world);
  if (tank.frame >= a) return 1;
  // 440454
  if (tank.frame < a) {
    tank.frame = a;
    tank.poly = null;
    updateGeometry(world, tank);
  }
  return 0;
}

/** 4403f3 : avant l'impact, l'eau ondule (images 0 … a − 1) ; après, l'image avance d'un pas sur deux jusqu'à l'état b. */
function tankRun(world: World, p: Part): void {
  const { a, b } = tankStates(world);
  if (p.frame < a) {
    if (world.animFlags & 1) {
      p.frame++;
      if (p.frame === a) p.frame = 0;
    }
  } else if (p.frame !== b) {
    if (p.f104 !== 0) p.frame++;
    p.f104 = 1;
  }
  if (p.frame !== p.framePrev) updateGeometry(world, p);
}

// ---------------------------------------------------------------------------------------------------------------
// Punaise (53)

interface TackStates {
  /** 0x481ec0 … 0x481ecc : premières images des états 6, 8, 11 et 13. */
  s6: number;
  s8: number;
  s11: number;
  s13: number;
}
const tackCache = new WeakMap<TypeTable, TackStates>();

function tackStates(world: World): TackStates {
  let s = tackCache.get(world.types);
  if (!s) {
    s = {
      s6: stateFirst(world, 53, 6),
      s8: stateFirst(world, 53, 8),
      s11: stateFirst(world, 53, 11),
      s13: stateFirst(world, 53, 13),
    };
    tackCache.set(world.types, s);
  }
  return s;
}

/** 444489 : orientation de la punaise (0 … 3) d'après son image. */
export function tackOrientation(world: World, p: Part): number {
  const s = tackStates(world);
  if (p.frame < s.s8) return 0;
  if (p.frame < s.s11) return 1;
  if (p.frame < s.s13) return 2;
  return 3;
}

/** 0x4780c0 : angle (mots de 16 bits) du côté piquant selon l'orientation. */
const TACK_ANGLE = [0x4000, 0xc000, 0x0000, 0x8000] as const;

/**
 * 444320 : un ballon (4), une balle de TIM (0x4f) ou 0x6d qui arrive par la pointe (côté 2, sommet touché, angle du côté
 * dans le demi-cercle d'ouverture) éclate : +0x24 de la pièce touchante = 1 (2 pour 0x4f). Rend 1.
 */
function tackAccept(world: World, p: Part, arg?: number | Part | null): number {
  const toucher = typeof arg === "object" && arg ? arg : null;
  if (!toucher) return 1;
  const tack = toucher.contact ?? p;
  if (toucher.type === 4 || toucher.type === 0x4f || toucher.type === 0x6d) {
    const angle = (toucher.contactAngle + TACK_ANGLE[tackOrientation(world, tack)]!) & 0xffff;
    if (!(angle & 0x8000) && toucher.contactIndex === 2 && toucher.flags10 & 0x1000) toucher.f24 = toucher.type === 0x4f ? 2 : 1;
  }
  return 1;
}

/** 444390 : polygone de l'orientation courante. */
function tackReset(world: World, p: Part): void {
  setPoly(world, p, tackOrientation(world, p));
}

/** 444417 : rotation d'un quart (action 15) : l'image passe à l'orientation suivante ; puis polygone. */
function tackEdit(world: World, p: Part, arg?: number | Part | null): void {
  if (arg === 0xf) {
    const s = tackStates(world);
    switch (tackOrientation(world, p)) {
      case 0:
        p.frame = s.s13;
        break;
      case 1:
        p.frame = s.s11;
        break;
      case 2:
        p.frame = s.s6;
        break;
      default:
        p.frame = s.s8;
    }
  }
  p.editFrame = p.frame;
  tackReset(world, p);
  // 43087b, 439695 : zones à redessiner (affichage).
}

// ---------------------------------------------------------------------------------------------------------------
// Boîtes (71) et cheville (72)

/** 445cbc : polygone de l'image courante. */
function boxReset(world: World, p: Part): void {
  setPoly(world, p, p.frame);
}

/** 0x478260 / 0x47826a : ancrage (x, y) de la corde selon l'image, normal puis retourné en X. */
const PEG_ANCHOR = [[0x0d, 7], [0x0d, 6], [0x0d, 5], [0x0c, 5], [0x0b, 5]] as const;
const PEG_ANCHOR_FLIPPED = [[2, 7], [2, 6], [2, 5], [3, 5], [4, 5]] as const;

const pegCache = new WeakMap<TypeTable, number>();

function pegLast(world: World): number {
  let v = pegCache.get(world.types);
  if (v === undefined) {
    const anim = world.types.anims[72]!;
    let i = 2;
    while (anim.stateAt(i) === 0) i++;
    v = i - 1;
    pegCache.set(world.types, v);
  }
  return v;
}

/** 445d52 : ancrage selon l'image (au plus 4) et le retournement. */
function pegReset(world: World, p: Part): void {
  pegLast(world);
  const i = Math.min(p.frame, 4);
  const [x, y] = (p.flags10 & 0x10 ? PEG_ANCHOR_FLIPPED : PEG_ANCHOR)[i]!;
  setAnchor(p, x, y);
}

/** 445d2c : l'image avance jusqu'à la dernière de l'état ; géométrie et ancrage suivent. */
function pegRun(world: World, p: Part): void {
  if (p.frame === pegLast(world)) return;
  p.frame++;
  updateGeometry(world, p);
  pegReset(world, p);
}

export function registerObjects(r: HandlerRegistry): void {
  // Ballon
  r.register(0x43f1c8, "balloon.reset", (w, p) => balloonReset(w, p));
  r.register(0x43f2b4, "balloon.accept", (w, p, a) => balloonAccept(w, p, a));
  r.register(0x43f2d4, "balloon.run", (w, p) => balloonRun(w, p));
  r.register(0x43f40b, "balloon.collision", (w, p, a, _slot = 0, flags = 0, _mass = 0, force = 0) => reactToCollision(w, a as Part, p, flags, force, false));
  // Panier à linge
  r.register(0x43f954, "basket.reset", (w, p) => basketReset(w, p));
  r.register(0x43f9b5, "basket.collision", (w, p, a, _slot = 0, flags = 0, _mass = 0, force = 0) => reactToCollision(w, a as Part, p, flags, force, true));
  r.register(0x43f986, "basket.draw", () => undefined);
  // Aquarium
  r.register(0x440364, "tank.reset", (w, p) => tankReset(w, p));
  r.register(0x4403ca, "tank.accept", (w, p, a) => tankAccept(w, p, a));
  r.register(0x4403f3, "tank.run", (w, p) => tankRun(w, p));
  // Punaise
  r.register(0x444320, "tack.accept", (w, p, a) => tackAccept(w, p, a));
  r.register(0x444390, "tack.reset", (w, p) => tackReset(w, p));
  r.register(0x444417, "tack.edit", (w, p, a) => tackEdit(w, p, a));
  // Boîtes
  r.register(0x445cbc, "boxes.reset", (w, p) => boxReset(w, p));
  r.register(0x445ce0, "boxes.draw", () => undefined);
  // Cheville
  r.register(0x445d2c, "peg.run", (w, p) => pegRun(w, p));
  r.register(0x445d52, "peg.reset", (w, p) => pegReset(w, p));
  r.register(0x445db6, "peg.collision", (w, p, a, _slot = 0, flags = 0, _mass = 0, force = 0) => reactToCollision(w, a as Part, p, flags, force, false));
}
