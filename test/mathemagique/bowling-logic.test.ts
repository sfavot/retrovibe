import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../src/games/mathemagique/data/mohawk";
import { MsvcRandom } from "../../src/games/mathemagique/engine/rng";
import { DEFAULT_BOWLING_TICKS, Roster } from "../../src/games/mathemagique/engine/roster";
import {
  BowlingProgress,
  EstimationTables,
  GameTimer,
  PROBLEM_MAX,
  QuestionPicker,
  STRIKE_THRESHOLDS,
  SUBTYPE_COUNTS,
  backgroundMusicId,
  buildOperands,
  buildQuestion,
  contiguousMask,
  formatEstimationPrompt,
  loadBowlingData,
  pinAnimationId,
  popcount,
  rotateMask12,
  scatteredMask,
  simplifyFraction,
  type BowlingQuestion,
} from "../../src/games/mathemagique/game/bowling";
import { hasOriginalFiles, readOriginal } from "./helpers";

const ADD = 0;
const SUBTRACT = 1;
const MULTIPLY = 2;
const DIVIDE = 3;
const EQUIVALENCE = 4;
const ESTIMATION = 5;

/** Plages de bits identiques d'un masque de 8 cellules (le rejet de `1010:2f34` en exige plus de 3). */
function runs8(mask: number): number {
  let count = 1;
  for (let bit = 1; bit < 8; bit++) if (((mask >>> bit) & 1) !== ((mask >>> (bit - 1)) & 1)) count++;
  return count;
}

// --- Générateur aléatoire (bowling.md §8.4 n° 1) ---------------------------------------------------------------------------------

describe("hasard du Bowling", () => {
  it("reproduit les suites de l'exécutable", () => {
    const a = new MsvcRandom(1);
    expect(Array.from({ length: 5 }, () => a.rand(9))).toEqual([1, 5, 4, 8, 7]);
    const b = new MsvcRandom(0);
    expect(Array.from({ length: 5 }, () => b.rand1(4))).toEqual([2, 3, 2, 1, 3]);
  });

  it("rand(0) renvoie 0 sans avancer l'état", () => {
    const rng = new MsvcRandom(1);
    const before = rng.current;
    expect(rng.rand(0)).toBe(0);
    expect(rng.current).toBe(before);
  });
});

// --- Tables (§8.4 n° 4) ----------------------------------------------------------------------------------------------------------

describe("tables du Bowling", () => {
  it("compte les sous-types, les problèmes et les seuils de chaque opération", () => {
    expect(SUBTYPE_COUNTS).toEqual([9, 11, 10, 8, 13, 4]);
    expect(PROBLEM_MAX[ADD]).toEqual([40, 54, 59, 59, 49, 49, 63, 63, 255]);
    expect(PROBLEM_MAX[SUBTRACT]).toEqual([35, 17, 34, 41, 59, 59, 59, 65, 71, 63, 255]);
    expect(PROBLEM_MAX[MULTIPLY]).toEqual([32, 21, 65, 25, 90, 47, 71, 143, 255, 215]);
    expect(PROBLEM_MAX[DIVIDE]).toEqual([47, 48, 107, 56, 44, 82, 255, 255]);
    expect(PROBLEM_MAX[EQUIVALENCE]).toEqual([35, 35, 25, 97, 57, 255, 143, 143, 143, 143, 107, 107, 107]);
    STRIKE_THRESHOLDS.forEach((thresholds, op) => {
      // Cinq groupes (4 niveaux + bonus), chacun clos par 10, strictement croissants dans le groupe ; un seuil par sous-type + celui du bonus.
      expect(thresholds.filter((t) => t === 10)).toHaveLength(5);
      expect(thresholds).toHaveLength(SUBTYPE_COUNTS[op]! + 1);
      expect(PROBLEM_MAX[op]).toHaveLength(SUBTYPE_COUNTS[op]!);
    });
  });
});

// --- Opérandes (§8.4 n° 2) -------------------------------------------------------------------------------------------------------

describe("opérandes sans aléa", () => {
  const e = (op: number, sub: number, n: number) => buildOperands(op, sub, n).e;

  it("addition", () => {
    expect(e(ADD, 0, 39).slice(0, 2)).toEqual([9, 9]);
    expect(e(ADD, 6, 63).slice(0, 3)).toEqual([4, 8, 9]);
    expect(e(ADD, 8, 5).slice(0, 2)).toEqual([357, 505]);
    expect(e(ADD, 8, 255).slice(0, 2)).toEqual([348, 542]);
  });

  it("soustraction : a ≥ b", () => {
    expect(e(SUBTRACT, 4, 59).slice(0, 2)).toEqual([49, 6]);
    expect(e(SUBTRACT, 10, 0).slice(0, 2)).toEqual([500, 100]);
  });

  it("multiplication", () => {
    expect(e(MULTIPLY, 5, 47).slice(0, 3)).toEqual([10, 24, 1]);
    expect(e(MULTIPLY, 9, 215).slice(0, 3)).toEqual([7, 8, 9]);
  });

  it("équivalence : masques de 8 et 24 cellules", () => {
    expect(e(EQUIVALENCE, 2, 12).slice(0, 3)).toEqual([0xf0, 4, 4]);
    const big = buildOperands(EQUIVALENCE, 10, 35);
    expect(big.e.slice(0, 3)).toEqual([11, 10, 9]);
    expect(big.mask24).toBe(contiguousMask(24, 10, 9));
  });

  it("refuse un indice hors de l'espace du sous-type", () => {
    expect(() => buildOperands(ADD, 0, 41)).toThrow(RangeError);
    expect(() => buildOperands(ADD, 9, 0)).toThrow(RangeError);
    expect(() => buildOperands(6, 0, 0)).toThrow(RangeError);
    expect(() => buildOperands(ESTIMATION, 0, 0)).toThrow(/tables/);
  });
});

