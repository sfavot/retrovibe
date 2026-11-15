/**
 * Réponse aux contacts trouvés par `collide.ts` : roulement (434382), rebond (434652) et choc entre deux pièces mobiles
 * (4347e3), appelés par 43373c (passe 6 du pas). Traduit de TIMWIN.EXE ; la forme générale (rotation dans le repère du
 * côté, élasticité et frottement en 1/256) est celle d'OpenTIM (`src/parts/mod.rs`), mais les arrondis viennent de l'exe.
 */
import { abs32, idiv, mul16, s16, u16 } from "./fixed";
import { clampVelocity, partAccel } from "./gravity";
import type { Part } from "./part";
import { angleOf, cos16, rotate, sin16 } from "./tables";
import type { World } from "./world";

/** 434335 : élasticité et frottement d'une pièce (balle programmable : ceux réglés dans l'éditeur). */
function material(world: World, p: Part): [number, number] {
  if (p.type === 0x57 && p.prog) return [p.prog[1]!, p.prog[2]!];
  const d = world.types.get(p.type);
  return [d.elasticity, d.friction];
}

/** Angle du côté touché, avec les cas des sols plats en bout de côté (434382 et 434652). */
function contactSlope(p: Part, other: Part, flat: boolean): number {
  let a = u16(p.contactAngle);
  if (a === 0 && other.type === 0x88) a = 0xf000;
  if (flat && (a === 0 || a === 0x8000)) {
    if (p.contactLeft === 0) a = u16(a + 0x1000);
    else if (p.contactRight === 0) a = u16(a + 0xf000);
  }
  return a;
}

/** Recale la position fine sur le bord du pixel dans le sens du mouvement (fin de 434382, 434652, 4347e3). */
function snapX(p: Part, positive: boolean): void {
  p.fx = positive ? (((p.px + 1) << 9) - 1) | 0 : p.px << 9;
}

function snapY(world: World, p: Part): void {
  p.fy = partAccel(p, world.types) >= 0 ? (((p.py + 1) << 9) - 1) | 0 : p.py << 9;
}

/** 434382 : roulement sur le support (pièce posée, +0x0C & 1). */
export function roll(world: World, p: Part): void {
  const other = p.contact!;
  const [, f1] = material(world, p);
  const [, f2] = material(world, other);
  const g = partAccel(p, world.types);
  let di = u16(p.contactAngle);
  if (di === 0 && other.type === 0x88) di = 0xf000;
  if (abs32(p.vx) < 0x400 && (di === 0 || di === 0x8000)) {
    if (p.contactLeft === 0) di = u16(di + 0x1000);
    else if (p.contactRight === 0) di = u16(di + 0xf000);
  }
  let v = p.vx;
  let friction: number;
  if (other.type === 5 && other.f24 !== 0) friction = 0x100;
  else if (p.type === 0x57) friction = f1;
  else friction = f1 > f2 ? f1 : f2;
  const c = s16(cos16(-di));
  const s = s16(sin16(-di));
  const absG = abs32(g);
  const normal = mul16(c, absG) >> 14;
  const sdi = s16(di);
  const along = (v > 0 && sdi > 0) || (v < 0 && sdi < 0) ? mul16(s, v) >> 14 : 0;
  const pressure = u16(abs32(normal) + abs32(along));
  const fr = mul16(pressure, friction) >> 8;
  let k = mul16(fr, c) >> 14;
  if (friction !== 0) k = (abs32(k) + (p.flags0C & 0x20 ? 0x20 : 2)) | 0;
  const pull = mul16(s, absG) >> 14;
  v = (v + (mul16(abs32(c), pull) >> 14)) | 0;
  if (v < 0) v = ((k + v) | 0) < 0 ? (k + v) | 0 : 0;
  else v = ((v - k) | 0) > 0 ? (v - k) | 0 : 0;
  p.vx = v;
  if ((sdi + 0x4000) & 0x8000) p.vy = mul16(sin16(-di), -v) >> 14;
  else p.vy = mul16(sin16(-di), v) >> 14;
  clampVelocity(p, world.types);
  if (p.px << 9 !== p.fx) snapX(p, v >= 0);
  snapY(world, p);
}

