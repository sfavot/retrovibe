/**
 * Alligator (61). Traduit de TIMWIN.EXE 444f94 … 445262. Pas d'équivalent OpenTIM (pièce propre à TIM3).
 * Effets d'affichage (43087b, 439695) ignorés.
 */
import { clampVelocity } from "../../gravity";
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { cached, collectInRect, frameCount, stateFrame } from "./kernel";
import { strikeZone } from "./strike";

const GATOR = 61;
const MOUSE = 0x2a;
const MEL = 0x36;

/**
 * 0x481f14 … 0x481f34 (calculées au slot 2 par 44b2c0, 0x478170 …) : images des états {1, 6}, {8, 10}, {4, 11}, {12, 13} et
 * {5, fin} pour l'alligator fermé (0) et ouvert (1).
 */
interface Frames {
  idle: number[];
  chewStart: number[];
  eaten: number[];
  kick: number[];
  closed: number[];
}
function frames(world: World): Frames {
  return cached(world.types, "gator.frames", () => {
    const f = (a: number, b: number): number[] => [a, b].map((s) => (s < 0 ? frameCount(world.types, GATOR) : stateFrame(world.types, GATOR, s)));
    return {
      idle: f(1, 6),
      chewStart: f(8, 10),
      eaten: f(4, 11),
      kick: f(12, 13),
      closed: f(5, -1),
    };
  });
}

/** Indice du côté touché (+0xE4 de la pièce qui touche) ramené à l'orientation de l'alligator (retourné : n − i − 2). */
function sideOf(world: World, gator: Part, index: number): number {
  if (!(gator.flags10 & 0x10)) return index;
  const n = world.types.get(GATOR).vertexCount;
  let s = (n - index - 2) | 0;
  if (s < 0) s = (s + n) | 0;
  return s;
}

/**
 * 444f94 (slot 0) : `toucher` touche la gueule. Côté 0 ou 4 : une souris (42) ou Mel (54) est mangée (image « mangé », la
 * pièce sort de l'aire : rend 0) ; une autre pièce (côté 0, sans le drapeau +0x11 & 0x10) est lancée en l'air (+0x600 en x,
 * vy = −0x1600, bridée par 4341cb ; rend 0). Côté 3 : une pièce qui monte assez vite déclenche l'image du coup.
 */
function gatorAccept(world: World, p: Part, toucher: Part): number {
  const g = toucher.contact ?? p;
  const f = frames(world);
  const side = sideOf(world, g, toucher.contactIndex);
  const k = g.frame >= f.closed[0]! ? 1 : 0;
  if (side === 0 || side === 4) {
    if (toucher.type === MOUSE || toucher.type === MEL) {
      g.frame = f.eaten[k]!;
      updateGeometry(world, g);
      toucher.flags10 |= 0x2000; // la proie disparaît
      return 0;
    }
    if (side === 0 && !(toucher.flags10 & 0x1000)) {
      g.frame = f.kick[k]!;
      updateGeometry(world, g);
      toucher.vx = g.flags10 & 0x10 ? (toucher.vx - 0x600) | 0 : (toucher.vx + 0x600) | 0;
      toucher.vy = -0x1600;
      clampVelocity(toucher, world.types);
      return 0;
    }
  }
  if (side === 3 && f.idle[k]! <= g.frame && f.eaten[k]! > g.frame && toucher.vy < -0x400) {
    g.frame = f.kick[k]!;
    updateGeometry(world, g);
  }
  return 1;
}

/** 445179 (slot 1) : animation de la gueule ; aux images de fin de coup, frappe les pièces fixes devant elle. */
function gatorRun(world: World, p: Part): void {
  const f = frames(world);
  const k = p.frame >= f.closed[0]! ? 1 : 0;
  if (world.animFlags & 1 || f.idle[k] !== p.frame) p.frame = (p.frame + 1) | 0;
  if (f.chewStart[k] === p.frame || f.closed[k] === p.frame) p.frame = f.idle[k]!;
  else if (f.kick[k] === p.frame) p.frame = f.closed[0]!;
  updateGeometry(world, p);
  if (((f.eaten[k]! + 1) | 0) === p.frame || ((f.kick[k]! + 1) | 0) === p.frame) {
    if (p.flags10 & 0x10) {
      collectInRect(world, p, 0x2000, 0x40, 0x50, -0x11, 0);
      strikeZone(world, p, 0, 0x40, 0x50, -0x11, 0);
    } else {
      collectInRect(world, p, 0x2000, 0, 0x10, -0x11, 0);
      strikeZone(world, p, 0, 0, 0x10, -0x11, 0);
    }
  }
}

/** 44509c (slot 2) : polygone selon le retournement (0 ou 1), angles des côtés (439e38). */
function gatorReset(world: World, p: Part): void {
  frames(world);
  const polys = world.types.get(p.type).polygons;
  if (!polys) return;
  p.poly = polys[p.flags10 & 0x10 ? 1 : 0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** 445262 (slot 3) : tout argument non nul retourne la pièce ; slot 2 ; affichage ignoré. */
function gatorEdit(world: World, p: Part, arg?: number | Part | null): void {
  if (arg) p.flags10 ^= 0x10;
  gatorReset(world, p);
}

export function register(r: HandlerRegistry): void {
  r.register(0x444f94, "gator.accept", (w, p, a) => (a && typeof a === "object" ? gatorAccept(w, p, a) : 1));
  r.register(0x445179, "gator.run", (w, p) => gatorRun(w, p));
  r.register(0x44509c, "gator.reset", (w, p) => gatorReset(w, p));
  r.register(0x445262, "gator.edit", (w, p, a) => gatorEdit(w, p, a));
}
