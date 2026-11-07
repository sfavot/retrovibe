import type { MsvcRandom } from "../../../../engine/mohawk/rng";
import type { Attrs } from "../state";

/**
 * Règles du piège de cristal (`SMOKE.MHK`, écran 17 ; `docs/zoombinis/puzzles/smoke.md`) : une machine compare deux versions transformées de deux fiches de
 * Zoombini, celle du Zoombini testé (à gauche) et une cible (à droite). Des filtres (niveau 2) ou des cristaux posés sur la voie (niveaux 3 et 4)
 * fixent ou incrémentent des attributs de chaque côté ; si les 4 attributs sont égaux après transformation le Zoombini est sauvé, sinon il est piégé.
 * Fonctions pures sur `SmokeState`, sans rendu ni attente ; seul le hasard (`MsvcRandom`, `10a8:04e8(max, min)` = `rng.range(min, max)`) est injecté,
 * dans l'ordre des tirages de l'original. Aucun texte.
 *
 * Attributs : octets `+0xec`…`+0xef` de l'objet = cheveux, yeux, nez, pieds (`attrs[0]` à `attrs[3]`, `engine.md` §3.6), de 1 à 5 ; **0 = pas d'effet** dans une
 * fiche de filtre ou de cristal (« case » de `DS:9442`). Dans les tirages, « niveau » est le niveau interne `[93ac]` de 1 à 4 (`1168:515d() + 1`).
 *
 * Correspondance avec la mémoire de l'original (noms français inventés) : `[93aa]` = `members.length`, `[93e2]` = `tested`, `[93e6]` = `savedCount`,
 * `[9428]` = `current`, `[9426]` = `silhouette`, `[93b6…93b9]` / `[93ba…93bd]` = `reference` (niveaux 1-2) ou les deux premiers de la paire A / B (niveaux 3-4),
 * `[94aa]` = `rank`, `[94ba]` = `second`, `[94dc…]` = `shelf`, `[94ec…]` = `left` / `right`, `DS:9442…` = case 0 (Zoombini), 1 à 3 (gauche),
 * 4 à 6 (droite, du centre vers l'extérieur), 7 (cible).
 */

export type SmokeLevel = 1 | 2 | 3 | 4;

/** Nombre de silhouettes (niveaux 1-2, `4956`), de filtres (niveau 2), de cristaux (niveaux 3-4), d'emplacements par côté. */
export const SILHOUETTES = 8;
export const FILTERS = 4;
export const CRYSTALS = 6;
export const SLOTS_PER_SIDE = 3;

// --- Images de la planche `tBMP` 10000 de `SMOKE.MHK` (`1140:0000`, relu et vérifié sur une planche de contrôle) ---

/** Ressources : planche de 69 images, ses ancres (`REGS` X, `REGS` Y), palette `SHPL`, fond. */
export const SMOKE_SHEET_ID = 10000;
export const SMOKE_SHEET_REGS_X = 10000;
export const SMOKE_SHEET_REGS_Y = 10001;
export const SMOKE_PALETTE_ID = 5000;
/**
 * Trois jeux de 21 images (indices 1-based de la planche) : base `b`, puis `b` = corps (grande silhouette bleue), `b + 1…5` = cheveux 1 à 5, `b + 6…10` = yeux,
 * `b + 11…15` = nez, `b + 16…20` = pieds. L'image d'un attribut `k` (0 cheveux, 1 yeux, 2 nez, 3 pieds) de valeur `v` est `b + 5k + v` (**sûr**).
 * Les jeux 1 et 43 sont les mêmes images tournées à gauche / à droite (mêmes tailles), le jeu 22 est de face.
 */
export const SILHOUETTE_SET_LEFT = 1;
export const SILHOUETTE_SET_FRONT = 22;
export const SILHOUETTE_SET_RIGHT = 43;
/** Images 64 à 69 : cristaux verts (64 = fond hachuré d'une silhouette, 65 / 66 / 68 de biais, 67 / 69 de face). */
export const CRYSTAL_IMAGE_FIRST = 64;
export const CRYSTAL_IMAGE_LAST = 69;
/**
 * Orientation d'un objet (octet `+0xf1` = `+0x121` du feature) : jeu de silhouette (`local_110[0xc2…]` de `1158:4a01`, mots lus par `1140:0000`) et image de cristal
 * posée dessous. Orientations utilisées : 0 filtre / cristal / cible de gauche, 1 silhouette, 2 filtre de droite, 3 seconde cible, 5 cible, 7 cristal sur étagère, 8 cristal gauche
 * du niveau 3-4 ; les autres (4, 6) existent dans la table.
 */
export const ORIENTATION_SET: readonly number[] = [1, 22, 43, 43, 22, 1, 1, 22, 43];
/** Image de cristal dessinée sous l'objet selon l'orientation (`1140:0000` : 0 → 0x41, 1 → 0x40, 2 → 0x42, 6 → 0x41, 7 → 0x45, 8 → 0x43 ; sinon aucune). */
export const ORIENTATION_CRYSTAL: Readonly<Record<number, number>> = { 0: 65, 1: 64, 2: 66, 6: 65, 7: 69, 8: 67 };

/**
 * Images à dessiner pour un objet d'orientation `orientation` et d'attributs `attrs`, de l'arrière vers l'avant (`1140:0000`) : le cristal éventuel, le corps (si les 4 attributs sont
 * non nuls : une silhouette complète), puis pieds, yeux, nez, cheveux de valeur non nulle (une pièce seule pour un cristal à un ou deux attributs).
 */
export function objectParts(orientation: number, attrs: Attrs): number[] {
  const base = ORIENTATION_SET[orientation] ?? 0;
  const parts: number[] = [];
  const crystal = ORIENTATION_CRYSTAL[orientation];
  if (crystal !== undefined) parts.push(crystal);
  if (attrs.every((v) => v !== 0)) parts.push(base);
  for (const k of [3, 1, 2, 0]) if (attrs[k] !== 0) parts.push(partImage(base, k, attrs[k]!));
  return parts;
}

