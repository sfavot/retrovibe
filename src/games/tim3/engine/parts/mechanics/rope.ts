/**
 * Cordes, câbles et poulies (types 10, 76, 7 ; bout de corde 49) : tension d'une corde sur la pièce qui vient de bouger,
 * extrémités et longueurs, liste auxiliaire des bascules tirées.
 *
 * Traduit de TIMWIN.EXE 43a31d (tension), 43a901, 43a0dc, 439f67, 43a093, 43a0bc, 43a2d9, 438db6, 43ada7 (bouts
 * d'édition). Correspondance OpenTIM (GPL-3.0, TEMIM) : `c_src/main.c` `stub_10a8_3cc1` (tension, « Accurate »),
 * `distance_to_rope_link` (10a8:42e6), `rope_calculate_flags`, `approximate_hypot_of_rope`, `update_rope_pos`,
 * `stub_10a8_4509` (liste « llama »), `structures/RopeData.csv`. TIM3 garde la même logique avec des champs 32 bits,
 * d'autres offsets (pièce +0x90 liens, +0xA8 cordes, +0xB0 ancrages ; longueurs dans +0xFC / +0x104 de la pièce corde)
 * et un type de plus pour la bascule (139).
 */
import { collide, intersect } from "../../collide";
import { abs32, idiv, mul16 } from "../../fixed";
import { clampVelocity } from "../../gravity";
import { updateGeometry } from "../../move";
import type { Part, RopeData } from "../../part";
import type { World } from "../../world";
import { insertCreated, newPart, recyclePart } from "../../zone";

export const ROPE_END = 0x31;
const PULLEY = 7;

/** 43a0bc(part, rope) : l'autre bout de la corde (`null` sans corde). */
export function otherEnd(part: Part, rope: RopeData | null): Part | null {
  if (!rope) return null;
  return part === rope.end1 ? rope.end2 : rope.end1;
}

/** 43a093(a, b) : rang de `a` dans les liens de corde de `b` (0, 1, ou −1). */
export function linkIndex(a: Part | null, b: Part): number {
  if (a === b.links[0]) return 0;
  if (a === b.links[1]) return 1;
  return -1;
}

/** Hypoténuse approchée de 43a0dc et 43a901 : grand côté + petit/4 + petit/8. */
function hypot(ax: number, ay: number): number {
  return ax < ay ? ((ax >> 2) + (ax >> 3) + ay) | 0 : ((ay >> 2) + (ay >> 3) + ax) | 0;
}

/** Point d'attache de corde `slot` d'une pièce (position en pixels + ancrage +0xB0). */
function anchorX(p: Part, slot: number): number {
  return (p.px + p.ropeAnchor[2 * slot]!) | 0;
}
function anchorY(p: Part, slot: number): number {
  return (p.py + p.ropeAnchor[2 * slot + 1]!) | 0;
}

/**
 * 43a901 (OpenTIM `distance_to_rope_link`) : distance du bout `part` de la corde au point suivant (pièce liée, ou
 * extrémité de la corde de la poulie liée). Rend [distance, dx, dy] (bout − point suivant).
 */
export function linkDistance(rope: RopeData, part: Part): [number, number, number] {
  let from: Part;
  let slot: number;
  if (part === rope.end1) {
    from = part;
    slot = rope.slot1;
  } else {
    from = rope.end2!;
    slot = rope.slot2;
  }
  const x = anchorX(from, slot);
  const y = anchorY(from, slot);
  const next = from.links[slot]!;
  const i = linkIndex(from, next);
  let nx: number;
  let ny: number;
  if (next.type === PULLEY) {
    const e = next.ropes[0]!.ends;
    nx = e[2 * (1 - i)]!;
    ny = e[2 * (1 - i) + 1]!;
  } else {
    nx = anchorX(next, i);
    ny = anchorY(next, i);
  }
  const dx = (x - nx) | 0;
  const dy = (y - ny) | 0;
  return [hypot(abs32(dx), abs32(dy)), dx, dy];
}

