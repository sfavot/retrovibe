/**
 * Un problème du Bowling en entier (`1010:108d` + `1010:2150`, screens/bowling.md §1.6 à §1.8) : énoncé, bonne réponse, 3 distracteurs,
 * place de la bonne réponse. Pas de rendu : l'énoncé et les cases sont des descriptions que la scène dessine.
 */
import { MsvcRandom } from "../../engine/rng";
import { contiguousMask, popcount, rotateMask12, scatteredMask, simplifyFraction } from "./equivalence";
import { type EstimationPrompt, type EstimationTables, formatEstimationPrompt } from "./estimation";
import { buildOperands, equivalenceCells, type OperandWords, type Operands } from "./operands";
import {
  ADD,
  CHOICE_COUNT,
  DIVIDE,
  EQUIVALENCE,
  ESTIMATION,
  IMAGE_BANDS,
  MAX_DISPLAYED_ANSWER,
  MULTIPLY,
  ORDER_MULTIPLIERS,
  PROBLEM_MAX,
  SUBTRACT,
} from "./tables";

export { buildOperands, equivalenceCells } from "./operands";
export type { Operands, OperandWords } from "./operands";

/** Une case de réponse (ou l'énoncé graphique de l'équivalence), à dessiner. */
export type Choice =
  | { kind: "number"; value: number }
  /** Image de pizza `index` (0 à 35) : forme `index + 1` de `SHPL 1800`. */
  | { kind: "image"; index: number }
  /** Masque de `cells` (8, 12 ou 24) cellules ; le bit `i` colorie la cellule `i`. */
  | { kind: "mask"; cells: 8 | 12 | 24; bits: number }
  /** Fraction `numerator/denominator` ; `text` est le rendu de `1010:12ad` (`k`, `k/8`, `k/12`, `k/24`, simplifié pour les sous-types 9, 11, 12). */
  | { kind: "fraction"; numerator: number; denominator: 8 | 12 | 24; simplified: boolean; text: string };

export type ArithmeticOperator = "+" | "-" | "x" | "÷";

export type Prompt =
  /** `%d + %d =`, `%d + %d + %d =`, `%d - %d =`, `%d x %d =`, `%d x %d x %d =`, `%d ÷ %d =` (le jeu dessine le signe ÷ avec l'octet 0xD6 de sa fonte). */
  | { kind: "arithmetic"; operator: ArithmeticOperator; operands: number[]; text: string }
  | { kind: "estimation"; parts: EstimationPrompt; text: string }
  /** Énoncé graphique de l'équivalence : une image ou un masque. */
  | { kind: "picture"; picture: Extract<Choice, { kind: "image" | "mask" }> };

export interface BowlingQuestion {
  operation: number;
  subType: number;
  index: number;
  prompt: Prompt;
  /** Les 4 cases, de gauche à droite. */
  choices: Choice[];
  /** Mots bruts `4c9a[0..3]` des cases (nombre, indice d'image, masque ou numérateur selon le sous-type). */
  values: number[];
  /** Case (0 à 3) de la bonne réponse. */
  correctSlot: number;
  /** Mot brut de la bonne réponse. */
  answer: number;
  /** `e` après `2150` (÷ : dividende, diviseur ; ≈ : avec l'ordre de grandeur). */
  operands: OperandWords;
  /** Rempli par `QuestionPicker` : problème repris après une erreur. */
  retry: boolean;
}

export interface BuildQuestionOptions {
  /** Case cliquée à tort lors de la première pose : la bonne réponse n'y revient pas (`4c96 = (case + 1 + rand1(3)) & 3`). */
  avoidSlot?: number | null;
  /** Tables d'estimation (obligatoires pour l'opération ≈). */
  estimation?: EstimationTables;
}

const s16 = (value: number): number => (value << 16) >> 16;
/** Division entière tronquée vers 0, comme `IDIV`. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** Repli : on n'a jamais observé de boucle, mais une boucle de rejet infinie ferait geler le jeu. */
const MAX_REROLLS = 5000;

/** `perturbation` des distracteurs numériques : de `v/2` à `3v/2`, ou 1 à 4 si `v ≤ 3`. */
function perturb(value: number, rng: MsvcRandom): number {
  return value <= 3 ? rng.rand1(4) + 1 : rng.rand(value) + idiv(value, 2);
}

function imageBand(image: number): [number, number] {
  let j = 0;
  while (IMAGE_BANDS[j]! <= image) j++;
  return [IMAGE_BANDS[j - 1]!, IMAGE_BANDS[j]!];
}