/** Image 1-based de la pièce d'attribut `attribute` (0 à 3) de valeur `value` (1 à 5) dans le jeu de base `base` (1, 22 ou 43). */
export function partImage(base: number, attribute: number, value: number): number {
  return base + 5 * attribute + value;
}

// --- Types ---

/** Cristal (niveaux 3-4) : jusqu'à 2 attributs fixés (valeur ≠ 0) et au plus 1 attribut incrémenté (`+0xf5` = rang − 1). */
export interface SmokeCrystal {
  /** Valeurs imposées (0 = attribut libre) ; l'attribut incrémenté vaut 0 ici (son octet est recalculé à la pose, `2ad9`). */
  fixed: Attrs;
  /** Attribut ajoutant 1 en cycle (5 → 1) à la valeur qu'il a quand le cristal l'atteint, ou null. */
  incr: number | null;
}

/** Les cristaux, la cible et la seconde cible tirés par `1158:4dbf`. */
export interface CrystalPuzzle {
  /** Cristaux n° 1 à 6 (indices 0 à 5). */
  crystals: SmokeCrystal[];
  /** Cible n° 7 (le Zoombini A). */
  target: Attrs;
  /** Cible n° 8 (le Zoombini B), seulement s'il y a un B ; sinon null. */
  target2: Attrs | null;
}

/** Résultat d'une pose / d'un test. */
export interface SmokeTest {
  /** Fiche de gauche (Zoombini transformé), fiche de droite (cible transformée). */
  left: Attrs;
  right: Attrs;
  /** Vrai si les 4 attributs sont égaux (`1158:31e8` renvoie 0). */
  saved: boolean;
  /** Membre testé. */
  member: number;
}

export type SmokeSide = "left" | "right";

export interface SmokeState {
  level: SmokeLevel;
  /** Attributs du groupe, dans l'ordre des features (`1168:365d`). */
  members: Attrs[];
  /** Résultat par membre : null = pas encore testé, true = sauvé, false = piégé. */
  outcome: (boolean | null)[];
  /** Nombre de membres testés (`[93e2]`) et de sauvés (`[93e6]`). */
  tested: number;
  savedCount: number;
  /** Voix d'introduction `[a2c4]` tirée à la fin d'`Enter` (`10a8:04e8(20067, 20066)`), non jouée dans l'écran. */
  introVoice: number;
  /** Membre posé sur le cristal gauche (`[9428]`), ou null. */
  current: number | null;
  /** Vrai entre la fin d'un tour et le tirage du levier « nouveau tirage » (`[94ca] = 1`) : aucune pose possible. */
  awaitingRound: boolean;
  /** Vrai si le test du membre courant a été fait mais pas encore enregistré par `endTurn`. */
  pending: SmokeTest | null;

  // Niveaux 1-2 (`1158:3f88`, `42c0`, `4a01`, `4500`)
  /** Membres non testés, dans l'ordre (`[9380]` dont les testés sont mis à 0). */
  queue: number[];
  /** Référence `[93b6…93b9]` : le Zoombini dont une silhouette est la jumelle (octets nuls = libres). */
  reference: number[];
  /** Membre dont `reference` est la fiche (`93b6` copié de lui) : sa jumelle existe toujours parmi les silhouettes. */
  referenceMember: number | null;
  silhouettes: Attrs[];
  /** Silhouette posée sur le cristal droit (`[9426] − 1`), ou null. */
  silhouette: number | null;
  /** Filtres du niveau 2 : 0 et 1 à gauche (cases 1 et 2), 2 et 3 à droite (cases 4 et 5). Vide au niveau 1. */
  filters: Attrs[];
  /** Mémoire du générateur de filtres : forcés à gauche (`DS:950e`) et à droite (`DS:9516`). */
  forcedLeft: number[];
  forcedRight: number[];

  // Niveaux 3-4 (`1158:236b`, `4dbf`, `414b`)
  /** Rang du Zoombini courant (`[94aa]`). */
  rank: number;
  crystals: SmokeCrystal[];
  target: Attrs;
  /** Cible n° 8 (niveau 4, B présent), sinon null. */
  target2: Attrs | null;
  /** Étagère (1 à 6) de chaque cristal (`[94dc + 2n]`, permutation tirée par `236b`). */
  shelf: number[];
  /** Cristaux posés (numéros 1 à 6), de gauche à droite sur la voie. */
  left: number[];
  right: number[];
  /** Niveau 4 : le test en cours est celui du second de la paire, contre la cible n° 8 (`[94ba] < 3`), fait sans geste du joueur. */
  second: boolean;
}

// --- Générateur des cristaux `1158:4dbf(n, objet)` (niveaux 3-4) ---

/** `[94dc]` / pool de `4dbf` : liste 0…7 dont on retire l'entrée tirée (tirage sans remise de l'original). */
function newPool(): number[] {
  return [0, 1, 2, 3, 4, 5, 6, 7];
}

/** Retire l'entrée `idx` du pool (décalage des suivantes, `max` diminue d'un). */
function removeFromPool(pool: number[], idx: number, max: number): void {
  for (let e = idx; e < max + 1; e++) pool[e] = pool[e + 1] ?? 0;
}

type Table = number[][];

function table(rows: number): Table {
  return Array.from({ length: rows }, () => [0, 0, 0, 0]);
}

/** `x − 1`, 1 → 5 (les inversions des cristaux 3 et 4, `1158:4dbf`). */
function dec5(x: number): number {
  return x - 1 < 1 ? 5 : x - 1;
}

/** `x + 1`, 5 → 1. */
function inc5(x: number): number {
  return x + 1 > 5 ? 1 : x + 1;
}