describe("division : (dividende, diviseur, réponse)", () => {
  function division(sub: number, n: number) {
    const q = buildQuestion(DIVIDE, sub, n, new MsvcRandom(1));
    if (q.prompt.kind !== "arithmetic") throw new Error("énoncé arithmétique attendu");
    return { operands: q.prompt.operands, answer: q.answer, operator: q.prompt.operator };
  }

  it("reproduit les vecteurs de l'étude", () => {
    expect(division(0, 10)).toEqual({ operands: [2, 1], answer: 2, operator: "÷" });
    expect(division(2, 0)).toEqual({ operands: [100, 1], answer: 100, operator: "÷" });
    expect(division(2, 107)).toEqual({ operands: [144, 12], answer: 12, operator: "÷" });
  });
});

// --- Masques et fractions (§8.4 n° 9) --------------------------------------------------------------------------------------------

describe("masques de cellules", () => {
  it("masque contigu tourné", () => {
    expect(contiguousMask(8, 2, 0)).toBe(0x03);
    expect(contiguousMask(8, 4, 4)).toBe(0xf0);
    expect(contiguousMask(8, 4, 6)).toBe(0xc3);
    expect(contiguousMask(8, 0, 3)).toBe(0);
    expect(contiguousMask(8, 8, 3)).toBe(0xff);
    expect(contiguousMask(12, 3, 10)).toBe(0xc01);
    expect(contiguousMask(24, 24, 0)).toBe(0xffffff);
  });

  it("popcount et rotation de 12 cellules", () => {
    expect(popcount(8, 0x1ff)).toBe(8);
    expect(popcount(12, 0xabc)).toBe(7);
    expect(rotateMask12(0x801, 4)).toBe(0x018);
    expect(rotateMask12(0x123, 12)).toBe(0x123);
  });

  it("masque éparpillé : déterministe, bon nombre de cellules, hors du hasard du jeu", () => {
    for (let seed = 0; seed < 8; seed++) {
      for (let k = 2; k <= 6; k++) {
        const first = scatteredMask(8, k, seed, 3);
        expect(scatteredMask(8, k, seed, 3)).toBe(first);
        expect(popcount(8, first)).toBe(k);
        // Sous-types 2 à 5 : au moins 4 plages de bits identiques.
        expect(runs8(first)).toBeGreaterThan(3);
      }
    }
    expect(scatteredMask(12, 5, 3, 7)).toBe(scatteredMask(12, 5, 3, 7));
    expect(popcount(12, scatteredMask(12, 5, 3, 7))).toBe(5);
    // k < 2 ou k ≥ n − 1 : masque contigu tourné de la graine.
    expect(scatteredMask(8, 1, 3, 3)).toBe(contiguousMask(8, 1, 3));
    expect(scatteredMask(8, 7, 2, 3)).toBe(contiguousMask(8, 7, 2));
    expect(scatteredMask(24, 10, 9, 12)).toBe(scatteredMask(24, 10, 9, 12));
  });

  it("n'avance pas le hasard du jeu", () => {
    const rng = new MsvcRandom(5);
    const before = rng.current;
    scatteredMask(12, 5, 3, 7);
    expect(rng.current).toBe(before);
  });

  it("simplifie par 2 et 3 seulement", () => {
    expect(simplifyFraction(6, 12)).toEqual({ numerator: 1, denominator: 2 });
    expect(simplifyFraction(4, 24)).toEqual({ numerator: 1, denominator: 6 });
    expect(simplifyFraction(10, 12)).toEqual({ numerator: 5, denominator: 6 });
    expect(simplifyFraction(5, 24)).toEqual({ numerator: 5, denominator: 24 });
    expect(simplifyFraction(12, 12)).toEqual({ numerator: 1, denominator: 1 });
    expect(simplifyFraction(0, 12)).toEqual({ numerator: 0, denominator: 12 });
  });
});

