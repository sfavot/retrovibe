/**
 * Danse d'Algebird (rhythm.md §3.5) : chorégraphie tirée à chaque chargement de morceau et pas de danse d'une mesure. Pur : le hasard (`MsvcRandom`)
 * vient de l'appelant, le dessin et le temps sont ceux de la scène.
 *
 * Les tables sont relues dans le segment de données de `MATH` (`1108`, offsets `DS:11de`, `DS:136e` / `138a`, `DS:13a6`) ; les valeurs sont des
 * numéros de pose 1 à 174 de la `SHPL` 31000 (`SHAP` `31000 + pose - 1`, 148 × 154 pixels, posées dans le rectangle d'Algebird).
 *
 * - Familles de pose 0 à 4 (5 : seulement avec un tempo d'au moins 110 bpm, une fois sur deux) ; jamais trois fois la même d'affilée ni, pour la
 *   dernière mesure, la même famille que la première.
 * - Pas normal d'une mesure de `n` pas (`1028:2ab4`) : ligne `[depuis, f1 … f6, vers]` du couple (famille de la mesure, famille suivante) ;
 *   pas 0-1 = `f1, f2` (ou `f3, f4` si la mesure précédente est de même famille), pas 2 à `n - 3` = `f3 … f6` en boucle (période 4), deux derniers
 *   = `f5, f6` si la famille suivante est la même, sinon `f1, f2`.
 * - Pas spécial (`DS:13a6 + 24 (n - 1)`, 1 à 14) : table de 12 poses étalées sur les `n` pas de la mesure (`1028:2c32` n'est lu que dans le principe :
 *   **hypothèse** sur l'étalement quand `n` ≠ 12).
 */
import type { MsvcRandom } from "../engine/rng";

/** Nombre de poses de la `SHPL` 31000. */
export const DANCE_POSE_COUNT = 174;
export const DANCE_SHPL = 31000;
/** Pose neutre d'attente (`SHPL` 33000, indice 7). */
export const NEUTRAL_POSE_SHAP = 33006;

/** `DS:11de` : 5 × 5 lignes `[depuis, f1, f2, f3, f4, f5, f6, vers]`, indexées par (famille de la mesure, famille suivante). */
export const NORMAL_STEPS: readonly (readonly number[])[] = [
  [1, 7, 8, 9, 10, 9, 8, 1],
  [1, 7, 8, 9, 10, 9, 11, 2],
  [1, 12, 13, 14, 15, 16, 17, 3],
  [1, 18, 19, 20, 19, 20, 21, 4],
  [1, 22, 23, 24, 25, 26, 27, 5],
  [2, 28, 29, 30, 29, 30, 31, 1],
  [2, 28, 29, 30, 29, 30, 29, 2],
  [2, 32, 33, 34, 35, 34, 36, 3],
  [2, 37, 38, 39, 40, 39, 41, 4],
  [2, 42, 43, 44, 43, 45, 46, 5],
  [3, 47, 48, 49, 50, 49, 51, 1],
  [3, 52, 53, 54, 53, 54, 55, 2],
  [3, 47, 48, 49, 50, 49, 48, 3],
  [3, 56, 57, 58, 59, 60, 61, 4],
  [3, 62, 63, 64, 63, 64, 65, 5],
  [4, 66, 67, 68, 69, 68, 70, 1],
  [4, 71, 72, 73, 72, 74, 75, 2],
  [4, 76, 77, 78, 79, 78, 36, 3],
  [4, 66, 67, 68, 69, 68, 67, 4],
  [4, 28, 80, 81, 82, 81, 83, 5],
  [5, 84, 85, 86, 85, 86, 75, 1],
  [5, 87, 88, 89, 90, 89, 91, 2],
  [5, 83, 92, 93, 92, 94, 95, 3],
  [5, 96, 97, 98, 97, 98, 99, 4],
  [5, 84, 85, 86, 85, 86, 85, 5],
];

/** `DS:136e` / `DS:138a` : les 14 couples (famille de la mesure, famille suivante) qui ont un pas spécial (numéro = rang + 1). */
export const SPECIAL_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [3, 2],
  [4, 0],
  [0, 5],
  [5, 0],
  [1, 5],
  [5, 1],
  [2, 5],
  [5, 2],
  [3, 5],
  [5, 3],
  [5, 4],
  [4, 5],
  [5, 5],
];

/** `DS:13a6 + 24 (n - 1)` : 12 poses du pas spécial `n` (1 à 14). */
export const SPECIAL_STEPS: readonly (readonly number[])[] = [
  [1, 7, 8, 100, 101, 102, 103, 102, 101, 100, 11, 2],
  [4, 76, 77, 104, 78, 105, 79, 105, 78, 77, 36, 3],
  [5, 84, 106, 107, 108, 109, 106, 110, 111, 112, 70, 1],
  [1, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 6],
  [6, 144, 145, 146, 145, 146, 145, 146, 145, 146, 147, 1],
  [2, 123, 124, 125, 126, 127, 128, 127, 126, 125, 129, 6],
  [6, 148, 149, 150, 151, 151, 149, 150, 152, 152, 153, 2],
  [3, 130, 131, 132, 132, 132, 133, 134, 135, 136, 137, 6],
  [6, 154, 155, 156, 157, 24, 158, 159, 160, 26, 161, 3],
  [4, 138, 139, 140, 141, 142, 139, 140, 141, 142, 143, 6],
  [6, 162, 163, 164, 165, 166, 165, 167, 168, 167, 169, 4],
  [6, 170, 171, 172, 171, 172, 173, 172, 173, 172, 174, 5],
  [5, 174, 172, 173, 172, 173, 172, 171, 172, 171, 170, 6],
  [6, 170, 171, 172, 171, 172, 173, 172, 173, 172, 170, 6],
];

