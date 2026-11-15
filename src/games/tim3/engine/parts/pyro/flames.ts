/**
 * Flammes : bougie (138), silex et amadou (78), lampe d'Aladdin (45), allumette à ressort (75). Une fois allumées
 * (+0x24, ou chauffées plus de 20 pas, +0x104), elles animent leur flamme et mettent le feu au rectangle voisin
 * (43beb8). Traduit de TIMWIN.EXE 448798 … 4487e5, 446384 … 44640f, 443c48 … 443cad, 446094 … 4462ee.
 */
import { updateGeometry } from "../../move";
import { F10, type Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import {
  flame,
  insertCreated,
  linkIndex,
  pyroGlobals,
  recyclePart,
  ropeOf,
  setAnchor,
  stateAt,
  stateFrame,
  usePolygon,
} from "./kernel";

/** Allumage commun : chauffée plus de 20 pas (+0x104 > 0x14), la pièce prend feu. */
function heat(p: Part): void {
  if (p.f24 === 0 && p.f104 > 0x14) p.f24 = 1;
}

/**
 * Flamme qui boucle : sans animations décoratives (0x481034 & 1), deux images alternent ; sinon on avance jusqu'à la fin
 * de l'ANM puis on revient au début de la flamme (`lit`).
 */
function flicker(world: World, p: Part, lit: number, a: number, b: number): void {
  if (!(world.animFlags & 1)) p.frame = p.frame === a ? b : a;
  else if (p.frame < lit) p.frame = lit;
  else {
    p.frame++;
    if (stateAt(world, p.type, p.frame) === -1) p.frame = lit;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Bougie (138).

/** 448798 : slot 2 : point de mise à feu (la mèche) et polygone. */
function candleReset(world: World, p: Part): void {
  setAnchor(p, 4, 0xc, 1);
  usePolygon(world, p, 0);
}

/** 4487e5 : slot 1 : allumée, la flamme (début de l'état 2, 0x482010) brûle au-dessus de la mèche. */
function candleRun(world: World, p: Part): void {
  heat(p);
  if (p.f24 === 0) return;
  flicker(world, p, stateFrame(world, 0x8a, 2), 3, 5);
  updateGeometry(world, p);
  flame(world, p, 6, 0x11, -0x10, 4);
}

// ---------------------------------------------------------------------------------------------------------------------
// Silex et amadou (78).

/** 446384 : slot 0 : un choc sur le côté 0 ou 3 du silex l'allume. */
function flintAccept(_w: World, self: Part, arg: unknown): number {
  const m = arg && typeof arg === "object" ? (arg as Part) : self;
  if (m.contactIndex === 0 || m.contactIndex === 3) m.contact!.f24 = 1;
  return 1;
}

/** 4463b0 : slot 2 : polygone 0 au repos, 1 frappé (image non nulle). */
function flintReset(world: World, p: Part): void {
  usePolygon(world, p, p.frame !== 0 ? 1 : 0);
}

/** 44640f : slot 1 : allumé, le silex se rabat puis l'amadou brûle (début de l'état 7, 0x481670). */
function flintRun(world: World, p: Part): void {
  if (p.f24 === 0) return;
  p.flags10 |= 0x40;
  if (p.frame === 0) {
    p.frame++;
    flintReset(world, p);
    p.frame--;
  }
  const lit = stateFrame(world, 0x4e, 7);
  if (p.frame >= lit && !(world.animFlags & 1)) p.frame = p.frame === 0x1c ? 0x1e : 0x1c;
  else {
    p.frame++;
    if (p.frame === stateFrame(world, 0x4e, -1)) p.frame = lit;
  }
  if (p.frame >= lit) flame(world, p, 0x10, 0x1e, -0xc, 0x13);
  updateGeometry(world, p);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lampe d'Aladdin (45).

/** 443c48 : slot 2 : point de mise à feu (le bec) et polygone selon le retournement en X. */
function lampReset(world: World, p: Part): void {
  const flipped = (p.flags10 & F10.FLIP_X) !== 0;
  setAnchor(p, 4, flipped ? 4 : 0x30, 3);
  usePolygon(world, p, flipped ? 1 : 0);
}

/**
 * 443cad : slot 1. Allumée, la flamme (début de l'état 2, 0x481eb8) brûle au bout du bec. Éteinte, la lampe frotte de
 * temps en temps (compte à rebours global 0x4780bc, relancé à 40 … 239 pas tirés au hasard, 4520a4).
 */
function lampRun(world: World, p: Part): void {
  heat(p);
  const lit = stateFrame(world, 0x2d, 2);
  if (p.f24 !== 0) {
    flicker(world, p, lit, 4, 6);
    updateGeometry(world, p);
    if (p.flags10 & F10.FLIP_X) flame(world, p, -5, 0xa, -0x18, 5);
    else flame(world, p, 0x28, 0x37, -0x18, 5);
    return;
  }
  if (!(world.animFlags & 1)) return;
  if (p.frame !== 0) {
    p.frame++;
    if (p.frame === lit) p.frame = 0;
    updateGeometry(world, p);
    return;
  }
  const g = pyroGlobals(world);
  g.lampTimer = (g.lampTimer - 1) | 0;
  if (g.lampTimer > 0) return;
  p.frame++;
  g.lampTimer = (world.rng.next() % 200) + 0x28;
  updateGeometry(world, p);
}

// ---------------------------------------------------------------------------------------------------------------------
// Allumette à ressort (75).

/** 0x478274 / 0x478279 : abscisse du point d'attache de la corde selon l'image (/2, au plus 4), sans et avec retournement. */
const MATCH_ROPE_X = [
  [34, 35, 37, 39, 41],
  [2, 1, -1, -3, -5],
] as const;

/** 446094 : slot 2 : point d'attache 0 (la corde) suivant l'image ; y = 7. */
function matchReset(_w: World, p: Part): void {
  let i = p.frame >> 1;
  if (i > 4) i = 4;
  setAnchor(p, 0, MATCH_ROPE_X[p.flags10 & F10.FLIP_X ? 1 : 0]![i]!, 7);
}

/**
 * 44611c : slot 1. Allumée, l'allumette se détend ; à la fin de la détente (début de l'état 3, 0x481f6c), la corde
 * passe à une cheville (72) créée à sa place, puis la flamme brûle (début de l'état 2, 0x48166c).
 */
function matchRun(world: World, p: Part): void {
  if (p.f24 === 0) return;
  p.flags10 |= 0x40;
  const lit = stateFrame(world, 0x4b, 2);
  const released = stateFrame(world, 0x4b, 3);
  if (p.frame >= lit && !(world.animFlags & 1)) p.frame = p.frame === 0x1b ? 0x20 : 0x1b;
  else p.frame++;
  if (p.frame < released) matchReset(world, p);
  if (p.frame === released) releaseRope(world, p);
  if (p.frame === stateFrame(world, 0x4b, -1)) p.frame = lit;
  if (p.frame >= lit) {
    if (p.flags10 & F10.FLIP_X) flame(world, p, 0x19, 0x28, -0x20, -2);
    else flame(world, p, -5, 0xa, -0x20, -2);
  }
  updateGeometry(world, p);
}

/** Fin de détente (44617d … 446255) : une cheville (72) prend la place de l'allumette au bout de la corde. */
function releaseRope(world: World, p: Part): void {
  const rope = ropeOf(p);
  const peg = recyclePart(world, 0x48);
  if (!peg) return;
  insertCreated(world, world.mobiles, peg);
  peg.ropes[0] = rope;
  peg.links[0] = p.links[0]!;
  const other = peg.links[0];
  if (other) {
    const k = linkIndex(p, other);
    if (k !== -1) other.links[k] = peg;
  }
  if (rope) {
    if (rope.end1 === p) rope.end1 = peg;
    else rope.end2 = peg;
  }
  if (p.flags10 & F10.FLIP_X) {
    peg.flags10 |= F10.FLIP_X;
    peg.px = (p.px - 6) | 0;
  } else peg.px = (p.px + 0x1c) | 0;
  peg.prevPx = peg.px;
  peg.fx = peg.px << 9;
  peg.py = peg.prevPy = p.py;
  peg.fy = peg.py << 9;
  updateGeometry(world, peg);
  // 445d52 : slot 2 de la cheville (points d'attache), appelé directement.
  world.call(2, peg);
  p.ropes[0] = null;
  p.links[0] = null;
}

/**
 * 4462ee : slot 5 (la corde tire). Cas 1 : compteur +0x18 du bloc de corde. Sinon, `kind` & 0x8018 : tirée du côté du
 * ressort (8, ou 0x10 retournée), elle résiste (1) ; tirée de l'autre côté, elle résiste si elle est allumée, et
 * s'allume sinon (sans le bit 0x8000).
 */
export function matchPulled(_w: World, self: Part, _puller: Part, kind: number): number {
  if (kind === 1) {
    const rope = ropeOf(self);
    if (rope) rope.n18 = (rope.n18 + 1) | 0;
    return 0;
  }
  const k = kind & 0x8018;
  const side = k & ~0x8000;
  const [hold, pull] = self.flags10 & F10.FLIP_X ? [0x10, 8] : [8, 0x10];
  if (side === hold) return 1;
  if (side === pull && self.f24 !== 0) return 1;
  if (k === pull && self.f24 === 0) self.f24 = 1;
  return 0;
}

export function register(r: HandlerRegistry): void {
  r.register(0x448798, "candle.reset", (w, p) => candleReset(w, p));
  r.register(0x4487e5, "candle.run", (w, p) => candleRun(w, p));
  r.register(0x446384, "flint.accept", (w, p, a) => flintAccept(w, p, a));
  r.register(0x4463b0, "flint.reset", (w, p) => flintReset(w, p));
  r.register(0x44640f, "flint.run", (w, p) => flintRun(w, p));
  r.register(0x443c48, "lamp.reset", (w, p) => lampReset(w, p));
  r.register(0x443cad, "lamp.run", (w, p) => lampRun(w, p));
  r.register(0x446094, "match.reset", (w, p) => matchReset(w, p));
  r.register(0x44611c, "match.run", (w, p) => matchRun(w, p));
  // 4462ab : slot 3 : toute action retourne en X, puis slot 2 et géométrie (affichage et 439695 laissés à l'éditeur).
  r.register(0x4462ab, "match.edit", (w, p, a) => {
    if (a) p.flags10 ^= F10.FLIP_X;
    matchReset(w, p);
    updateGeometry(w, p);
  });
  // Slot 5 : `World.pull` (tension des cordes, 43a31d) : (pièce, tireur, emplacement, drapeaux, masse, effort).
  r.register(0x4462ee, "match.pulled", (w, p, a, _slot = 0, flags = 0) => matchPulled(w, p, a as Part, flags));
}