/**
 * `1158:4dbf(1, …)` : tire les 6 cristaux, la cible n° 7 et, s'il y a un second Zoombini, la cible n° 8. Les appels `n = 2…8` de l'original ne font que recopier ces valeurs.
 * Tables de l'original (9 lignes de 4 mots) : `R` (`DS:953c`, valeur de l'attribut), `S` (`DS:9584`, même ligne pour le second Zoombini B), `T` (`DS:95cc`, non nul si
 * l'attribut est incrémenté) ; `cur` (`9614` / `961c`) suit l'état de A et de B après les cristaux déjà construits, `cur2` (`9624` / `962c`) sa copie pour la construction à l'envers.
 * Le décompilé a été relu sur le désassemblage de `1158:4f78`…`5083` (adresses des tables, ordre des tirages) ; la phase 1 écrit à un endroit **faux** quand B est absent :
 * voir `bugMissingB`.
 *
 *  1. Cristaux 1 et 2 (« côté gauche » : transforment A) : 2 attributs au plus chacun. Pour chaque attribut `a` (tirage `04e8(5, 1)` dans le pool restant), au rang
 *     `special = 04e8(4, 0)` (0 à 4 : 4 = aucun) avec la probabilité `rand(100) > 0x46` et si rien n'est encore incrémenté, l'attribut est incrémenté ; sinon `rand(100) > 0x28`, ou
 *     obligatoirement pour le dernier attribut quand rien n'est posé, il est fixé à la valeur tirée.
 *  2. Cristaux 3 et 4 (« côté droit » : ramènent la cible à l'état atteint par A) : construits à l'envers (`cur2 − 1`), 70 % de branche normale (`rand(100) < 0x47`) ; le tirage de
 *     `special` de la phase est fait mais n'est pas lu.
 *  3. Cible n° 7 puis (si B) n° 8 : défaite des cristaux 4 et 3 à partir de l'état `cur2`, valeurs libres tirées par `04e8(5, 1)`.
 *  4. Cristaux 5 et 6 : niveau 3, deux leurres tirés sur le modèle de la phase 1 ; niveau 4, un leurre est une copie « décalée de 1 » du cristal 3 ou 4 (ou 1 ou 2) et l'autre un
 *     cristal à un attribut aléatoire.
 *
 * `bugMissingB` (défaut faux : défaut de l'original corrigé, décision de la vague H ; vrai le reproduit) : si B est absent (dernier Zoombini d'un groupe impair) et que le cristal 1 ou 2 incrémente un attribut, l'original écrit
 * `R = B[a] + 1 = 1` au lieu de `S` (`1158:5017` : écriture à `[BX + 0x953c]` au lieu de `0x9584`), donc l'état suivi de A devient 1 au lieu de sa vraie valeur + 1 : les cristaux 3 et 4
 * sont alors construits sur un état faux. Faux = comportement corrigé (écrit `S`, plafond `inc5`).
 */