/**
 * 43a0dc(rope, mode, side) (OpenTIM `approximate_hypot_of_rope`) : longueur du premier tronçon de la corde depuis le
 * bout `side` (0 : end1, 1 : end2) jusqu'à la poulie suivante ou l'autre bout. Mode 1 ou 2 : extrémités du pas
 * précédent (+0x34) ; sinon courantes (+0x24).
 */
export function segmentLength(rope: RopeData, mode: number, side: number): number {
  let from: number;
  let target: RopeData;
  let to: number;
  if (side === 0 || rope.end2 === null) {
    from = 0;
    const next = rope.end1!.links[rope.slot1];
    if (next === rope.end2) {
      target = rope;
      to = 1;
    } else {
      const r = next?.ropes[0] ?? null;
      if (!r) return 0;
      target = r;
      to = 0;
    }
  } else {
    from = 1;
    const next = rope.end2.links[rope.slot2];
    if (next === rope.end1) {
      target = rope;
      to = 0;
    } else {
      const r = next?.ropes[0] ?? null;
      if (!r) return 0;
      target = r;
      to = 1;
    }
  }
  const a = mode === 1 || mode === 2 ? rope.prevEnds : rope.ends;
  const b = mode === 1 || mode === 2 ? target.prevEnds : target.ends;
  const dx = abs32((a[2 * from]! - b[2 * to]!) | 0);
  const dy = abs32((a[2 * from + 1]! - b[2 * to + 1]!) | 0);
  return hypot(dx, dy);
}

/**
 * 438db6 (OpenTIM `update_rope_pos`) : extrémités de la corde (+0x24) depuis les points d'attache des deux bouts, puis
 * celles des poulies traversées depuis end1 ; en édition, longueurs des deux premiers tronçons (+0xFC, +0x104 de la
 * pièce corde).
 */
export function updateRopeEnds(world: World, rope: RopeData | null): void {
  if (!rope || !rope.end1) return;
  const a = rope.end1;
  rope.ends[0] = anchorX(a, rope.slot1);
  rope.ends[1] = anchorY(a, rope.slot1);
  const b = rope.end2;
  if (b) {
    rope.ends[2] = anchorX(b, rope.slot2);
    rope.ends[3] = anchorY(b, rope.slot2);
  }
  let p = a.links[rope.slot1];
  while (p && p.type === PULLEY) {
    const r = p.ropes[0]!;
    for (let i = 0; i < 2; i++) {
      r.ends[2 * i] = anchorX(p, i);
      r.ends[2 * i + 1] = anchorY(p, i);
    }
    p = p.links[0];
  }
  if (world.running) return;
  rope.ropePart.fFC = segmentLength(rope, 3, 0);
  rope.ropePart.f104 = segmentLength(rope, 3, 1);
}

/**
 * Fin de 43ada7 pour une pièce corde (10, 76) : bouts et emplacements d'édition, cordes recopiées chez les bouts, poulies
 * traversées (+0xAC), extrémités, longueurs des deux tronçons (+0xFC/+0x100, +0x104/+0x108), compteur +0x18 à 0.
 */
export function resetRope(world: World, p: Part): void {
  const r = p.ropes[0];
  if (!r) return;
  r.end1 = r.origEnd1;
  r.end2 = r.origEnd2;
  r.slot1 = r.origSlot1;
  r.slot2 = r.origSlot2;
  r.end1!.ropes[r.slot1 & 1] = r;
  r.end2!.ropes[r.slot2 & 1] = r;
  let q: Part | null = r.end1;
  let next = q!.links[r.slot1] ?? null;
  while (q) {
    if (q.type === PULLEY) q.ropes[1] = r;
    if (q === r.end2) q = null;
    else {
      q = next;
      next = next!.links[0] ?? null;
    }
  }
  updateRopeEnds(world, r);
  p.fFC = p.f100 = segmentLength(r, 3, 0);
  p.f104 = p.f108 = segmentLength(r, 3, 1);
  r.n18 = r.n1C = 0;
}

