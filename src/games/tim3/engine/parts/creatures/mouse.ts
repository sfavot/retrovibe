/**
 * Souris de Newton (type 42) et trou de souris (type 66) : TIMWIN.EXE 44376c (slot 0), 443776 (slot 2), 443868 (slot 1),
 * 443be1 (slot 3), 443c19 (boîte de 434ec6) ; trou : 445708 (slot 2), 445715 (slot 1). Le fromage (52) n'a aucun handler.
 * Pas d'équivalent OpenTIM exploitable ; le binaire de TIM3 fait foi.
 *
 * Comme le chat, l'ANM de la souris a deux moitiés (images < 481eb4 = première image de l'état 10, sinon moitié 1) dont les
 * états se répondent : repos 1 / 0xb, trot 7 / 0xc, course 8 / 0xd, fin 0xa / fin d'ANM, remuement 9 / 0xe.
 */
import { abs32 } from "../../fixed";
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { pairIgnored, timersOf } from "./cat";
import { cached, collectInRect, findNeighbours, frameCount, overlapsAnother, registerBoxHook, relativeOf, stateAt, stateFrame } from "./kernel";

const MOUSE = 42;
const CAT = 12;
const CHEESE = 52;

/** 478098 : déplacement horizontal par image du trot et de la course (indexé par l'image après avancement). */
const STRIDE = [0, 5, 0x1a, 0x11, -4, 0x1a, 0x0e, -4];

interface MouseFrames {
  /** 481eb4 : première image de la moitié 1 (état 10). */
  half: number;
  idle: [number, number];
  trot: [number, number];
  run: [number, number];
  end: [number, number];
  wiggle: [number, number];
}

function frames(world: World): MouseFrames {
  return cached(world.types, "mouse", () => {
    const t = world.types;
    const f = (id: number) => (id < 0 ? frameCount(t, MOUSE) : stateFrame(t, MOUSE, id));
    const pair = (a: number, b: number): [number, number] => [f(a), f(b)];
    return { half: f(0xa), idle: pair(1, 0xb), trot: pair(7, 0xc), run: pair(8, 0xd), end: pair(0xa, -1), wiggle: pair(9, 0xe) };
  });
}