export function generateCrystals(rng: MsvcRandom, level: 3 | 4, a: Attrs, b: Attrs | null, bugMissingB = false): CrystalPuzzle {
  const A: number[] = [...a];
  const B: number[] = b ? [...b] : [0, 0, 0, 0];
  const R = table(9);
  const S = table(9);
  const T = table(9);
  R[0] = [...A];
  S[0] = [...B];
  const cur = [[...A], [...B]] as [number[], number[]];

  // Phase 1 : cristaux 1 et 2.
  for (let n = 1; n < 3; n++) {
    const pool = newPool();
    let count = 0;
    let incrDone = false;
    let idx = 1;
    let max = 5;
    const special = rng.range(0, 4);
    for (let at = 0; at < 4; at++) {
      if (count >= 2) continue;
      idx = rng.range(1, max);
      if (at === special && rng.range(0, 100) > 0x46 && !incrDone) {
        incrDone = true;
        R[n]![at] = inc5(cur[0][at] === 0 ? A[at]! : cur[0][at]!);
        if (cur[1][at] === 0) {
          // Écriture fautive de l'original : R et non S, sans plafond.
          if (bugMissingB) R[n]![at] = B[at]! + 1;
          else S[n]![at] = 1;
        } else {
          S[n]![at] = inc5(cur[1][at]!);
        }
        T[n]![at] = R[n]![at]!;
      } else if (rng.range(0, 100) > 0x28 || (at === 3 && count === 0)) {
        R[n]![at] = S[n]![at] = pool[idx]!;
        T[n]![at] = 0;
      }
      if (R[n]![at] !== 0) {
        cur[0][at] = R[n]![at]!;
        cur[1][at] = S[n]![at]!;
        count++;
        removeFromPool(pool, idx, max);
        max--;
      }
    }
  }

  // Phase 2 : cristaux 3 et 4, à l'envers.
  const cur2 = [[...cur[0]], [...cur[1]]] as [number[], number[]];
  for (let n = 3; n < 5; n++) {
    const pool = newPool();
    let count = 0;
    let incrDone = false;
    let idx = 1;
    let max = 5;
    rng.range(0, 4); // `local_14` : tiré mais jamais lu dans cette phase
    for (let at = 0; at < 4; at++) {
      if (count >= 2) continue;
      idx = rng.range(1, max);
      const r = rng.range(0, 100);
      const normal = (r < 0x47 && (at !== 3 || count !== 0)) || incrDone;
      const fixedBefore = (T[2]![at] === 0 && R[2]![at] !== 0) || (T[1]![at] === 0 && R[1]![at] !== 0);
      if (normal) {
        if (n === 3) {
          if (T[2]![at] === 0 && R[2]![at] !== 0) {
            R[3]![at] = cur2[0][at]!;
            S[3]![at] = cur2[1][at]!;
          } else if (T[1]![at] === 0 && R[1]![at] !== 0) {
            R[3]![at] = cur2[0][at]!;
            S[3]![at] = cur2[1][at]!;
          } else {
            R[3]![at] = S[3]![at] = 0;
          }
          T[3]![at] = 0;
        } else if (T[3]![at] === 0) {
          if (R[3]![at] === 0) {
            if (fixedBefore) {
              R[4]![at] = cur2[0][at]!;
              S[4]![at] = cur2[1][at]!;
            } else {
              R[4]![at] = S[4]![at] = 0;
            }
            T[4]![at] = 0;
          } else {
            R[4]![at] = S[4]![at] = pool[idx]!;
          }
        } else if (!incrDone) {
          R[4]![at] = dec5(cur2[0][at]!);
          S[4]![at] = dec5(cur2[1][at]!);
          incrDone = true;
          T[4]![at] = R[4]![at]!;
        } else {
          T[4]![at] = 0;
        }
      } else {
        incrDone = true;
        if (n === 3) {
          R[3]![at] = cur2[0][at] === 0 ? A[at]! : cur2[0][at]!;
          S[3]![at] = cur2[0][at] === 0 ? B[at]! : cur2[1][at]!;
        } else if (T[3]![at] === 0) {
          if (R[3]![at] === 0) {
            R[4]![at] = cur2[0][at] === 0 ? A[at]! : cur2[0][at]!;
            S[4]![at] = cur2[0][at] === 0 ? B[at]! : cur2[1][at]!;
          } else {
            R[4]![at] = S[4]![at] = pool[idx]!;
          }
        } else {
          R[4]![at] = dec5(cur2[0][at]!);
          S[4]![at] = dec5(cur2[1][at]!);
        }
        T[n]![at] = R[n]![at]!;
      }
      if (R[n]![at] !== 0) {
        cur2[0][at] = R[n]![at]!;
        cur2[1][at] = S[n]![at]!;
        count++;
        removeFromPool(pool, idx, max);
        max--;
      }
    }
  }

  // Phase 3 : cibles n° 7 et n° 8.
  for (let at = 0; at < 4; at++) {
    if (T[4]![at] !== 0) R[7]![at] = dec5(R[4]![at]!);
    else if (R[4]![at] === 0) {
      if (T[3]![at] === 0) R[7]![at] = R[3]![at] === 0 ? cur2[0][at]! : rng.range(1, 5);
      else R[7]![at] = dec5(R[3]![at]!);
    } else R[7]![at] = rng.range(1, 5);
  }
  const hasB = B[0] !== 0;
  if (hasB) {
    for (let at = 0; at < 4; at++) {
      if (T[4]![at] !== 0) S[8]![at] = dec5(S[4]![at]!);
      else if (S[4]![at] === 0) {
        if (T[3]![at] === 0) S[8]![at] = S[3]![at] === 0 ? cur2[1][at]! : rng.range(1, 5);
        else S[8]![at] = dec5(S[3]![at]!);
      } else S[8]![at] = rng.range(1, 5);
    }
  }

  // Phase 4 : cristaux 5 et 6.
  if (level === 3) {
    for (let n = 5; n < 7; n++) {
      const pool = newPool();
      let count = 0;
      let idx = 1;
      let max = 5;
      const special = rng.range(0, 3);
      for (let at = 0; at < 4; at++) {
        if (count >= 2) continue;
        idx = rng.range(1, max);
        if (at === special && rng.range(0, 100) > 0x46) {
          R[n]![at] = pool[idx]!;
          T[n]![at] = pool[idx]!;
        } else if (rng.range(0, 100) > 0x28 || (at === 3 && count === 0)) {
          R[n]![at] = pool[idx]!;
          T[n]![at] = 0;
        }
        if (R[n]![at] !== 0) {
          count++;
          removeFromPool(pool, idx, max);
          max--;
        }
      }
    }
  } else if (rng.range(0, 1) === 0) {
    const n = rng.range(3, 4);
    for (let at = 0; at < 4; at++) {
      if (T[n]![at] === 0) {
        if (R[n]![at] !== 0) {
          R[6]![at] = inc5(R[n]![at]!);
          T[6]![at] = 0;
        }
      } else {
        R[6]![at] = R[n]![at]!;
        T[6]![at] = R[n]![at]!;
      }
    }
    rng.range(1, 2); // `local_12` : tiré, non lu
    const sp = rng.range(0, 3);
    for (let at = 0; at < 4; at++) {
      if (at === sp) {
        R[5]![at] = rng.range(1, 5);
        T[5]![at] = 0;
      }
    }
  } else {
    const n = rng.range(1, 2);
    for (let at = 0; at < 4; at++) {
      if (T[n]![at] === 0) {
        if (R[n]![at] !== 0) {
          R[5]![at] = inc5(R[n]![at]!);
          T[5]![at] = 0;
        }
      } else {
        R[5]![at] = R[n]![at]!;
        T[5]![at] = R[n]![at]!;
      }
    }
    rng.range(3, 4); // `local_12` : tiré, non lu
    const sp = rng.range(0, 3);
    for (let at = 0; at < 4; at++) {
      if (at === sp) {
        R[6]![at] = rng.range(1, 5);
        T[6]![at] = 0;
      }
    }
  }

  // Recopie dans les objets (`4dbf`, fin) : octets +0xbc… = R ; `+0xf5` = rang du dernier attribut de T non nul. Un cristal qui incrémente un attribut ignore l'octet de cet attribut.
  const crystals: SmokeCrystal[] = [];
  for (let n = 1; n <= 6; n++) {
    let incr: number | null = null;
    for (let at = 0; at < 4; at++) if (T[n]![at] !== 0) incr = at;
    const fixed = [0, 0, 0, 0] as Attrs;
    for (let at = 0; at < 4; at++) if (at !== incr) fixed[at] = R[n]![at]!;
    crystals.push({ fixed, incr });
  }
  return {
    crystals,
    target: R[7]!.slice() as Attrs,
    target2: hasB ? (S[8]!.slice() as Attrs) : null,
  };
}

// --- Niveau 2 : filtres `1158:4500(i, objet)` ---

