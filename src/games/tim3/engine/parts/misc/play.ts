/**
 * Jouets et balles spéciales (groupe `misc`) : balle programmable (87), super-balle (59), bumper (64), coussin
 * antigravité (69), flipper (116), queue de billard (117), poche de billard (119). Traduit de TIMWIN.EXE (adresses en
 * commentaire) ; pas d'équivalent dans OpenTIM pour ces types de TIM3.
 *
 * Convention des handlers de slot 0 : `arg` est la pièce qui touche (le paramètre de l'exe), `part` celle qui est touchée
 * (le paramètre vaut `part` quand l'exe appelle le slot 0 de la pièce sur elle-même, 43373c) ; l'exe relit la touchée
 * par +0xDC du paramètre.
 */
import { centreAngle } from "../../bounce";
import { abs32, idiv, mul16, s16, u16 } from "../../fixed";
import { acceleration, atmosphere } from "../../gravity";
import { computeEdgeAngles, updateGeometry } from "../../move";
import { Part } from "../../part";
import { angleOf, cos16, sin16 } from "../../tables";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { stateFirst } from "./anim";
import { collectInArea, kick, setKickZone } from "./kick";

/** Pièce qui touche : le paramètre de l'exe. */
const toucher = (part: Part, arg: unknown): Part => (arg instanceof Part ? arg : part);