describe("équivalence : la bonne réponse", () => {
  it("sous-type 2 : même nombre de cellules, rotation différente (graine 1 : 0x1e)", () => {
    const q = buildQuestion(EQUIVALENCE, 2, 12, new MsvcRandom(1));
    expect(q.operands.slice(0, 3)).toEqual([0xf0, 4, 4]);
    expect(q.answer).toBe(0x1e);
    const choice = q.choices[q.correctSlot]!;
    expect(choice).toEqual({ kind: "mask", cells: 8, bits: 0x1e });
    expect(q.prompt).toEqual({ kind: "picture", picture: { kind: "mask", cells: 8, bits: 0xf0 } });
  });

  it("images : sous-type 0 (même image, distracteurs d'une autre bande) et 1 (même bande)", () => {
    const bands = [0, 1, 8, 22, 26, 30, 33, 36];
    const bandOf = (image: number) => bands.findIndex((low, i) => image >= low && image < bands[i + 1]!);
    for (let n = 0; n <= 35; n++) {
      for (let seed = 1; seed <= 6; seed++) {
        const same = buildQuestion(EQUIVALENCE, 0, n, new MsvcRandom(seed));
        expect(same.answer).toBe(n);
        same.values.forEach((value, slot) => {
          if (slot !== same.correctSlot) expect(bandOf(value)).not.toBe(bandOf(n));
        });
        const band = buildQuestion(EQUIVALENCE, 1, n, new MsvcRandom(seed));
        expect(bandOf(band.answer)).toBe(bandOf(n));
        if (n !== 0) expect(band.answer).not.toBe(n);
        band.values.forEach((value, slot) => {
          if (slot !== band.correctSlot) expect(bandOf(value)).not.toBe(bandOf(n));
        });
      }
    }
  });

  it("fractions : numérateurs, simplification des sous-types 9, 11 et 12", () => {
    const four = buildQuestion(EQUIVALENCE, 4, 0, new MsvcRandom(2));
    expect(four.choices[four.correctSlot]).toMatchObject({ kind: "fraction", numerator: 1, denominator: 8, simplified: false, text: "1/8" });
    // sous-type 9, N = 69 : 6/12 → « 1/2 » ; N = 11 : 1 cellule sur 12 ; k = 12 → « 1 ».
    const simplified = buildQuestion(EQUIVALENCE, 9, 5 * 12, new MsvcRandom(3));
    expect(simplified.choices[simplified.correctSlot]).toMatchObject({ numerator: 6, denominator: 12, simplified: true, text: "1/2" });
    const full = buildQuestion(EQUIVALENCE, 9, 11 * 12, new MsvcRandom(3));
    expect(full.choices[full.correctSlot]).toMatchObject({ numerator: 12, text: "1" });
    const plain = buildQuestion(EQUIVALENCE, 8, 5 * 12, new MsvcRandom(3));
    expect(plain.choices[plain.correctSlot]).toMatchObject({ numerator: 6, simplified: false, text: "6/12" });
  });
});

// --- Propriétés sur tout l'espace des problèmes (§8.4 n° 3) ------------------------------------------------------------------------

function checkQuestion(q: BowlingQuestion, context: string): void {
  expect(q.choices, context).toHaveLength(4);
  expect(q.values, context).toHaveLength(4);
  // Cases distinctes, bonne réponse exactement une fois dans la case annoncée.
  expect(new Set(q.values).size, context).toBe(4);
  expect(q.values[q.correctSlot], context).toBe(q.answer);
  expect(q.values.filter((value) => value === q.answer), context).toHaveLength(1);
  for (const value of q.values) expect(value, context).toBeLessThanOrEqual(19999);
  if (q.operation < 4) {
    for (const value of q.values) expect(value, context).toBeGreaterThanOrEqual(0);
  }
  if (q.prompt.kind === "arithmetic") {
    const [a, b, c] = q.prompt.operands as [number, number, number | undefined];
    const text = q.prompt.text;
    expect(text.endsWith(" ="), context).toBe(true);
    switch (q.operation) {
      case ADD:
        expect(q.answer, context).toBe(a + b + (c ?? 0));
        break;
      case SUBTRACT:
        expect(a, context).toBeGreaterThanOrEqual(b);
        expect(q.answer, context).toBe(a - b);
        break;
      case MULTIPLY:
        expect(q.answer, context).toBe(a * b * (c ?? 1));
        break;
      case DIVIDE:
        expect(a % b, context).toBe(0);
        expect(q.answer, context).toBe(a / b);
        break;
    }
  }
}

