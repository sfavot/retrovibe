/**
 * Estimation (opération ≈, screens/bowling.md §1.8) : précalcul de `1010:306c`, décodage d'un problème (`1010:1486` cas 5),
 * réponse et ordre de grandeur (`1010:2150` cas 5), texte de la question (`1010:37b0`).
 *
 * Fidélité arithmétique (relue dans `disasm.txt`, `1010:306c`) : les bornes `U × multiplicateur` sont calculées sur **32 bits non
 * signés avec retenue perdue** (`IMUL EDX,EAX`), les indices `lo`/`hi` sont stockés en octets et l'effectif est l'octet
 * `hi − lo + 1` signé. La borne haute de la bande 4 déborde pour les mois et les années : le total des durées de la bande 4 est 63
 * (et non 65 avec des entiers sans limite), donc `problemMax(3) = 190` (et non 191, valeur de repli du segment).
 */
import { type BowlingData, type EstimationCategory, DURATION, ESTIMATION_CATEGORIES, LENGTH, TARGET_COLUMNS, WEIGHT } from "./data";
import { BAND_HIGH, BAND_LOW, LEVEL_COUNT, ORDER_MULTIPLIERS } from "./tables";

const WRAP_32 = 2 ** 32;
/** Une catégorie ne fournit jamais plus de 64 problèmes à une bande (`min(T, 64)`). */
const QUOTA = 64;

/** Enregistrement de cible trié : objet 1-based, colonne (long/tall/wide, n° de phrase 1 à 5, 0 pour les poids) et valeur. */
export interface TargetRecord {
  object: number;
  column: number;
  value: number;
}

/** Mots intercalés dans la question (`1108:0aeb…0b26`), indexés par `2 + colonne` pour les durées et `colonne` pour les longueurs. */
export const ESTIMATION_WORDS: readonly string[] = ["long", "tall", "wide", "does it take", "pass before", "are you", "pass while", "pass"];
/** Gabarits de la question (`1108:038c`, `03b0`, `03d1`, sans le préfixe `%l0%l0` de sélection des listes) selon la catégorie. */
export const ESTIMATION_FORMATS: readonly string[] = [
  "About how many %unit %word is %subject?",
  "About how many %unit %word %subject?",
  "About how many %unit does %subject weigh?",
];

/** Opérandes d'un problème d'estimation : `e[0]` unité, `e[1]` indice de la cible triée, `e[2]` catégorie, `e[3]` ordre de grandeur (calculé avec la réponse). */
export type EstimationOperands = [unit: number, target: number, category: number, magnitude: number];

export interface EstimationPrompt {
  category: number;
  unit: string;
  /** Mot intercalé (`long`, `does it take`…) ; `null` pour les poids. */
  word: string | null;
  subject: string;
}

function signedByte(value: number): number {
  const byte = value & 0xff;
  return byte >= 0x80 ? byte - 0x100 : byte;
}

export class EstimationTables {
  /** `records[k]` : cibles de la catégorie `k` triées par valeur croissante (égalités par n° d'objet : l'ordre du `qsort` d'origine est inconnu et sans effet sur les réponses). */
  readonly records: TargetRecord[][];
  /** `low[k][q][j]` : nombre de cibles inférieures à `U × BAND_LOW[j]` ; `count[k][q][j]` : effectif de l'unité `q` dans la bande `j`. */
  readonly low: number[][][];
  readonly high: number[][][];
  readonly count: number[][][];
  /** `totals[j][k]` : effectif de la catégorie `k` dans la bande `j`. */
  readonly totals: number[][];

  private constructor(readonly categories: EstimationCategory[]) {
    this.records = categories.map((category, k) => EstimationTables.sortedRecords(category, k));
    this.low = [];
    this.high = [];
    this.count = [];
    this.totals = Array.from({ length: LEVEL_COUNT }, () => new Array<number>(ESTIMATION_CATEGORIES).fill(0));
    for (let k = 0; k < ESTIMATION_CATEGORIES; k++) this.precompute(k);
  }

  static build(data: BowlingData | readonly EstimationCategory[]): EstimationTables {
    const categories = "categories" in data ? data.categories : data;
    if (categories.length !== ESTIMATION_CATEGORIES) throw new RangeError(`estimation : ${categories.length} catégories au lieu de ${ESTIMATION_CATEGORIES}`);
    return new EstimationTables([...categories]);
  }

  private static sortedRecords(category: EstimationCategory, k: number): TargetRecord[] {
    const records: TargetRecord[] = [];
    const columns = TARGET_COLUMNS[k]!;
    category.objects.forEach((_, i) => {
      if (k === LENGTH) {
        for (let column = 0; column < columns; column++) {
          const value = category.targets[i * columns + column]!;
          if (value !== 0) records.push({ object: i + 1, column, value });
        }
      } else if (k === DURATION) {
        records.push({ object: i + 1, column: category.targets[i * columns + 1]!, value: category.targets[i * columns]! });
      } else {
        records.push({ object: i + 1, column: 0, value: category.targets[i]! });
      }
    });
    return records.sort((a, b) => a.value - b.value || a.object - b.object || a.column - b.column);
  }

