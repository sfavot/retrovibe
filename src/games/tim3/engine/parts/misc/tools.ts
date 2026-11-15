/**
 * Outils : gant de boxe (35), taille-haie (37) et cisailles (77, code partagé), tremplin (39), ouvre-boîte (67).
 * Traduit de TIMWIN.EXE 442210 … 442ab8, 443168 … 443218, 4457ac … 445801. Pas d'équivalent direct dans OpenTIM (pièces
 * propres à TIM3). Les slots 6 (dessin) sont des no-op : le dessin est de la vague R.
 *
 * Besoins de noyau / d'autres groupes (voir `docs/tim3/parts-misc.md`) :
 * - `cutRopes` (442af6) : dans `mechanics/rope.ts` ;
 * - le gant appelle 43f907 (moteur 6) et 440454 (aquarium 15) via `World.special` ;
 * - la globale 0x481664 (image de repos de la souris 54, posée par 4445e5) n'existe pas dans `World` : `mouseRestFrame`.
 */
import { abs32 } from "../../fixed";
import { clampVelocity } from "../../gravity";
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { cutRopes } from "../mechanics/rope";
import { stateFirst } from "./anim";

const GLOVE = 35;
const TRIMMER = 37;
const TRAMPOLINE = 39;
const CAN_OPENER = 67;
const SNIPS = 77;

const unsignedLess = (a: number, b: number): boolean => a >>> 0 < b >>> 0;

