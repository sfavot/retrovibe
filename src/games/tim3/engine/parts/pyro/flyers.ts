/**
 * Engins volants et trappe : montgolfière (79), dirigeable (109), trappe (73). La montgolfière monte quand son brûleur
 * est allumé et tombe crevée ; le dirigeable vole droit devant lui, fait demi-tour au contact et prend feu ou explose ;
 * la trappe s'ouvre sous une pièce lourde et pousse vers le bas les mobiles qu'elle portait. Traduit de TIMWIN.EXE
 * 44649c … 44670a, 447810 … 447ab6, 445e0c … 445eef.
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
  linkIndex,
  LIST_MOBILE,
  nearby,
  newPart,
  placeAt,
  recyclePart,
  ropeOf,
  setAnchor,
  stateFrame,
  usePolygon,
} from "./kernel";

function moverOf(self: Part, arg: unknown): Part {
  return arg && typeof arg === "object" ? (arg as Part) : self;
}

// ---------------------------------------------------------------------------------------------------------------------
// Montgolfière (79).

/** 44649c : slot 0 : une balle de phazer (20) la crève (+0x24 = 2). */
function balloonAccept(_w: World, self: Part, arg: unknown): number {
  const m = moverOf(self, arg);
  if (m.type === 0x14) m.contact!.f24 = 2;
  return 1;
}

/** 4464bc : slot 2 : point de mise à feu (le brûleur), point d'attache de la corde (la nacelle), polygone. */
function balloonReset(world: World, p: Part): void {
  setAnchor(p, 4, 0x11, 0x3b);
  setAnchor(p, 0, 0x11, 0x52);
  usePolygon(world, p, 0);
}

/**
 * 446555 : slot 1. Crevée (+0x24 = 2) : elle tombe (+0x400 par pas, au plus 0x2000), perd son polygone, lâche sa corde
 * (un bout de corde 49 prend sa place) et disparaît sous y = 400. Allumée (+0x24 = 1) : le brûleur monte la
 * montgolfière (−0x200 par pas jusqu'à −0x800) et met le feu au-dessus de lui.
 */
function balloonRun(world: World, p: Part): void {
  const t = 0x4f;
  if (p.f24 === 0 && p.f104 > 0x14) p.f24 = 1;
  if (p.f24 === 2) {
    p.vy = (p.vy + 0x400) | 0;
    if (p.vy > 0x2000) p.vy = 0x2000;
    const popped = stateFrame(world, t, 4);
    if (p.frame < popped) {
      p.poly = null;
      p.frame = popped;
      dropRope(world, p);
    } else p.frame++;
    if (p.frame >= stateFrame(world, t, -1)) {
      p.frame = stateFrame(world, t, 3);
      if (p.py > 0x190) p.flags10 |= F10.GONE;
    }
    updateGeometry(world, p);
    return;
  }
  if (p.f24 !== 1) return;
  p.frame++;
  if (p.frame >= stateFrame(world, t, 4)) {
    if (world.animFlags & 1) p.frame = 1;
    else p.frame = (p.frame - 2) | 0;
  }
  updateGeometry(world, p);
  if (p.vy > -0x800) p.vy = (p.vy - 0x200) | 0;
  flame(world, p, 0xd, 0x15, 0x31, 0x3e);
}

/** 4465b7 … 446675 : la corde de la montgolfière passe à un bout de corde (49) posé au point d'attache. */
function dropRope(world: World, p: Part): void {
  const rope = ropeOf(p);
  if (!rope) return;
  const end = recyclePart(world, 0x31);
  if (!end) return;
  insertCreated(world, world.mobiles, end);
  end.ropes[0] = rope;
  end.links[0] = p.links[0]!;
  const other = end.links[0];
  if (other) {
    const k = linkIndex(p, other);
    if (k !== -1) other.links[k] = end;
  }
  if (rope.end1 === p) {
    rope.end1 = end;
    end.px = rope.ends[0]!;
    end.py = rope.ends[1]!;
  } else {
    rope.end2 = end;
    end.px = rope.ends[2]!;
    end.py = rope.ends[3]!;
  }
  placeAt(world, end, end.px, end.py);
  p.ropes[0] = null;
  p.links[0] = null;
}