/**
 * 439f67(rope, side, down) (OpenTIM `rope_calculate_flags`) : sens de la traction vu du bout `side` qui monte
 * (`down` 0) ou descend (1). 1 : l'autre brin va dans l'autre sens ; sinon 8 ou 0x10 (le point suivant est à gauche ou
 * à droite) | 2 ou 4 (même sens ou sens contraire).
 */
export function ropeFlags(rope: RopeData, side: number, down: number): number {
  const other = 1 - side;
  let from: Part;
  let fromSlot: number;
  let to: Part;
  let toSlot: number;
  if (side !== 0) {
    from = rope.end2!;
    fromSlot = rope.slot2;
    to = rope.end1!;
    toSlot = rope.slot1;
  } else {
    from = rope.end1!;
    fromSlot = rope.slot1;
    to = rope.end2!;
    toSlot = rope.slot2;
  }
  const nextFrom = from.links[fromSlot]!;
  const nextTo = to.links[toSlot]!;
  let r14: RopeData;
  let r18: RopeData;
  let c: number;
  let e: number;
  if (to === nextFrom) {
    r14 = r18 = rope;
    c = other;
    e = side;
  } else {
    r14 = nextFrom.ropes[0]!;
    r18 = nextTo.ropes[0]!;
    c = 1 - side;
    e = 1 - other;
  }
  const lr = r18.ends[2 * e]! < rope.ends[2 * other]! ? 8 : 0x10;
  if (down === 0) {
    if (r14.ends[2 * c + 1]! < rope.ends[2 * side + 1]!) return 1;
    return r18.ends[2 * e + 1]! <= rope.ends[2 * other + 1]! ? lr | 2 : lr | 4;
  }
  if (r14.ends[2 * c + 1]! > rope.ends[2 * side + 1]!) return 1;
  return r18.ends[2 * e + 1]! >= rope.ends[2 * other + 1]! ? lr | 4 : lr | 2;
}

/** 43a2d9(part, sx, sy, axes) : vitesse déduite du déplacement en pixels (<< 9 − s), bridée. */
function velocityFromMove(world: World, p: Part, sx: number, sy: number, axes: number): void {
  if (axes & 1) p.vx = ((p.px - p.prevPx) << (9 - sx)) | 0;
  if (axes & 2) p.vy = ((p.py - p.prevPy) << (9 - sy)) | 0;
  clampVelocity(p, world.types);
}

/**
 * Bout de corde (0x31) tiré au-delà de la poulie : la corde glisse d'un tronçon (43a64c … 43a7b5). `first` : le bout
 * libre est end1.
 */
function slipOverPulley(rope: RopeData, free: Part, excess: number, first: boolean): void {
  const rp = rope.ropePart;
  if (first) {
    rp.fFC = (rp.fFC - excess) | 0;
    if (rp.fFC < 0) {
      excess = (excess + rp.fFC) | 0;
      // 4305ea(rp, 3) sous 0x4815b0 = 0x1000 : dessin seulement.
      const a = free.links[rope.slot1]!;
      const b = a.links[0]!;
      const i = linkIndex(a, b);
      free.links[rope.slot1] = b;
      b.links[i] = free;
      a.links[0] = a.links[1] = null;
      rp.fFC = segmentLength(rope, 3, 0);
    }
    rp.f104 = (rp.f104 + excess) | 0;
  } else {
    rp.f104 = (rp.f104 - excess) | 0;
    if (rp.f104 < 0) {
      excess = (excess + rp.f104) | 0;
      const a = free.links[rope.slot2]!;
      const b = a.links[1]!;
      const i = linkIndex(a, b);
      free.links[rope.slot2] = b;
      b.links[i] = free;
      a.links[0] = a.links[1] = null;
      rp.f104 = segmentLength(rope, 3, 1);
    }
    rp.fFC = (rp.fFC + excess) | 0;
  }
}

/**
 * 43a31d (OpenTIM `stub_10a8_3cc1`) : la pièce `p` vient de bouger et tient une corde (+0xA8). Si le tronçon de son
 * côté dépasse sa longueur, on reprend du mou de l'autre côté, on entraîne l'autre bout s'il est mobile et plus léger,
 * sinon on ramène `p` sur le cercle de la corde (vitesse recalculée) et on prévient l'autre bout (slot 5, ou liste
 * auxiliaire pour une bascule). Rend 1 si `p` a été ramenée.
 */
