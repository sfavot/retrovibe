/**
 * Trigonométrie entière de TIMWIN.EXE (tables générées, `data/tables/`). Angles sur 16 bits : 0x10000 = un tour.
 * Format identique à OpenTIM (`src/math.rs` : `COSINE_LOOKUP`, `ARCTAN_LOOKUP`), mais le binaire de TIM3 fait foi.
 */
import { ARCTAN } from "../data/tables/arctan";
import { COSINE_Q14 } from "../data/tables/cosine";
import { idiv, mul16, s16, u16 } from "./fixed";

/** 4137d0 : cosinus Q14 d'un angle 16 bits (table de 2 049 entrées sur [0, π], repliée). */
export function cos16(angle: number): number {
  let i = u16(angle) >>> 4;
  if (i >= 0x800) i = 0x1000 - i;
  return COSINE_Q14[i]!;
}

/** 4137f4 : sinus = cos(angle + 0xC000) (mot de 16 bits, l'addition déborde comme `add ax`). */
export function sin16(angle: number): number {
  return cos16(u16(angle) + 0xc000);
}

/** 4138c0 : arctangente tabulée ; 0 au-delà de l'indice 511. */
function arctan(i: number): number {
  return i < 0x200 ? ARCTAN[i]! : 0;
}

/**
 * 41348a : angle (16 bits) du vecteur (a, b), a et b entiers 32 bits. Valeur utile : les 16 bits bas (`ax`), que tous les
 * appelants lisent seuls.
 */
export function angleOf(a: number, b: number): number {
  const negA = a < 0;
  const negB = b < 0;
  if (negA) a = -a | 0;
  if (negB) b = -b | 0;
  let t: number;
  if (a === 0) t = 0x400;
  else if (b === 0) t = 0;
  else if (b === a) t = 0x200;
  else if (b > a) t = u16(0x400 - arctan(idiv(a << 9, b)));
  else t = arctan(idiv(b << 9, a));
  if (negA) t = u16(0x800 - t);
  if (negB) t = u16(0x1000 - t);
  // add ax, 0xfc00 ; shl eax, 4 : seuls les 12 bits bas de ax survivent dans le mot de résultat.
  return u16(((t + 0xfc00) & 0xfff) << 4);
}

/**
 * 413404 : rotation d'un vecteur (x, y) de l'angle donné, opérandes lus sur 16 bits, produits Q14 puis `sar 14`.
 * Renvoie [x', y'].
 */
export function rotate(x: number, y: number, angle: number): [number, number] {
  const c = cos16(angle);
  const s = s16(sin16(angle));
  const nx = (mul16(x, c) - mul16(y, s)) | 0;
  const ny = (mul16(x, s) + mul16(y, c)) | 0;
  return [nx >> 14, ny >> 14];
}
