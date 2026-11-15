import { describe, expect, it } from "vitest";
import { Surface as S, type Surface, drawPart } from "../../../src/games/tim3/render";
import { colorBlockColor } from "../../../src/games/tim3/render/parts";
import { mapColor } from "../../../src/games/tim3/render/palette";
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

describe("faisceau des lasers (43cd22)", () => {
  const none = new FakeAssets({ frames: [] }, new Map());
  /** Laser allumé dont le tampon trace un L : (1, 1) → (6, 1) → (6, 4), impact éventuel sur le dernier tronçon. */
  function laser(type: number, f24 = 1, impact: [number, number] | null = null) {
    const p = part(type, 0, 0, 1, 1);
    p.beam = new Int32Array(32);
    p.beam.set([1, 1, 6, 1, 6, 4]);
    p.f24 = f24;
    p.fFC = 2;
    [p.vx, p.vy] = impact ?? [-0x1000, 0];
    return p;
  }
  const lit = (s: Surface) => Array.from({ length: 6 }, (_, y) => Array.from(s.pixels.subarray(y * 8, y * 8 + 8), (v) => (v ? "#" : "0")).join(""));

  it("trace chaque tronçon du tampon, jusqu'au bout sans impact (+0x54 = −0x1000)", () => {
    const s = new S(8, 6);
    draw(s, none, laser(0x5b), 3);
    expect(lit(s)).toEqual(["00000000", "0######0", "000000#0", "000000#0", "000000#0", "00000000"]);
  });

  it("arrête le dernier tronçon au point d'impact (+0x54, +0x58)", () => {
    const s = new S(8, 6);
    draw(s, none, laser(0x5b, 1, [6, 2]), 3);
    expect(lit(s)).toEqual(["00000000", "0######0", "000000#0", "00000000", "00000000", "00000000"]);
  });

  it("ne dessine rien quand le laser est éteint (+0x24 = 0)", () => {
    const s = new S(8, 6);
    draw(s, none, laser(0x5b, 0), 3);
    expect(s.pixels.every((v) => v === 0)).toBe(true);
  });

  it("couleur logique 12, 10, 9 pour 91, 92, 93 ; table 0x477d64 pour le mélangeur 95", () => {
    const at = (type: number, f24: number) => {
      const s = new S(8, 6);
      draw(s, none, laser(type, f24), 3);
      return s.pixels[1 * 8 + 1];
    };
    expect([at(0x5b, 1), at(0x5c, 1), at(0x5d, 1)]).toEqual([27, 25, 24]);
    expect([1, 2, 3, 4, 5, 6, 7].map((f) => at(0x5f, f))).toEqual([24, 25, 26, 27, 16, 29, 30]);
  });
});

describe("dessins propres : ensemble de couleurs 127 (44827f), loupe 30 (441a0a), message d'ordinateur 136 (448424)", () => {
  /** Palette de test : couleur i = (i, 2i mod 256, 0), sauf 200 = (100, 100, 100). */
  const palette = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) palette.set([i, (2 * i) & 0xff, 0, 255], i * 4);
  palette.set([100, 100, 100, 255], 200 * 4);
  class PaletteAssets extends FakeAssets {
    override gamePalette(): Uint8Array {
      return palette;
    }
  }
  const assets = new PaletteAssets({ frames: [image([[7]])] }, new Map([[30, anm(1, 1, [frame(0, 0, 1, 1, [bitmapCmd(0)])])], [136, anm(1, 1, [frame(0, 0, 1, 1, [bitmapCmd(0)])])]]));

  it("couleur : 5 si +0xFC est nul ; quartet bas seul : couleur logique ; deux quartets : la plus proche de leur moyenne", () => {
    expect(colorBlockColor(palette, 0)).toBe(mapColor(5));
    expect(colorBlockColor(palette, 3)).toBe(18);
    // a = 1 (16), b = 3 (18) : moyenne (17, 34, 0) = couleur 17.
    expect(colorBlockColor(palette, 0x31)).toBe(17);
  });

  it("rectangle plein de la taille de la pièce, sans image ; rien sans l'option « fond » (448345)", () => {
    const p = part(127, 1, 1, 3, 2);
    p.fFC = 2;
    const s = new S(5, 4);
    draw(s, assets, p);
    const filled = [...s.pixels.keys()].filter((i) => s.pixels[i] === 17).map((i) => [i % 5, Math.trunc(i / 5)]);
    expect(filled).toEqual([[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2]]);
    const off = new S(5, 4);
    draw(off, assets, p, 4, { animFlags: 3 } as World);
    expect([...off.pixels].every((v) => v === 0)).toBe(true);
  });

  it("loupe : en marche, un triangle de couleur 14 de la lentille au point de mise à feu de la cible", () => {
    const glass = part(30, 0, 0, 24, 20);
    const target = part(0, 40, 30, 4, 4);
    target.ropeAnchor[8] = 2;
    target.ropeAnchor[9] = 1;
    glass.links[4] = target;
    const idle = new S(60, 40);
    draw(idle, assets, glass, 4, { animFlags: 7, running: false } as World);
    expect([...idle.pixels].filter((v) => v === mapColor(14))).toHaveLength(0);
    const s = new S(60, 40);
    draw(s, assets, glass, 4, { animFlags: 7, running: true } as World);
    const yellow = mapColor(14);
    // Base sur x = 18 (y 6 à 16), pointe en (42, 31).
    expect(s.pixels[10 * 60 + 18]).toBe(yellow);
    expect(s.pixels[31 * 60 + 42]).toBe(yellow);
    expect(s.pixels[2 * 60 + 18]).toBe(0);
    // Retournée : la base passe à x − 1.
    glass.flags10 = 0x10;
    glass.px = 10;
    const f = new S(60, 40);
    draw(f, assets, glass, 4, { animFlags: 7, running: true } as World);
    expect(f.pixels[10 * 60 + 9]).toBe(yellow);
  });

  it("message d'ordinateur : le caractère +0xFC seulement allumé (+0x24)", () => {
    const font = { kind: "pft", height: 2, baseline: 2, firstChar: 0x41, glyphs: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 1, 1, 1]) }] };
    class FontAssets extends PaletteAssets {
      override font(): never {
        return font as never;
      }
    }
    const fa = new FontAssets({ frames: [image([[7]])] }, new Map([[136, anm(1, 1, [frame(0, 0, 1, 1, [bitmapCmd(0)])])]]));
    const pc = part(136, 0, 4, 1, 1);
    pc.fFC = 0x41;
    const dark = new S(30, 10);
    draw(dark, fa, pc);
    expect(dark.pixels[6 * 30 + 17]).toBe(0);
    pc.f24 = 1;
    const lit = new S(30, 10);
    draw(lit, fa, pc);
    // Centré sur (18, 7) : coin en (17, 6).
    expect([lit.pixels[6 * 30 + 17], lit.pixels[7 * 30 + 18]]).toEqual([mapColor(0x14), mapColor(0x14)]);
  });
});
