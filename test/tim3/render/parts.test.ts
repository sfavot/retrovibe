import { describe, expect, it } from "vitest";
import { Surface as S, type Surface, drawPart } from "../../../src/games/tim3/render";
import { FakeAssets, WORLD, anm, bitmapCmd, frame, image, part, rows } from "./support";
import type { World } from "../../../src/games/tim3/engine/world";

const VIEW = { x: 0, y: 0 };
/** Image de test : 4 vignettes de 4×2, chacune d'un seul chiffre (1 à 4 : bord gauche, motifs A et B, bord droit). */
const tiles = [1, 2, 3, 4].map((v) => image([[v, v, v, v], [v, v, v, v]]));

function draw(surface: Surface, assets: FakeAssets, p: ReturnType<typeof part>, layer = 4, world: World = WORLD): void {
  drawPart(surface, assets, world, p, layer, VIEW);
}

describe("pièce ordinaire (42deab)", () => {
  const a = anm(3, 2, [frame(0, 0, 3, 2, [bitmapCmd(0)])]);
  const assets = new FakeAssets({ frames: [image([[1, 2, 3], [4, 5, 6]])] }, new Map([[0, a]]));

  it("dessine l'image courante à la position de la pièce", () => {
    const s = new S(6, 3);
    draw(s, assets, part(0, 2, 1, 3, 2));
    expect(rows(s, 0, 0, 6, 3)).toEqual(["000000", "001230", "004560"]);
  });

  it("retourne à gauche-droite (0x10) et haut-bas (0x20) sur place", () => {
    const x = new S(6, 3);
    draw(x, assets, part(0, 2, 1, 3, 2, 0x10));
    expect(rows(x, 0, 0, 6, 3)).toEqual(["000000", "003210", "006540"]);
    const y = new S(6, 3);
    draw(y, assets, part(0, 2, 1, 3, 2, 0x20));
    expect(rows(y, 0, 0, 6, 3)).toEqual(["000000", "004560", "001230"]);
    const xy = new S(6, 3);
    draw(xy, assets, part(0, 2, 1, 3, 2, 0x30));
    expect(rows(xy, 0, 0, 6, 3)).toEqual(["000000", "006540", "003210"]);
  });

  it("laisse voir le fond sous les pixels transparents", () => {
    const s = new S(4, 2);
    s.clear(9);
    draw(s, new FakeAssets({ frames: [image([[1, 0, 0], [0, 0, 2]])] }, new Map([[0, a]])), part(0, 0, 0, 3, 2));
    expect(rows(s, 0, 0, 4, 2)).toEqual(["1999", "9929"]);
  });

  it("ignore les décors quand l'option d'affichage 2 est éteinte", () => {
    const p = part(0, 0, 0, 3, 2);
    p.flags14 = 0x1000;
    const on = new S(3, 2);
    draw(on, assets, p);
    const off = new S(3, 2);
    draw(off, assets, p, 4, { animFlags: 5 } as World);
    expect([on.pixels[0], off.pixels[0]]).toEqual([1, 0]);
  });
});

describe("pièces étirables (42dcec)", () => {
  // Groupe horizontal : images 0 à 3 (état 1) ; groupe vertical : images 4 à 6 (état 2) : bord haut, motif, bord bas.
  const horizontal = tiles.map((_, i) => frame(0, 0, 4, 2, [bitmapCmd(i)]));
  const vertical = [5, 6, 7].map((_, i) => frame(0, 0, 4, 2, [bitmapCmd(4 + i)]));
  const bitmaps = [...tiles, ...[5, 6, 7].map((v) => image([[v, v, v, v], [v, v, v, v]]))];
  const wall = anm(4, 2, [...horizontal, ...vertical], [{ first: 0, state: 1 }, { first: 4, state: 2 }]);
  const assets = new FakeAssets({ frames: bitmaps }, new Map([[1, wall]]));

  it("pose un bord, des motifs en alternance, puis l'autre bord (pièce plus large que haute)", () => {
    const s = new S(24, 2);
    draw(s, assets, part(1, 0, 0, 24, 2));
    expect(rows(s, 0, 0, 24, 1)).toEqual(["111122223333222233334444"]);
  });

  it("compte `largeur / tuile` tuiles, reste ignoré", () => {
    const s = new S(24, 2);
    draw(s, assets, part(1, 0, 0, 14, 2));
    // 14 / 4 = 3 tuiles : bord, motif, bord.
    expect(rows(s, 0, 0, 24, 1)).toEqual(["111122224444000000000000"]);
  });

  it("utilise le groupe vertical pour une pièce plus haute que large : bord haut, motif, bord bas", () => {
    const s = new S(4, 8);
    draw(s, assets, part(1, 0, 0, 4, 8));
    expect(rows(s, 0, 0, 1, 8)).toEqual(["5", "5", "6", "6", "6", "6", "7", "7"]);
  });
});

