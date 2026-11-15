/**
 * Bascule (3, et 139 qui partage ses handlers) : trois positions (image 0, 1, 2), basculée par une pièce qui tombe sur un
 * bout (liste auxiliaire 0x4815f8) ou tirée par une corde ; elle lance les pièces posées et frappe celles sous ses bouts.
 * Traduit de TIMWIN.EXE 43ea9c (slot 0), 43eb94 (slot 2), 43ec0c (slot 3), 43ec68 (slot 1), 43ef32 (slot 5), 43f050,
 * 43f12e, 43f188, 434fab. Correspondance OpenTIM (GPL-3.0, TEMIM) : `teeter_totter_rope` et le run de la bascule dans
 * `src/parts/mod.rs` (même mécanique, autres tables) ; le binaire de TIM3 fait foi.
 */
import { collide, intersect } from "../../collide";
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import { boxScan, chain } from "../../zone";
import { strikeZone } from "../creatures/strike";
import type { HandlerRegistry } from "../registry";
import { setPoly, stateFirst } from "./common";
import { otherEnd, ropeFlags } from "./rope";

/** 0x477de4 … 0x477df6 (mots {x, y}) : points d'attache des deux cordes selon l'image (l'image 3 lit la table suivante). */
const ANCHORS = [5641, 2571, 269, 326, 2631, 5704, 6661, 3590, 522, 584, 3660, 6734] as const;
/** 0x477dfc : segment de la planche par image (relatif à la bascule), pour lancer les pièces posées (434fab). */
const PLANK = [
  [0, 32, 79, 3],
  [0, 17, 79, 17],
  [0, 3, 79, 32],
] as const;

/** 43eb94 (slot 2) : points d'attache des cordes et polygone selon l'image. */
function seesawReset(world: World, p: Part): void {
  const f = p.frame;
  const a = f === 3 ? ANCHORS[f]! : ANCHORS[6 + f]!;
  const b = f === 3 ? ANCHORS[3 + f]! : ANCHORS[9 + f]!;
  p.ropeAnchor[0] = a & 0xff;
  p.ropeAnchor[1] = a >> 8;
  p.ropeAnchor[2] = b & 0xff;
  p.ropeAnchor[3] = b >> 8;
  setPoly(world, p, f);
}

/** 43ec0c (slot 3) : un code non nul fait passer la bascule d'un bout à l'autre (image 0 ↔ 2). */
function seesawEdit(world: World, p: Part, action: number): void {
  if (action !== 0) p.frame = p.frame !== 0 ? 0 : 2;
  p.editFrame = p.frame;
  seesawReset(world, p);
  updateGeometry(world, p);
  world.redraw(p, 2);
}

/**
 * 43ea9c (slot 0) : une pièce `c` touche la bascule. Sur un bout qui peut descendre, elle s'inscrit dans la liste
 * auxiliaire (sens +0x24, effort +0x60) et perd son contact ; rend 1 si la bascule se comporte comme un appui.
 */
function seesawAccept(world: World, c: Part): number {
  const s = c.contact!;
  if (s.flags10 & 0x200) return 1;
  const k = c.contactIndex;
  let solid = k === 0 || k === 2 || k === 6 ? 0 : 1;
  let dir = 0;
  if (k === 0) {
    const x = ((c.frameW >> 1) + c.px - s.px) | 0;
    if (x >= 0x2c) {
      if (s.frame === 2) solid = 1;
      else dir = 1;
    } else if (x <= 0x24) {
      if (s.frame === 0) solid = 1;
      else dir = -1;
    } else solid = 1;
  } else if (k === 2) {
    if (s.frame === 0) solid = 1;
    else dir = -1;
  } else if (k === 6) {
    if (s.frame === 2) solid = 1;
    else dir = 1;
  }
  if (solid) return 1;
  if (world.auxInsert(c, s)) {
    s.f24 = dir;
    s.momentum = c.momentum;
    c.contact = null;
    return 0;
  }
  return 1;
}

/**
 * 43f050(from, s, bits, masse, effort) : la bascule qui bouge tire sur les cordes attachées (sauf vers `from`) : slot 5
 * de l'autre bout avec les drapeaux de 439f67 | `bits`. Rend 1 dès qu'un bout résiste (ou si la bascule est bloquée).
 */
