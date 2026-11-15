/**
 * Lancer de rayon des lasers (91, 92, 93) et du mélangeur de faisceaux (95) : noyau partagé, exposé au groupe `electric`
 * qui porte les handlers propres de ces types. Traduit de TIMWIN.EXE 43c65c (slot 7 : tampon du faisceau), 43ce78
 * (tracé, miroirs 94), 43d15b (faisceau contre polygone), 43d078 et 43d379 (première pièce touchée et sa réaction),
 * 43d013 (passe lasers de 433334), 43d43e (pièces chauffées par le faisceau, +0x104). Pièces propres à TIM3.
 *
 * Non traduits : 43ce36 et 43cdfd / 413388 (zones à redessiner, couleur du faisceau : affichage) ; 0x481580 (décalage
 * de l'aire, toujours 0 dans le banc) est ignoré.
 */
import { intersect } from "../../collide";
import { computeEdgeAngles } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";

/** 0x477d04 : nouvelle direction après un miroir (94), [direction][image du miroir] ; 4 : le faisceau s'arrête. */
const MIRROR = [4, 4, 1, 3, 0, 4, 4, 2, 3, 1, 4, 4, 4, 0, 2, 4] as const;
/** 0x477d84 / 0x477da4 : départ du faisceau (laser ; mélangeur 95) selon la direction (0 : droite, 1 : bas, 2 : gauche, 3 : haut). */
const ORIGIN = [51, 26, 26, 51, -1, 26, 26, -1] as const;
const ORIGIN_95 = [39, 20, 19, 39, 1, 20, 19, -1] as const;
/** 0x477dc4 : longueur maximale d'un tronçon, par direction. */
const STEP = [592, 0, 0, 592, -592, 0, 0, -592] as const;
/** 0x477d44 : image (mod 7) de la prise laser 96 qui répond au mélangeur, selon les faisceaux reçus (+0x24, 0 … 7). */
const MIXER_PLUG = [7, 3, 2, 6, 1, 4, 5, 0] as const;
/** Types que le tracé (43ce78) traverse : murs fins, bascules, aquarium… */
const TRANSPARENT = new Set([1, 0x30, 0x3c, 0x53, 0x55, 0x7d, 3, 0x0f, 0x10, 0x25, 0x37, 0x49, 0x4d, 0x8b]);

/** 43c65c (slot 7 de 91 … 93) : tampon du faisceau (+0x90 et +0x98). L'initialisation de type est dans `types.ts`. */
export function allocBeam(p: Part | null | undefined): number {
  if (p) p.beam = new Int32Array(32);
  return 1;
}

/**
 * 43d15b(p, a, b) : le segment a → b (points du tampon) coupe-t-il un côté du polygone de `p` ? Test grossier sur la boîte
 * (+0x7C), puis côté par côté (41355c) ; b est raccourci au point de coupe, `edge` reçoit le numéro du côté. Pour 95, 96
 * et 148, un point de coupe égal à a suffit ; pour les autres, il doit différer de a et de b.
 */
function beamHits(p: Part, seg: Int32Array, a: number, b: number, edge: { i: number }): boolean {
  const x = p.px;
  const y = p.py;
  const r = (p.boxW + x) | 0;
  const bt = (p.boxH + y) | 0;
  if (seg[a]! < x && seg[b]! < x) return false;
  if (r < seg[a]! && r < seg[b]!) return false;
  if (seg[a + 1]! < y && seg[b + 1]! < y) return false;
  if (bt < seg[a + 1]! && bt < seg[b + 1]!) return false;
  const poly = p.poly;
  if (!poly) return false;
  const n = p.vertexCount;
  const e = new Int32Array(4);
  const ray = new Int32Array(4);
  const out = new Int32Array(2);
  let hit = false;
  for (let k = 1; k <= n; k++) {
    const sx = (x + poly.x[k - 1]!) | 0;
    const sy = (y + poly.y[k - 1]!) | 0;
    const j = k === n ? 0 : k;
    // L'exe soustrait le départ du côté à lui-même : le côté part de (0, 0).
    e[0] = 0;
    e[1] = 0;
    e[2] = (x + poly.x[j]! - sx) | 0;
    e[3] = (y + poly.y[j]! - sy) | 0;
    ray[0] = (seg[a]! - sx) | 0;
    ray[1] = (seg[a + 1]! - sy) | 0;
    ray[2] = (seg[b]! - sx) | 0;
    ray[3] = (seg[b + 1]! - sy) | 0;
    if (!intersect(e, ray, out)) continue;
    const ox = (out[0]! + sx) | 0;
    const oy = (out[1]! + sy) | 0;
    const atA = seg[a] === ox && seg[a + 1] === oy;
    const atB = seg[b] === ox && seg[b + 1] === oy;
    const special = p.type === 0x5f || p.type === 0x60 || p.type === 0x94;
    if (special ? !atA : !atB && !atA) {
      seg[b] = ox;
      seg[b + 1] = oy;
      edge.i = k - 1;
      hit = true;
    }
  }
  return hit;
}