describe("tout l'espace des problèmes arithmétiques et d'équivalence", () => {
  for (const op of [ADD, SUBTRACT, MULTIPLY, DIVIDE, EQUIVALENCE]) {
    it(`opération ${op} : réponses distinctes, bonne réponse présente, ≤ 19 999, aucune boucle`, () => {
      for (let sub = 0; sub < SUBTYPE_COUNTS[op]!; sub++) {
        for (let n = 0; n <= PROBLEM_MAX[op]![sub]!; n++) {
          for (const seed of [n + 1, 77 * n + sub + 3, 123457 + op]) {
            const q = buildQuestion(op, sub, n, new MsvcRandom(seed), { avoidSlot: seed % 3 === 0 ? seed % 4 : null });
            checkQuestion(q, `op ${op} sub ${sub} n ${n} seed ${seed}`);
            if (seed % 3 === 0) expect(q.correctSlot, `op ${op} sub ${sub} n ${n}`).not.toBe(seed % 4);
          }
        }
      }
    });
  }

  it("addition à 3 opérandes, soustraction positive, ÷ exacte : énoncés bien formés", () => {
    const three = buildQuestion(ADD, 6, 63, new MsvcRandom(9));
    expect(three.prompt).toMatchObject({ kind: "arithmetic", operator: "+", operands: [4, 8, 9], text: "4 + 8 + 9 =" });
    expect(three.answer).toBe(21);
    const product = buildQuestion(MULTIPLY, 9, 215, new MsvcRandom(9));
    expect(product.prompt).toMatchObject({ operator: "x", operands: [7, 8, 9], text: "7 x 8 x 9 =" });
    expect(product.answer).toBe(504);
    const sub = buildQuestion(SUBTRACT, 10, 0, new MsvcRandom(9));
    expect(sub.prompt).toMatchObject({ operator: "-", operands: [500, 100], text: "500 - 100 =" });
    expect(sub.answer).toBe(400);
    const div = buildQuestion(DIVIDE, 2, 107, new MsvcRandom(9));
    expect(div.prompt).toMatchObject({ operator: "÷", text: "144 ÷ 12 =" });
  });

  it("place de la bonne réponse : hasard, ou jamais la case cliquée à tort", () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 60; seed++) seen.add(buildQuestion(ADD, 0, 7, new MsvcRandom(seed)).correctSlot);
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    for (let wrong = 0; wrong < 4; wrong++) {
      const slots = new Set<number>();
      for (let seed = 0; seed < 60; seed++) slots.add(buildQuestion(ADD, 0, 7, new MsvcRandom(seed), { avoidSlot: wrong }).correctSlot);
      expect(slots.has(wrong)).toBe(false);
      expect(slots.size).toBe(3);
    }
  });

  it("les distracteurs d'une addition restent dans [v/2, 3v/2] d'un opérande ou du résultat", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const q = buildQuestion(ADD, 3, 25, new MsvcRandom(seed));
      const [a, b] = q.prompt.kind === "arithmetic" ? q.prompt.operands : [0, 0];
      const biggest = Math.max(a!, b!);
      const smallest = Math.min(a!, b!);
      q.values.forEach((value, slot) => {
        if (slot === q.correctSlot) return;
        const low = smallest + Math.trunc(biggest / 2);
        const high = smallest + Math.trunc(biggest / 2) + biggest;
        expect(value).toBeGreaterThanOrEqual(low);
        expect(value).toBeLessThanOrEqual(high);
      });
    }
  });
});

// --- Progression (§8.4 n° 6) -----------------------------------------------------------------------------------------------------