/**
 * `1158:4500(i, …)` : tire le filtre `i` (0 et 1 à gauche, cases 1 et 2 ; 2 et 3 à droite, cases 4 et 5) et met à jour `s.reference` (octets nuls = libres) et la mémoire
 * `s.forcedLeft` (`DS:950e`) / `s.forcedRight` (`DS:9516`). `n = 04e8(2, 1)` réglages, au plus 4 essais ; les listes `A` (attributs 0 à 4, indice max 3) et `B` (valeurs 1 à 6, indice max 4)
 * sont consommées à chaque essai (tirage `B` d'abord, puis `A`), même quand le filtre est à droite (qui tire alors son attribut à part, `04e8(3, 0)`, après eux).
 *  - gauche : le réglage `(A[ia], B[ib])` est accepté si l'attribut n'est pas déjà forcé à cette valeur ;
 *  - droite : attribut `a` : s'il n'est pas forcé à gauche il prend la valeur de la référence ; sinon (35 %, `rand(100) > 0x41`, ou 4e essai sans rien posé) il prend la valeur forcée à gauche.
 * Fin d'appel : `reference[a] = forcedLeft[a]` si non nul ; au 4e appel les valeurs forcées à droite (case 4 avant case 5) sont relues et `reference[a]` vaut 0 si elle les égale
 * (la jumelle est alors libre sur cet attribut). `s.filters` doit contenir les filtres déjà tirés.
 */
function drawFilter(rng: MsvcRandom, i: number, s: SmokeState): Attrs {
  const { reference, forcedLeft, forcedRight } = s;
  const out: Attrs = [0, 0, 0, 0];
  const attrList = [0, 1, 2, 3, 4];
  const valueList = [1, 2, 3, 4, 5, 6];
  let maxAttr = 3;
  let maxValue = 4;
  if (i === 0) {
    forcedLeft.fill(0);
    forcedRight.fill(0);
  }
  const total = rng.range(1, 2);
  let left = total;
  for (let tried = 0; tried < 4 && left > 0; tried++) {
    const valueIdx = rng.range(0, maxValue);
    const attrIdx = rng.range(0, maxAttr);
    if (i < 2) {
      const attr = attrList[attrIdx]!;
      const value = valueList[valueIdx]!;
      if (forcedLeft[attr] !== value) {
        out[attr] = value;
        forcedLeft[attr] = value;
        left--;
      }
    } else {
      const attr = rng.range(0, 3);
      if (forcedLeft[attr] === 0) {
        out[attr] = reference[attr]!;
        forcedRight[attr] = reference[attr]!;
        left--;
      } else if (rng.range(0, 100) > 0x41 || (left === total && tried === 3)) {
        out[attr] = forcedLeft[attr]!;
        forcedRight[attr] = forcedLeft[attr]!;
        left--;
      }
    }
    removeFromPool(attrList, attrIdx, maxAttr);
    maxAttr--;
    removeFromPool(valueList, valueIdx, maxValue);
    maxValue--;
  }
  for (let k = 0; k < 4; k++) if (forcedLeft[k] !== 0) reference[k] = forcedLeft[k]!;
  if (i === 3) {
    for (let k = 0; k < 4; k++) {
      const v = s.filters[2]![k]! || out[k]!;
      if (v !== 0) forcedRight[k] = v;
      if (reference[k] === forcedRight[k]) reference[k] = 0;
    }
  }
  return out;
}

/** Tire les 4 filtres dans l'ordre (`1158:44ab` au levier, `4a01(4, 2)` à `Enter`). */
function drawAllFilters(rng: MsvcRandom, s: SmokeState): void {
  s.filters = [];
  for (let i = 0; i < FILTERS; i++) s.filters.push(drawFilter(rng, i, s));
}

// --- Silhouettes `1158:4a01(8, 1)` (création) et `1158:42c0` (nouveau tirage) ---

/** Remplit `silhouettes` : 4 tirages par silhouette dans `1…max`, puis la jumelle (indice tiré) recopie la référence, un octet nul étant tiré à la place. */
function drawSilhouettes(rng: MsvcRandom, s: SmokeState, twin: number, max: number): void {
  const out: Attrs[] = [];
  for (let k = 0; k < SILHOUETTES; k++) {
    const attrs: Attrs = [rng.range(1, max), rng.range(1, max), rng.range(1, max), rng.range(1, max)];
    if (k === twin) for (let at = 0; at < 4; at++) attrs[at] = s.reference[at] === 0 ? rng.range(1, max) : s.reference[at]!;
    out.push(attrs);
  }
  s.silhouettes = out;
}

// --- Cycle de la partie ---

function blankState(level: SmokeLevel, members: readonly Attrs[]): SmokeState {
  return {
    level,
    members: members.map((m) => [...m] as Attrs),
    outcome: members.map(() => null),
    tested: 0,
    savedCount: 0,
    introVoice: 0,
    current: null,
    awaitingRound: false,
    pending: null,
    queue: members.map((_, i) => i),
    reference: [0, 0, 0, 0],
    referenceMember: null,
    silhouettes: [],
    silhouette: null,
    filters: [],
    forcedLeft: [0, 0, 0, 0],
    forcedRight: [0, 0, 0, 0],
    rank: 0,
    crystals: [],
    target: [0, 0, 0, 0],
    target2: null,
    shelf: [0, 1, 2, 3, 4, 5, 6],
    left: [],
    right: [],
    second: false,
  };
}

