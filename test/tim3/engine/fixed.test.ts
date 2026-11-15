import { describe, expect, it } from "vitest";
import { abs32, half, idiv, mul16, s16, sar, u16 } from "../../../src/games/tim3/engine/fixed";
import { acceleration, atmosphere } from "../../../src/games/tim3/engine/gravity";
import { angleOf, cos16, rotate, sin16 } from "../../../src/games/tim3/engine/tables";
import { Random } from "../../../src/games/tim3/engine/random";

describe("TIM3 : arithmétique exacte", () => {
  it("multiplie comme 413808 (opérandes tronqués à 16 bits signés)", () => {
    expect(mul16(3, 4)).toBe(12);
    expect(mul16(0x10003, 2)).toBe(6);
    expect(mul16(0xffff, 5)).toBe(-5);
    expect(mul16(-0x8000, -0x8000)).toBe(0x40000000);
    expect(mul16(0x8000, 1)).toBe(-0x8000);
  });

  it("divise en tronquant vers 0 (idiv) et décale vers −∞ (sar)", () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(idiv(7, -2)).toBe(-3);
    expect(sar(-7, 1)).toBe(-4);
    expect(sar(-1, 9)).toBe(-1);
    expect(half(-7)).toBe(-3);
    expect(() => idiv(1, 0)).toThrow();
  });

  it("tronque les mots et les valeurs absolues comme le processeur", () => {
    expect(s16(0x18000)).toBe(-0x8000);
    expect(u16(-1)).toBe(0xffff);
    expect(abs32(-0x80000000)).toBe(-0x80000000);
  });
});

describe("TIM3 : gravité (4340b0, 4340ef, 434141)", () => {
  it("donne 269 pour la boule de bowling aux réglages par défaut (valeur relevée par le banc)", () => {
    const atm = atmosphere(272, 67);
    expect(atm).toEqual({ gravity: 272, air: 33 });
    expect(acceleration(2832, atm.air, atm.gravity)).toBe(269);
    expect(0x2600 - atm.air).toBe(9695);
  });

  it("couvre les cas de l'atmosphère et la poussée vers le haut", () => {
    expect(atmosphere(100, 80)).toEqual({ gravity: 26, air: 1280 });
    expect(atmosphere(300, 0)).toEqual({ gravity: 600, air: 0 });
    expect(acceleration(33, 33, 272)).toBe(0);
    // Ballon (densité 9) : (9·272)/33 − 272 = 74 − 272.
    expect(acceleration(9, 33, 272)).toBe(-198);
    // Gravité nulle : aucune accélération.
    expect(acceleration(2832, 33, 0)).toBe(0);
  });
});

describe("TIM3 : trigonométrie (4137d0, 41348a, 413404)", () => {
  it("lit la table cosinus Q14 repliée", () => {
    expect(cos16(0)).toBe(16384);
    expect(cos16(0x8000)).toBe(-16384);
    expect(cos16(0x4000)).toBe(cos16(0xc000));
    expect(sin16(0x4000)).toBe(16384);
    expect(sin16(0)).toBe(cos16(0xc000));
  });

  it("calcule l'angle d'un vecteur sur 16 bits", () => {
    expect(angleOf(0, 5)).toBe(0);
    expect(angleOf(5, 0)).toBe(0xc000);
    expect(angleOf(0, -5)).toBe(0x8000);
    expect(angleOf(-5, 0)).toBe(0x4000);
    expect(angleOf(3, 3)).toBe(0xe000);
  });

  it("tourne un vecteur d'un quart de tour", () => {
    expect(rotate(512, 0, 0)).toEqual([512, 0]);
    const [x, y] = rotate(512, 0, 0x4000);
    expect(Math.abs(x)).toBeLessThanOrEqual(1);
    expect(Math.abs(y)).toBe(512);
  });
});

describe("TIM3 : générateur 4520a4", () => {
  it("est déterministe et rend des mots de 16 bits", () => {
    const a = new Random();
    const b = new Random();
    const seq = Array.from({ length: 200 }, () => a.next());
    expect(Array.from({ length: 200 }, () => b.next())).toEqual(seq);
    expect(seq.every((v) => v >= 0 && v <= 0xffff)).toBe(true);
    const c = a.clone();
    expect(c.next()).toBe(a.next());
  });
});
