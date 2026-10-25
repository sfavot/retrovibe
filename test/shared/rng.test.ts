import { describe, expect, it } from "vitest";
import { Lcg, borlandRand, msvcRand, msvcRand16, randomSeed } from "../../src/engine/rng";
import { Rng } from "../../src/games/indy/engine/rng";
import { MsvcRandom } from "../../src/games/mathemagique/engine/rng";
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