/**
 * `1158:0000` (`Enter`) : mise en place d'après le groupe `members` (1 à 16 membres, dans l'ordre des features) et le niveau (1 à 4). Tirages, dans l'ordre de l'original :
 *  1. `04e8(N − 1, 0)` : membre de référence (niveaux 1-2 ; tiré aussi aux niveaux 3-4, sans usage : A et B sont les deux premiers membres) ;
 *  2. `1158:4956` : `4a01(nombre, type)` tire d'abord `04e8(nombre − 1, 0)` (indice de la jumelle) puis ses objets :
 *     niveau 1 `(8,1)(2,4)(2,5)` ; niveau 2 `(4,2)(8,1)(2,4)(2,5)` ; niveau 3 `(7,3)(1,4)(2,5)` ; niveau 4 `(8,3)(1,4)(2,5)`. Les types 4 et 5 ne tirent que l'indice (`04e8(1, 0)`, ou `04e8(0, 0)` qui n'avance pas) ;
 *  3. `04e8(20067, 20066)` : voix d'introduction.
 * Aux niveaux 3-4 le groupe arrive un par un : `current` est le premier membre (case 0), les cristaux sont sur les étagères dans l'ordre.
 */
export function createSmoke(rng: MsvcRandom, level: SmokeLevel, members: readonly Attrs[], bugMissingB = false): SmokeState {
  if (members.length < 1 || members.length > 16) throw new Error("smoke : un groupe compte de 1 à 16 Zoombinis");
  const s = blankState(level, members);
  const n = members.length;
  const refMember = rng.range(0, n - 1);
  if (level < 3) {
    s.reference = [...members[refMember]!];
    s.referenceMember = refMember;
  }
  else {
    s.current = 0;
  }
  if (level === 1) {
    const twin = rng.range(0, SILHOUETTES - 1);
    drawSilhouettes(rng, s, twin, 5);
    rng.range(0, 1);
    rng.range(0, 1);
  } else if (level === 2) {
    rng.range(0, FILTERS - 1);
    drawAllFilters(rng, s);
    const twin = rng.range(0, SILHOUETTES - 1);
    drawSilhouettes(rng, s, twin, 5);
    rng.range(0, 1);
    rng.range(0, 1);
  } else {
    rng.range(0, level === 3 ? 6 : 7);
    fillCrystals(rng, s, bugMissingB);
    rng.range(0, 1);
  }
  s.introVoice = rng.range(20066, 20067);
  return s;
}

/** `1158:4dbf` pour le Zoombini courant `rank` (A) et le suivant (B, absent après le dernier ; au niveau 4 la paire n'est pas recalculée en cours de paire). */
function fillCrystals(rng: MsvcRandom, s: SmokeState, bugMissingB: boolean): void {
  const a = s.members[s.rank]!;
  const b = s.members[s.rank + 1] ?? null;
  const p = generateCrystals(rng, s.level as 3 | 4, a, b, bugMissingB);
  s.crystals = p.crystals;
  s.target = p.target;
  s.target2 = s.level === 4 ? p.target2 : null;
  s.current = s.rank;
}

// --- Évaluation ---

/** Applique un cristal à une fiche (la valeur d'un attribut incrémenté est celle que la chaîne lui donne : `+1` cyclique). */
export function applyCrystal(c: SmokeCrystal, attrs: Attrs): void {
  for (let at = 0; at < 4; at++) if (c.fixed[at] !== 0) attrs[at] = c.fixed[at]!;
  if (c.incr !== null) attrs[c.incr] = inc5(attrs[c.incr]!);
}

function applyFilter(f: Attrs, attrs: Attrs): void {
  for (let at = 0; at < 4; at++) if (f[at] !== 0) attrs[at] = f[at]!;
}

/**
 * `1158:31e8` : fiches transformées. Gauche : le Zoombini (case 0) puis les cases 1, 2, 3 ; droite : la cible (case 7) puis les cases 6, 5, 4. Une case non nulle l'emporte.
 * Niveaux 3-4 : la chaîne de gauche s'applique de gauche à droite, celle de droite de droite à gauche (`2ad9`, `2d23`).
 */
export function transform(s: SmokeState, member: number): SmokeTest {
  const left: Attrs = [...s.members[member]!];
  let right: Attrs;
  if (s.level <= 2) {
    right = [...s.silhouettes[s.silhouette ?? 0]!];
    if (s.level === 2) {
      applyFilter(s.filters[0]!, left);
      applyFilter(s.filters[1]!, left);
      applyFilter(s.filters[3]!, right);
      applyFilter(s.filters[2]!, right);
    }
  } else {
    right = [...(s.second ? s.target2! : s.target)];
    for (const n of s.left) applyCrystal(s.crystals[n - 1]!, left);
    for (let i = s.right.length - 1; i >= 0; i--) applyCrystal(s.crystals[s.right[i]! - 1]!, right);
  }
  return { left, right, saved: left.every((v, i) => v === right[i]), member };
}

// --- Actions du joueur ---

/** Niveaux 1-2 : pose le membre `member` (non testé) sur le wagonnet de gauche. Reprend celui qui y était. Refuse après un test non enregistré ou entre deux tours. */
export function chooseMember(s: SmokeState, member: number): boolean {
  if (s.level > 2 || s.awaitingRound || s.pending || s.outcome[member] !== null || member < 0 || member >= s.members.length) return false;
  s.current = member;
  return true;
}

/** Reprend le Zoombini posé (`1158:1429`, clic dessus : case 0 vidée, levier désarmé). */
export function releaseMember(s: SmokeState): void {
  if (s.level <= 2 && !s.pending) s.current = null;
}

/** Niveaux 1-2 : pose la silhouette `k` sur le cristal droit (une seule à la fois ; en poser une autre renvoie la première à sa place). */
export function chooseSilhouette(s: SmokeState, k: number): boolean {
  if (s.level > 2 || s.awaitingRound || s.pending || k < 0 || k >= SILHOUETTES) return false;
  s.silhouette = k;
  return true;
}

export function releaseSilhouette(s: SmokeState): void {
  if (s.level <= 2 && !s.pending) s.silhouette = null;
}

/**
 * Niveaux 3-4 : pose le cristal `crystal` (1 à 6) du côté `side`, à la place `slot` (0 à nombre de cristaux déjà posés de ce côté, de gauche à droite : les suivants sont décalés).
 * Refusé si le côté compte déjà 3 cristaux. Un cristal déjà posé est d'abord retiré (`1158:1429`, clic sur un cristal posé).
 */