/**
 * 43ce78(laser, direction) : trace le faisceau depuis la bouche du laser : tronçons de 592 px au plus, arrêtés par la
 * première pièce fixe touchée (sauf types transparents), réfléchis par un miroir (94) touché sur sa face (côté 0) ;
 * 16 tronçons au plus. Rend le nombre de tronçons dans +0x104.
 */
export function traceBeam(world: World, laser: Part, dir: number): void {
  const buf = (laser.beam ??= new Int32Array(32));
  const o = laser.type === 0x5f ? ORIGIN_95 : ORIGIN;
  buf[0] = (laser.px + o[2 * dir]!) | 0;
  buf[1] = (laser.py + o[2 * dir + 1]!) | 0;
  buf[2] = (STEP[2 * dir]! + buf[0]!) | 0;
  buf[3] = (STEP[2 * dir + 1]! + buf[1]!) | 0;
  let count = 1;
  let i = 0;
  const end = new Int32Array(4);
  for (;;) {
    end[2] = buf[2 * i + 2]!;
    end[3] = buf[2 * i + 3]!;
    end[0] = buf[2 * i]!;
    end[1] = buf[2 * i + 1]!;
    let more = false;
    let hitPart: Part | null = null;
    const edge = { i: 0 };
    for (const s of world.statics) {
      if (TRANSPARENT.has(s.type)) continue;
      if (beamHits(s, end, 0, 2, edge)) hitPart = s;
    }
    if (hitPart) {
      i++;
      buf[2 * i] = end[2]!;
      buf[2 * i + 1] = end[3]!;
      if (hitPart.type === 0x5e) {
        dir = MIRROR[dir * 4 + hitPart.frame]!;
        if (dir !== 4 && edge.i === 0) {
          count++;
          more = true;
          buf[2 * i + 2] = (STEP[2 * dir]! + buf[2 * i]!) | 0;
          buf[2 * i + 3] = (STEP[2 * dir + 1]! + buf[2 * i + 1]!) | 0;
        }
      }
    }
    if (count >= 16 || !more) break;
  }
  laser.f104 = count;
}

/**
 * 43d379(laser, pièce, côté) : la pièce touchée par le faisceau réagit : mélangeur 95 (côté 0 : bit de la couleur dans
 * +0x8C), prise laser 96 (+0x24 = 1 si son image mod 7 est celle du laser), détecteur 148 (+0x24 = 1), ballon (crevé).
 * Rend 1 si la pièce touchée a bougé ou changé d'image (le faisceau est alors à redessiner).
 */
function beamReacts(laser: Part, hit: Part, edge: number): number {
  let bit = 0;
  let colour = 0;
  switch (laser.type) {
    case 0x5b:
      bit = 4;
      colour = 1;
      break;
    case 0x5c:
      bit = 2;
      colour = 2;
      break;
    case 0x5d:
      bit = 1;
      colour = 3;
      break;
    case 0x5f:
      bit = laser.f24;
      colour = MIXER_PLUG[bit] ?? 0;
      break;
  }
  if (hit.type === 0x5f) {
    if (edge === 0) hit.f8C |= bit;
    return 0;
  }
  if (hit.type === 0x60) {
    if (hit.frame % 7 === colour) hit.f24 = 1;
    return 0;
  }
  if (hit.type === 0x94) {
    hit.f24 = 1;
    return 0;
  }
  if (hit.type === 4) hit.f24 = 1;
  return hit.px !== hit.prevPx || hit.py !== hit.prevPy || hit.frame !== hit.framePrev ? 1 : 0;
}

