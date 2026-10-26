/**
 * Arithmétique en virgule fixe de `SWIV_WIN.EXE` (voir `docs/swiv3d/player.md` §2).
 *
 * - Positions et vitesses d'objet en Q8 (1 unité de monde = 256) ; le monde est un tore de 2^23 en Q8 (32 768 unités).
 * - Angles sur 512 pas par tour (1 pas = 0,703125°).
 * - Tables `sin`/`cos` de 512 `int16` (exe : `00483188` / `00483988`), non présentes dans les fichiers originaux : elles sont
 *   recalculées ici. Choix d'arrondi : `Math.round(256 · sin(2π·i / 512))` (arrondi au plus proche, les demi-valeurs vers
 *   +∞) ; `cos(i) = sin(i + 128)`, donc les deux tables sont décalées exactement d'un quart de tour. Valeurs de contrôle :
 *   `SIN[0] = 0`, `SIN[128] = 256`, `SIN[256] = 0`, `SIN[384] = -256`, `SIN[64] = 181`, `SIN[1] = 3`. Les tables de l'exe n'étant
 *   pas disponibles, aucune comparaison octet à octet n'est possible : un écart d'un cran sur quelques entrées reste possible.
 */

/** Nombre de pas d'angle par tour. */
export const ANGLE_STEPS = 512;
export const ANGLE_MASK = ANGLE_STEPS - 1;
/** Période du tore en Q8 (32 768 unités × 256). */
export const TORUS_Q8 = 1 << 23;
export const TORUS_MASK = TORUS_Q8 - 1;
/** Une unité de monde en Q8. */
export const ONE = 256;

function buildSin(): Int16Array {
  const t = new Int16Array(ANGLE_STEPS);
  for (let i = 0; i < ANGLE_STEPS; i++)
    t[i] = Math.round(256 * Math.sin((2 * Math.PI * i) / ANGLE_STEPS));
  return t;
}

/** `round(256·sin(2π·i/512))`, Q8 (±256). */
export const SIN: Int16Array = buildSin();
/** `round(256·cos(2π·i/512))`, Q8 (±256) ; `COS[i] = SIN[i + 128]`. */
export const COS: Int16Array = Int16Array.from(
  { length: ANGLE_STEPS },
  (_, i) => SIN[(i + 128) & ANGLE_MASK]!,
);

/** Sinus Q8 d'un angle quelconque (replié modulo 512, y compris négatif). */
export function sin(angle: number): number {
  return SIN[angle & ANGLE_MASK]!;
}
export function cos(angle: number): number {
  return COS[angle & ANGLE_MASK]!;
}

/** Replie une coordonnée Q8 dans le tore (`x &= 0x7fffff`, entier signé 32 bits). */
export function wrapQ8(v: number): number {
  return v & TORUS_MASK;
}

/** Écart signé le plus court entre deux coordonnées Q8 du tore, dans `[-2^22, 2^22[`. */
export function torusDelta(a: number, b: number): number {
  return (
    ((((a - b) & TORUS_MASK) + (TORUS_Q8 >> 1)) & TORUS_MASK) - (TORUS_Q8 >> 1)
  );
}

/** Frottement `v -= v >> 4` (ou `v` entier si `v >> 4 == 0`), tel que dans `gm_heli_physics`. */
export function friction16(v: number): number {
  const d = v >> 4;
  return v - (d === 0 ? v : d);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * `gm_vec_normalize256` (`00415374`) : ramène un vecteur à la longueur 256. L'exe passe par des tables (`0055a4c8`,
 * `005836ac`, indexées par `|v|² >> 11` borné à 4000, 0 → 4000) ; ici la même indexation avec un facteur calculé :
 * `f = 65536 / sqrt(idx · 2048)`, résultat `v · f >> 8`. Approximation des tables (non lues), à ±1 près.
 */
export function normalize256(
  x: number,
  y: number,
  z: number,
  out: { x: number; y: number; z: number },
): void {
  let idx = (x * x + y * y + z * z) >>> 11;
  if (idx > 4000) idx = 4000;
  if (idx === 0) idx = 4000;
  const f = Math.trunc(65536 / Math.sqrt(idx * 2048));
  out.x = (x * f) >> 8;
  out.y = (y * f) >> 8;
  out.z = (z * f) >> 8;
}
