/**
 * Seau (17) et seau qui fuit (108) : contenu, masse, entraînement du contenu ; réaction à la corde.
 * Traduit de TIMWIN.EXE 43518f, 43ab9a, 43abe8, 435309 (passes du noyau dans 433334), 440660 (slot 2), 4406c1 et 4477b9
 * (slot 5), 4476df (slot 1 du seau qui fuit), 44764c (slot 2). Correspondance OpenTIM (GPL-3.0, TEMIM) :
 * `c_src/main.c` `bucket_handle_contained_parts`, `bucket_add_mass`, `bucket_add_mass_of_contained`,
 * `bucket_move_contained` (mêmes passes, autres bornes).
 */
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { TypeTable } from "../../types";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";

const isBucket = (p: Part) => p.type === 0x11 || p.type === 0x6c;

/**
 * 43518f : refait la chaîne du contenu (+0xC4). Une mobile y entre si son point bas (milieu de l'image, ou point propre
 * aux types 36 et 70) est entre les bords du seau (x + 4 … x + 32) et, soit elle est posée sur le seau en tombant, soit
 * ce point est dans le seau (y + 20 … y + hauteur + 4). Elle prend alors la vitesse du seau et +0x14 & 0x10.
 */
export function gatherContents(world: World, b: Part): void {
  if (!isBucket(b)) return;
  b.bucketNext = null;
  const left = (b.prevPx + 4) | 0;
  const right = (left + 0x1c) | 0;
  const top = b.prevPy;
  const bottom = (top + b.frameH) | 0;
  const level = (b.py + 0x14) | 0;
  for (const p of world.mobiles) {
    if (p === b || p.flags10 & 0x2000 || p.flags14 & 0x4000 || p.type === 0x0b) continue;
    let x: number;
    let y: number;
    if (p.type === 0x24) {
      x = (p.prevPx + 0x2a) | 0;
      y = (p.prevPy + 0x3d) | 0;
    } else if (p.type === 0x46) {
      x = (p.prevPx + 0x2f) | 0;
      y = (p.prevPy + 0x4a) | 0;
    } else {
      x = ((p.frameW >> 1) + p.prevPx) | 0;
      y = (p.prevPy + p.frameH) | 0;
    }
    let inside = p.contact === b && p.vy > 0 && x > left && x < right;
    if (!inside && x > left && x < right && y > ((top + 0x14) | 0) && ((y - 4) | 0) < bottom) inside = true;
    if (!inside) continue;
    p.bucketNext = b.bucketNext;
    b.bucketNext = p;
    p.flags14 |= 0x10;
    p.vx = b.vx;
    p.vy = b.vy;
    p.fFC = level;
  }
}

/** 43abe8 : somme de deux masses, plafonnée à 32 000. */
const addMass = (a: number, b: number) => {
  const s = (a + b) | 0;
  return s > 0x7d00 ? 0x7d00 : s;
};

/** 43ab9a : masse du seau = la sienne + celle du contenu (+ l'eau restante du seau qui fuit, +0x104 / 2). */
export function addContentsMass(_w: World, b: Part): void {
  for (let q = b.bucketNext; q; q = q.bucketNext) b.mass = addMass(b.mass, q.mass);
  if (b.type === 0x6c) b.mass = addMass(b.mass, b.f104 >> 1);
}

/** 435309 : le contenu suit le déplacement en pixels du seau. */
export function moveContents(world: World, b: Part): void {
  if (!isBucket(b)) return;
  const dx = (b.px - b.prevPx) | 0;
  const dy = (b.py - b.prevPy) | 0;
  if (dx === 0 && dy === 0) return;
  for (let q = b.bucketNext; q; q = q.bucketNext) {
    q.px = (q.px + dx) | 0;
    q.py = (q.py + dy) | 0;
    updateGeometry(world, q);
    q.fx = q.px << 9;
    q.fy = q.py << 9;
  }
}

