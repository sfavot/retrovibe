import { describe, expect, it } from "vitest";
import { HEIGHT, PIXELS, Plane, TRANSPARENT, WIDTH } from "../../../src/games/drascula/render/plane";

/** Plan dont le pixel (x, y) vaut `f(x, y)`. */
function planeOf(f: (x: number, y: number) => number): Plane {
  const plane = new Plane();
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) plane.pixels[y * WIDTH + x] = f(x, y);
  return plane;
}

describe("plan 320 x 200", () => {
  it("refuse une taille qui n'est pas celle de l'écran", () => {
    expect(() => new Plane(new Uint8Array(10))).toThrow(RangeError);
    expect(new Plane().pixels).toHaveLength(PIXELS);
  });

  it("copyBackground copie un rectangle tel quel, transparent compris", () => {
    const src = planeOf((x, y) => (x === 11 && y === 12 ? TRANSPARENT : (x + y) % 200));
    const dest = new Plane();
    dest.clear(7);
    dest.copyBackground(src, 10, 10, 100, 50, 4, 3);
    expect(dest.at(100, 50)).toBe(20);
    expect(dest.at(101, 52)).toBe(TRANSPARENT);
    expect(dest.at(103, 52)).toBe(25);
    expect(dest.at(104, 50)).toBe(7);
    expect(dest.at(100, 53)).toBe(7);
  });

  it("copyRect saute l'indice 255", () => {
    const src = planeOf((x) => (x % 2 === 0 ? TRANSPARENT : 9));
    const dest = new Plane();
    dest.clear(3);
    dest.copyRect(src, 0, 0, 20, 20, 4, 1);
    expect([dest.at(20, 20), dest.at(21, 20), dest.at(22, 20), dest.at(23, 20)]).toEqual([3, 9, 3, 9]);
  });

  it("rogne à l'écran de destination et décale la source quand le point est négatif", () => {
    const src = planeOf((x, y) => (x + 3 * y) % 200);
    const dest = new Plane();
    dest.copyRect(src, 10, 20, -2, -1, 6, 4);
    // les deux premières colonnes et la première ligne tombent hors de l'écran : le coin visible est la source (12, 21)
    expect(dest.at(0, 0)).toBe(src.at(12, 21));
    expect(dest.at(3, 2)).toBe(src.at(15, 23));
    expect(dest.at(4, 0)).toBe(0);
    dest.copyRect(src, 0, 0, 318, 198, 10, 10);
    expect(dest.at(319, 199)).toBe(src.at(1, 1));
    expect(dest.pixels).toHaveLength(PIXELS);
  });

  it("ne lit pas hors de la source", () => {
    const src = planeOf(() => 5);
    const dest = new Plane();
    dest.copyRect(src, 316, 196, 10, 10, 20, 20);
    expect(dest.at(13, 13)).toBe(5);
    expect(dest.at(14, 10)).toBe(0);
    expect(dest.at(10, 14)).toBe(0);
  });
});

describe("réduction du héros (reduce_hare_chico)", () => {
  const src = planeOf((x, y) => 1 + ((x * 3 + y * 5) % 200));

  it("facteur 100 : copie à l'identique", () => {
    const dest = new Plane();
    const size = dest.reduce(src, 0, 72, 30, 40, 43, 70, 100);
    expect(size).toEqual({ width: 43, height: 70 });
    for (const [x, y] of [[0, 0], [42, 0], [0, 69], [42, 69], [20, 33]]) expect(dest.at(30 + x, 40 + y)).toBe(src.at(x, 72 + y));
    expect(dest.at(73, 40)).toBe(0);
    expect(dest.at(30, 110)).toBe(0);
  });

  it("facteur 50 : 21 x 35, un pixel de la source prélevé tous les 43 / 21 et 70 / 35", () => {
    const dest = new Plane();
    const size = dest.reduce(src, 0, 72, 30, 40, 43, 70, 50);
    expect(size).toEqual({ width: 21, height: 35 });
    expect(dest.at(30, 40)).toBe(src.at(0, 72));
    expect(dest.at(31, 40)).toBe(src.at(2, 72));
    expect(dest.at(30, 41)).toBe(src.at(0, 74));
    expect(dest.at(30 + 20, 40 + 34)).toBe(src.at(40, 72 + 68));
    expect(dest.at(30 + 21, 40)).toBe(0);
    expect(dest.at(30, 40 + 35)).toBe(0);
  });

  it("l'indice 255 reste transparent et rien n'est écrit sous un facteur nul", () => {
    const holes = planeOf((x) => (x < 2 ? TRANSPARENT : 4));
    const dest = new Plane();
    dest.clear(9);
    dest.reduce(holes, 0, 0, 0, 0, 43, 70, 100);
    expect(dest.at(0, 0)).toBe(9);
    expect(dest.at(2, 0)).toBe(4);
    const empty = new Plane();
    expect(empty.reduce(src, 0, 0, 0, 0, 43, 70, 0)).toEqual({ width: 0, height: 0 });
    expect(empty.pixels.every((p) => p === 0)).toBe(true);
  });

  it("rogne un héros qui dépasse de l'écran", () => {
    const dest = new Plane();
    expect(() => dest.reduce(src, 0, 72, 300, 180, 43, 70, 100)).not.toThrow();
    expect(dest.at(319, 199)).toBe(src.at(19, 72 + 19));
  });
});