export function ropeTension(world: World, p: Part): number {
  let result = 0;
  const viaPulley = p.links[0]!.type === PULLEY;
  const dirY = p.py < p.prevPy ? 0 : p.py > p.prevPy ? 1 : -1;
  const rope = p.ropes[0]!;
  const rp = rope.ropePart;
  const other = otherEnd(p, rope)!;
  const first = p === rope.end1;
  const side = first ? 0 : 1;
  const slot = first ? rope.slot2 : rope.slot1;
  let len = first ? rp.fFC : rp.f104;
  let otherLen = first ? rp.f104 : rp.fFC;
  let [dOther] = linkDistance(rope, other);
  const [d, dx, dy] = linkDistance(rope, p);
  let excess = (d - len) | 0;
  if (p.type !== ROPE_END) {
    const slack = (dOther - otherLen) | 0;
    if (excess > 0 && slack < 0) {
      excess = (excess + slack) | 0;
      let rem = 0;
      if (excess <= 0) {
        rem = excess;
        excess = 0;
      }
      len = (d - excess) | 0;
      otherLen = (dOther - rem) | 0;
      if (first) {
        rp.fFC = len;
        rp.f104 = otherLen;
      } else {
        rp.f104 = len;
        rp.fFC = otherLen;
      }
    }
  }
  if (excess > 0 && other.flags0C & 0x1000 && other.type !== ROPE_END && p.type !== ROPE_END && p.mass > other.mass) {
    let take = idiv((mul16(abs32(excess), (p.mass - other.mass) | 0) + p.mass) | 0, p.mass);
    const atLeast1 = take > 1 ? take : 1;
    take = atLeast1 < abs32(otherLen) ? atLeast1 : abs32(otherLen);
    if (take !== 0) {
      if (first) {
        rp.f104 = (rp.f104 - take) | 0;
        otherLen = rp.f104;
        ropeTension(world, other);
        other.flags0C &= ~0xf;
        collide(world, other);
        [dOther] = linkDistance(rope, other);
        const diff = (dOther - otherLen) | 0;
        if (diff !== 0) {
          rp.f104 = (rp.f104 + diff) | 0;
          take = (take - diff) | 0;
        }
        if (take !== 0) {
          rp.fFC = (rp.fFC + take) | 0;
          len = rp.fFC;
          excess = (d - len) | 0;
        }
      } else {
        rp.fFC = (rp.fFC - take) | 0;
        otherLen = rp.fFC;
        ropeTension(world, other);
        other.flags0C &= ~0xf;
        collide(world, other);
        [dOther] = linkDistance(rope, other);
        const diff = (dOther - otherLen) | 0;
        if (diff !== 0) {
          rp.fFC = (rp.fFC + diff) | 0;
          take = (take - diff) | 0;
        }
        if (take !== 0) {
          rp.f104 = (rp.f104 + take) | 0;
          len = rp.f104;
          excess = (d - len) | 0;
        }
      }
    }
  }
  if (excess <= 0) return result;
  if (other.type === ROPE_END && p.type !== ROPE_END) {
    if (viaPulley) slipOverPulley(rope, other, excess, other === rope.end1);
    return result;
  }
  result = 1;
  p.px = (p.px + idiv(mul16(dx, len), d) - dx) | 0;
  p.fx = p.px << 9;
  p.py = (p.py + idiv(mul16(dy, len), d) - dy) | 0;
  p.fy = p.py << 9;
  updateGeometry(world, p);
  velocityFromMove(world, p, 0, 0, 1);
  if (p.px === p.prevPx) p.vy = 0;
  if (p.type === ROPE_END || dirY === -1) return result;
  const flags = ropeFlags(rope, side, dirY === 0 ? 0 : 1);
  if (other.type === 3 || other.type === 0x8b) {
    let s = 0;
    if (flags & 4) {
      if (slot === 0) {
        if (other.frame > 0) s = -1;
      } else if (other.frame < 2) s = 1;
    } else if (slot === 0) {
      if (other.frame < 2) s = 1;
    } else if (other.frame > 0) s = -1;
    if (world.auxInsert(p, other)) {
      other.f24 = s;
      other.momentum = p.momentum;
    }
  } else world.pull(p, other, flags, p.mass, p.momentum);
  return result;
}