/** Polygone du type par indice (445xxx, 447xxx…), angles des côtés (439e38). */
function setPoly(world: World, p: Part, index: number): void {
  p.poly = world.types.get(p.type).polygons![index]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** 0x481664 : image de l'état 8 de Mel (type 54), posée par son slot 2 (444672). */
const melFrame = (world: World): number => stateFirst(world, 0x36, 8);

/** Mel (54) qui vient d'être lancée : image minimale de l'état « envol » (suite de 445560, 447d0c, 447f57). */
function melLaunched(world: World, b: Part): void {
  const f = melFrame(world);
  if (b.type === 0x36 && b.frame < f) b.frame = f;
}


/** 43a28f(part, angle, vitesse) : vitesse = vitesse × (sin, cos) de l'angle, Q14. */
function setPolarVelocity(p: Part, angle: number, speed: number): void {
  p.vx = mul16(speed, sin16(angle)) >> 14;
  p.vy = mul16(speed, cos16(angle)) >> 14;
}

// ---------------------------------------------------------------------------------------------------------------
// Balle programmable (87)
// ---------------------------------------------------------------------------------------------------------------

/** 43baec (slot 7) : structure de réglages et image de départ (état 5) ; `null` à l'initialisation du type. */
function progLink(world: World, p: Part | null): number {
  if (!p) return 1;
  if (!p.prog) p.prog = new Int32Array(4);
  p.frame = stateFirst(world, 0x57, 5);
  p.editFrame = p.frame;
  const d = world.types.get(p.type);
  p.prog[0] = d.density;
  p.prog[1] = d.elasticity;
  p.prog[2] = d.friction;
  return 1;
}

/** 43bb86 (slot 2) : accélération d'après la densité réglée, polygone, compteurs de rotation à zéro. */
function progReset(world: World, p: Part): void {
  p.prog ??= new Int32Array(4);
  const atm = atmosphere(world.gravity, world.pressure);
  p.prog[3] = acceleration(p.prog[0]!, atm.air, atm.gravity);
  p.poly = world.types.get(p.type).polygons![0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
  updateGeometry(world, p);
  p.fFC = 0;
  p.f104 = 0;
}

/** 43bbf3 (slot 1) : images 5 à 0x14 = la balle roule ; l'image dépend du chemin parcouru (/ 6, 8 positions). */
function progRun(_w: World, p: Part): void {
  if (p.frame < 5 || p.frame > 0x14) return;
  if (p.flags0C & 1) {
    const d = (p.px - p.prevPx) | 0;
    p.f104 = (d + d) | 0;
    p.fFC = (p.fFC + d) | 0;
  } else if (p.flags0C & 2) {
    p.f104 = p.vx >> 9;
    p.fFC = (p.fFC + p.f104) | 0;
  } else p.fFC = (p.fFC + p.f104) | 0;
  p.frame = ((idiv(p.fFC, 6) & 7) + p.editFrame) | 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Super-balle (59)
// ---------------------------------------------------------------------------------------------------------------

/** 444f04 (slot 0) : la super-balle qui touche s'écrase : image 2 contre un côté plat, 1 contre un côté vertical. */
function superAccept(world: World, part: Part, arg: unknown): number {
  const t = toucher(part, arg);
  if (t.type === 0x3b) {
    const a = u16(t.contactAngle);
    if (a === 0 || a === 0x8000) {
      t.frame = 2;
      updateGeometry(world, t);
    } else if (a === 0x4000 || a === 0xc000) {
      t.frame = 1;
      updateGeometry(world, t);
    }
  }
  return 1;
}

/** 444f53 (slot 2). */
function superReset(world: World, p: Part): void {
  setPoly(world, p, 0);
}

/** 444f77 (slot 1) : retour à l'image 0. */
function superRun(world: World, p: Part): void {
  if (p.frame !== 0) {
    p.frame = 0;
    updateGeometry(world, p);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bumper (64)
// ---------------------------------------------------------------------------------------------------------------

/**
 * 445560 (slot 0) : la pièce qui touche est renvoyée à 0x1c00 le long de la droite des centres ; le bumper s'allume.
 * (L'exe calcule aussi max(0x1c00, somme des vitesses), valeur jamais lue.) Rend 0 : pas de rebond normal.
 */
function bumperHit(world: World, part: Part, arg: unknown): number {
  const b = toucher(part, arg);
  const self = b.contact!;
  const angle = s16(centreAngle(self, b));
  setPolarVelocity(b, angle, 0x1c00);
  melLaunched(world, b);
  self.f24 = 1;
  return 0;
}

/** 445660 (slot 1) : allumé 1 pas (image 1), puis éteint. */
function bumperRun(world: World, p: Part): void {
  if (p.f24) {
    p.frame = 1;
    p.f24 = 0;
    updateGeometry(world, p);
  } else if (p.frame !== 0) {
    p.frame = 0;
    updateGeometry(world, p);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Coussin antigravité (69)
// ---------------------------------------------------------------------------------------------------------------

/** 445830 (slot 1) : inverse la gravité des pièces mobiles au-dessus du coussin (zone 0..31 × −400..1) ; animation. */
function antigravRun(world: World, p: Part): void {
  collectInArea(world, p, 0x1000, 0, 0x1f, -400, 1);
  let hit = false;
  for (let q = p.bucketNext; q; q = q.bucketNext) {
    const dx = ((((p.boxW >> 1) + p.px) | 0) - (((q.boxW >> 1) + q.px) | 0)) | 0;
    if (abs32(dx) <= p.boxW >> 1 || abs32(dx) <= q.boxW >> 1) {
      q.flags14 |= 0x800;
      hit = true;
    }
  }
  if (!hit) {
    p.frame = 0;
    return;
  }
  p.frame++;
  if ((world.types.anims[p.type]?.stateAt(p.frame) ?? -1) === -1) {
    if (world.animFlags & 1) p.frame = 1;
    else p.frame -= 2;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Flipper (116)
// ---------------------------------------------------------------------------------------------------------------

/** 447d0c(flipper, b) : lance la pièce b ; la force dépend de sa distance horizontale au centre du flipper. */
function flipperLaunch(world: World, f: Part, b: Part): void {
  const fc = ((f.frameW >> 1) + f.px) | 0;
  const bc = ((b.frameW >> 1) + b.px) | 0;
  let c = (f.flags10 & 0x10 ? (bc - fc) >> 1 : (fc - bc) >> 1) - 3;
  if (c > 8) c = 8;
  else if (c < -7) c = -7;
  c = ((c + 8) << 9) | 0;
  b.vy = (abs32((c - 0x1000) | 0) - 0x2800) | 0;
  b.vx = f.flags10 & 0x10 ? c : -c | 0;
  if (b.type === 0x36 && b.frame < melFrame(world)) {
    b.frame = melFrame(world);
    updateGeometry(world, b);
  }
}

/**
 * 447b5c (slot 0) : seul le côté d'indice 0 (le dessus de la palette, selon le retournement) déclenche le flipper : il
 * lance la pièce qui touche, puis frappe les pièces de la zone (mobiles : lancées ; fixes : 43dcb5). Rend 0 dans ce
 * cas (pas de rebond), 1 sinon.
 */
function flipperHit(world: World, part: Part, arg: unknown): number {
  const t = toucher(part, arg);
  const self = t.contact!;
  const flipped = (self.flags10 & 0x10) !== 0;
  let side = t.contactIndex;
  if (flipped) {
    const n = world.types.get(0x74).vertexCount;
    side = (n - side - 2) | 0;
    if (side < 0) side = (side + n) | 0;
  }
  if (side !== 0) return 1;
  self.f24 = 1;
  flipperLaunch(world, self, t);
  const [xl, xr] = flipped ? [0xb, 0x2c] : [0, 0x21];
  collectInArea(world, self, 0x3000, xl, xr, 0, 0x21);
  setKickZone(self, xl, xr, 0, 0x21);
  for (let b = self.bucketNext; b; b = b.bucketNext) {
    const dx = flipped ? (b.px - self.px - 0xb) | 0 : (self.px - b.px + 0x21) | 0;
    const dy = (b.py - self.py) | 0;
    if (dy > 0 && (dx < 0 || dy >= dx)) continue;
    if (b.flags0C & 0x1000 && t !== b) flipperLaunch(world, self, b);
    else kick(world, b);
  }
  return 0;
}

/** 447c72 (slot 2) : polygone selon le retournement. */
function flipperReset(world: World, p: Part): void {
  setPoly(world, p, p.flags10 & 0x10 ? 1 : 0);
}

/** 447c9f (slot 1) : image 1 un pas après le coup. */
const flipperRun = bumperRun;

/** 447cd4 (slot 3) : édition ; un argument non nul retourne en X. */
function flipperEdit(world: World, p: Part, arg: unknown): void {
  if (arg) p.flags10 ^= 0x10;
  flipperReset(world, p);
  updateGeometry(world, p);
}

// ---------------------------------------------------------------------------------------------------------------
// Queue de billard (117)
// ---------------------------------------------------------------------------------------------------------------

/** 0x478364 / 0x4783f4 : masques d'angle ; 0x478374 / 0x4783b4 : extrémités du coup (x, y) pour chacun des 8 sens. */
const CUE_ANGLE = [0x0000, 0x2000, 0x4000, 0x6000, 0x8000, 0xa000, 0xc000, 0xe000];
const CUE_MASK = [0xc000, 0xe000, 0x0000, 0x2000, 0x4000, 0x6000, 0x8000, 0xa000];
const CUE_A = [[0x45, 0x26], [0x3c, 0x3a], [0x27, 0x3c], [0x13, 0x3a], [0x0a, 0x26], [0x13, 0x12], [0x27, 0x0a], [0x3c, 0x12]] as const;
const CUE_B = [[0x61, 0x26], [0x51, 0x4f], [0x27, 0x60], [-2, 0x4f], [-0x14, 0x26], [-2, -3], [0x27, -0x14], [0x51, -3]] as const;

/** 41352a(v, a, b) : v entre a et b (inclus), comparaison sur 16 bits non signés. */
function between(v: number, a: number, b: number): boolean {
  return b < a ? u16(v - b) <= u16(a - b) : u16(v - a) <= u16(b - a);
}

/**
 * 41355c : intersection de deux segments {x0, y0, x1, y1} (droites, arrondi `idiv`) ; rend le point ou `null`. Le point
 * est écrit dans `out` même sans intersection (comme l'exe).
 */
function intersect(s1: readonly number[], s2: readonly number[], out: number[]): boolean {
  const a1 = (s1[1]! - s1[3]!) | 0;
  const b1 = (s1[0]! - s1[2]!) | 0;
  const c1 = (Math.imul(a1, s1[2]!) - Math.imul(b1, s1[3]!)) | 0;
  const a2 = (s2[3]! - s2[1]!) | 0;
  const b2 = (s2[2]! - s2[0]!) | 0;
  const c2 = (Math.imul(a2, s2[0]!) - Math.imul(b2, s2[1]!)) | 0;
  const det = (Math.imul(a2, b1) - Math.imul(a1, b2)) | 0;
  let x: number;
  let y: number;
  if (det !== 0) {
    x = idiv((Math.imul(c2, b1) - Math.imul(c1, b2)) | 0, det);
    y = idiv((Math.imul(a1, c2) - Math.imul(a2, c1)) | 0, det);
  } else if (((Math.imul(a2, s1[0]!) + Math.imul(b2, s1[1]!)) | 0) !== 0) {
    x = 0;
    y = 0;
  } else {
    x = s1[2]!;
    y = s1[3]!;
  }
  out[0] = x;
  out[1] = y;
  return between(x, s1[2]!, s1[0]!) && between(x, s2[2]!, s2[0]!) && between(y, s1[3]!, s1[1]!) && between(y, s2[3]!, s2[1]!);
}

/**
 * 447fdb(masque, b, A, B) : le segment [A, B] coupe-t-il un côté du polygone de b dont l'angle + masque + 0x4000 est
 * dans le demi-tour positif ? Si oui, B devient le point d'intersection (sauf s'il retombe sur A ou B).
 */
function cueHits(mask: number, b: Part, a: number[], bb: number[]): boolean {
  const poly = b.poly;
  if (!poly) return false;
  const n = b.vertexCount;
  let hit = false;
  const vx = (i: number) => (b.px + poly.x[i % n]!) | 0;
  const vy = (i: number) => (b.py + poly.y[i % n]!) | 0;
  for (let i = 0; i < n; i++) {
    const ang = u16(poly.angle[i]! + mask + 0x4000);
    if (ang & 0x8000 || ang === 0) continue;
    const x0 = vx(i);
    const y0 = vy(i);
    const s1 = [0, 0, (vx(i + 1) - x0) | 0, (vy(i + 1) - y0) | 0];
    const s2 = [(a[0]! - x0) | 0, (a[1]! - y0) | 0, (bb[0]! - x0) | 0, (bb[1]! - y0) | 0];
    const out = [0, 0];
    if (!intersect(s1, s2, out)) continue;
    const ox = (out[0]! + x0) | 0;
    const oy = (out[1]! + y0) | 0;
    if ((bb[0] === ox && bb[1] === oy) || (a[0] === ox && a[1] === oy)) continue;
    bb[0] = ox;
    bb[1] = oy;
    hit = true;
  }
  return hit;
}

/** 447da8 (slot 0) : à l'arrêt (image % 7 = 0 ou 6), un contact dans le bon demi-tour déclenche le coup. */
function cueHit(_world: World, part: Part, arg: unknown): number {
  const t = toucher(part, arg);
  const self = t.contact!;
  const m = self.frame % 7;
  if (m === 0 || m === 6) {
    const a = u16(t.contactAngle + CUE_ANGLE[(self.frame / 7) | 0]!);
    if (!(a & 0x8000)) {
      self.f24 = 1;
      self.frame = (self.editFrame + 1) | 0;
    }
  }
  return 1;
}

/** 447e11 (slot 2) : polygone d'après le sens (image / 7). */
function cueReset(world: World, p: Part): void {
  setPoly(world, p, (p.frame / 7) | 0);
}

/** 447e3f (slot 1) : le coup dure 6 images ; à l'image 3, le segment du coup envoie les mobiles touchés à 0x1c00. */
function cueRun(world: World, p: Part): void {
  if (!p.f24) return;
  if (p.frame % 7 === 6) {
    p.f24 = 0;
    return;
  }
  p.frame++;
  if (p.frame % 7 === 3) {
    const i = (p.frame / 7) | 0;
    for (const b of world.mobiles) {
      if (b.flags10 & 0x2000) continue;
      const a = [(CUE_A[i]![0] + p.px) | 0, (CUE_A[i]![1] + p.py) | 0];
      const e = [(CUE_B[i]![0] + p.px) | 0, (CUE_B[i]![1] + p.py) | 0];
      if (!cueHits(CUE_MASK[i]!, b, a, e)) continue;
      const cx = ((b.frameW >> 1) + b.px) | 0;
      const cy = ((b.frameH >> 1) + b.py) | 0;
      setPolarVelocity(b, s16(angleOf((e[0]! - cx) | 0, (cy - e[1]!) | 0)), 0x1c00);
      melLaunched(world, b);
    }
  }
  updateGeometry(world, p);
}

/** 447f8f (slot 3) : édition ; l'action 15 passe au sens suivant (image + 7, modulo 56). */
function cueEdit(world: World, p: Part, arg: unknown): void {
  if (arg === 15) {
    p.frame += 7;
    if (p.frame === 0x38) p.frame = 0;
  }
  p.editFrame = p.frame;
  cueReset(world, p);
  updateGeometry(world, p);
}

// ---------------------------------------------------------------------------------------------------------------
// Poche de billard (119)
// ---------------------------------------------------------------------------------------------------------------

/** 448160 (slot 0) : la pièce qui touche le fond de la poche (côté 0) disparaît ; la poche se remplit (image + 8). */
function pocketHit(_world: World, part: Part, arg: unknown): number {
  const t = toucher(part, arg);
  if (t.contactIndex === 0) {
    t.flags10 |= 0x2000;
    const self = t.contact!;
    if (self.frame < 8) self.frame += 8;
  }
  return 1;
}

/** 44819b (slot 2) : polygone de l'image modulo 8. */
function pocketReset(world: World, p: Part): void {
  let e = p.frame & 0x80000007;
  if (e < 0) e = ((e - 1) | -8) + 1;
  setPoly(world, p, e);
}

/** 4481cc (slot 3) : édition ; l'action 15 passe à l'image suivante (modulo 8). */
function pocketEdit(world: World, p: Part, arg: unknown): void {
  if (arg === 15) {
    p.frame++;
    if (p.frame === 8) p.frame = 0;
  }
  p.editFrame = p.frame;
  pocketReset(world, p);
  updateGeometry(world, p);
}

export function registerPlay(r: HandlerRegistry): void {
  // 87 balle programmable
  r.register(0x43baec, "progBall.link", (w, p) => progLink(w, p));
  r.register(0x43bb86, "progBall.reset", (w, p) => progReset(w, p));
  r.register(0x43bbf3, "progBall.run", (w, p) => progRun(w, p));
  // 59 super-balle
  r.register(0x444f04, "superBall.accept", (w, p, a) => superAccept(w, p, a));
  r.register(0x444f53, "superBall.reset", (w, p) => superReset(w, p));
  r.register(0x444f77, "superBall.run", (w, p) => superRun(w, p));
  // 64 bumper
  r.register(0x445560, "bumper.hit", (w, p, a) => bumperHit(w, p, a));
  r.register(0x445660, "bumper.run", (w, p) => bumperRun(w, p));
  // 69 coussin antigravité
  r.register(0x445830, "antigrav.run", (w, p) => antigravRun(w, p));
  // 116 flipper
  r.register(0x447b5c, "flipper.hit", (w, p, a) => flipperHit(w, p, a));
  r.register(0x447c9f, "flipper.run", (w, p) => flipperRun(w, p));
  r.register(0x447c72, "flipper.reset", (w, p) => flipperReset(w, p));
  r.register(0x447cd4, "flipper.edit", (w, p, a) => flipperEdit(w, p, a));
  // 117 queue de billard
  r.register(0x447da8, "cue.hit", (w, p, a) => cueHit(w, p, a));
  r.register(0x447e3f, "cue.run", (w, p) => cueRun(w, p));
  r.register(0x447e11, "cue.reset", (w, p) => cueReset(w, p));
  r.register(0x447f8f, "cue.edit", (w, p, a) => cueEdit(w, p, a));
  // 119 poche
  r.register(0x448160, "pocket.hit", (w, p, a) => pocketHit(w, p, a));
  r.register(0x44819b, "pocket.reset", (w, p) => pocketReset(w, p));
  r.register(0x4481cc, "pocket.edit", (w, p, a) => pocketEdit(w, p, a));
}
