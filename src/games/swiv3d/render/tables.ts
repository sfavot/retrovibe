/**
 * Tables numériques du rendu logiciel de `SWIV_WIN.EXE` (`gm_render_init_tables` `0042477c`, `docs/swiv3d/render.md` §4.2, §6.2, §6.6).
 * Toutes sont recalculées par formule (vérifiées identiques aux tables de l'exécutable) : le rendu n'a pas besoin de l'EXE.
 */

/** Pas d'un tour complet des angles (512 pas par tour). */
export const ANGLE_STEPS = 512;
export const ANGLE_MASK = ANGLE_STEPS - 1;

const table = (length: number, fn: (i: number) => number): Int32Array => Int32Array.from({ length }, (_, i) => fn(i));
const turn = (i: number): number => (2 * Math.PI * i) / ANGLE_STEPS;

/** `round(256 sin)` et `round(256 cos)` (`00483188`, `00483988`). */
export const SIN = table(ANGLE_STEPS, (i) => Math.round(256 * Math.sin(turn(i))));
export const COS = table(ANGLE_STEPS, (i) => Math.round(256 * Math.cos(turn(i))));
/** Même formule avec 320 : étirement vertical ×1,25 du vecteur lumière (`00483588`, `00483d88`). */
export const SIN320 = table(ANGLE_STEPS, (i) => Math.round(320 * Math.sin(turn(i))));
export const COS320 = table(ANGLE_STEPS, (i) => Math.round(320 * Math.cos(turn(i))));

/** Ondulation de l'eau, 32 entrées (`00481050`) : `round(16 sin(π i / 32))`. */
export const WAVE = table(32, (i) => Math.round(16 * Math.sin((Math.PI * i) / 32)));

/** Division C : tronque vers zéro. */
export const idiv = (a: number, b: number): number => (a / b) | 0;

/** `RECIP_FFFF[n] = trunc(0xffff / n)` (`005836ac`, `[0] = 0xffff`). */
export const RECIP_FFFF = table(0x1000, (n) => (n === 0 ? 0xffff : idiv(0xffff, n)));
/** `RECIP_16[d] = min(0x7ff8, 0x10000 / d)` (`0057f694`). */
export const RECIP_16 = table(0x1000, (n) => (n === 0 ? 0x7ff8 : Math.min(0x7ff8, idiv(0x10000, n))));
/** `ISQRT256[i] = trunc(sqrt(i * 2048) * 256)` (racine de la normalisation du terrain). */
export const ISQRT256 = table(0x2000, (i) => Math.trunc(Math.sqrt(i * 2048) * 256));

/**
 * Normalise (x, y, z) à la longueur 256 (`gm_vec3_normalize_256`, `00415374`), sur place dans `v[0..2]`.
 */
export function normalize256(v: Int32Array): void {
  let u = (Math.imul(v[0]!, v[0]!) + Math.imul(v[1]!, v[1]!) + Math.imul(v[2]!, v[2]!)) >>> 11;
  if (u > 4000) u = 4000;
  if (u === 0) u = 4000;
  const r = RECIP_FFFF[ISQRT256[u]! >> 8]!;
  v[0] = Math.imul(v[0]!, r) >> 8;
  v[1] = Math.imul(v[1]!, r) >> 8;
  v[2] = Math.imul(v[2]!, r) >> 8;
}