describe("progression", () => {
  const rng = () => new MsvcRandom(4);

  /** Joueur 1 d'un roster neuf, avec `mask` et des variables posées, puis relu. */
  function loaded(setup: (roster: Roster) => void): BowlingProgress {
    const roster = Roster.createEmpty();
    expect(roster.addPlayer("Zoe")).toMatchObject({ ok: true, id: 1 });
    setup(roster);
    return BowlingProgress.load(roster, 1);
  }

  const allLevels = (op: number) => 0xf << (5 * op);

  it("rang : 1 + niveaux terminés, bonus ignorés", () => {
    const progress = BowlingProgress.empty();
    expect(progress.rank).toBe(1);
    progress.mask = 0x3fffffff;
    expect(progress.rank).toBe(25);
    progress.mask = (1 << 4) | (1 << 9) | (1 << 14);
    expect(progress.rank).toBe(1);
    progress.mask = 1 | (1 << 5);
    expect(progress.rank).toBe(3);
  });

  it("sous-type recalculé : + niveau 4 → 6, 7, 8 à 0, 3, 6 strikes ; recompute(+, niveau 4, 3 strikes) = 7", () => {
    const sub = (level: number, strikes: number) =>
      loaded((roster) => {
        roster.setVar(1, "bowlingLevel", level, ADD);
        roster.setVar(1, "bowlingStrikes", strikes, 5 * ADD + level);
      }).subType;
    expect([0, 1, 2].map((s) => sub(3, s))).toEqual([6, 6, 6]);
    expect([3, 4, 5].map((s) => sub(3, s))).toEqual([7, 7, 7]);
    expect([6, 7, 8, 9].map((s) => sub(3, s))).toEqual([8, 8, 8, 8]);
    expect(sub(0, 0)).toBe(0);
    expect(sub(0, 5)).toBe(1);
    expect(sub(1, 0)).toBe(2);
    expect(sub(2, 5)).toBe(5);
    expect(sub(4, 4)).toBe(9);
  });

  it("10 bonnes réponses = un strike ; le sous-type avance aux seuils", () => {
    const progress = BowlingProgress.empty();
    progress.selectOperation(ADD);
    progress.selectLevel(0);
    progress.startRound();
    for (let i = 1; i < 10; i++) expect(progress.correctAnswer()).toBe(false);
    expect(progress.correctAnswer()).toBe(true);
    const generator = rng();
    const results = [];
    for (let strike = 1; strike <= 5; strike++) results.push(progress.strike(generator));
    expect(results.map((r) => r.strikes)).toEqual([1, 2, 3, 4, 5]);
    expect(results.map((r) => r.subTypeAdvanced)).toEqual([false, false, false, false, true]);
    expect(progress.subType).toBe(1);
    expect(progress.currentStrikes).toBe(5);
    expect(progress.roundCorrect).toBe(0);
    for (const result of results) {
      expect(result.animation).toBeGreaterThanOrEqual(0);
      expect(result.animation).toBeLessThan(69);
    }
    // 3e strike : animation spéciale (49 à 68).
    expect(results[2]!.animation).toBeGreaterThanOrEqual(49);
    expect(results[0]!.animation).toBeLessThan(49);
  });

  it("10 strikes terminent le niveau : bit posé, compteur remis à 0, niveau suivant", () => {
    const progress = BowlingProgress.empty();
    progress.selectOperation(MULTIPLY);
    const generator = rng();
    let last = progress.strike(generator);
    for (let i = 1; i < 10; i++) last = progress.strike(generator);
    expect(last).toMatchObject({ strikes: 10, levelCompleted: true, completedLevel: 0, maskBit: 10, level: 1, gusCheer: null });
    expect(progress.isDone(MULTIPLY, 0)).toBe(true);
    expect(progress.mask).toBe(1 << 10);
    expect(progress.level).toBe(1);
    expect(progress.currentStrikes).toBe(0);
    expect(progress.strikesOf(MULTIPLY, 0)).toBe(0);
    expect(progress.subType).toBe(3);
    expect(progress.rank).toBe(2);
    // Les autres opérations ne bougent pas.
    expect(progress.levelOf(ADD)).toBe(0);
  });

  function finishLevel(progress: BowlingProgress, generator: MsvcRandom): void {
    for (let i = 0; i < 10; i++) progress.strike(generator);
  }

  it("fin du niveau 4 : retour au niveau 1 sans les 3 autres bits, bonus avec ; bonus fini : niveau 1", () => {
    const generator = rng();
    const partial = BowlingProgress.empty();
    partial.selectOperation(DIVIDE);
    partial.mask = 1 << (5 * DIVIDE + 1); // seul le niveau 2 est fait
    expect(partial.selectLevel(3)).toBe(true);
    finishLevel(partial, generator);
    expect(partial.level).toBe(0);
    expect(partial.isDone(DIVIDE, 3)).toBe(true);
    expect(partial.subType).toBe(0);

    const whole = BowlingProgress.empty();
    whole.selectOperation(ADD);
    whole.mask = 0b0111 << (5 * ADD);
    expect(whole.selectLevel(3)).toBe(true);
    expect(whole.subType).toBe(6);
    finishLevel(whole, generator);
    expect(whole.mask & 0x1f).toBe(0xf);
    expect(whole.level).toBe(4);
    expect(whole.bonusUnlocked(ADD)).toBe(true);
    expect(whole.subType).toBe(9);
    finishLevel(whole, generator);
    expect(whole.isDone(ADD, 4)).toBe(true);
    expect(whole.level).toBe(0);
    expect(whole.subType).toBe(0);
    // Le bonus ne compte pas dans le rang.
    expect(whole.rank).toBe(5);
  });

  it("le bonus n'est sélectionnable qu'après les 4 niveaux de l'opération", () => {
    const progress = BowlingProgress.empty();
    progress.selectOperation(SUBTRACT);
    expect(progress.selectLevel(4)).toBe(false);
    expect(progress.selectLevel(5)).toBe(false);
    progress.mask = allLevels(ADD);
    expect(progress.selectLevel(4)).toBe(false);
    progress.mask |= allLevels(SUBTRACT);
    expect(progress.selectLevel(4)).toBe(true);
    expect(progress.level).toBe(4);
  });

  it("un niveau déjà fait peut être rejoué : le bit reste posé", () => {
    const progress = BowlingProgress.empty();
    progress.mask = 1;
    progress.selectOperation(ADD);
    progress.selectLevel(0);
    const generator = rng();
    finishLevel(progress, generator);
    expect(progress.mask).toBe(1);
    expect(progress.level).toBe(1);
  });

  it("aller-retour avec le roster : variables et masque", () => {
    const roster = Roster.createEmpty();
    roster.addPlayer("Zoe");
    const progress = BowlingProgress.empty();
    progress.selectOperation(ESTIMATION);
    const generator = rng();
    for (let i = 0; i < 4; i++) progress.strike(generator);
    progress.mask = 0b101;
    progress.save(roster, 1);
    expect(roster.getVar(1, "bowlingStrikes", 5 * ESTIMATION)).toBe(4);
    expect(roster.getMask(1)).toBe(5);
    const again = BowlingProgress.load(roster, 1);
    expect(again.strikesOf(ESTIMATION, 0)).toBe(4);
    expect(again.mask).toBe(5);
    expect(again.rank).toBe(3);
  });

  it("musique, jeu de quilles et animation de quilles", () => {
    const generator = rng();
    expect(backgroundMusicId(2, generator)).toBe(2002);
    for (let i = 0; i < 20; i++) expect(backgroundMusicId(4, generator)).toBeGreaterThanOrEqual(2000);
    expect(pinAnimationId(0, 0)).toBe(1200);
    expect(pinAnimationId(13, 9)).toBe(1200 + 100 + 30 + 9);
    expect(pinAnimationId(29, 9)).toBe(1499);
  });
});