export function placeCrystal(s: SmokeState, crystal: number, side: SmokeSide, slot: number): boolean {
  if (s.level < 3 || s.awaitingRound || s.pending || s.second || crystal < 1 || crystal > CRYSTALS) return false;
  const before = { left: [...s.left], right: [...s.right] };
  removeCrystal(s, crystal);
  const list = side === "left" ? s.left : s.right;
  if (list.length >= SLOTS_PER_SIDE || slot < 0 || slot > list.length) {
    s.left = before.left;
    s.right = before.right;
    return false;
  }
  list.splice(slot, 0, crystal);
  return true;
}

/** Retire un cristal de la voie (il retourne à son étagère). */
export function removeCrystal(s: SmokeState, crystal: number): void {
  if (s.second || s.pending) return;
  s.left = s.left.filter((c) => c !== crystal);
  s.right = s.right.filter((c) => c !== crystal);
}

/**
 * Le levier est armé (`[94c8] = 1`) : niveaux 1-2 quand un Zoombini et une silhouette sont posés ; niveaux 3-4 quand un Zoombini est là (la voie peut être vide : le test se fait alors
 * Zoombini contre cible). Au niveau 4 le test du second de la paire n'est pas tiré par le joueur : voir `second`.
 */
export function leverArmed(s: SmokeState): boolean {
  if (s.awaitingRound || s.pending || isFinished(s)) return false;
  if (s.level <= 2) return s.current !== null && s.silhouette !== null;
  return s.current !== null;
}

/** Tire le levier (`1158:1429` région 3 → `3126` → `31e8`) ou lance le test automatique du second Zoombini (niveau 4). Enregistre le test dans `pending`. */
export function pull(s: SmokeState): SmokeTest | null {
  if (!leverArmed(s)) return null;
  s.pending = transform(s, s.current!);
  return s.pending;
}

/** Tous les Zoombinis ont été testés (`[93e2] = [93aa]`) : les clics de saisie sont ignorés. */
export function isFinished(s: SmokeState): boolean {
  return s.tested >= s.members.length;
}

/** Le bouton « go » est actif après le premier Zoombini sauvé (`[9504]`). */
export function goActive(s: SmokeState): boolean {
  return s.savedCount > 0;
}

export interface TurnEnd {
  /** Résultat du Zoombini testé. */
  test: SmokeTest;
  /** Vrai si tous les membres sont testés. */
  finished: boolean;
  /** Niveau 4 : le second de la paire arrive et doit être testé sans geste (appeler `pull`). */
  autoTest: boolean;
  /** Le levier « nouveau tirage » est disponible (il faut appeler `newRound` avant toute pose). */
  roundAvailable: boolean;
}

/**
 * Fin de tour (`Tick`, événement 50) : enregistre le test de `pending` (sauvé : `+0x127 = 1`, `savedCount++` ; sinon piégé), `tested++`, puis prépare la suite :
 *  - niveaux 1-2 : le membre testé quitte la file, `1158:3f88` tire la prochaine référence (`04e8(restants − 1, 0)`, rien s'il ne reste personne) ;
 *  - niveau 3 : `rank++`, A et B sont les deux suivants (`414b`, sans tirage) ;
 *  - niveau 4 : après le premier de la paire, le second arrive et est testé avec la même disposition (`second`) ; après le second, `rank++` et nouvelle paire.
 * Au niveau 4 le second testé n'est pas un « nouveau tirage » : le levier ne s'offre qu'une fois la paire terminée.
 * Les voix de fin de série (`04e8(4, 0)`, `04e8(20048, 20045)`, `04e8(20063, 20055)`) sont tirées par l'écran après le dernier tour.
 */
export function endTurn(s: SmokeState, rng: MsvcRandom): TurnEnd | null {
  const test = s.pending;
  if (!test) return null;
  s.pending = null;
  s.outcome[test.member] = test.saved;
  s.tested++;
  if (test.saved) s.savedCount++;
  s.current = null;
  let autoTest = false;
  let roundAvailable = false;
  if (s.level <= 2) {
    s.queue = s.queue.filter((m) => m !== test.member);
    s.silhouette = null;
    if (s.queue.length > 0) {
      s.referenceMember = s.queue[rng.range(0, s.queue.length - 1)]!;
      s.reference = [...s.members[s.referenceMember]!];
      roundAvailable = true;
    }
  } else {
    s.rank++;
    if (s.level === 4 && !s.second) {
      if (s.rank < s.members.length) {
        s.second = true;
        s.current = s.rank;
        autoTest = true;
      }
    } else {
      s.second = false;
    }
    roundAvailable = !isFinished(s) && !autoTest;
  }
  s.awaitingRound = roundAvailable;
  return { test, finished: isFinished(s), autoTest, roundAvailable };
}

/**
 * Levier « nouveau tirage » (`1158:2208`) : vide la chaîne et les fiches, puis
 *  - niveau 1 : `42c0` (nouvelles silhouettes) ; niveau 2 : `44ab` (4 filtres) puis `42c0` ;
 *  - niveaux 3-4 : `236b` : permutation des 6 étagères (`04e8(6 − k, 1)`, 6 tirages), puis `4dbf` pour le nouveau A et son B ; le Zoombini suivant se pose sur le cristal gauche.
 * `42c0(p)` : `p` = membres restants ; jumelle d'indice `04e8(min(8, p) − 1, 0)` ; 4 attributs de 1 à 4 par silhouette (la valeur 5 n'apparaît plus que par la référence).
 */