function pullRopes(world: World, from: Part | null, s: Part, bits: number, mass: number, force: number): number {
  if (s.flags10 & 0x200) return 1;
  let res = 0;
  for (let i = 0; i < 2 && res === 0; i++) {
    const rope = s.ropes[i];
    if (!rope) continue;
    const other = otherEnd(s, rope)!;
    if (other === from) continue;
    const first = s === rope.end1;
    const mine = first ? rope.slot1 : rope.slot2;
    const theirs = first ? rope.slot2 : rope.slot1;
    const down = s.f24 > 0 ? (mine !== 0 ? 1 : 0) : mine === 0 ? 1 : 0;
    res = world.pull(s, other, ropeFlags(rope, first ? 0 : 1, down) | bits, mass, force, theirs);
  }
  return res;
}

/**
 * 43ef32 (slot 5) : la bascule `s` est tirée par `puller` par sa corde `slot`. Mode 1 : comptage. Sinon elle bascule
 * vers le bout tiré si elle le peut (en propageant aux autres cordes), et rend 1 si elle est bloquée.
 */
function seesawPull(world: World, s: Part, puller: Part, slot: number, flags: number, mass: number, force: number): number {
  const rope = s.ropes[slot]!;
  const f = flags & 0x8007;
  const mode = f & ~0x8000;
  if (mode !== 1 && rope.n18 !== 0) {
    if (!(f & 0x8000)) rope.n18 = (rope.n18 - 1) | 0;
    return 0;
  }
  const saved = s.f24;
  let blocked = 0;
  let dir = 0;
  if (mode === 4) {
    if (slot === 0) {
      if (s.frame === 0) blocked = 1;
      else dir = -1;
    } else if (s.frame === 2) blocked = 1;
    else dir = 1;
  } else if (mode === 2) {
    if (slot === 0) {
      if (s.frame === 2) blocked = 1;
      else dir = 1;
    } else if (s.frame === 0) blocked = 1;
    else dir = -1;
  }
  if (!blocked && mode !== 1) {
    s.f24 = dir;
    blocked = pullRopes(world, puller, s, f & 0x8000, mass, force);
    if (f & 0x8000) s.f24 = saved;
    else if (!blocked) s.flags10 |= 0x400;
  }
  if (blocked) s.flags10 |= 0x200;
  if (s.flags10 & 0x200) return 1;
  if (f === 1) rope.n18 = (rope.n18 + 1) | 0;
  return 0;
}

/** 43f12e : vitesse de lancement selon la masse. */
function launchSpeed(b: Part): number {
  const m = b.mass;
  if (m < 2) return 0x1c00;
  if (m < 6) return 0x1a00;
  if (m < 10) return 0x1800;
  if (m < 0x15) return 0x1600;
  if (m < 0x79) return 0x1400;
  if (m < 0x97) return 0x1200;
  return 0x1000;
}

/**
 * 434fab(p, filtre, segment) : pièces dont un côté du polygone coupe le segment (relatif à `p`), chaînées en +0xC4.
 * Écart volontaire : pour une pièce sans polygone, l'exe garde le pointeur de sommets précédent, non initialisé si
 * c'est la première pièce parcourue (comportement indéfini, `docs/tim3/engine.md` § 6 bis) ; ici elle est ignorée.
 */
export function polygonScan(world: World, p: Part, filter: number, seg: readonly number[]): void {
  p.bucketNext = null;
  const a = Int32Array.from(seg);
  const e = new Int32Array(4);
  const out = new Int32Array(2);
  const list = filter & 0x2000 ? (filter & 0x1000 ? [...world.staticThenMobile()] : [...world.statics]) : [...world.mobiles];
  for (const b of list) {
    const poly = b.poly;
    if (!poly) continue;
    const n = b.vertexCount;
    for (let k = 0; k < n; k++) {
      const j = k + 1 === n ? 0 : k + 1;
      e[0] = (b.px + poly.x[k]! - p.px) | 0;
      e[1] = (b.py + poly.y[k]! - p.py) | 0;
      e[2] = (b.px + poly.x[j]! - p.px) | 0;
      e[3] = (b.py + poly.y[j]! - p.py) | 0;
      if (intersect(a, e, out)) {
        b.bucketNext = p.bucketNext;
        p.bucketNext = b;
        break;
      }
    }
  }
}