// --- Minuteur (§8.4 n° 8) --------------------------------------------------------------------------------------------------------

describe("GameTimer", () => {
  it("dure 10 800 ticks par défaut et lit l'en-tête du roster", () => {
    expect(new GameTimer().totalTicks).toBe(DEFAULT_BOWLING_TICKS);
    const roster = Roster.createEmpty();
    expect(GameTimer.fromRoster(roster).totalTicks).toBe(10800);
    roster.setBowlingSeconds(90);
    expect(GameTimer.fromRoster(roster).totalTicks).toBe(5400);
    expect(() => new GameTimer(0)).toThrow(RangeError);
  });

  it("barre de temps : 0 au GO!, 121 à l'échéance", () => {
    const timer = new GameTimer(1000);
    expect(timer.barHalfWidth(50)).toBe(0);
    timer.start(100);
    expect(timer.barHalfWidth(100)).toBe(0);
    expect(timer.barHalfWidth(100 + 500)).toBe(121 - Math.floor((121 * 500) / 1000));
    expect(timer.barHalfWidth(1100)).toBe(121);
    expect(timer.barHalfWidth(5000)).toBe(121);
    expect(timer.remaining(350)).toBe(750);
  });

  it("échéance ≤ tick ; suspendue pendant le traitement d'une réponse puis constatée à la reprise", () => {
    const timer = new GameTimer(100);
    expect(timer.expired(10_000)).toBe(false);
    timer.start(0);
    expect(timer.running).toBe(true);
    expect(timer.expired(99)).toBe(false);
    expect(timer.expired(100)).toBe(true);
    timer.suspended = true;
    expect(timer.expired(500)).toBe(false);
    timer.suspended = false;
    expect(timer.expired(500)).toBe(true);
    timer.stop();
    expect(timer.running).toBe(false);
    expect(timer.expired(500)).toBe(false);
  });
});

// --- File de reprise et historique (§8.4 n° 7) --------------------------------------------------------------------------------------