/** 434652 : rebond sur un côté (élasticité minimale des deux pièces, amortissement de 0x40). */
export function bounce(world: World, p: Part): void {
  const other = p.contact!;
  const [e1, f1] = material(world, p);
  const [e2] = material(world, other);
  const a = contactSlope(p, other, true);
  let [vx, vy] = rotate(p.vx, p.vy, a);
  let el = e1 < e2 ? e1 : e2;
  if (p.type === 0x3b && el >= 0x80) el = e1;
  if (f1 !== 0) {
    vy = -(mul16(vy, el) >> 8) | 0;
    if (vy < 0) vy = ((vy + 0x40) | 0) < 0 ? (vy + 0x40) | 0 : 0;
    else vy = ((vy - 0x40) | 0) > 0 ? (vy - 0x40) | 0 : 0;
  } else vy = -vy | 0;
  [vx, vy] = rotate(vx, vy, -a);
  p.vx = vx;
  p.vy = vy;
  clampVelocity(p, world.types);
  snapX(p, vx >= 0);
  snapY(world, p);
}

/** 43712c : angle de la droite qui joint les centres de deux pièces (montgolfière, panier : centres particuliers). */
export function centreAngle(a: Part, b: Part): number {
  const centreY = (p: Part) =>
    p.type === 0x4f ? (p.py + 0x13) | 0 : p.type === 0x0b ? (p.py + 0x10) | 0 : ((p.boxH >> 1) + p.py) | 0;
  const ax = ((a.boxW >> 1) + a.px) | 0;
  const bx = ((b.boxW >> 1) + b.px) | 0;
  return angleOf((ax - bx) | 0, (centreY(b) - centreY(a)) | 0);
}

const CONTAINERS = new Set([0x11, 0x6c, 0x0b]);

/** 4347e3 : choc entre deux pièces mobiles (conservation de la quantité de mouvement le long de la ligne des centres). */
export function hit(world: World, p: Part): void {
  const o = p.contact!;
  const k = 0xc0;
  if (p.type === 0x3f && o.type === 0x3f) world.sound(0xbf7, p);
  let container: Part | null = null;
  let content: Part | null = null;
  if (CONTAINERS.has(p.type)) {
    container = p;
    content = o;
  } else if (CONTAINERS.has(o.type)) {
    container = o;
    content = p;
  }
  let inside = false;
  if (container && content) {
    if (container.type === 0x0b) inside = ((content.py + content.boxH) | 0) < ((container.py + 0x1e) | 0);
    else inside = content.py > ((container.py + container.boxH - 0xe) | 0);
  }
  let v1x = p.vx;
  let v1y = p.vy;
  let v2x = o.vx;
  let v2y = o.vy;
  const angle = (s16(centreAngle(p, o)) - 0x4000) | 0;
  [v1x, v1y] = rotate(v1x, v1y, angle);
  [v2x, v2y] = rotate(v2x, v2y, angle);
  const away = v1x <= 0;
  if (away) v1x = -v1x | 0;
  const m1 = p.mass;
  const m2 = o.mass;
  const km1 = mul16(k, m1) >> 8;
  const km2 = mul16(k, m2) >> 8;
  const total = (m1 + m2) | 0;
  const a1 = mul16(m1, v1x);
  const a2 = mul16(m2, v2x);
  const b1 = mul16(km1, v1x);
  const b2 = mul16(km2, v2x);
  const c2 = mul16(km2, v1x);
  const c1 = mul16(km1, v2x);
  v1x = idiv((a1 + a2 + b2 - c2) | 0, total);
  v2x = idiv((a1 + b1 + a2 - c1) | 0, total);
  [v1x, v1y] = rotate(v1x, v1y, -angle);
  [v2x, v2y] = rotate(v2x, v2y, -angle);
  if (!away || container) {
    p.vx = v1x;
    p.vy = v1y;
  }
  o.vx = v2x;
  o.vy = v2y;
  if (container && content) {
    const left = (container.px + 5) | 0;
    const right = (container.px + container.boxW - 6) | 0;
    const mid = ((container.boxW >> 1) + container.px) | 0;
    const cx = ((content.boxW >> 1) + content.px) | 0;
    if (inside) {
      content.vx = cx < mid ? -abs32(content.vx) | 0 : abs32(content.vx);
    } else if (cx <= left || (cx >= mid && cx < right)) {
      content.vx = -abs32(content.vx) | 0;
      container.vx = cx > left ? 0 : abs32(container.vx);
    } else {
      content.vx = abs32(content.vx);
      container.vx = cx < right ? 0 : -abs32(container.vx) | 0;
    }
  }
  clampVelocity(p, world.types);
  clampVelocity(o, world.types);
  snapX(p, p.vx >= 0);
  snapY(world, p);
  snapX(o, o.vx >= 0);
  snapY(world, o);
}
