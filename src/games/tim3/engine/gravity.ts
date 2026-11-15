/**
 * Gravité, poussée de l'air et vitesse terminale.
 * Traduit de TIMWIN.EXE ; correspondance OpenTIM : `src/atmosphere.rs` (même formule, TEMIM « TIMWIN 1090:0000 »).
 */
import { abs32, idiv, mul16, u16 } from "./fixed";
import type { Part } from "./part";
import { F14 } from "./part";
import type { TypeTable } from "./types";

/** Valeurs par défaut posées par 432bec. */
export const DEFAULT_PRESSURE = 67;
export const DEFAULT_GRAVITY = 272;

/** 4340b0 : gravité et densité de l'air effectives d'après les réglages du niveau (0x481384, 0x481380). */
export function atmosphere(gravity: number, pressure: number): { gravity: number; air: number } {
  let g = gravity | 0;
  if (g < 0x8c) g = ((g >> 2) + 1) | 0;
  else if (g > 0x116) g = (g << 1) | 0;
  let air = pressure | 0;
  air = air < 0x46 ? air >> 1 : (air << 4) | 0;
  return { gravity: g, air };
}

/** 4340ef(densité, air, gravité) : accélération verticale (1/512 px par pas²), divisions tronquées vers 0. */
export function acceleration(density: number, air: number, gravity: number): number {
  if (air === density) return 0;
  if (air < density) return (gravity - idiv(mul16(air, gravity), density)) | 0;
  return (idiv(mul16(density, gravity), air) - gravity) | 0;
}

/** 434141 : accélération (+0x5C) et vitesse terminale (+0x60) de tous les types, au chargement d'un niveau. */
export function applyAtmosphere(types: TypeTable, gravity: number, pressure: number): void {
  const atm = atmosphere(gravity, pressure);
  for (let t = 0; t < types.byType.length; t++) {
    const d = types.byType[t]!;
    d.accel = acceleration(d.density, atm.air, atm.gravity);
    if (t === 0x14 || t === 0x2b) {
      // Balle de phazer (20) et boulet (43).
      d.terminal = 0x3000;
      if (t === 0x14) d.accel = 0;
    } else {
      // Boule de billard, montgolfière, dirigeable, chauve-souris, Cupidon : sans pesanteur.
      if (t === 0x3f || t === 0x4f || t === 0x6d || t === 0x20 || t === 0x21) d.accel = 0;
      d.terminal = (0x2600 - atm.air) | 0;
    }
  }
}

/** Accélération propre d'une pièce : la balle programmable (87) a la sienne (+0x90 → +0x0C). */
export function partAccel(part: Part, types: TypeTable): number {
  if (part.type === 0x57) return programmableAccel(part);
  return types.get(part.type).accel;
}

/** Balle programmable : accélération réglée dans l'éditeur (structure +0x90, champ +0x0C). */
export function programmableAccel(part: Part): number {
  return part.prog ? part.prog[3]! : 0;
}

/** 4341cb : bride la vitesse à ± la vitesse terminale du type (vy d'abord, puis vx). */
export function clampVelocity(part: Part, types: TypeTable): void {
  const t = types.get(part.type).terminal;
  if (part.vy > t) part.vy = t;
  else if (-t > part.vy) part.vy = -t | 0;
  if (part.vx > t) part.vx = t;
  else if (-t > part.vx) part.vx = -t | 0;
}

/** 434221 : gravité d'un pas, bride, puis quantité de mouvement (+0x60). */
export function applyGravity(part: Part, types: TypeTable): void {
  const g = partAccel(part, types);
  if (part.flags14 & F14.REVERSED_GRAVITY) part.vy = (part.vy - g) | 0;
  else part.vy = (part.vy + g) | 0;
  clampVelocity(part, types);
  // add cx, ax : somme des valeurs absolues sur 16 bits, puis produit 16 × 16 avec le mot bas de la masse.
  const speed = u16(abs32(part.vx) + abs32(part.vy));
  part.momentum = mul16(speed, part.mass);
}