/** 43f188(p, mode, x0, x1, y0, y1) : fixes de la zone (434eff), puis frappe (43dc73). */
function strike(world: World, p: Part, mode: number, x0: number, x1: number, y0: number, y1: number): void {
  boxScan(world, p, 0x2000, x0, x1, y0, y1);
  strikeZone(world, p, mode, x0, x1, y0, y1);
}

/** 43ec68 (slot 1) : bascule demandée (+0x24) : cordes, image, lancement des pièces posées ; frappes sous les bouts. */
function seesawRun(world: World, s: Part): void {
  if (s.f24 !== 0) {
    s.flags10 |= 0x40;
    if (s.flags10 & 0x400) s.frame = (s.frame + s.f24) | 0;
    else if (pullRopes(world, null, s, 0x8000, 1000, s.momentum)) s.flags10 |= 0x200;
    else {
      pullRopes(world, null, s, 0, 1000, s.momentum);
      s.frame = (s.frame + s.f24) | 0;
    }
    if (s.frame !== s.framePrev) {
      seesawReset(world, s);
      if (s.framePrev === 0 || s.framePrev === 2) world.sound(0xc43, s);
      updateGeometry(world, s);
      const mid = ((s.frameW >> 1) + s.px) | 0;
      polygonScan(world, s, 0x1000, PLANK[s.frame]!);
      for (const b of chain(s)) {
        const bx = ((b.frameW >> 1) + b.px) | 0;
        const v = launchSpeed(b);
        if (s.f24 === -1) {
          if (bx < mid) {
            b.vy = v;
            b.vx = -(v >> 2) | 0;
          } else {
            b.vy = -v | 0;
            b.vx = v >> 2;
          }
        } else if (s.f24 === 1) {
          if (bx < mid) {
            b.vy = -v | 0;
            b.vx = -(v >> 2) | 0;
          } else {
            b.vy = v;
            b.vx = v >> 2;
          }
        }
        if (b.vy < 0) {
          b.prevPy = (b.py - 0x10) | 0;
          collide(world, b);
          b.prevPy = (b.py + 0x10) | 0;
          s.flags10 |= 0x2000;
          collide(world, b);
          s.flags10 &= ~0x2000;
          b.prevPy = b.py;
          b.fy = b.py << 9;
        } else {
          b.prevPy = (b.py + 0x10) | 0;
          collide(world, b);
          b.prevPy = (b.py - 0x10) | 0;
          s.flags10 |= 0x2000;
          collide(world, b);
          s.flags10 &= ~0x2000;
          b.prevPy = b.py;
          b.fy = (((b.py + 1) << 9) - 1) | 0;
        }
        if (b.type === 0x36) {
          const fly = stateFirst(world, 0x36, 8);
          if (b.frame < fly) b.frame = fly;
        }
      }
    }
    s.f24 = 0;
    s.momentum = 0;
  }
  const f = s.frame;
  const prev = s.framePrev;
  if (f === 1 && prev === 0) {
    strike(world, s, 0, 0, 0x20, 0x10, 0x1f);
    strike(world, s, 1, 0x34, 0x4f, 0xc, 0x18);
  } else if (f === 2 && prev === 1) {
    strike(world, s, 0, 0, 0x20, 0, 0x10);
    strike(world, s, 1, 0x34, 0x4f, 0x18, 0x26);
  } else if (f === 1 && prev === 2) {
    strike(world, s, 1, 0, 0x16, 0xa, 0x10);
    strike(world, s, 0, 0x34, 0x4f, 0x10, 0x20);
  } else if (f === 0 && prev === 1) {
    strike(world, s, 1, 0, 0x16, 0x15, 0x26);
    strike(world, s, 0, 0x34, 0x4f, 0, 0x10);
  }
}

export function register(r: HandlerRegistry): void {
  r.register(0x43ea9c, "seesaw.accept", (w, _p, a) => seesawAccept(w, a as Part));
  r.register(0x43eb94, "seesaw.reset", (w, p) => seesawReset(w, p));
  r.register(0x43ec0c, "seesaw.edit", (w, p, a) => seesawEdit(w, p, typeof a === "number" ? a : 0));
  r.register(0x43ec68, "seesaw.run", (w, p) => seesawRun(w, p));
  r.register(0x43ef32, "seesaw.pull", (w, p, a, slot = 0, flags = 0, mass = 0, force = 0) =>
    seesawPull(w, p, a as Part, slot, flags, mass, force),
  );
}
