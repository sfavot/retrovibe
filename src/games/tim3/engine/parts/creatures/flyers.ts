/**
 * Chauve-souris Boris (32), Cupidon (33) et Père Noël (34), TIMWIN.EXE 441fe4 … 442210. Ces trois types n'apparaissent dans
 * aucun niveau du jeu : le banc ne peut pas les tracer, la traduction n'est vérifiée que par relecture du désassemblage.
 * Gravité nulle (types 32 et 33 : `docs/tim3/engine.md` § 4). Pas d'équivalent dans OpenTIM.
 */
import { computeEdgeAngles } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { stateAt } from "./kernel";

const BAT = 32;
const CUPID = 33;
const SANTA = 34;

function isPart(a: unknown): a is Part {
  return typeof a === "object" && a !== null;
}

// --- chauve-souris (32) ----------------------------------------------------------------------------------------

/** 441fe4 : slot 2, accrochée (image 0) elle a son polygone ; en vol (image ≠ 0) elle n'en a plus (+0xD8 = 0). */
function batReset(world: World, b: Part): void {
  b.poly = b.frame === 0 ? world.types.get(b.type).polygons![0]! : null;
  if (b.poly) computeEdgeAngles(b.poly, b.vertexCount);
}

/** 442018 : slot 0, touchée, elle se réveille (+0x24 = 1) ; `toucher.contact` est la chauve-souris. */
function batHit(part: Part, arg: unknown): number {
  const toucher = isPart(arg) ? arg : part;
  (toucher.contact ?? part).f24 = 1;
  return 1;
}

/** 442032 : slot 1, éveillée : bat des ailes (images ≥ 1 en boucle) et change de vitesse au hasard (4520a4) tous les 20 … 219 pas. */
function batRun(world: World, b: Part): void {
  if (b.f24 === 0) return;
  b.frame++;
  if (stateAt(world.types, BAT, b.frame) === -1) b.frame = 1;
  b.fFC = (b.fFC - 1) | 0;
  if (b.fFC <= 0) {
    b.fFC = ((world.rng.next() % 200) + 0x14) | 0;
    b.vx = (world.rng.next() & 0x3ff) - 0x200;
    b.vy = (world.rng.next() & 0x3ff) - 0x200;
  }
  batReset(world, b);
}

// --- Cupidon (33) ----------------------------------------------------------------------------------------------

/** 4420b4 : slot 2, polygone selon le retournement. */
function cupidReset(world: World, c: Part): void {
  c.poly = world.types.get(CUPID).polygons![c.flags10 & 0x10 ? 1 : 0]!;
  computeEdgeAngles(c.poly, c.vertexCount);
}

/**
 * 4420e1 : slot 0. Quand Cupidon est lui-même la pièce qui touche (43373c l'appelle sur ses propres contacts), il se
 * retourne ; il touche alors `contact` avec un angle décalé de 0x8000. Un ballon (4, 79, 109) touché par le bon côté (selon le
 * retournement) éclate : +0x24 = 1 (2 pour le type 79).
 */
function cupidHit(world: World, part: Part, arg: unknown): number {
  const e = isPart(arg) ? arg : part;
  let cupid: Part;
  let target: Part;
  let angle: number;
  if (e.type === CUPID) {
    e.flags10 ^= 0x10;
    cupidReset(world, e);
    cupid = e;
    target = e.contact ?? part;
    angle = (e.contactAngle + 0x8000) & 0xffff;
  } else {
    target = e;
    cupid = e.contact ?? part;
    angle = e.contactAngle & 0xffff;
  }
  if (target.type === 4 || target.type === 0x4f || target.type === 0x6d) {
    const flipped = (cupid.flags10 & 0x10) !== 0;
    if (flipped ? !(angle & 0x8000) : (angle & 0x8000) !== 0) target.f24 = target.type === 0x4f ? 2 : 1;
  }
  return 1;
}

/** 442178 : slot 1, vole à vitesse constante (0x200 vers sa droite), animation en boucle. */
function cupidRun(world: World, c: Part): void {
  c.vx = c.flags10 & 0x10 ? 0x200 : -0x200;
  c.frame++;
  if (stateAt(world.types, CUPID, c.frame) === -1) c.frame = 0;
}

// --- Père Noël (34) --------------------------------------------------------------------------------------------

/** 4421b8 : slot 2. */
function santaReset(world: World, s: Part): void {
  s.poly = world.types.get(SANTA).polygons![0]!;
  computeEdgeAngles(s.poly, s.vertexCount);
}

/** 4421d8 : slot 1, éveillé (+0x24 ≠ 0) : animation en boucle depuis l'image 1 ; sinon image 0. Pas de mise à jour de la position de dessin. */
function santaRun(world: World, s: Part): void {
  if (s.f24 === 0) {
    s.frame = 0;
    return;
  }
  s.frame++;
  if (stateAt(world.types, SANTA, s.frame) === -1) s.frame = 1;
}

export function register(r: HandlerRegistry): void {
  r.register(0x442018, "bat.hit", (_w, p, a) => batHit(p, a));
  r.register(0x442032, "bat.run", (w, p) => batRun(w, p));
  r.register(0x441fe4, "bat.reset", (w, p) => batReset(w, p));
  r.register(0x4420e1, "cupid.hit", (w, p, a) => cupidHit(w, p, a));
  r.register(0x442178, "cupid.run", (w, p) => cupidRun(w, p));
  r.register(0x4420b4, "cupid.reset", (w, p) => cupidReset(w, p));
  r.register(0x4421d8, "santa.run", (w, p) => santaRun(w, p));
  r.register(0x4421b8, "santa.reset", (w, p) => santaReset(w, p));
}
