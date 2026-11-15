/**
 * Mandrill (31), TIMWIN.EXE 441bc4 … 441f56. Il se balance sur une corde ou un support (ancrages +0xB0/+0xB1, +0x88/+0x89
 * pour les cordes), donne un coup de poing à qui le touche et entraîne la pièce qui lui est liée par une courroie (+0x84).
 * Pas d'équivalent dans OpenTIM (TIM1/TEMIM n'ont pas de mandrill) : traduction directe de l'exe.
 *
 * Les globales 0x481e24 … 0x481e3c sont les premières images des états 3, 4, 9, 5, 7, 8 et le nombre d'images de l'ANM du
 * type 31 (0x480bc4), calculées par 44b2c0 au premier slot 2 : ici à la demande.
 */
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { cached, frameCount, stateFrame } from "./kernel";

const MANDRILL = 31;

interface MandrillStates {
  /** 0x481e28 : état 4. */
  s4: number;
  /** 0x481e30 : état 5. */
  s5: number;
  /** 0x481e34 : état 7. */
  s7: number;
  /** 0x481e38 : état 8. */
  s8: number;
  /** 0x481e2c : état 9. */
  s9: number;
  /** 0x481e3c : nombre d'images. */
  count: number;
}

function states(world: World): MandrillStates {
  return cached(world.types, "mandrill.states", () => {
    const t = world.types;
    return {
      s4: stateFrame(t, MANDRILL, 4),
      s9: stateFrame(t, MANDRILL, 9),
      s5: stateFrame(t, MANDRILL, 5),
      s7: stateFrame(t, MANDRILL, 7),
      s8: stateFrame(t, MANDRILL, 8),
      count: frameCount(t, MANDRILL),
    };
  });
}


function isPart(a: unknown): a is Part {
  return typeof a === "object" && a !== null;
}

/** 439f44 : l'autre pièce de la courroie (+0x84) qui porte `p` ; `null` sans courroie. */
function beltPartner(p: Part): Part | null {
  const b = p.belt;
  if (!b) return null;
  return p === b.end1 ? b.end2 : b.end1;
}

/**
 * 441bc4 : slot 0, un coup du mandrill. `toucher` (paramètre de l'exe) est la pièce touchée par lui ; l'indice du côté
 * touché (+0xE4, compté dans le sens des sommets : inversé quand le mandrill est retourné) choisit la réaction : côté
 * < 5 : il frappe (compteur +0xFC = 0x30, image d'élan) ; côté 5 : il pousse la pièce de 0x800 (sa tête).
 */
function hit(world: World, part: Part, arg: unknown): number {
  const toucher = isPart(arg) ? arg : part;
  const m = toucher.contact ?? part;
  let side = toucher.contactIndex;
  const n = world.types.get(MANDRILL).vertexCount;
  if (m.flags10 & 0x10) {
    side = (n - side - 2) | 0;
    if (side < 0) side = (side + n) | 0;
  }
  if (m.fFC === 0) {
    const S = states(world);
    if (side < 5) {
      m.fFC = 0x30;
      m.f24 = 0;
      m.frame = m.frame < S.s4 ? S.s8 : S.s7;
    } else if (side === 5) {
      if (m.frame >= S.s9 && m.frame < S.s7) toucher.vx = (toucher.vx + (m.flags10 & 0x10 ? 0x800 : -0x800)) | 0;
    }
  }
  return 1;
}

/** 441c6f : slot 2, polygone selon le retournement, ancrages des cordes (+0xB0 … +0xB1, +0x88 … +0x8C) selon l'image. */
function reset(world: World, m: Part): void {
  const S = states(world);
  const flip = (m.flags10 & 0x10) !== 0;
  m.poly = world.types.get(MANDRILL).polygons![flip ? 1 : 0]!;
  if (m.frame < S.s4 || m.frame === S.s8) {
    m.ropeAnchor[0] = flip ? 3 : 3 + 0x5f;
    m.ropeAnchor[1] = 0x42;
  } else {
    m.ropeAnchor[0] = flip ? 9 : 9 + 0x53;
    m.ropeAnchor[1] = 0x47;
  }
  // +0x88 / +0x89 sont des octets (l'exe n'écrit que l'octet bas), +0x8C un mot de 32 bits.
  m.f88 = (m.f88 & ~0xff) | (flip ? 0x47 : 0x47 - 0x25);
  m.f89 = (m.f89 & ~0xff) | 0x42;
  m.f8C = 7;
  computeEdgeAngles(m.poly, m.vertexCount);
}