/**
 * 442af6(outil, segment) : coupe la première corde (10 ; aussi le câble 76 pour la cisaille 77) dont un tronçon croise
 * `line` (relatif à l'outil, 41355c). La corde garde le tronçon côté end1, terminé par un bout de corde (0x31) au point
 * de coupe ; une nouvelle pièce corde (432d78) prend l'autre côté avec un second bout. Extrémités et longueurs
 * recalculées comme en édition (0x4815b0 = 0x1000), extrémités précédentes recopiées.
 */
export function cutRopes(world: World, tool: Part, line: readonly number[]): void {
  const seg = new Int32Array(4);
  const out = new Int32Array(2);
  const cut = Int32Array.from(line);
  for (const rp of [...world.statics]) {
    if (!((tool.type === 0x4d && rp.type === 0x4c) || rp.type === 10)) continue;
    const rope = rp.ropes[0]!;
    const first = rope.end1!;
    const last = rope.end2;
    let cur: Part | null = first;
    let slot = rope.slot1;
    let nextSlot = 0;
    let next: Part | null = cur.links[slot] ?? null;
    while (cur && next) {
      if (cur !== first) slot = 1;
      seg[0] = (cur.ropeAnchor[2 * slot]! + cur.drawX - tool.px) | 0;
      seg[1] = (cur.ropeAnchor[2 * slot + 1]! + cur.drawY - tool.py) | 0;
      if (next === last) nextSlot = rope.slot2;
      seg[2] = (next.ropeAnchor[2 * nextSlot]! + next.drawX - tool.px) | 0;
      seg[3] = (next.ropeAnchor[2 * nextSlot + 1]! + next.drawY - tool.py) | 0;
      if (!intersect(cut, seg, out)) {
        if (next === last) break;
        cur = next;
        next = next.links[0] ?? null;
        continue;
      }
      const e1 = recyclePart(world, ROPE_END);
      if (!e1) return;
      const e2 = recyclePart(world, ROPE_END);
      if (!e2) return;
      const part2 = newPart(world, rp.type);
      if (!part2) return;
      insertCreated(world, world.mobiles, e1);
      e1.px = (tool.px + out[0]!) | 0;
      e1.py = (tool.py + out[1]!) | 0;
      insertCreated(world, world.mobiles, e2);
      e2.px = e1.px;
      e2.py = e1.py;
      insertCreated(world, world.statics, part2);
      const r2 = part2.ropes[0]!;
      r2.end1 = e2;
      r2.end2 = last;
      r2.slot1 = 0;
      r2.slot2 = rope.slot2;
      e2.links[0] = next;
      e2.ropes[0] = r2;
      if (next.type === PULLEY) {
        next.ropes[1] = r2;
        next.links[1] = e2;
      } else {
        next.ropes[nextSlot] = r2;
        next.links[nextSlot] = e2;
      }
      last!.ropes[r2.slot2 & 1] = r2;
      rope.end2 = e1;
      rope.slot2 = 0;
      e1.links[0] = cur;
      e1.ropes[0] = rope;
      if (cur.type === PULLEY) cur.links[0] = e1;
      else cur.links[slot] = e1;
      for (const e of [e1, e2]) {
        e.prevPx = e.px;
        e.fx = e.px << 9;
        e.prevPy = e.py;
        e.fy = e.py << 9;
        updateGeometry(world, e);
      }
      const running = world.running;
      world.running = false;
      for (const r of [rope, r2]) {
        updateRopeEnds(world, r);
        r.prevEnds.set(r.ends);
      }
      world.running = running;
      return;
    }
  }
}
