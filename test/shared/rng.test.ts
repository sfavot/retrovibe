import { describe, expect, it } from "vitest";
import { Lcg, borlandRand, msvcRand, msvcRand16, randomSeed, scummvmRandom } from "../../src/engine/rng";
import { Rng } from "../../src/games/indy/engine/rng";
import { MsvcRandom } from "../../src/engine/mohawk/rng";
import { BorlandRandom } from "../../src/games/teleportaschtroumpf/engine/rng";

const SEEDS = [0, 1, 42, 0x1234, 0xffff, 0x7fffffff, 0xdeadbeef, 123456789];

describe("Lcg : identique aux générateurs existants", () => {
  it("msvcRand = Rng d'Indiana Jones (next, mod, pick, shuffle)", () => {
    for (const seed of SEEDS) {
      const a = new Lcg(seed, msvcRand);
      const b = new Rng(seed);
      for (let i = 0; i < 200; i++) expect(a.next()).toBe(b.next());
      for (const n of [0, 1, 2, 7, 100, 32767]) expect(a.mod(n)).toBe(b.mod(n));
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      expect(a.pick(items)).toBe(b.pick(items));
      expect(a.pick([])).toBeUndefined();
      expect(a.shuffle(items)).toEqual(b.shuffle(items));
      expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
  });

  it("borlandRand = BorlandRandom du Téléportaschtroumpf (next, scaled, état)", () => {
    for (const seed of SEEDS) {
      const a = new Lcg(seed, borlandRand);
      const b = new BorlandRandom(seed);
      for (let i = 0; i < 200; i++) expect(a.next()).toBe(b.next());
      for (const n of [1, 3, 10, 200]) expect(a.scaled(n)).toBe(b.below(n));
      expect(a.state).toBe(b.current);
    }
  });

  it("msvcRand16 = MsvcRandom de Mathémagique (inclusive = rand, mod = rand1/below)", () => {
    for (const seed of SEEDS) {
      const a = new Lcg(seed, msvcRand16);
      const b = new MsvcRandom(seed);
      for (const n of [0, 1, 5, 99, 1000, 60000]) expect(a.inclusive(n)).toBe(b.rand(n));
      // rand1(1) n'avance pas l'état chez Mathémagique, mod(1) avance chez Indiana Jones : seul n ≥ 2 est comparable.
      for (const n of [2, 3, 10, 500]) expect(a.mod(n)).toBe(b.below(n));
      expect(a.state).toBe(b.current);
    }
  });
});

describe("Lcg : comportement propre", () => {
  it("vecteur connu du rand() de Microsoft C avec la graine 1", () => {
    const rng = new Lcg(1);
    expect([rng.next(), rng.next(), rng.next()]).toEqual([41, 18467, 6334]);
  });

  it("seed et state reprennent la suite exactement", () => {
    const a = new Lcg(77);
    a.next();
    const saved = a.state;
    const expected = [a.next(), a.next()];
    const b = new Lcg();
    b.seed(saved);
    expect([b.next(), b.next()]).toEqual(expected);
    expect(saved).toBeGreaterThanOrEqual(0);
  });

  it("mod et inclusive de n ≤ 0 ne consomment pas de tirage", () => {
    const a = new Lcg(5);
    expect(a.mod(0)).toBe(0);
    expect(a.inclusive(-1)).toBe(0);
    expect(a.state).toBe(5);
  });

  it("randomSeed donne un entier positif de 31 bits", () => {
    for (let i = 0; i < 20; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0x7fffffff);
    }
  });
});

describe("scummvmRandom : valeurs relevées dans Common::RandomSource (algorithme de ScummVM 2026.4.0 compilé en C++)", () => {
  const FULL: [number, number[], number][] = [
    [1, [1980353283, 262458883, 1743047043, 2568796267, 974877070], 3244508122],
    [0, [1980353283, 262458883, 1743047043, 2568796267, 974877070], 3244508122],
    [42, [1570459262, 3030762429, 2606224763, 346448048, 3288782876], 2368614068],
    [0xdeadbeef, [3328448961, 93168681, 1177615324, 2799201604, 1960099943], 4264466893],
  ];

  it("getRandomNumber(UINT_MAX) : produit brut sur 32 bits, état final", () => {
    for (const [seed, values, state] of FULL) {
      const r = scummvmRandom(seed);
      expect(values.map(() => r.number(0xffffffff))).toEqual(values);
      expect(r.state).toBe(state);
    }
  });

  it("getRandomNumber(99), getRandomNumberRng(5, 10), getRandomBit() enchaînés", () => {
    const n100: Record<number, number[]> = {
      1: [83, 83, 43, 67, 70, 95, 9, 33],
      42: [62, 29, 63, 48, 76, 11, 31, 45],
      0xdeadbeef: [61, 81, 24, 4, 43, 12, 62, 27],
    };
    const rng: Record<number, number[]> = {
      1: [8, 9, 10, 7, 10, 7, 10, 10],
      42: [8, 5, 9, 10, 7, 6, 8, 6],
      0xdeadbeef: [7, 9, 5, 9, 6, 5, 6, 6],
    };
    const bits: Record<number, [number[], number]> = {
      1: [[1, 0, 1, 1, 1, 1, 0, 1, 1, 0], 938049188],
      42: [[0, 1, 1, 0, 0, 1, 1, 1, 1, 1], 1227702705],
      0xdeadbeef: [[1, 0, 0, 0, 0, 1, 0, 1, 1, 1], 813376509],
    };
    for (const seed of [1, 42, 0xdeadbeef]) {
      // Même enchaînement que le programme de référence : un seul générateur, trois séries à la suite.
      const r = scummvmRandom(seed);
      expect(n100[seed].map(() => r.number(99))).toEqual(n100[seed]);
      expect(rng[seed].map(() => r.range(5, 10))).toEqual(rng[seed]);
      expect(bits[seed][0].map(() => r.bit())).toEqual(bits[seed][0]);
      expect(r.state).toBe(bits[seed][1]);
    }
  });

  it("seed(state) reprend la suite ; rangeSigned reste dans les bornes", () => {
    const a = scummvmRandom(7);
    a.number(10);
    const b = scummvmRandom(a.state);
    for (let i = 0; i < 20; i++) expect(b.number(1000)).toBe(a.number(1000));
    const r = scummvmRandom(3);
    for (let i = 0; i < 200; i++) {
      const v = r.rangeSigned(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});