/** Famille « 5 » : tempo minimal pour qu'elle soit tirée (`rhythm.md` §3.5). */
export const FAMILY_FIVE_MIN_BPM = 110;
/** Les trois premières mesures évitent le pas spécial une fois sur trois. */
const SPECIAL_SKIP_MEASURES = 3;

export interface DancePlan {
  /** 4, 8 ou 12 mesures. */
  measures: number;
  /** Famille de pose (0 à 5) de chaque mesure. */
  families: number[];
  /** Pas spécial (1 à 14) de chaque mesure, 0 = pas normal. */
  specials: number[];
}

/** Numéro (1 à 14) du pas spécial du couple, ou 0. */
export function specialOfPair(family: number, next: number): number {
  const rank = SPECIAL_PAIRS.findIndex(([a, b]) => a === family && b === next);
  return rank + 1;
}

/** Tire la chorégraphie d'un morceau de tempo `bpm` (`1028:28e0`). */
export function planDance(rng: MsvcRandom, bpm: number): DancePlan {
  const measures = 4 * rng.range(1, 3);
  const draw = (): number => (bpm >= FAMILY_FIVE_MIN_BPM && rng.rand(1) === 1 ? 5 : rng.rand(4));
  const families: number[] = [];
  for (let m = 0; m < measures; m++) {
    let family = draw();
    // Jamais trois fois la même d'affilée ; la dernière mesure diffère de la première (tirages repris, bornés par sécurité).
    for (let guard = 0; guard < 50; guard++) {
      const triple = m >= 2 && families[m - 1] === family && families[m - 2] === family;
      const wraps = m === measures - 1 && family === families[0];
      if (!triple && !wraps) break;
      family = draw();
    }
    // Garde-fou : si le hasard s'obstine, on prend la famille suivante.
    if (m === measures - 1 && family === families[0]) family = (family + 1) % 5;
    if (m >= 2 && families[m - 1] === family && families[m - 2] === family) family = (family + 1) % 5;
    families.push(family);
  }
  const specials = families.map((family, m) => {
    const special = specialOfPair(family, families[(m + 1) % measures]!);
    if (special === 0) return 0;
    // 33 % de chance de ne pas l'appliquer pour les trois premières mesures, toujours ensuite.
    if (m < SPECIAL_SKIP_MEASURES && rng.rand(2) === 0) return 0;
    return special;
  });
  return { measures, families, specials };
}

/** Ligne de la table normale pour (famille, suivante) ; la famille 5 sans pas spécial prend la ligne du pas spécial (5, 5) étalée. */
function normalRow(family: number, next: number): readonly number[] | null {
  if (family > 4 || next > 4) return null;
  return NORMAL_STEPS[family * 5 + next]!;
}

/** Poses (numéros 1 à 174) des `steps` pas de la mesure `measure` du plan. */
export function dancePoses(plan: DancePlan, measure: number, steps: number): number[] {
  const m = ((measure % plan.measures) + plan.measures) % plan.measures;
  const family = plan.families[m]!;
  const next = plan.families[(m + 1) % plan.measures]!;
  const previous = plan.families[(m + plan.measures - 1) % plan.measures]!;
  const special = plan.specials[m]!;
  const row = special > 0 ? null : normalRow(family, next);
  const spread = special > 0 ? SPECIAL_STEPS[special - 1]! : row ? null : SPECIAL_STEPS[13]!;
  if (spread) return Array.from({ length: steps }, (_, k) => spread[Math.min(spread.length - 1, Math.floor((k * spread.length) / steps))]!);
  const f = row!.slice(1, 7);
  const poses: number[] = [];
  const sameAsPrevious = previous === family && m > 0;
  for (let k = 0; k < steps; k++) {
    let pose: number;
    if (k < 2) pose = sameAsPrevious ? f[2 + k]! : f[k]!;
    else if (k >= steps - 2) pose = next === family ? f[4 + (k - (steps - 2))]! : f[k - (steps - 2)]!;
    else pose = f[2 + ((k - 2) % 4)]!;
    poses.push(pose);
  }
  return poses;
}

/** `SHAP` d'une pose de danse. */
export function poseShapeId(pose: number): number {
  if (!Number.isInteger(pose) || pose < 1 || pose > DANCE_POSE_COUNT) throw new RangeError(`Pose ${pose} hors de 1 à ${DANCE_POSE_COUNT}`);
  return DANCE_SHPL + pose - 1;
}