/** 441da8 : slot 1 : coup de poing (compteur +0xFC), élan, balancement du bras, clignement au repos. */
function run(world: World, m: Part): void {
  const S = states(world);
  // La pièce liée (courroie) reçoit le double de l'élan tant que le bras est tendu (images 9 … 7).
  const partner = beltPartner(m);
  if (partner && !(partner.flags10 & 0x800)) {
    partner.f24 = m.frame >= S.s9 && m.frame < S.s7 ? (m.f24 * 2) | 0 : 0;
  }
  if (m.fFC !== 0) {
    m.fFC = (m.fFC - 1) | 0;
    if (m.fFC === 0) {
      if (m.frame < S.s8) {
        m.f24 = m.flags10 & 0x10 ? 1 : -1;
        m.frame = S.s5;
      } else m.frame = 0;
    } else {
      m.frame++;
      if (m.frame === S.s8) m.frame = S.s7;
      else if (m.frame === S.count) m.frame = S.s8;
    }
  } else if (m.f24 !== 0) {
    if (m.frame < S.s4) m.frame = (S.s4 - 1) | 0;
    m.frame++;
    if (m.frame === S.s7) m.frame = S.s5;
  } else if (world.animFlags & 1) {
    if (m.frame !== 0) {
      if (m.frame < S.s4) {
        m.frame++;
        if (m.frame === S.s4) m.frame = 0;
      }
    } else {
      // 0x477fc8 : compte à rebours global avant que le mandrill ne bouge au repos (`World.mandrillTimer`).
      const t = (world.mandrillTimer - 1) | 0;
      world.mandrillTimer = t;
      if (t < 0) {
        m.frame++;
        world.mandrillTimer = ((world.rng.next() % 200) + 0x28) | 0;
      }
    }
  }
  if (m.frame !== m.framePrev) {
    reset(world, m);
    updateGeometry(world, m);
  }
}

/** 441f13 : slot 3, retournement (tout argument non nul). */
function edit(world: World, m: Part, action: unknown): void {
  if (typeof action === "number" && action !== 0) m.flags10 ^= 0x10;
  reset(world, m);
  updateGeometry(world, m);
  // 43050d, 43087b : affichage seul.
  world.redraw(m, 2); // 439695
}

/**
 * 441f56 : slot 5, la corde tendue entre une autre pièce (le paramètre 1 de l'exe) et le mandrill `self` (le paramètre 2) ;
 * `mode` = indicateurs de 43a31d (1 : simple comptage, 2 / 4 : côté tiré, bit 0x8000 : simulation). Rend 1 si le mandrill
 * résiste.
 */
function pulled(world: World, self: Part, mode: number): number {
  const rope = self.ropes[0];
  if (mode === 1) {
    if (rope) rope.n18 = (rope.n18 + 1) | 0;
    return 0;
  }
  const edx = mode & 0x8006;
  const ecx = edx & ~0x8000;
  if (ecx === 2) return 1;
  const S = states(world);
  if (ecx === 4) {
    if (self.frame === S.s8) self.frame = S.s7;
    else if (self.f24 !== 0 || self.frame >= S.s4) return 1;
  }
  if (edx === 4 && self.f24 === 0) self.f24 = self.flags10 & 0x10 ? 1 : -1;
  return 0;
}

export function register(r: HandlerRegistry): void {
  r.register(0x441bc4, "mandrill.hit", (w, p, a) => hit(w, p, a));
  r.register(0x441da8, "mandrill.run", (w, p) => run(w, p));
  r.register(0x441c6f, "mandrill.reset", (w, p) => reset(w, p));
  r.register(0x441f13, "mandrill.edit", (w, p, a) => edit(w, p, a));
  r.register(0x441f56, "mandrill.pulled", (w, p, _puller, _slot = 0, flags = 0) => pulled(w, p, flags));
}
