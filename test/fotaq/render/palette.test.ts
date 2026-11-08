import { describe, expect, it } from "vitest";
import { type RoomLight, MASK_SIZE } from "../../../src/games/fotaq/data/dynalum";
import { FADE_SPEED, FADE_TICKS, Palette, backdropColors, colorsForRoom, fadingDisabled } from "../../../src/games/fotaq/render/palette";

/** Palette de fichier : la couleur `i` vaut `(i, i / 2, 255 - i)`. */
function gradient(): Uint8Array {
  const pal = new Uint8Array(768);
  for (let i = 0; i < 256; i++) pal.set([i, i >> 1, 255 - i], i * 3);
  return pal;
}
const color = (pal: Uint8Array, i: number): number[] => Array.from(pal.subarray(i * 3, i * 3 + 3));
const joe = { active: true, x: 10, y: 10 };

describe("choix des couleurs par pièce (getNumColorsForRoom, isPalFadingDisabled)", () => {
  it("224 couleurs, 256 pour les pièces 114 à 125 ; pas de fondu dans les pièces d'introduction", () => {
    expect(colorsForRoom(1)).toBe(224);
    expect(colorsForRoom(113)).toBe(224);
    expect(colorsForRoom(114)).toBe(256);
    expect(colorsForRoom(125)).toBe(256);
    expect(colorsForRoom(126)).toBe(224);
    expect(backdropColors(7)).toBe(144);
    expect(backdropColors(120)).toBe(256);
    for (const room of [90, 94, 115, 125]) expect(fadingDisabled(room), `${room}`).toBe(true);
    for (const room of [1, 89, 95, 114, 126]) expect(fadingDisabled(room), `${room}`).toBe(false);
  });
});

describe("palette de la pièce, du panneau et de Joe", () => {
  it("les couleurs 0 à 143 viennent du décor, 144 à 255 du panneau", () => {
    const palette = new Palette();
    const panel = new Uint8Array(768).map((_, i) => 255 - (i % 251));
    palette.setPanelColors(panel);
    palette.setupRoom(gradient(), 7, null, 640);
    expect(color(palette.room, 0)).toEqual([0, 0, 255]);
    expect(color(palette.room, 143)).toEqual([143, 71, 112]);
    expect(Array.from(palette.room.subarray(144 * 3))).toEqual(Array.from(panel.subarray(144 * 3)));
    expect(Array.from(palette.screen.subarray(144 * 3))).toEqual(Array.from(panel.subarray(144 * 3)));
  });

  it("une pièce à 256 couleurs prend tout le décor ; `useBasePanel` remet le panneau", () => {
    const palette = new Palette();
    const panel = new Uint8Array(768).fill(9);
    palette.setPanelColors(panel);
    palette.setupRoom(gradient(), 120, null, 320);
    expect(color(palette.room, 200)).toEqual([200, 100, 55]);
    palette.useBasePanel();
    expect(color(palette.room, 200)).toEqual([9, 9, 9]);
  });

  it("tenues : 16 couleurs de Joe (144 à 159) dans la palette de la pièce et de l'écran", () => {
    const palette = new Palette();
    palette.setJoeDress();
    expect(color(palette.room, 144)).toEqual([0, 0, 0]);
    expect(color(palette.room, 149)).toEqual([0xff, 0xff, 0xff]);
    expect(color(palette.screen, 150)).toEqual([0x30, 0x30, 0x90]);
    palette.setJoeNormal();
    expect(color(palette.room, 149)).toEqual([0x43, 0x34, 0x20]);
    expect(color(palette.screen, 159)).toEqual([0x98, 0xd4, 0xff]);
    expect(color(palette.room, 160)).toEqual([0, 0, 0]);
  });

  it("pièces 28 à 31 : les couleurs 72 à 83 changent de teinte (palCustomColors), 28 lit le vert pour le bleu", () => {
    const base = gradient();
    const expected = (room: number): number[] => {
      const palette = new Palette();
      palette.setupRoom(base, room, null, 320);
      return color(palette.room, 80);
    };
    expect(color(base, 80)).toEqual([80, 40, 175]);
    expect(expected(31)).toEqual([80, 36, 122]);
    expect(expected(29)).toEqual([80, 24, 105]);
    expect(expected(30)).toEqual([48, 32, 175]);
    expect(expected(28)).toEqual([64, 40, 24]);
    expect(expected(27)).toEqual([80, 40, 175]);
  });
});