function setPoly(world: World, p: Part, index: number): void {
  p.poly = world.types.get(p.type).polygons![index]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** Globale 0x481664 : posée par le slot 2 de la souris (54, groupe `creatures`) ; absente de `World` : 0 en attendant. */
function mouseRestFrame(_world: World): number {
  return 0;
}

// ---------------------------------------------------------------- gant de boxe (35)

/** 44234c (cache 0x481e40) : première image ≥ 3 qui commence un état (44b19c ≠ 0) : l'image du coup. */
function gloveStrikeFrame(world: World): number {
  const anim = world.types.anims[GLOVE];
  let f = 2;
  for (;;) {
    f++;
    if (!anim || anim.stateAt(f) !== 0) return f;
  }
}

/** 442210 : le gant est armé par une pièce qui touche sa face de frappe (angle 0x4000, ou 0xC000 retourné). */
function gloveAccept(_w: World, _p: Part, arg?: number | Part | null): number {
  const toucher = arg as Part;
  const glove = toucher.contact!;
  if (glove.flags10 & 0x10) {
    if ((toucher.contactAngle & 0xffff) === 0x4000) glove.f24 = 1;
  } else if ((toucher.contactAngle & 0xffff) === 0xc000) glove.f24 = 1;
  return 1;
}

/** 44234c : polygone selon le retournement et l'image du coup. */
function gloveReset(world: World, p: Part): void {
  let i = p.flags10 & 0x10 ? 2 : 0;
  if (p.frame === gloveStrikeFrame(world)) i++;
  setPoly(world, p, i);
}

/** 4423ed : vitesse donnée à une pièce frappée, d'après sa masse (+0x5C). */
function gloveForce(mass: number): number {
  if (mass < 6) return 0x1a00;
  if (mass < 10) return 0x1800;
  if (mass < 0x15) return 0x1600;
  if (mass < 0x79) return 0x1400;
  if (mass < 0x97) return 0x1200;
  if (mass < 0xc9) return 0x1000;
  if (mass < 0x709) return 0xe00;
  return 0xc00;
}

/**
 * 434eff : chaîne (+0xC4) des pièces dont la boîte recoupe le rectangle [x0, x1] × [y0, y1] (relatif à `p`), parmi les
 * statiques puis les mobiles (`flags` 0x3000) ou les mobiles seules (0x1000). Insertion en tête de chaîne.
 */
export function gatherInRect(world: World, p: Part, flags: number, x0: number, x1: number, y0: number, y1: number): void {
  p.bucketNext = null;
  x0 = (x0 + p.px) | 0;
  x1 = (x1 + p.px) | 0;
  y0 = (y0 + p.py) | 0;
  y1 = (y1 + p.py) | 0;
  const list = flags & 0x2000 ? world.staticThenMobile() : world.mobiles;
  for (const q of list) {
    if (q === p || q.flags10 & 0x2000 || q.flags14 & 0x4000) continue;
    if (q.px < x1 && ((q.boxW + q.px) | 0) > x0 && q.py < y1 && ((q.boxH + q.py) | 0) > y0) {
      q.bucketNext = p.bucketNext;
      p.bucketNext = q;
    }
  }
}

// 477fbc / 477fc8 : bord de la zone frappée selon l'image (4 ou 5).
const STRIKE_NEAR = [-0x20, -0x52];
const STRIKE_FAR = [0x50, 0x82];

/** 44224f : avance le coup ; aux images 4 et 5, frappe les pièces dans la zone devant le gant. */
function gloveRun(world: World, p: Part): void {
  if (p.f24 !== 0 && p.frame !== gloveStrikeFrame(world)) {
    p.frame++;
    gloveReset(world, p);
    updateGeometry(world, p);
  }
  if (p.frame !== 4 && p.frame !== 5) return;
  const k = p.frame - 4;
  if (p.flags10 & 0x10) gatherInRect(world, p, 0x3000, 0x30, STRIKE_FAR[k]!, 0, 0x1f);
  else gatherInRect(world, p, 0x3000, STRIKE_NEAR[k]!, 0, 0, 0x1f);
  for (let b = p.bucketNext; b; b = b.bucketNext) {
    if (b.flags0C & 0x1000) {
      const v = gloveForce(b.mass);
      b.vx = p.flags10 & 0x10 ? v : -v | 0;
      const rest = mouseRestFrame(world);
      if (b.type === 0x36 && b.frame < rest) b.frame = rest;
    } else if (b.type === 6) world.special(0x43f907, b);
    else if (b.type === 15) world.special(0x440454, b);
    else if (b.type === 0x4e) b.f24 = 1;
  }
}

/** 4423b5 : édition (retournement), polygone, géométrie. */
function gloveEdit(world: World, p: Part, arg?: number | Part | null): void {
  if (arg) p.flags10 ^= 0x10;
  gloveReset(world, p);
  updateGeometry(world, p);
}

// ---------------------------------------------------------------- taille-haie (37) et cisailles (77)

interface SnipFrames {
  /** 481e6c (37 : état 0xB), 481e68 (37 : 3), 481e70 (37 : 4), 481e80 (77 : 6), 481e84 (77 : 3). */
  trimmerEnd: number;
  trimmerCut: number;
  trimmerOpen: number;
  snipsCut: number;
  snipsOpen: number;
}

function snipFrames(world: World): SnipFrames {
  return {
    trimmerEnd: stateFirst(world, TRIMMER, 0xb),
    trimmerCut: stateFirst(world, TRIMMER, 3),
    trimmerOpen: stateFirst(world, TRIMMER, 4),
    snipsCut: stateFirst(world, SNIPS, 6),
    snipsOpen: stateFirst(world, SNIPS, 3),
  };
}

/** Segments {x0, y0, x1, y1} relatifs à l'outil (0x47802c, 0x47803c, 0x47804c, 0x47805c). */
const CUT_LINE = {
  trimmer: [0x20, 0x11, 0x39, 0x11],
  trimmerFlipped: [-2, 0x11, 0x17, 0x11],
  snips: [0x31, 0xf, 0x39, 0xf],
  snipsFlipped: [-2, 0xf, 6, 0xf],
} as const;

/** 442760 : une pièce touche l'outil ; selon le côté touché, il se déclenche (ou déclenche la pièce touchée). */
function snipsAccept(world: World, _p: Part, arg?: number | Part | null): number {
  const toucher = arg as Part;
  const tool = toucher.contact!;
  const f = snipFrames(world);
  if (tool.frame !== 0 && !(tool.type === TRIMMER && unsignedLess(tool.frame, f.trimmerEnd))) return 1;
  let side = toucher.contactIndex;
  const count = world.types.get(tool.type).vertexCount;
  if (tool.flags10 & 0x10) {
    side = (count - side - 2) | 0;
    if (side < 0) side = (side + count) | 0;
  }
  if (side === 0 || side === 1 || side === 5 || side === 6) tool.f24 = 1;
  else if (side === 3) {
    if (toucher.type === 4 || toucher.type === 0x6d) toucher.f24 = 1;
    else if (toucher.type === 0x4f) toucher.f24 = 2;
  }
  return 1;
}

/** 442800 : polygone selon le retournement et l'image (taille-haie : après la fin du coup ; cisailles : image non nulle). */
function snipsReset(world: World, p: Part): void {
  const f = snipFrames(world);
  let i = p.flags10 & 0x10 ? 2 : 0;
  if (p.type === TRIMMER) {
    if (p.frame >>> 0 > f.trimmerEnd >>> 0) i++;
  } else if (p.frame !== 0) i++;
  setPoly(world, p, i);
}

/** 442905 : coupe (cordes) à la première image du coup, puis anime ; le taille-haie clignote au repos. */
function snipsRun(world: World, p: Part): void {
  const f = snipFrames(world);
  const isSnips = p.type === SNIPS;
  if (p.f24 !== 0) {
    const first = isSnips ? f.snipsCut : f.trimmerCut;
    if (unsignedLess(p.frame, first)) {
      const flipped = (p.flags10 & 0x10) !== 0;
      const line = isSnips
        ? flipped ? CUT_LINE.snipsFlipped : CUT_LINE.snips
        : flipped ? CUT_LINE.trimmerFlipped : CUT_LINE.trimmer;
      cutRopes(world, p, line);
      p.frame = first;
      snipsReset(world, p);
      updateGeometry(world, p);
      return;
    }
    const open = isSnips ? f.snipsOpen : f.trimmerOpen;
    if (open !== p.frame) {
      p.frame++;
      if (world.types.anims[p.type]?.stateAt(p.frame) !== 0) p.frame = open;
      updateGeometry(world, p);
    }
  } else if (world.animFlags & 1 && p.type === TRIMMER) {
    if (p.frame !== 0) {
      p.frame++;
      if (p.frame === f.trimmerEnd) p.frame = 0;
    } else {
      const t = (world.trimmerTimer - 1) | 0;
      world.trimmerTimer = t;
      if (t > 0) return;
      p.frame++;
      world.trimmerTimer = (world.rng.next() % 200) + 0x28;
    }
  }
}

/** 442a44 : édition (retournement) ; le polygone suit. */
function snipsEdit(world: World, p: Part, arg?: number | Part | null): void {
  if (arg) p.flags10 ^= 0x10;
  snipsReset(world, p);
}

// ---------------------------------------------------------------- tremplin (39)

/** 443168 : rebond au sommet (côté 0, hors choc de sommet) : lance la pièce vers le haut, avec −0x800 en plus. */
function trampolineAccept(world: World, _p: Part, arg?: number | Part | null): number {
  const toucher = arg as Part;
  const tramp = toucher.contact!;
  if (toucher.contactIndex !== 0 || toucher.flags10 & 0x1000) return 1;
  tramp.f24 = 1;
  tramp.frame = 0;
  toucher.contact = null;
  toucher.flags0C &= ~1;
  toucher.fy = toucher.py << 9;
  toucher.vy = (-abs32(toucher.vy) - 0x800) | 0;
  clampVelocity(toucher, world.types);
  return 0;
}

/** 443218 : détente du ressort jusqu'à l'image de repos (état 4). */
function trampolineRun(world: World, p: Part): void {
  const rest = stateFirst(world, TRAMPOLINE, 4);
  if (p.f24 !== 0 && p.frame !== rest) {
    p.frame++;
    if (p.frame === rest) p.f24 = 0;
    updateGeometry(world, p);
  }
}

// ---------------------------------------------------------------- ouvre-boîte (67)

/** 445801 : une fois armé (ou après l'image d'état 2), avance jusqu'à la dernière image. */
function canOpenerRun(world: World, p: Part): void {
  const anim = world.types.anims[CAN_OPENER];
  const last = (anim ? anim.count : 0) - 1;
  if (p.f24 === 0 && unsignedLess(p.frame, stateFirst(world, CAN_OPENER, 2))) return;
  if (p.frame !== last) {
    p.frame++;
    updateGeometry(world, p);
  }
}

const noop = (): void => undefined;

export function registerTools(r: HandlerRegistry): void {
  r.register(0x442210, "glove.accept", gloveAccept);
  r.register(0x44224f, "glove.run", (w, p) => gloveRun(w, p));
  r.register(0x44234c, "glove.reset", (w, p) => gloveReset(w, p));
  r.register(0x4423b5, "glove.edit", (w, p, a) => gloveEdit(w, p, a));

  r.register(0x442760, "snips.accept", snipsAccept);
  r.register(0x442905, "snips.run", (w, p) => snipsRun(w, p));
  r.register(0x442800, "snips.reset", (w, p) => snipsReset(w, p));
  r.register(0x442a44, "snips.edit", (w, p, a) => snipsEdit(w, p, a));
  r.register(0x442a75, "trimmer.draw", noop);
  r.register(0x442ab8, "snips.draw", noop);

  r.register(0x443168, "trampoline.accept", trampolineAccept);
  r.register(0x443218, "trampoline.run", (w, p) => trampolineRun(w, p));
  r.register(0x4431d9, "trampoline.reset", (w, p) => setPoly(w, p, 0));

  r.register(0x445801, "canOpener.run", (w, p) => canOpenerRun(w, p));
  r.register(0x4457ac, "canOpener.reset", (w, p) => setPoly(w, p, 0));
}
