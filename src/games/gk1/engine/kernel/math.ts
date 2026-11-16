/**
 * Noyau, groupe « calcul » : `Random`, `Abs`, `Sqrt`, `GetAngle`, `GetDistance`, `ATan`, `SinMult`, `CosMult`, `SinDiv`, `CosDiv`.
 *
 * Référence : `engines/sci/engine/kmath.cpp` (`kRandom`, `kAbs`, `kSqrt`, `kGetAngle_SCI1` et son arc tangente entière,
 * `kGetDistance`, `kTimesSin`, `kTimesCos`, `kSinDiv`, `kCosDiv`) de ScummVM, GPL v3 ou ultérieure, lu puis réécrit. Dans la
 * table du noyau de ScummVM, `SinMult` et `CosMult` sont `kTimesSin` et `kTimesCos`, et `ATan` n'a pas d'implémentation.
 *
 * Écarts volontaires : `Random` tire dans le générateur commun du dépôt (`src/engine/rng.ts`), dont la graine est injectable,
 * et non dans celui de l'interpréteur d'origine (non étudié) ; fixer ou lire la graine depuis un script est sans effet ;
 * `SinDiv` et `CosDiv` rendent −1 pour un diviseur nul au lieu d'arrêter le jeu ; `ATan` rend l'accumulateur, avec un avertissement.
 */
import { fromInt, type Reg, SIGNAL_REG, toSint16 } from "../memory";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;
const DEGREES_TO_RADIANS = Math.PI / 180;
/** Sinus ou cosinus en deçà duquel `SinDiv` / `CosDiv` refusent de diviser. */
const DIVISOR_EPSILON = 0.0001;

/** Tangente en virgule fixe (× 10 000) à partir de laquelle l'arc tangente est interpolé dans la table. */
const TAN_SCALE = 10000;
const TAN_TABLE_THRESHOLD = 1000;
/** 10 000 × tan(5°, 10°, … 45°). */
const TAN_TABLE = [875, 1763, 2679, 3640, 4663, 5774, 7002, 8391, 10000];
const TAN_TABLE_STEP_DEGREES = 5;
/** Pente de l'arc tangente à l'origine, en degrés (180 / π, arrondi comme l'original). */
const ATAN_SLOPE_DEGREES = 57;

function random(vm: Vm, argv: Uint32Array): Reg {
  if (argv.length !== 2) {
    vm.warn("Random : lecture ou écriture de la graine ignorée");
    return 0;
  }
  // Bornes non signées ; un intervalle renversé rend sa borne haute.
  const from = argv[0] & WORD_MASK;
  const to = argv[1] & WORD_MASK;
  if (from > to) return to;
  return (from + vm.rng.inclusive(to - from)) & WORD_MASK;
}

/** Arc tangente du premier octant (x ≥ y ≥ 0), en degrés de 0 à 45. */
function atanFirstOctant(y: number, x: number): number {
  if (x === 0) return 0;
  const tan = Math.trunc((TAN_SCALE * y) / x);
  if (tan < TAN_TABLE_THRESHOLD) return Math.trunc((ATAN_SLOPE_DEGREES * y + Math.trunc(x / 2)) / x);
  let i = 1;
  while (tan > TAN_TABLE[i]) i++;
  const span = TAN_TABLE[i] - TAN_TABLE[i - 1];
  return TAN_TABLE_STEP_DEGREES * i + Math.trunc((TAN_TABLE_STEP_DEGREES * (tan - TAN_TABLE[i - 1]) + Math.trunc(span / 2)) / span);
}

/** Arc tangente entière sur le cercle : degrés de 0 à 359. */
function atan2Degrees(y: number, x: number): number {
  if (y < 0) {
    const angle = atan2Degrees(-y, -x);
    return angle === 180 ? 0 : 180 + angle;
  }
  if (x < 0) return 90 + atan2Degrees(-x, y);
  return y > x ? 90 - atanFirstOctant(x, y) : atanFirstOctant(y, x);
}

/** Cap, en degrés, de (x1, y1) vers (x2, y2) : 0 vers le haut de l'écran, 90 vers la droite. */
export function angleBetween(x1: number, y1: number, x2: number, y2: number): number {
  return atan2Degrees(x2 - x1, y1 - y2);
}

function getDistance(_vm: Vm, argv: Uint32Array): Reg {
  const arg = (i: number): number => (argv.length > i ? toSint16(argv[i]) : 0);
  // Le sixième argument est l'angle de la perspective ; son cosinus vaut 1 quand il est absent.
  const dx = Math.trunc((arg(1) - arg(3)) / Math.cos(arg(5) * DEGREES_TO_RADIANS));
  const dy = arg(0) - arg(2);
  return fromInt(Math.trunc(Math.sqrt(dx * dx + dy * dy)));
}

function divideBy(trig: (radians: number) => number): (vm: Vm, argv: Uint32Array) => Reg {
  return (vm, argv) => {
    const divisor = trig(toSint16(argv[0]) * DEGREES_TO_RADIANS);
    if (Math.abs(divisor) < DIVISOR_EPSILON) {
      vm.warn("SinDiv / CosDiv : division par zéro");
      return SIGNAL_REG;
    }
    return fromInt(Math.trunc(toSint16(argv[1]) / divisor));
  };
}

export function registerMathKernel(kernel: Kernel): void {
  kernel
    .register("Random", random)
    .register("Abs", (_vm, argv) => fromInt(Math.abs(toSint16(argv[0]))))
    .register("Sqrt", (_vm, argv) => fromInt(Math.trunc(Math.sqrt(Math.abs(toSint16(argv[0]))))))
    .register("GetAngle", (_vm, argv) => fromInt(angleBetween(toSint16(argv[0]), toSint16(argv[1]), toSint16(argv[2]), toSint16(argv[3]))))
    .register("GetDistance", getDistance)
    .register("ATan", (vm) => {
      vm.warn("ATan : sans implémentation connue");
      return vm.acc;
    })
    .register("SinMult", (_vm, argv) => fromInt(Math.trunc(toSint16(argv[1]) * Math.sin(toSint16(argv[0]) * DEGREES_TO_RADIANS))))
    .register("CosMult", (_vm, argv) => fromInt(Math.trunc(toSint16(argv[1]) * Math.cos(toSint16(argv[0]) * DEGREES_TO_RADIANS))))
    .register("SinDiv", divideBy(Math.sin))
    .register("CosDiv", divideBy(Math.cos));
}