describe("lumière dynamique (dynalumUpdate)", () => {
  /** Masque dont chaque cellule vaut le numéro de sa colonne modulo 8, table : ligne r = (r, -r, 2r). */
  function light(): RoomLight {
    const mask = new Uint8Array(MASK_SIZE).map((_, i) => (i % 160) % 8);
    const table = new Int8Array(24);
    for (let r = 0; r < 8; r++) table.set([r, -r, 2 * r], r * 3);
    return { mask, table };
  }

  it("ajoute `triplet x 4` aux couleurs 144 à 159 de l'écran, bornées à 0..255", () => {
    const palette = new Palette();
    palette.setJoeNormal();
    palette.setupRoom(gradient(), 7, light(), 640);
    palette.dynalumUpdate(3 * 4, 0); // cellule 3 : (3, -3, 6)
    expect(color(palette.screen, 144)).toEqual([12, 0, 24]);
    expect(color(palette.screen, 148)).toEqual([0xda + 12, 0xda - 12, 0xda + 24]);
    expect(color(palette.room, 148)).toEqual([0xda, 0xda, 0xda]);
    expect(color(palette.screen, 160)).toEqual(color(palette.room, 160));
  });

  it("ne recalcule que si la cellule change de ligne ; position bornée au décor et à 149", () => {
    const palette = new Palette();
    palette.setJoeNormal();
    palette.setupRoom(gradient(), 7, light(), 640);
    palette.dynalumUpdate(4, 0);
    const first = palette.screen.slice();
    palette.screen[145 * 3] = 99;
    palette.dynalumUpdate(4, 0);
    expect(palette.screen[145 * 3]).toBe(99); // même ligne : pas de recalcul
    palette.dynalumUpdate(5000, 5000); // borné : x = 640, y = 149 -> cellule (160 + (149 >> 2) * 160) lue dans la ligne suivante
    expect(palette.screen).not.toEqual(first);
  });

  it("une ligne hors de la table (masque de T6) laisse la palette", () => {
    const palette = new Palette();
    const odd = light();
    odd.mask.fill(255);
    palette.setJoeNormal();
    palette.setupRoom(gradient(), 7, odd, 640);
    const before = palette.screen.slice();
    palette.dynalumUpdate(40, 40);
    expect(palette.screen).toEqual(before);
  });

  it("sans lumière, rien ne change", () => {
    const palette = new Palette();
    palette.setupRoom(gradient(), 7, null, 640);
    expect(palette.hasLight).toBe(false);
    const before = palette.screen.slice();
    palette.dynalumUpdate(40, 40);
    expect(palette.screen).toEqual(before);
  });
});

describe("fondus (palFadeIn, palFadeOut)", () => {
  it("fondu d'entrée : la palette montrée est celle de l'écran x niveau / 16 sur les 224 premières couleurs", () => {
    const palette = new Palette();
    palette.setupRoom(gradient(), 7, null, 640);
    expect(palette.beginFadeIn(7, joe)).toEqual({ colors: 224, fades: true });
    expect(color(palette.shown, 100)).toEqual([0, 0, 0]);
    palette.setFadeIn((1 * FADE_SPEED) / FADE_TICKS);
    expect(color(palette.shown, 100)).toEqual([Math.trunc((100 * 4) / 16), Math.trunc((50 * 4) / 16), Math.trunc((155 * 4) / 16)]);
    // Les couleurs du panneau (224 à 255) ne sont pas dans le fondu.
    expect(color(palette.shown, 230)).toEqual(color(palette.screen, 230));
    palette.setFadeIn(FADE_SPEED);
    expect(palette.shown).toEqual(palette.screen);
    palette.endFadeIn();
    expect(palette.shown).toEqual(palette.screen);
    expect(color(palette.screen, 100)).toEqual(color(palette.room, 100));
  });

  it("fondu de sortie : la palette de l'écran descend à zéro par pas de départ x niveau / 16, les couleurs 224 à 255 restent", () => {
    const palette = new Palette();
    palette.setupRoom(gradient(), 7, null, 640);
    palette.beginFadeIn(7, joe);
    palette.endFadeIn();
    const { colors, from } = palette.beginFadeOut(7);
    expect(colors).toBe(224);
    expect(palette.scrollable).toBe(false);
    palette.setFadeOut(colors, from!, 8);
    expect(color(palette.shown, 100)).toEqual([50, 25, 77]);
    palette.setFadeOut(colors, from!, 0);
    expect(palette.shown.subarray(0, 224 * 3).every((v) => v === 0)).toBe(true);
    expect(color(palette.shown, 230)).toEqual(color(palette.panel, 230 - 144)); // le texte du panneau reste visible
  });

  it("pièces d'introduction : pas de fondu, l'écran devient noir tout de suite, la palette est reprise telle quelle", () => {
    const palette = new Palette();
    palette.setupRoom(gradient(), 120, null, 320);
    expect(palette.beginFadeIn(120, joe)).toEqual({ colors: 256, fades: false });
    expect(palette.shown).toEqual(palette.room);
    const out = palette.beginFadeOut(120);
    expect(out.from).toBeNull();
    expect(palette.shown.every((v) => v === 0)).toBe(true);
  });

  it("la lumière dynamique est appliquée à l'entrée de la pièce, d'après Joe", () => {
    const palette = new Palette();
    const table = new Int8Array(24);
    table.set([1, 1, 1], 3);
    palette.setJoeNormal();
    palette.setupRoom(gradient(), 7, { mask: new Uint8Array(MASK_SIZE).fill(1), table }, 640);
    palette.beginFadeIn(7, joe);
    expect(color(palette.screen, 144)).toEqual([4, 4, 4]);
    palette.beginFadeIn(7, { active: false, x: 0, y: 0 });
    expect(color(palette.screen, 144)).toEqual([0, 0, 0]);
  });
});