export function newRound(s: SmokeState, rng: MsvcRandom, bugMissingB = false): boolean {
  if (!s.awaitingRound) return false;
  s.awaitingRound = false;
  s.left = [];
  s.right = [];
  if (s.level <= 2) {
    if (s.level === 2) drawAllFilters(rng, s);
    const p = s.queue.length;
    const twin = rng.range(0, Math.min(8, p) - 1);
    drawSilhouettes(rng, s, twin, 4);
    s.silhouette = null;
    s.current = null;
  } else {
    const pool = newPool();
    let max = 6;
    const shelf = [0, 1, 2, 3, 4, 5, 6];
    for (let n = 1; n < 7; n++) {
      const idx = rng.range(1, max);
      shelf[n] = pool[idx]!;
      removeFromPool(pool, idx, max);
      max--;
    }
    s.shelf = shelf;
    fillCrystals(rng, s, bugMissingB);
  }
  return true;
}

/**
 * Sortie (`1168:36e1`) : seuls les Zoombinis sauvés (`+0x127 = 1`) restent ; les piégés, ceux qui n'ont pas été testés et ceux qui ne sont jamais arrivés sont perdus
 * (ils retournent au camp 2).
 */
export function leaveSmoke(s: SmokeState): { saved: number[]; lost: number[] } {
  const saved: number[] = [];
  const lost: number[] = [];
  s.members.forEach((_, i) => (s.outcome[i] === true ? saved : lost).push(i));
  return { saved, lost };
}

// --- Robot ---

export interface SmokeRobotPlan {
  /** Niveaux 1-2 : membre et silhouette à poser. */
  member?: number;
  silhouette?: number;
  /** Niveaux 3-4 : cristaux (numéros 1 à 6) de chaque côté, de gauche à droite. */
  left?: number[];
  right?: number[];
}

/** Toutes les suites ordonnées de cristaux distincts (1 à 6) de 0 à 3 éléments : les dispositions possibles d'un côté de la voie (157), par longueur croissante. */
const SIDE_SEQUENCES: readonly (readonly number[])[] = (() => {
  const out: number[][] = [[]];
  for (let len = 1; len <= SLOTS_PER_SIDE; len++) {
    const rec = (prefix: number[]): void => {
      if (prefix.length === len) {
        out.push(prefix);
        return;
      }
      for (let c = 1; c <= CRYSTALS; c++) if (!prefix.includes(c)) rec([...prefix, c]);
    };
    rec([]);
  }
  return out;
})();

/** Test d'une disposition sans allocation de plus que les fiches (mêmes règles que `transform`). */
function passes(crystals: readonly SmokeCrystal[], left: readonly number[], right: readonly number[], member: Attrs, target: Attrs): boolean {
  const l: Attrs = [...member];
  const r: Attrs = [...target];
  for (const n of left) applyCrystal(crystals[n - 1]!, l);
  for (let i = right.length - 1; i >= 0; i--) applyCrystal(crystals[right[i]! - 1]!, r);
  return l[0] === r[0] && l[1] === r[1] && l[2] === r[2] && l[3] === r[3];
}

/**
 * Robot : cherche de quoi sauver le Zoombini courant.
 *  - niveaux 1-2 : le premier membre non testé pour lequel une silhouette passe (la jumelle du membre de référence existe toujours), avec la silhouette ;
 *  - niveaux 3-4 : la disposition la plus courte (nombre total de cristaux, puis ordre de l'énumération) pour laquelle le Zoombini courant passe contre la cible et, au niveau 4 quand un second Zoombini suit,
 *    pour laquelle ce second passe aussi contre la cible n° 8. Renvoie null s'il n'en existe pas.
 */
export function robotPlan(s: SmokeState): SmokeRobotPlan | null {
  if (isFinished(s) || s.pending) return null;
  if (s.level <= 2) {
    const probe = { ...s, silhouette: 0 } as SmokeState;
    for (const m of s.queue) {
      for (let k = 0; k < SILHOUETTES; k++) {
        probe.silhouette = k;
        if (transform(probe, m).saved) return { member: m, silhouette: k };
      }
    }
    return null;
  }
  const second = s.level === 4 && !s.second && s.target2 !== null && s.rank + 1 < s.members.length ? s.rank + 1 : null;
  const first = s.members[s.rank]!;
  for (let total = 0; total <= 2 * SLOTS_PER_SIDE; total++) {
    for (const left of SIDE_SEQUENCES) {
      const wanted = total - left.length;
      if (wanted < 0 || wanted > SLOTS_PER_SIDE) continue;
      for (const right of SIDE_SEQUENCES) {
        if (right.length !== wanted || right.some((c) => left.includes(c))) continue;
        if (passes(s.crystals, left, right, first, s.target) && (second === null || passes(s.crystals, left, right, s.members[second]!, s.target2!))) {
          return { left: [...left], right: [...right] };
        }
      }
    }
  }
  return null;
}

/** Applique un plan du robot (poses puis levier) ; renvoie le test ou null. */
export function robotApply(s: SmokeState, plan: SmokeRobotPlan): SmokeTest | null {
  if (s.level <= 2) {
    if (!chooseMember(s, plan.member!) || !chooseSilhouette(s, plan.silhouette!)) return null;
  } else if (!s.second) {
    s.left = [];
    s.right = [];
    for (const c of plan.left ?? []) if (!placeCrystal(s, c, "left", s.left.length)) return null;
    for (const c of plan.right ?? []) if (!placeCrystal(s, c, "right", s.right.length)) return null;
  }
  return pull(s);
}

/**
 * Joue une partie entière avec le robot : à chaque tour le robot compose et tire, `endTurn` enregistre, `newRound` tire. S'arrête si le robot ne trouve aucun plan (le reste est perdu).
 * Renvoie le nombre de tours joués.
 */
export function playRobot(s: SmokeState, rng: MsvcRandom, bugMissingB = false): number {
  let turns = 0;
  while (!isFinished(s)) {
    if (s.awaitingRound && !newRound(s, rng, bugMissingB)) break;
    const plan = s.second ? { left: s.left, right: s.right } : robotPlan(s);
    if (!plan || !robotApply(s, plan)) break;
    if (!endTurn(s, rng)) break;
    turns++;
  }
  return turns;
}