/** 440660 : point d'attache de la corde (0x12, 1), premier polygone. */
function bucketReset(world: World, p: Part): void {
  p.ropeAnchor[0] = 0x12;
  p.ropeAnchor[1] = 1;
  p.poly = world.types.get(p.type).polygons![0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/**
 * 4406c1 / 4477b9 (slot 5, appelé par 43a31d) : mode 1 : compteur +0x18 de la corde. Sinon le seau se laisse tirer
 * (rend 1) si l'effort de la pièce qui tire est inférieur à l'effort du seau (bascule) ou à son double.
 */
export function bucketPull(_w: World, puller: Part, target: Part, flags: number, force: number): number {
  if (flags === 1) {
    const r = target.ropes[0];
    if (r) r.n18 = (r.n18 + 1) | 0;
    return 0;
  }
  if (puller.type === 3 || puller.type === 0x8b) return force < target.momentum ? 1 : 0;
  return force < ((target.momentum + target.momentum) | 0) ? 1 : 0;
}

/** 0x47834c : états d'eau du seau qui fuit ; 0x478334 : quantité d'eau (+0x104) au début de chacun. */
const LEAK_STATES = [4, 5, 6, 7, 8, 9] as const;
const LEAK_WATER = [0, 99, 199, 299, 499, 800] as const;
const leakCache = new WeakMap<TypeTable, number[]>();

/** 44764c (première partie) : 0x481fd4[i] = première image de l'état LEAK_STATES[i] (44b2c0). */
function leakFrames(types: TypeTable): number[] {
  let f = leakCache.get(types);
  if (f) return f;
  const anim = types.anims[0x6c];
  f = LEAK_STATES.map((n) => {
    if (!anim) return 0;
    for (const s of anim.anm.states) if (s.state === 0 || s.state === n) return s.first;
    return 0;
  });
  leakCache.set(types, f);
  return f;
}

/** 44764c (slot 2) : image 1 au moins ; eau selon l'image ; attache (0x10, 1) ; premier polygone. */
function leakyReset(world: World, p: Part): void {
  const f = leakFrames(world.types);
  if (p.frame === 0) p.frame = p.editFrame = 1;
  for (let i = 0; i < 6; i++) if (f[i] === p.frame) p.f104 = LEAK_WATER[i]!;
  p.ropeAnchor[0] = 0x10;
  p.ropeAnchor[1] = 1;
  p.poly = world.types.get(p.type).polygons![0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** 4476df (slot 1) : tant qu'il n'est pas vide, l'eau baisse d'une unité par pas et l'image suit le niveau. */
function leakyRun(world: World, p: Part): void {
  const f = leakFrames(world.types);
  if (p.frame === f[0]) return;
  const w = p.f104;
  const i = w === 0 ? 0 : w < 100 ? 1 : w < 200 ? 2 : w < 300 ? 3 : w < 500 ? 4 : 5;
  p.frame++;
  const s = world.types.anims[0x6c]?.stateAt(p.frame) ?? -1;
  if (s !== 0) p.frame = f[i]!;
  p.f104 = (p.f104 - 1) | 0;
  if (p.f104 < 0) p.f104 = 0;
  updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  r.registerSpecial(0x43518f, "bucket.gather", (w, p) => gatherContents(w, p));
  r.registerSpecial(0x43ab9a, "bucket.mass", (w, p) => addContentsMass(w, p));
  r.registerSpecial(0x435309, "bucket.carry", (w, p) => moveContents(w, p));
  r.register(0x440660, "bucket.reset", (w, p) => bucketReset(w, p));
  const pull = (w: World, p: Part, arg?: number | Part | null, _slot = 0, flags = 0, _mass = 0, force = 0) =>
    bucketPull(w, arg as Part, p, flags, force);
  r.register(0x4406c1, "bucket.pull", pull);
  r.register(0x4477b9, "leakyBucket.pull", pull);
  r.register(0x44764c, "leakyBucket.reset", (w, p) => leakyReset(w, p));
  r.register(0x4476df, "leakyBucket.run", (w, p) => leakyRun(w, p));
  // 440692 / 44778e : dessin (slot 6).
  r.register(0x440692, "bucket.draw", () => undefined);
  r.register(0x44778e, "leakyBucket.draw", () => undefined);
}