describe("couleurs qui tournent, panneau gris, éclair, pièces éteintes", () => {
  it("scroll : les couleurs avancent d'un cran, la dernière revient au début", () => {
    const palette = new Palette();
    palette.screen.set(gradient());
    palette.scroll(10, 12);
    expect([color(palette.screen, 10), color(palette.screen, 11), color(palette.screen, 12)]).toEqual([color(gradient(), 12), color(gradient(), 10), color(gradient(), 11)]);
    expect(color(palette.screen, 13)).toEqual(color(gradient(), 13));
    expect(color(palette.screen, 9)).toEqual(color(gradient(), 9));
  });

  it("cycle : la pièce 25 tourne à chaque image, la pièce 2 une image sur deux ; les autres pièces et `scrollable` faux : rien", () => {
    const base = gradient();
    const fresh = (): Palette => {
      const palette = new Palette();
      palette.screen.set(base);
      return palette;
    };
    const p25 = fresh();
    p25.cycle(25);
    expect(color(p25.screen, 116)).toEqual(color(base, 123));
    const p2 = fresh();
    p2.cycle(2); // compteur 1 : tourne
    expect(color(p2.screen, 120)).toEqual(color(base, 127));
    p2.cycle(2); // compteur 2 : ne tourne pas
    expect(color(p2.screen, 120)).toEqual(color(base, 127));
    const other = fresh();
    other.cycle(1);
    expect(other.screen).toEqual(base);
    const frozen = fresh();
    frozen.scrollable = false;
    frozen.cycle(25);
    expect(frozen.screen).toEqual(base);
  });

  it("pièce 123 : les couleurs 96 à 110 virent au rouge par pas de 2, puis reviennent", () => {
    const palette = new Palette();
    palette.room.set(gradient());
    palette.screen.set(gradient());
    palette.cycle(123); // j = 0 appliqué, puis j = 2
    expect(color(palette.screen, 100)).toEqual([100, 50, 155]);
    palette.cycle(123); // j = 2
    expect(color(palette.screen, 100)).toEqual([116, 58, 155]);
  });

  it("panneau gris pendant une scène : couleurs 224 à 255 = composante verte x 2 / 3 ; effacé à la fin de la scène", () => {
    const palette = new Palette();
    palette.screen.set(gradient());
    palette.greyPanel();
    const grey = Math.trunc((127 * 2) / 3);
    expect(color(palette.shown, 254)).toEqual([grey, grey, grey]);
    expect(color(palette.shown, 100)).toEqual(color(palette.screen, 100));
    palette.clearGrey();
    expect(palette.shown).toEqual(palette.screen);
  });

  it("éclair : blanc, noir de 17 à 66, blanc", () => {
    const palette = new Palette();
    palette.screen.set(gradient());
    palette.flash(true);
    expect(color(palette.shown, 5)).toEqual([255, 255, 255]);
    expect(color(palette.shown, 17)).toEqual([0, 0, 0]);
    expect(color(palette.shown, 66)).toEqual([0, 0, 0]);
    expect(color(palette.shown, 67)).toEqual([255, 255, 255]);
    palette.flash(false);
    expect(palette.shown).toEqual(palette.screen);
  });

  it("pièce sans lumière : couleurs 16 à 223 noires (32 à 223 dans le hall 103), puis la palette de la pièce revient", () => {
    const palette = new Palette();
    palette.room.set(gradient());
    palette.screen.set(gradient());
    palette.lightsOff(7);
    expect(color(palette.screen, 15)).toEqual(color(gradient(), 15));
    expect(color(palette.screen, 16)).toEqual([0, 0, 0]);
    expect(color(palette.screen, 224)).toEqual(color(gradient(), 224));
    expect(palette.scrollable).toBe(false);
    palette.lightsOn(7);
    expect(palette.screen).toEqual(gradient());
    palette.lightsOff(103);
    expect(color(palette.screen, 31)).toEqual(color(gradient(), 31));
    expect(color(palette.screen, 32)).toEqual([0, 0, 0]);
  });
});