/** `1010:2150` pour la case `i` : calcule `values[i]` (et, pour `i = 0`, complète `e`). */
function computeValue(i: number, operation: number, subType: number, e: OperandWords, values: number[], rng: MsvcRandom, estimation?: EstimationTables): void {
  const la: OperandWords = [...e];
  let done = false;
  if (i !== 0) {
    switch (operation) {
      case ADD: {
        let idx = la[1] < la[0] ? 1 : 0;
        if (subType > 5 && subType < 8 && la[2] < la[idx]!) idx = 2;
        la[idx] = perturb(e[idx]!, rng);
        break;
      }
      case SUBTRACT:
        if (la[0] < 4 || la[0] < idiv(la[1] * 3, 2)) {
          values[i] = perturb(values[0]!, rng);
          done = true;
        } else la[1] = perturb(e[1], rng);
        break;
      case MULTIPLY: {
        const idx = subType > 8 ? 2 : 1;
        if (la[0] === 0) la[0] = 1;
        la[idx] = perturb(e[idx]!, rng);
        break;
      }
      case DIVIDE:
        values[i] = perturb(values[0]!, rng);
        done = true;
        break;
      case EQUIVALENCE:
        done = equivalenceDistractorTop(i, subType, e, la, values, rng);
        break;
      default: {
        // ≈ : erreur d'ordre de grandeur sur la bonne réponse.
        values[i] = values[0]!;
        const target = (e[3] + i) & 3;
        const factor = ORDER_MULTIPLIERS[e[2]]!;
        for (let m = e[3]; m < target; m++) values[i] = s16(values[i]! * factor);
        for (let m = target; m < e[3]; m++) values[i] = idiv(s16(values[i]!), factor);
        done = true;
      }
    }
  }
  if (done) return;
  switch (operation) {
    case ADD:
      values[i] = s16(la[0] + la[1] + la[2]);
      break;
    case SUBTRACT:
      values[i] = s16(la[0] - la[1]);
      break;
    case MULTIPLY:
      values[i] = s16(la[0] * la[1] * la[2]);
      break;
    case DIVIDE:
      // i = 0 seulement : le quotient devient la réponse, e = (dividende, diviseur).
      values[0] = e[1];
      e[1] = e[0];
      e[0] = s16(e[0] * values[0]!);
      break;
    case EQUIVALENCE:
      equivalenceBottom(i, subType, e, la, values, rng);
      break;
    default:
      values[0] = estimation!.answer(e);
  }
}

/** Distracteurs de l'équivalence, première partie de `2150` (case 4). Renvoie vrai si la valeur est entièrement fixée. */
function equivalenceDistractorTop(i: number, subType: number, e: OperandWords, la: OperandWords, values: number[], rng: MsvcRandom): boolean {
  switch (subType) {
    case 0:
    case 1: {
      const [lo, hi] = imageBand(values[0]!);
      do values[i] = rng.rand(PROBLEM_MAX[EQUIVALENCE]![subType]!);
      while (values[i]! >= lo && values[i]! < hi);
      return true;
    }
    case 2:
      do {
        la[0] = rng.rand1(26);
        if (la[0] < 24) {
          la[1] = Math.trunc(la[0] / 8) * 2 + 2;
          la[2] = la[0] % 8;
        } else la[1] = la[0] * 8 - 192;
      } while (e[1] === la[1]);
      return false;
    case 3:
    case 6:
    case 7:
      return false;
    case 4:
    case 5:
      do values[i] = rng.rand(8);
      while (values[i] === e[1]);
      return true;
    default: {
      const range = subType < 10 ? 12 : 24;
      do values[i] = rng.rand1(range) + 1;
      while (values[i] === e[1]);
      return true;
    }
  }
}

/** Seconde partie de `2150` pour l'équivalence : réponse correcte (`i = 0`) ou masque / image / fraction du distracteur. */
function equivalenceBottom(i: number, subType: number, e: OperandWords, la: OperandWords, values: number[], rng: MsvcRandom): void {
  switch (subType) {
    case 0:
      values[i] = e[0];
      return;
    case 1: {
      const [lo, hi] = imageBand(e[0]);
      for (let attempt = 0; ; attempt++) {
        values[i] = rng.rand1(hi - lo) + lo;
        if (e[0] !== values[i] || e[0] === 0) return;
        if (attempt > MAX_REROLLS) throw new Error("équivalence : image introuvable");
      }
    }
    case 2:
      if (i === 0) {
        do la[2] = rng.rand1(8);
        while (e[2] === la[2]);
      }
      values[i] = contiguousMask(8, la[1], la[2]);
      return;
    case 3:
      la[0] = e[1];
      la[1] = la[0];
      if (i !== 0) {
        do la[1] = popcount(8, rng.rand1(256));
        while (la[1] === la[0]);
      }
      la[2] = rng.rand1(8);
      values[i] = e[2] === 0 ? contiguousMask(8, la[1], la[2]) : scatteredMask(8, la[1], la[2], subType);
      return;
    case 6:
    case 7:
      if (subType !== 6 || i !== 0) {
        la[0] = e[1];
        la[1] = la[0];
        if (i !== 0) {
          do la[1] = popcount(12, rng.rand1(144));
          while (la[1] === la[0]);
        }
        la[2] = rng.rand1(12);
        values[i] = scatteredMask(12, la[1], la[2], subType);
      } else {
        // Sous-type 6, bonne réponse : la question tournée de 4 ou 8 cellules.
        values[0] = rotateMask12(e[0], (rng.rand1(2) + 1) * 4);
      }
      return;
    default:
      // Fractions : le numérateur.
      values[i] = e[1];
  }
}