/** 443776 : polygone (original ou retourné d'après +0x10 & 0x10) et angles de ses côtés. */
function mouseReset(world: World, p: Part): void {
  p.poly = world.types.get(MOUSE).polygons![p.flags10 & 0x10 ? 1 : 0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/**
 * Change le sens de la souris (+0x10 & 0x10) et son polygone ; si le nouveau polygone gêne une autre pièce (437208), le
 * sens d'origine est rétabli. Rend vrai si le sens a été rétabli.
 */
function turn(world: World, p: Part, flags: number): boolean {
  const old = p.flags10;
  p.flags10 = flags;
  if (old === flags) return false;
  mouseReset(world, p);
  if (!overlapsAnother(world, p, pairIgnored)) return false;
  p.flags10 = old;
  mouseReset(world, p);
  return true;
}

/** 443868 : slot 1, une fois par pas. */
function mouseRun(world: World, p: Part): void {
  const c = frames(world);
  const oldX = p.px;
  const h = p.frame < c.half ? 0 : 1;
  let running = false;
  if (p.frame !== c.idle[0] && p.frame !== c.idle[1]) {
    if (c.trot[h] <= p.frame && c.end[h] > p.frame) {
      // Trot ou course : avance d'une foulée par image.
      running = true;
      p.frame++;
      const d = STRIDE[p.frame - c.trot[h]]!;
      p.px = (p.flags10 & 0x10 ? p.px - d : p.px + d) | 0;
      if (c.end[h] === p.frame) p.frame = c.idle[h];
    } else {
      p.frame++;
      if (stateAt(world.types, MOUSE, p.frame) !== 0) {
        p.frame = c.idle[h];
        updateGeometry(world, p);
      }
    }
  }
  if ((c.trot[h] > p.frame || c.end[h] <= p.frame) && p.flags0C & 1) {
    // Au repos sur le sol : regarde à 256 pixels autour (±8 en hauteur) : chat (12) à fuir, fromage (52) à rejoindre.
    const reach = running ? 0xa0 : 0x40;
    findNeighbours(world, p, 0x1000, -0x100, 0x100, -8, 8);
    let cat = 400;
    let cheese = 400;
    let side = 0;
    const turning = p.frame >= c.half && p.frame < c.idle[1];
    for (let n = p.bucketNext; n; n = n.bucketNext) {
      const dx = relativeOf(n).dx;
      if (n.type === CAT && abs32(dx) <= reach && abs32(dx) < abs32(cat)) cat = dx;
      if (!turning && n.type === CHEESE && abs32(dx) < abs32(cheese)) {
        if (((p.px + 0x10) | 0) < n.px || ((n.px + n.frameW + 2) | 0) < p.px) cheese = dx;
        else {
          side = ((n.px + 8) | 0) < p.px ? 2 : 1;
          cheese = 0;
        }
      }
    }
    if (cat === 400 && cheese !== 400) {
      if (turning || side === 0) cat = -cheese | 0;
      else {
        // Le fromage est sous la souris : demi-tour (animation de l'état 10) dans sa direction.
        p.frame = c.half;
        turn(world, p, side === 1 ? p.flags10 & ~0x10 : p.flags10 | 0x10);
      }
    }
    if (cat !== 400) {
      const before = p.frame;
      p.frame = running ? c.run[h] : c.trot[h];
      if (turn(world, p, cat < 0 ? p.flags10 & ~0x10 : p.flags10 | 0x10)) {
        p.frame = before;
        cat = 400;
      }
    }
    if (cat === 400 && world.animFlags & 1) {
      // Rien à fuir ni à rejoindre : remue de temps en temps (compteur global 4780b8).
      const t = timersOf(world);
      t.mouse = (t.mouse - 1) | 0;
      if (t.mouse <= 0) {
        p.frame = c.wiggle[h];
        t.mouse = 0x78;
      }
    }
  }
  if (p.frame !== p.framePrev) {
    if (p.px !== oldX) p.fx = p.px << 9;
    updateGeometry(world, p);
  }
}

/** 443be1 : slot 3, édition : tout argument non nul retourne la souris en X. */
function mouseEdit(world: World, p: Part, action: number): void {
  if (action !== 0) p.flags10 ^= 0x10;
  mouseReset(world, p);
  updateGeometry(world, p);
}

/** 443c19 : la boîte de collision sert aux recherches de voisins dès l'état « remuement » (images ≥ 481eac). */
export function mouseUsesBox(world: World, p: Part): boolean {
  const c = frames(world);
  return c.wiggle[p.frame < c.half ? 0 : 1] <= p.frame;
}
registerBoxHook(MOUSE, mouseUsesBox);

/** 445715 : trou de souris, une souris proche (écart horizontal < 14) y disparaît et le trou joue son animation. */
function holeRun(world: World, p: Part): void {
  for (let n = collectInRect(world, p, 0x1000, 7, 10, 6, 11); n; n = n.bucketNext) {
    if (n.type === MOUSE && abs32((p.px - n.px) | 0) < 0xe) {
      // 43087b : redessin ignoré.
      n.flags10 |= 0x2000;
      p.f24 = 1;
      p.frame = 0;
    }
  }
  if (p.f24 !== 0) {
    p.frame++;
    if (stateAt(world.types, p.type, p.frame) === -1) {
      p.frame--;
      p.f24 = 0;
    }
  }
}

export function registerMouse(r: HandlerRegistry): void {
  r.register(0x44376c, "mouse.accept", () => 1);
  r.register(0x443776, "mouse.reset", (w, p) => mouseReset(w, p));
  r.register(0x443868, "mouse.run", (w, p) => mouseRun(w, p));
  r.register(0x443be1, "mouse.edit", (w, p, a) => mouseEdit(w, p, typeof a === "number" ? a : 0));
  r.register(0x445708, "hole.reset", (_w, p) => {
    p.f24 = 0;
  });
  r.register(0x445715, "hole.run", (w, p) => holeRun(w, p));
}