/**
 * 43d013 (passe lasers de 433334), avec 43d078 : premier tronçon coupé par une pièce (fixes non détruites, puis mobiles),
 * réaction de la pièce touchée (43d379), extrémité du faisceau en +0x54/+0x58 (ou +0x54 = −0x1000 s'il va jusqu'au
 * bout), nombre de tronçons en +0xFC, puis chauffe (43d43e). Lit le tampon tracé par `traceBeam` (+0x104 tronçons).
 */
export function laserPass(world: World, laser: Part): void {
  if (laser.f24 === 0) return;
  const buf = laser.beam ?? (laser.beam = new Int32Array(32));
  const n = laser.f104;
  let found = 0;
  let react = 0;
  const seg = new Int32Array(4);
  const edge = { i: 0 };
  for (let i = 0; i < n && !found; i++) {
    seg[0] = buf[2 * i]!;
    seg[1] = buf[2 * i + 1]!;
    seg[2] = buf[2 * i + 2]!;
    seg[3] = buf[2 * i + 3]!;
    let hit: Part | null = null;
    for (const list of [world.statics, world.mobiles])
      for (const q of list) {
        if (q.flags10 & 0x2000) continue;
        if (beamHits(q, seg, 0, 2, edge)) hit = q;
      }
    if (hit) {
      react = beamReacts(laser, hit, edge.i);
      found = i + 1;
    }
  }
  laser.fFC = found;
  if (found) {
    laser.vx = seg[2]!;
    laser.vy = seg[3]!;
    // react : 43ce36 (zones à redessiner), affichage seulement.
    void react;
  } else {
    laser.fFC = laser.f104;
    laser.vx = -0x1000;
  }
  heat(world, laser);
}

/** 43d43e : les pièces inflammables (+0x14 & 4) au repos dont le point +0xB8 est à 4 px du faisceau chauffent (+0x104). */
function heat(world: World, laser: Part): void {
  const buf = laser.beam!;
  const n = laser.fFC;
  for (let i = 0; i < n; i++) {
    let x0 = buf[2 * i]!;
    let y0 = buf[2 * i + 1]!;
    let x1: number;
    let y1: number;
    if (i === n - 1 && laser.vx !== -0x1000) {
      x1 = laser.vx;
      y1 = laser.vy;
    } else {
      x1 = buf[2 * i + 2]!;
      y1 = buf[2 * i + 3]!;
    }
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    for (const q of world.staticThenMobile()) {
      if (!(q.flags14 & 4) || q.f24 !== 0) continue;
      const hx = (q.ropeAnchor[8]! + q.px) | 0;
      const hy = (q.ropeAnchor[9]! + q.py) | 0;
      if (x0 === x1) {
        if (hy >= y0 && hy <= y1 && Math.abs(hx - x0) <= 4) q.f104 = (q.f104 + 1) | 0;
      } else if (x0 <= hx && hx <= x1 && Math.abs(hy - y0) <= 4) q.f104 = (q.f104 + 1) | 0;
    }
  }
}

/** 43c88a (slot 2 des lasers 91 … 93) : polygone du laser 91 selon l'image (= direction), puis tracé du faisceau. */
function laserReset(world: World, p: Part): void {
  const d = world.types.get(0x5b);
  p.poly = d.polygons![p.frame]!;
  p.vertexCount = d.vertexCount;
  computeEdgeAngles(p.poly, p.vertexCount);
  traceBeam(world, p, p.frame);
}

export function register(r: HandlerRegistry): void {
  r.register(0x43c65c, "laser.init", (_w, p) => allocBeam(p));
  r.register(0x43c88a, "laser.reset", (w, p) => laserReset(w, p));
  r.registerSpecial(0x43d013, "laser.pass", (w, p) => laserPass(w, p));
}