describe("retournement d'une pièce étirable et seaux", () => {
  it("un mur horizontal retourné est miroité en Y (tuiles dont les lignes diffèrent)", () => {
    const tile = [image([[1, 1], [2, 2]]), image([[3, 3], [4, 4]]), image([[5, 5], [6, 6]])];
    const wall = anm(2, 2, tile.map((_, i) => frame(0, 0, 2, 2, [bitmapCmd(i)])), [{ first: 0, state: 1 }]);
    const assets = new FakeAssets({ frames: tile }, new Map([[1, wall]]));
    const s = new S(6, 2);
    draw(s, assets, part(1, 0, 0, 6, 2, 0x10));
    expect(rows(s, 0, 0, 6, 2)).toEqual(["224466", "113355"]);
  });

  it("un seau montre son image arrière aux plans ordinaires et son image avant au plan 2", () => {
    const a = anm(2, 1, [frame(0, 0, 2, 1, [bitmapCmd(0)]), frame(0, 0, 2, 1, [bitmapCmd(1)])]);
    const assets = new FakeAssets({ frames: [image([[1, 1]]), image([[2, 2]])] }, new Map([[17, a]]));
    const back = new S(2, 1);
    draw(back, assets, part(17, 0, 0, 2, 1), 6);
    const front = new S(2, 1);
    draw(front, assets, part(17, 0, 0, 2, 1), 2);
    expect([back.pixels[0], front.pixels[0]]).toEqual([1, 2]);
  });
});

describe("aplats (43e74b)", () => {
  const tile = anm(3, 2, [frame(0, 0, 3, 2, [bitmapCmd(0)])]);
  const assets = new FakeAssets({ frames: [image([[1, 2, 3], [4, 5, 6]])] }, new Map([[121, tile]]));

  it("répète l'image sur la zone, alignée sur une grille de la taille de l'image, et découpe au bord de la pièce", () => {
    const s = new S(12, 4);
    draw(s, assets, part(121, 4, 1, 7, 3), 8);
    // Zone x 4 à 10, y 1 à 3 ; grille de 3×2 : colonnes 3, 6, 9 ; lignes 0, 2.
    expect(rows(s, 0, 0, 12, 4)).toEqual(["000000000000", "000056456450", "000023123120", "000056456450"]);
  });

  it("n'est pas dessiné quand l'option d'affichage 4 est éteinte", () => {
    const s = new S(12, 4);
    draw(s, assets, part(121, 4, 1, 7, 3), 8, { animFlags: 3 } as World);
    expect(s.pixels.every((v) => v === 0)).toBe(true);
  });
});

describe("avant au plan 0 (slots 6 445ce0, 442a75, 442ab8)", () => {
  /** ANM d'une image de 1×1 par valeur (image i = pixel i + 1), avec ses états. */
  function oneByOne(type: number, count: number, states: { first: number; state: number }[] = []): FakeAssets {
    const bitmaps = Array.from({ length: count }, (_, i) => image([[i + 1]]));
    const a = anm(1, 1, bitmaps.map((_, i) => frame(0, 0, 1, 1, [bitmapCmd(i)])), states);
    return new FakeAssets({ frames: bitmaps }, new Map([[type, a]]));
  }
  function pixel(assets: FakeAssets, type: number, current: number, layer: number): number {
    const p = part(type, 0, 0, 1, 1);
    p.frame = current;
    const s = new S(1, 1);
    draw(s, assets, p, layer);
    return s.pixels[0]!;
  }

  it("boîte 71 : image courante au plan 4, son avant (image + 5) au plan 0 ; la caisse en carton (4) seulement au plan 0", () => {
    const assets = oneByOne(71, 9);
    expect([0, 1, 2, 3].map((f) => [pixel(assets, 71, f, 4), pixel(assets, 71, f, 0)])).toEqual([[1, 6], [2, 7], [3, 8], [4, 9]]);
    expect([pixel(assets, 71, 4, 4), pixel(assets, 71, 4, 0)]).toEqual([0, 5]);
  });

  it("le contenu d'une boîte 71 (plan 3) passe entre l'arrière et l'avant", () => {
    const assets = oneByOne(71, 9);
    const s = new S(1, 1);
    const box = part(71, 0, 0, 1, 1);
    draw(s, assets, box, 4);
    expect(s.pixels[0]).toBe(1);
    s.pixels[0] = 0xc; // le contenu, au plan 3
    draw(s, assets, box, 0);
    expect(s.pixels[0]).toBe(6);
  });

  it("taille-haie 37 : au plan 0, la lame (début de l'état 0xB) tant que l'image courante la précède", () => {
    const assets = oneByOne(37, 10, [{ first: 0, state: 7 }, { first: 4, state: 0xb }, { first: 5, state: 3 }]);
    expect([0, 3, 4, 6].map((f) => pixel(assets, 37, f, 0))).toEqual([5, 5, 0, 0]);
    expect(pixel(assets, 37, 6, 4)).toBe(7);
  });

  it("cisailles 77 : au plan 0, la lame (début de l'état 5) seulement ouvertes (image 0)", () => {
    const assets = oneByOne(77, 4, [{ first: 0, state: 4 }, { first: 1, state: 5 }, { first: 2, state: 6 }]);
    expect([0, 1, 2].map((f) => pixel(assets, 77, f, 0))).toEqual([2, 0, 0]);
    expect(pixel(assets, 77, 2, 4)).toBe(3);
  });
});