describe("QuestionPicker", () => {
  const level0 = { operation: ADD, level: 0, subType: 0 };

  it("tire sans répétition dans l'espace du sous-type, puis recommence", () => {
    const picker = new QuestionPicker();
    const rng = new MsvcRandom(11);
    const first = Array.from({ length: 41 }, () => picker.pick(level0, rng).index);
    expect(new Set(first).size).toBe(41);
    expect(Math.max(...first)).toBe(40);
    // Le 42e tirage vide l'historique : un indice valide quelconque.
    const again = picker.pick(level0, rng).index;
    expect(again).toBeGreaterThanOrEqual(0);
    expect(again).toBeLessThanOrEqual(40);
  });

  it("au bonus : sous-type au hasard parmi tous ceux de l'opération", () => {
    for (const operation of [ADD, SUBTRACT, MULTIPLY, DIVIDE, EQUIVALENCE]) {
      const picker = new QuestionPicker();
      const rng = new MsvcRandom(3 + operation);
      const subTypes = new Set<number>();
      for (let i = 0; i < 400; i++) {
        const pick = picker.pick({ operation, level: 4, subType: 0 }, rng);
        expect(pick.index).toBeLessThanOrEqual(PROBLEM_MAX[operation]![pick.subType]!);
        subTypes.add(pick.subType);
      }
      expect(subTypes.size).toBe(SUBTYPE_COUNTS[operation]);
      expect(Math.max(...subTypes)).toBe(SUBTYPE_COUNTS[operation]! - 1);
    }
  });

  it("jamais de boucle infinie : les indices épuisés par d'autres sous-types vident l'historique", () => {
    const picker = new QuestionPicker();
    const rng = new MsvcRandom(2);
    for (let i = 0; i < 3000; i++) {
      const pick = picker.pick({ operation: ADD, level: 4, subType: 0 }, rng);
      picker.answered(i % 5 !== 0, i % 4);
      expect(pick.index).toBeLessThanOrEqual(PROBLEM_MAX[ADD]![pick.subType]!);
    }
  });

  it("problème manqué : il revient 3 à 6 problèmes plus tard, la bonne réponse jamais dans la case cliquée", () => {
    const delays = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      const picker = new QuestionPicker();
      const rng = new MsvcRandom(seed);
      const missed = picker.pick(level0, rng);
      expect(missed.retry).toBe(false);
      const clicked = seed % 4;
      picker.answered(false, clicked);
      expect(picker.pending).toBe(1);
      let delay = 0;
      for (;;) {
        delay++;
        const pick = picker.pick(level0, rng);
        if (pick.retry) {
          expect(pick).toMatchObject({ index: missed.index, subType: missed.subType, avoidSlot: clicked });
          delays.add(delay);
          // Reprise : la bonne réponse change de case.
          const question = buildQuestion(pick.operation, pick.subType, pick.index, rng, { avoidSlot: pick.avoidSlot });
          expect(question.correctSlot).not.toBe(clicked);
          picker.answered(true, question.correctSlot);
          expect(picker.pending).toBe(0);
          break;
        }
        expect(delay).toBeLessThan(6);
        picker.answered(true, 0);
        expect(picker.pending).toBe(1);
      }
    }
    expect([...delays].sort()).toEqual([3, 4, 5, 6]);
  });

  it("mauvaise réponse à une reprise : file inchangée, le problème revient à nouveau", () => {
    const picker = new QuestionPicker();
    const rng = new MsvcRandom(5);
    const missed = picker.pick(level0, rng);
    picker.answered(false, 2);
    let guard = 0;
    let retry = picker.pick(level0, rng);
    while (!retry.retry && guard++ < 10) {
      picker.answered(true, 0);
      retry = picker.pick(level0, rng);
    }
    expect(retry).toMatchObject({ retry: true, index: missed.index });
    picker.answered(false, 1);
    expect(picker.pending).toBe(1);
    // Encore une fois en 3 à 6 problèmes, avec la case cliquée la toute première fois.
    let again = picker.pick(level0, rng);
    let delay = 1;
    while (!again.retry) {
      picker.answered(true, 0);
      again = picker.pick(level0, rng);
      delay++;
      expect(delay).toBeLessThanOrEqual(6);
    }
    expect(delay).toBeGreaterThanOrEqual(3);
    expect(again.avoidSlot).toBe(2);
  });

  it("le plus ancien problème manqué revient d'abord ; reset vide la file", () => {
    const picker = new QuestionPicker();
    const rng = new MsvcRandom(8);
    const a = picker.pick(level0, rng);
    picker.answered(false, 0);
    const b = picker.pick(level0, rng);
    picker.answered(false, 3);
    expect(picker.pending).toBe(2);
    let next = picker.pick(level0, rng);
    while (!next.retry) {
      picker.answered(true, 0);
      next = picker.pick(level0, rng);
    }
    expect(next.index).toBe(a.index);
    expect(next.index).not.toBe(b.index);
    picker.reset();
    expect(picker.pending).toBe(0);
    expect(picker.pick(level0, rng).retry).toBe(false);
  });

  it("next : problème complet, marqué « repris » quand c'est le cas", () => {
    const picker = new QuestionPicker();
    const rng = new MsvcRandom(21);
    const first = picker.next(level0, rng);
    expect(first.retry).toBe(false);
    checkQuestion(first, "next");
    picker.answered(false, (first.correctSlot + 1) & 3);
    let retried: BowlingQuestion | undefined;
    for (let i = 0; i < 8 && !retried; i++) {
      const question = picker.next(level0, rng);
      if (question.retry) retried = question;
      else picker.answered(true, question.correctSlot);
    }
    expect(retried).toBeDefined();
    expect(retried!.index).toBe(first.index);
    expect(retried!.operands.slice(0, 2)).toEqual(first.operands.slice(0, 2));
    expect(retried!.correctSlot).not.toBe((first.correctSlot + 1) & 3);
  });
});

// --- Avec les fichiers du jeu ---------------------------------------------------------------------------------------------------