/**
 * 44670a : slot 5 (la corde tire). Cas 1 : compteur +0x18 du bloc de corde. Allumée, elle résiste toujours ; sinon elle
 * résiste si la quantité de mouvement du tireur est inférieure à la sienne (bascule 3 ou 139), ou au double de la sienne.
 */
export function balloonPulled(_w: World, self: Part, puller: Part, kind: number, momentum: number): number {
  if (kind === 1) {
    const rope = ropeOf(self);
    if (rope) rope.n18 = (rope.n18 + 1) | 0;
    return 0;
  }
  if (self.f24 !== 0) return 1;
  if (puller.type === 3 || puller.type === 0x8b) return momentum < self.momentum ? 1 : 0;
  return momentum < ((self.momentum + self.momentum) | 0) ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dirigeable (109).

/**
 * 447a78 : slot 0. Appelé sur lui-même par 43373c quand il touche quelque chose (+0x0C & 6) : il fera demi-tour
 * (+0x24 = 3 retourné, 4 sinon). Touché par une balle de phazer : il explose (+0x24 = 2).
 */
function blimpAccept(_w: World, self: Part, arg: unknown): number {
  const m = moverOf(self, arg);
  if (m.type === 0x6d) m.f24 = m.flags10 & F10.FLIP_X ? 3 : 4;
  else if (m.type === 0x14) m.contact!.f24 = 2;
  return 1;
}

/** 447810 : slot 2 : polygone selon le retournement en X. */
function blimpReset(world: World, p: Part): void {
  usePolygon(world, p, p.flags10 & F10.FLIP_X ? 1 : 0);
}

/** 447ab6 : le dirigeable explose : explosion (41, neuve) à (x − 10, y − 12), image de l'épave (début de l'état 5). */
function explodeBlimp(world: World, p: Part): void {
  const e = newPart(world, 0x29);
  if (e) {
    insertCreated(world, world.statics, e);
    placeAt(world, e, (p.px - 0xa) | 0, (p.py - 0xc) | 0);
  }
  p.frame = stateFrame(world, 0x6d, 5);
}

/**
 * 4478c6 : slot 1. En vol (image avant l'état 2) : l'hélice tourne et il accélère de 0x40 par pas jusqu'à ±0x200 dans
 * son sens ; demi-tour : il s'arrête, l'animation de virage se joue, puis il repart retourné. +0x24 : 1 il prend feu,
 * 2 il explose, 3 / 4 il commence un demi-tour. Touché (état 2 et après) : il tombe en brûlant et disparaît sous y = 400.
 */
function blimpRun(world: World, p: Part): void {
  const t = 0x6d;
  const turnL = stateFrame(world, t, 3);
  const turnR = stateFrame(world, t, 4);
  const hit = stateFrame(world, t, 2);
  if (p.frame < hit) {
    switch (p.f24) {
      case 0:
        if (p.frame < turnL) {
          p.frame++;
          if (p.frame === turnL) p.frame = 0;
          if (p.flags10 & F10.FLIP_X) {
            if (p.vx < 0x200) p.vx = (p.vx + 0x40) | 0;
          } else if (p.vx > -0x200) p.vx = (p.vx - 0x40) | 0;
        } else {
          if (p.flags10 & F10.FLIP_X) {
            if (p.vx > 0) p.vx = 0;
          } else if (p.vx < 0) p.vx = 0;
          p.frame++;
          if (p.frame === turnR || p.frame === hit) {
            p.frame = 0;
            p.flags10 ^= F10.FLIP_X;
            blimpReset(world, p);
          }
        }
        break;
      case 1:
        p.frame = hit;
        p.poly = null;
        break;
      case 2:
        explodeBlimp(world, p);
        p.poly = null;
        break;
      case 3:
        p.frame = turnR;
        if (p.vx > 0) p.vx = 0;
        p.f24 = 0;
        break;
      default:
        p.frame = turnL;
        if (p.vx < 0) p.vx = 0;
        p.f24 = 0;
        break;
    }
  } else {
    p.vy = (p.vy + 0x200) | 0;
    if (p.vy > 0x1000) p.vy = 0x1000;
    p.frame++;
    const wreck = stateFrame(world, t, 5);
    const burning = stateFrame(world, t, 6);
    if (p.frame === wreck) p.frame--;
    else if (p.frame === stateFrame(world, t, -1)) p.frame = burning;
    if (p.frame >= burning) flame(world, p, 0, p.frameW, 0, p.frameH);
    if (p.py > 0x190) p.flags10 |= F10.GONE;
  }
  if (p.frame !== p.framePrev) updateGeometry(world, p);
}

// ---------------------------------------------------------------------------------------------------------------------
// Trappe (73).

/** 445e0c : slot 0 : une pièce de plus de 100 (masse) posée sur le côté 0 de la trappe fermée l'ouvre. */
function trapdoorAccept(world: World, self: Part, arg: unknown): number {
  const m = moverOf(self, arg);
  const c = m.contact!;
  if (c.frame === 0) {
    let side = m.contactIndex;
    if (c.flags10 & F10.FLIP_X) {
      const n = world.types.get(0x49).vertexCount;
      side = (n - side - 2) | 0;
      if (side < 0) side = (side + n) | 0;
    }
    if (side === 0 && m.mass > 0x64) c.f24 = 1;
  }
  return 1;
}

/** 445e61 : slot 2 : polygone fermé ou ouvert (image non nulle), selon le retournement en X. */
function trapdoorReset(world: World, p: Part): void {
  usePolygon(world, p, (p.flags10 & F10.FLIP_X ? 2 : 0) + (p.frame !== 0 ? 1 : 0));
}

/** 445eef : slot 1 : ouverte, elle s'abat (jusqu'au début de l'état 4) ; à l'image 2, les mobiles posés dessus partent. */
function trapdoorRun(world: World, p: Part): void {
  p.flags10 |= 0x40;
  if (p.f24 === 0 || p.frame === stateFrame(world, 0x49, 4)) return;
  p.frame++;
  if (p.frame === 2) {
    nearby(world, p, LIST_MOBILE, 0, 0, 0, 0x30);
    for (const q of chain(p)) {
      q.vy = (q.vy + 0x800) | 0;
      clampVelocity(q, world.types);
      if (q.type === 0x36) q.fFC = 1;
    }
    trapdoorReset(world, p);
  }
  updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  r.register(0x44649c, "balloon.accept", (w, p, a) => balloonAccept(w, p, a));
  r.register(0x4464bc, "balloon.reset", (w, p) => balloonReset(w, p));
  r.register(0x446555, "balloon.run", (w, p) => balloonRun(w, p));
  // Slot 5 : `World.pull` (tension des cordes, 43a31d) : (pièce, tireur, emplacement, drapeaux, masse, effort).
  r.register(0x44670a, "balloon.pulled", (w, p, a, _slot = 0, flags = 0, _mass = 0, force = 0) =>
    balloonPulled(w, p, a as Part, flags, force),
  );
  r.register(0x447a78, "blimp.accept", (w, p, a) => blimpAccept(w, p, a));
  r.register(0x447810, "blimp.reset", (w, p) => blimpReset(w, p));
  r.register(0x4478c6, "blimp.run", (w, p) => blimpRun(w, p));
  r.register(0x445e0c, "trapdoor.accept", (w, p, a) => trapdoorAccept(w, p, a));
  r.register(0x445e61, "trapdoor.reset", (w, p) => trapdoorReset(w, p));
  // 445eb7 : slot 3 : toute action retourne en X, puis slot 2 et géométrie (affichage et 439695 laissés à l'éditeur).
  r.register(0x445eb7, "trapdoor.edit", (w, p, a) => {
    if (a) p.flags10 ^= F10.FLIP_X;
    trapdoorReset(w, p);
    updateGeometry(w, p);
  });
  r.register(0x445eef, "trapdoor.run", (w, p) => trapdoorRun(w, p));
}
