/**
 * Engrenages (14, et petit engrenage 86) : voisins trouvés par position d'édition, propagation du sens de rotation
 * (engrenages voisins et courroie), blocage, entraînement des pièces touchées. Traduit de TIMWIN.EXE 43c13c (slot 2),
 * 43c2d7 (slot 1), 43c322, 43c429, 43c00c (slot 0), 43bfa4 … 43bff0. OpenTIM (TEMIM, `src/parts/mod.rs`, « gear ») a la
 * même propagation récursive ; le binaire de TIM3 fait foi (petit engrenage : rapport 2).
 */
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { otherBeltEnd } from "./belt";
import { setPoly } from "./common";

const isGear = (p: Part) => p.type === 0x0e || p.type === 0x56;

/**
 * 43c13c (slot 2) : poulie (+0x88/+0x89, rayon +0x8C), polygone ; voisins (+0x90 droite… selon l'écart d'édition) parmi
 * les engrenages fixes.
 */
function gearReset(world: World, g: Part): void {
  const big = g.type === 0x0e;
  g.f88 = g.f89 = big ? 0x11 : 8;
  g.f8C = big ? 5 : 3;
  setPoly(world, g, 0);
  g.links[0] = g.links[1] = g.links[2] = g.links[3] = null;
  for (const q of world.statics) {
    if (q === g || !isGear(q)) continue;
    const dx = (g.editX - q.editX) | 0;
    const dy = (g.editY - q.editY) | 0;
    // [écart pour links[1], links[0], links[2], links[3]] en {dx, dy}.
    let a: number; // ±0x20 / ±0x10 : écart principal
    let b: number; // décalage transverse
    let up: number;
    if (big) {
      up = -0x20;
      if (q.type === 0x0e) {
        a = 0x20;
        b = 0;
      } else {
        a = 0x10;
        b = -8;
      }
    } else {
      up = -0x10;
      if (q.type === 0x56) {
        a = 0x10;
        b = 0;
      } else {
        a = 0x20;
        b = 8;
      }
    }
    if (dx === up && dy === b) g.links[1] = q;
    else if (dx === a && dy === b) g.links[0] = q;
    else if (dx === b && dy === a) g.links[2] = q;
    else if (dx === b && dy === up) g.links[3] = q;
  }
}

/**
 * 43c322(a, b, mode, jam) : `b` (voisin en mode 2, courroie en mode 1) prend le sens de `a` (inversé par un voisin,
 * réduit ou doublé entre grand et petit engrenage). Un engrenage qui tourne déjà dans l'autre sens bloque (`jam`).
 * Propagation récursive aux voisins non encore visités (+0x10 & 0x40).
 */
function drive(a: Part, b: Part, mode: number, jam: number): number {
  let v = mode === 1 ? a.f24 : -a.f24 | 0;
  if (mode === 2 && isGear(b)) {
    let up = false;
    let down = false;
    if (a.type !== b.type) {
      if (a.type === 0x0e) up = true;
      else down = true;
    }
    if (down && Math.abs(v) !== 1) v >>= 1;
    else if (up && Math.abs(v) !== 4) v = (v + v) | 0;
  }
  if (b.f24 !== 0) {
    if (isGear(b) && v !== b.f24) jam = 1;
  } else b.f24 = v;
  if (isGear(b) && !(b.flags10 & 0x40)) {
    b.flags10 |= 0x40;
    for (let i = 0; i < 5; i++) {
      const q = i === 4 ? otherBeltEnd(b) : b.links[i]!;
      const m = i === 4 ? 1 : 2;
      if (q && !(q.flags10 & 0x40) && !(q.flags10 & 0x800)) jam = drive(b, q, m, jam);
    }
  }
  return jam;
}

/** 43c429(g, jam) : image selon le sens, vitesse retenue (+0x104), remise à zéro ; un blocage arrête les voisins. */
function turn(world: World, g: Part, jam: number): void {
  if (!(world.animFlags & 1)) {
    if (g.f24 !== 0) g.frame = g.frame === 3 ? 1 : 3;
  } else if (g.f24 > 0) {
    g.frame = g.frame === 0 ? 2 : g.frame + 1;
    if (g.frame === 5) g.frame = 1;
  } else if (g.f24 < 0) {
    g.frame--;
    if (g.frame === 0 || g.frame === -1) g.frame = 4;
  }
  g.f104 = g.f24;
  g.f24 = 0;
  for (let i = 0; i < 5; i++) {
    const q = i === 4 ? otherBeltEnd(g) : g.links[i]!;
    if (!q || q.f24 === 0 || q.flags10 & 0x800) continue;
    if (jam) q.f24 = 0;
    if (isGear(q)) turn(world, q, jam);
  }
}

/** 43c2d7 (slot 1) : un engrenage entraîné (+0x24) entraîne ses voisins puis tourne. */
function gearRun(world: World, g: Part): void {
  if (g.f24 === 0) return;
  g.flags10 |= 0x40;
  let jam = 0;
  for (let i = 0; i < 4; i++) {
    const q = g.links[i];
    if (q) jam = drive(g, q, 2, jam);
  }
  if (jam) g.f24 = 0;
  turn(world, g, jam);
}

/** 43bfa4 / 43bfbc / 43bfd8 / 43bff0 : vitesse poussée vers ±a (bornée côté poussée). */
function pushX(c: Part, a: number): void {
  c.vx = (c.vx + a) | 0;
  if (a < c.vx) c.vx = a;
}
function pullX(c: Part, a: number): void {
  c.vx = (c.vx - a) | 0;
  if (a > c.vx) c.vx = -a | 0;
}
function pushY(c: Part, a: number): void {
  c.vy = (c.vy + a) | 0;
  if (a < c.vy) c.vy = a;
}
function pullY(c: Part, a: number): void {
  c.vy = (c.vy - a) | 0;
  if (a > c.vy) c.vy = -a | 0;
}

/** 43c00c (slot 0) : une pièce touche un engrenage qui tourne : ballons crevés, sinon entraînée selon le côté touché. */
function gearAccept(c: Part): number {
  const v = c.contact!.f104;
  if (v === 0) return 1;
  if (c.type === 4 || c.type === 0x6d) {
    c.f24 = 1;
    return 1;
  }
  if (c.type === 0x4f) {
    c.f24 = 2;
    return 1;
  }
  const side = v > 0 ? c.contactIndex : (c.contactIndex + 4) & 7;
  switch (side) {
    case 0:
      pushX(c, 0x1000);
      break;
    case 1:
      pushX(c, 0x800);
      pushY(c, 0x800);
      break;
    case 2:
      pushY(c, 0x1000);
      break;
    case 3:
      pullX(c, 0x800);
      pushY(c, 0x800);
      break;
    case 4:
      pullX(c, 0x1000);
      break;
    case 5:
      pullX(c, 0x800);
      pullY(c, 0x800);
      break;
    case 6:
      pullY(c, 0x1000);
      break;
    case 7:
      pushX(c, 0x800);
      pullY(c, 0x800);
      break;
  }
  return 1;
}

export function register(r: HandlerRegistry): void {
  r.register(0x43c13c, "gear.reset", (w, p) => gearReset(w, p));
  r.register(0x43c2d7, "gear.run", (w, p) => gearRun(w, p));
  r.register(0x43c00c, "gear.accept", (_w, _p, a) => gearAccept(a as Part));
}