  /** Effectif forcé à 0 : longueurs et poids n'utilisent que les unités « petites » aux bandes 1 à 3 et « grandes » aux bandes 3 et 4. */
  private static unusedBand(k: number, unit: number, band: number): boolean {
    if (k === LENGTH) return (unit < 9 && band === 3) || (unit > 8 && band < 2);
    if (k === WEIGHT) return (unit < 6 && band === 3) || (unit > 5 && band < 2);
    return false;
  }

  private precompute(k: number): void {
    const records = this.records[k]!;
    const sizes = this.categories[k]!.unitSizes;
    const low: number[][] = [];
    const high: number[][] = [];
    const count: number[][] = [];
    sizes.forEach((size, unit) => {
      const lowRow: number[] = [];
      const highRow: number[] = [];
      const countRow: number[] = [];
      for (let band = 0; band < LEVEL_COUNT; band++) {
        const lowBound = (size * BAND_LOW[band]!) % WRAP_32;
        const highBound = (size * BAND_HIGH[band]! + (size >>> 1)) % WRAP_32;
        let i = 0;
        while (i < records.length && records[i]!.value < lowBound) i++;
        const lo = i;
        if (i > 0) i--;
        while (i < records.length && records[i]!.value < highBound) i++;
        const hi = i - 1;
        const effective = EstimationTables.unusedBand(k, unit, band) ? 0 : signedByte(hi - lo + 1);
        lowRow.push(lo);
        highRow.push(hi);
        countRow.push(effective);
        this.totals[band]![k]! += effective;
      }
      low.push(lowRow);
      high.push(highRow);
      count.push(countRow);
    });
    this.low.push(low);
    this.high.push(high);
    this.count.push(count);
  }

  /** Plus grand indice de problème de la bande `band` (0 à 3 = niveau 1 à 4) : `Σ_k min(T[band][k], 64) − 1`. */
  problemMax(band: number): number {
    this.checkBand(band);
    return this.totals[band]!.reduce((sum, total) => sum + Math.min(total, QUOTA), 0) - 1;
  }

  private checkBand(band: number): void {
    if (!Number.isInteger(band) || band < 0 || band >= LEVEL_COUNT) throw new RangeError(`bande d'estimation ${band} hors de 0 à ${LEVEL_COUNT - 1}`);
  }

  /** `1010:1486` cas 5 : unité, cible, catégorie du problème `index` de la bande `band`. */
  operands(band: number, index: number): EstimationOperands {
    this.checkBand(band);
    if (!Number.isInteger(index) || index < 0 || index > this.problemMax(band)) throw new RangeError(`problème d'estimation ${index} hors de 0 à ${this.problemMax(band)}`);
    const totals = this.totals[band]!;
    let category = -1;
    let before = 0;
    let cumulated = 0;
    do {
      category++;
      before = cumulated;
      cumulated += Math.min(totals[category]!, QUOTA);
    } while (cumulated <= index);
    // Quota plafonné : on étale les 64 places sur tout l'effectif de la catégorie.
    const local = cumulated - before === QUOTA ? ((index - before) * totals[category]!) >> 6 : index - before;
    const counts = this.count[category]!;
    let unit = 0;
    let loc = 0;
    while (unit < counts.length && loc < local + 1) loc += counts[unit++]![band]!;
    const found = unit - 1;
    const target = counts[found]![band]! + local + 1 - loc + this.low[category]![found]![band]! - 1;
    return [found, target, category, 0];
  }

  /** Bonne réponse `(valeur + U/2) div U` (16 bits) ; renseigne `operands[3]` (⌊log_M réponse⌋ plafonné à 3, −1 pour 0). */
  answer(operands: EstimationOperands): number {
    const [unit, target, category] = operands;
    const size = this.categories[category]!.unitSizes[unit]!;
    const value = this.records[category]![target]!.value;
    const answer = Math.floor((value + (size >>> 1)) / size) & 0xffff;
    const factor = ORDER_MULTIPLIERS[category]!;
    let magnitude = -1;
    for (let power = 1; magnitude < 3 && power <= answer; power *= factor) magnitude++;
    operands[3] = magnitude;
    return answer;
  }

  /** Éléments de la question (`1010:37b0`) : unité, mot intercalé, objet. */
  prompt(operands: readonly number[]): EstimationPrompt {
    const [unit, target, category] = operands as EstimationOperands;
    const record = this.records[category]![target]!;
    const word = category === LENGTH ? ESTIMATION_WORDS[record.column]! : category === DURATION ? ESTIMATION_WORDS[2 + record.column]! : null;
    return {
      category,
      unit: this.categories[category]!.units[unit]!,
      word,
      subject: this.categories[category]!.objects[record.object - 1]!,
    };
  }
}

/** Texte de la question d'estimation, d'après les gabarits de l'exécutable (`ESTIMATION_FORMATS`). */
export function formatEstimationPrompt(prompt: EstimationPrompt): string {
  return ESTIMATION_FORMATS[prompt.category]!.replace("%unit", prompt.unit)
    .replace("%word", prompt.word ?? "")
    .replace("%subject", prompt.subject);
}