describe.skipIf(!hasOriginalFiles)("estimation (BOWLING.DAT)", () => {
  const data = loadBowlingData(MohawkArchive.parse(readOriginal("BOWLING.DAT")));
  const tables = EstimationTables.build(data);

  it("lit les ressources : 14 / 6 / 10 unités, 81 / 58 / 61 objets, 25 rangs", () => {
    expect(data.categories.map((c) => c.units.length)).toEqual([14, 6, 10]);
    expect(data.categories.map((c) => c.objects.length)).toEqual([81, 58, 61]);
    expect(data.categories.map((c) => c.targets.length)).toEqual([243, 116, 61]);
    expect(data.ranks).toHaveLength(25);
    expect(data.ranks[0]).toBe("Rookie Roller");
    expect(data.ranks[24]).toBe("Strike Master");
    expect(data.categories[0]!.units.slice(0, 2)).toEqual(["pinheads", "peas"]);
    expect(data.categories[0]!.unitSizes).toEqual([6, 30, 50, 125, 350, 500, 800, 1000, 2400, 100, 1200, 3600, 40, 3960]);
    expect(data.categories[1]!.unitSizes).toEqual([1, 60, 3600, 86400, 2628000, 31536000]);
    expect(data.categories[2]!.unitSizes).toEqual([100, 400, 2000, 12800, 70000, 112000, 1000, 16000, 40, 35000]);
  });

  it("effectifs par bande et catégorie (32 bits non signés : durées de la bande 4 = 63, problemMax = 190)", () => {
    expect(tables.totals).toEqual([
      [465, 55, 98],
      [321, 34, 57],
      [267, 15, 67],
      [141, 63, 77],
    ]);
    expect([0, 1, 2, 3].map((band) => tables.problemMax(band))).toEqual([182, 154, 142, 190]);
  });

  it("vecteur : bande 0, problème 0 → pinheads, a toothpick, réponse 1", () => {
    const e = tables.operands(0, 0);
    const answer = tables.answer(e);
    const prompt = tables.prompt(e);
    expect(prompt.unit).toBe("pinheads");
    expect(prompt.subject).toBe("a toothpick");
    expect(answer).toBe(1);
    expect(formatEstimationPrompt(prompt)).toMatch(/^About how many pinheads (long|tall|wide) is a toothpick\?$/);
  });

  it("vecteur : bande 3, problème 189 → kilograms, a cow, réponse 686 (190 : a small car, 914)", () => {
    // Le document d'étude donnait 190 → a cow avec des bornes sans débordement ; sur 32 bits (`IMUL EDX,EAX`) le total des durées de la
    // bande 4 est 63, la catégorie des poids commence un cran plus tôt et la vache passe à 189.
    const e = tables.operands(3, 189);
    const answer = tables.answer(e);
    const prompt = tables.prompt(e);
    expect(prompt.unit).toBe("kilograms");
    expect(prompt.subject).toBe("a cow");
    expect(formatEstimationPrompt(prompt)).toBe("About how many kilograms does a cow weigh?");
    expect(answer).toBe(686);
    expect(e[3]).toBe(3);
    const last = tables.operands(3, 190);
    expect(tables.answer(last)).toBe(914);
    expect(tables.prompt(last).subject).toBe("a small car");
  });

  it("textes des trois catégories", () => {
    const lengthPrompt = tables.prompt([0, 0, 0, 0]);
    expect(lengthPrompt.category).toBe(0);
    const durations = tables.prompt([1, 5, 1, 0]);
    expect(formatEstimationPrompt(durations)).toMatch(/^About how many minutes (does it take|pass before|are you|pass while|pass) .+\?$/);
    const weights = tables.prompt([0, 0, 2, 0]);
    expect(formatEstimationPrompt(weights)).toMatch(/^About how many pennies does .+ weigh\?$/);
  });

  it("tout l'espace : réponse = (cible + U/2) div U, ordre de grandeur, quatre cases distinctes", () => {
    for (let band = 0; band < 4; band++) {
      const max = tables.problemMax(band);
      for (let index = 0; index <= max; index++) {
        for (const seed of [index + 1, 31 * index + band]) {
          const q = buildQuestion(ESTIMATION, band, index, new MsvcRandom(seed), { estimation: tables });
          checkQuestion(q, `≈ bande ${band} problème ${index} graine ${seed}`);
          const [unit, target, category] = q.operands;
          const size = data.categories[category]!.unitSizes[unit]!;
          const value = tables.records[category]![target]!.value;
          expect(q.answer).toBe(Math.floor((value + (size >> 1)) / size));
          // Dans la fenêtre de la bande : de U × bas à (U × haut + U/2) pour les bornes sans débordement.
          expect(value).toBeGreaterThanOrEqual(size * [1, 5, 20, 20][band]!);
          // Distracteurs : la bonne réponse multipliée ou divisée par le facteur de la catégorie (erreurs d'ordre de grandeur).
          const factor = [4, 6, 4][category]!;
          const magnitude = q.operands[3];
          const expected = [1, 2, 3].map((i) => {
            const target = (magnitude + i) & 3;
            let shifted = q.answer;
            for (let m = magnitude; m < target; m++) shifted *= factor;
            for (let m = target; m < magnitude; m++) shifted = Math.trunc(shifted / factor);
            return shifted;
          });
          expect(q.values.filter((_, slot) => slot !== q.correctSlot).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
        }
      }
    }
  });

  it("QuestionPicker + estimation : problèmes de la bande du niveau", () => {
    const picker = new QuestionPicker(tables);
    const rng = new MsvcRandom(6);
    for (let level = 0; level < 4; level++) {
      for (let i = 0; i < 50; i++) {
        const question = picker.next({ operation: ESTIMATION, level, subType: level }, rng);
        expect(question.subType).toBe(level);
        expect(question.index).toBeLessThanOrEqual(tables.problemMax(level));
        expect(question.prompt.kind).toBe("estimation");
        picker.answered(true, question.correctSlot);
      }
      picker.reset();
    }
    expect(() => new QuestionPicker().pick({ operation: ESTIMATION, level: 0, subType: 0 }, rng)).toThrow(/tables/);
  });
});
