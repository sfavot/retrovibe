/**
 * Tapis roulant (5). Traduit de TIMWIN.EXE 43f49c (slot 7), 43f50d (slot 2), 43f580 (slot 0), 43f638 (slot 1),
 * 43f6fa (slot 4). Pas d'équivalent direct dans OpenTIM pour TIM3 (le tapis de TEMIM est dans `src/parts/mod.rs`, avec
 * une autre animation) ; le binaire fait foi.
 */
import { s16 } from "../../fixed";
import { computeEdgeAngles } from "../../move";
import type { Part } from "../../part";
import type { TypeTable } from "../../types";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { otherBeltEnd } from "./belt";

/** 0x477e60 : rayon de poulie (+0x8C) par taille ; 0x477e38 : centre de poulie (+0x88, +0x89), pas de 8 octets. */
const PULLEY_RADIUS = [7, 6, 6, 7, 6] as const;
const PULLEY_CENTRE = [
  [16, 8],
  [23, 9],
  [32, 9],
  [41, 8],
  [47, 9],
] as const;

/**
 * 43f49c (slot 7, initialisation) : pour chaque taille i (0 … 4), première image de la boucle (0x481d50[i]) et image de
 * retour (0x481d68[i]), en suivant les débuts d'états de l'ANM (44b19c) ; 0x481d50[5] = fin de la dernière boucle.
 */
interface ConveyorFrames {
  first: number[];
  loop: number[];
}
const framesCache = new WeakMap<TypeTable, ConveyorFrames>();

export function stateRuns(types: TypeTable, type: number, count: number): ConveyorFrames {
  let f = framesCache.get(types);
  if (f && type === 5) return f;
  const anim = types.anims[type];
  const starts = (i: number) => (anim ? anim.stateAt(i) : -1) !== 0;
  f = { first: [], loop: [] };
  let n = 0;
  for (let i = 0; i < count; i++) {
    f.first[i] = n;
    do n = (n + 1) | 0;
    while (n !== 0 && !starts(n));
    f.loop[i] = n;
    do n = (n + 1) | 0;
    while (n !== 0 && !starts(n));
  }
  f.first[count] = n;
  if (type === 5) framesCache.set(types, f);
  return f;
}

const sizeIndex = (w: number) => ((w - 0x20) / 16) | 0;

/** 43f50d (slot 2) : image, poulie et polygone selon la largeur (+0x7C), sens (+0x24) à 0. */
export function conveyorReset(world: World, p: Part): void {
  const i = sizeIndex(p.boxW);
  const f = stateRuns(world.types, 5, 5);
  p.frame = p.editFrame = f.first[i]!;
  p.f8C = PULLEY_RADIUS[i]!;
  p.f24 = p.editF24 = 0;
  p.f88 = PULLEY_CENTRE[i]![0];
  p.f89 = PULLEY_CENTRE[i]![1];
  p.poly = world.types.get(5).polygons![i]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** 43f580 (slot 0) : une pièce posée dessus prend la vitesse du tapis (±|sens| << 11), sur le dessus ou le dessous. */
function conveyorAccept(_w: World, _p: Part, arg?: number | Part | null): number {
  const c = arg as Part;
  const dir = c.contact!.f24;
  const top = (c.contactIndex === 0 && !(c.flags10 & 0x1000)) || (s16(c.contactAngle) >= -0x800 && s16(c.contactAngle) <= 0x800);
  const v = (dir < 0 ? -dir : dir) << 11;
  if (top) {
    if (dir > 0) {
      c.vx = (c.vx + v) | 0;
      if (v < c.vx) c.vx = v;
    } else if (dir < 0) {
      c.vx = (c.vx - v) | 0;
      if (v > c.vx) c.vx = -v | 0;
    }
  } else if (c.contactIndex === 2 && !(c.flags10 & 0x1000)) {
    if (dir < 0) {
      c.vx = (c.vx + v) | 0;
      if (v < c.vx) c.vx = v;
    } else if (dir > 0) {
      c.vx = (c.vx - v) | 0;
      if (v > c.vx) c.vx = -v | 0;
    }
  }
  return 1;
}

/** 43f638 (slot 1) : s'arrête si l'engrenage qui l'entraîne (courroie) est immobile ; sinon fait tourner l'image. */
function conveyorRun(world: World, p: Part): void {
  if (p.f24 !== 0) {
    const q = otherBeltEnd(p);
    if (q && (q.type === 0x0e || q.type === 0x56) && q.framePrev === q.framePrev2) p.f24 = 0;
  }
  if (p.f24 === 0) return;
  const i = sizeIndex(p.frameW);
  const f = stateRuns(world.types, 5, 5);
  if (p.f24 > 0) {
    p.frame++;
    if (f.first[i + 1] === p.frame) {
      if (world.animFlags & 1) p.frame = f.loop[i]!;
      else p.frame -= 2;
    }
  } else if (f.loop[i] === p.frame || f.first[i] === p.frame) {
    if (world.animFlags & 1) p.frame = f.first[i + 1]! - 1;
    else p.frame = f.first[i]! + 2;
  } else p.frame--;
}

export function register(r: HandlerRegistry): void {
  r.register(0x43f49c, "conveyor.init", (w, p) => {
    stateRuns(w.types, 5, 5);
    if (p) conveyorReset(w, p);
    return 1;
  });
  r.register(0x43f50d, "conveyor.reset", (w, p) => conveyorReset(w, p));
  r.register(0x43f580, "conveyor.accept", conveyorAccept);
  r.register(0x43f638, "conveyor.run", (w, p) => conveyorRun(w, p));
  r.register(0x43f6fa, "conveyor.resize", (w, p) => {
    p.frameW = p.boxW;
    p.frameH = p.boxH;
    conveyorReset(w, p);
  });
}