function fractionChoice(numerator: number, denominator: 8 | 12 | 24, simplified: boolean): Choice {
  const shown = simplified ? simplifyFraction(numerator, denominator) : { numerator, denominator };
  const whole = simplified && (shown.numerator === 0 || shown.numerator === shown.denominator);
  return { kind: "fraction", numerator, denominator, simplified, text: whole ? `${shown.numerator}` : `${shown.numerator}/${shown.denominator}` };
}

/** Mot brut d'une case → description à dessiner (`1010:12ad`, `1010:2bb0`). */
function choiceOf(operation: number, subType: number, value: number): Choice {
  if (operation !== EQUIVALENCE) return { kind: "number", value };
  switch (subType) {
    case 0:
    case 1:
      return { kind: "image", index: value };
    case 2:
    case 3:
      return { kind: "mask", cells: 8, bits: value };
    case 6:
    case 7:
      return { kind: "mask", cells: 12, bits: value };
    case 4:
    case 5:
      return fractionChoice(value, 8, false);
    case 8:
    case 9:
      return fractionChoice(value, 12, subType === 9);
    default:
      return fractionChoice(value, 24, subType !== 10);
  }
}

const OPERATOR_FORMATS: Record<number, ArithmeticOperator> = { [ADD]: "+", [SUBTRACT]: "-", [MULTIPLY]: "x", [DIVIDE]: "÷" };

function promptOf(operation: number, subType: number, e: OperandWords, operands: Operands, estimation?: EstimationTables): Prompt {
  if (operation === EQUIVALENCE) {
    const cells = equivalenceCells(subType);
    if (cells === 0) return { kind: "picture", picture: { kind: "image", index: e[0] } };
    return { kind: "picture", picture: { kind: "mask", cells, bits: cells === 24 ? operands.mask24 : e[0] } };
  }
  if (operation === ESTIMATION) {
    const parts = estimation!.prompt(e);
    return { kind: "estimation", parts, text: formatEstimationPrompt(parts) };
  }
  const operator = OPERATOR_FORMATS[operation]!;
  const count = (operation === ADD && (subType === 6 || subType === 7)) || (operation === MULTIPLY && subType === 9) ? 3 : 2;
  const numbers = e.slice(0, count);
  return { kind: "arithmetic", operator, operands: numbers, text: `${numbers.join(` ${operator} `)} =` };
}

/**
 * Construit le problème `index` du sous-type `subType` de l'opération `operation` (`1010:108d`) : opérandes, bonne réponse, 3 distracteurs
 * tous différents et ≤ 19 999, puis place de la bonne réponse (au hasard, ou différente de `options.avoidSlot` pour une reprise).
 * Le hasard est consommé dans l'ordre de l'original : distracteurs 1 à 3, puis la case.
 */
export function buildQuestion(operation: number, subType: number, index: number, rng: MsvcRandom, options: BuildQuestionOptions = {}): BowlingQuestion {
  const operands = buildOperands(operation, subType, index, options.estimation);
  const e: OperandWords = [...operands.e];
  const values = new Array<number>(CHOICE_COUNT).fill(0);
  computeValue(0, operation, subType, e, values, rng, options.estimation);
  for (let i = 1; i < CHOICE_COUNT; i++) {
    for (let attempt = 0; ; attempt++) {
      computeValue(i, operation, subType, e, values, rng, options.estimation);
      const duplicate = values.slice(0, i).includes(values[i]!);
      if (!duplicate && values[i]! <= MAX_DISPLAYED_ANSWER) break;
      if (attempt > MAX_REROLLS) throw new Error(`problème sans distracteur valide (${operation}, ${subType}, ${index})`);
    }
  }
  const avoid = options.avoidSlot;
  const correctSlot = avoid === undefined || avoid === null ? rng.rand1(CHOICE_COUNT) : (avoid + 1 + rng.rand1(3)) & 3;
  const answer = values[0]!;
  [values[0], values[correctSlot]] = [values[correctSlot]!, values[0]!];
  return {
    operation,
    subType,
    index,
    prompt: promptOf(operation, subType, e, operands, options.estimation),
    choices: values.map((value) => choiceOf(operation, subType, value)),
    values,
    correctSlot,
    answer,
    operands: e,
    retry: false,
  };
}
