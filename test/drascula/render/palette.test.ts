import { describe, expect, it } from "vitest";
import { PALETTE_BYTES } from "../../../src/ui/indexed-canvas";
import { parseAlg } from "../../../src/games/drascula/data/alg";
import {
  COMPLETE_PAL,
  GamePalette,
  HALF_PAL,
  LIGHT_END,
  LIGHT_FIRST,
  TEXT_COLOR,
  TextColor,
  halfPalette,
  scummvmRgb6,
  scummvmRgb8,
} from "../../../src/games/drascula/render/palette";
import { hasOriginalFiles, readOriginal } from "../helpers";

/** Palette 8 bits dont la composante `i` vaut `(i * 7) % 256`. */
const ramp = (): Uint8Array => Uint8Array.from({ length: PALETTE_BYTES }, (_, i) => (i * 7) % 256);

describe("palette du jeu (6 bits)", () => {
  it("setRgb divise par 4 et n'applique que les premières couleurs (HALF_PAL : 128, par défaut : 1)", () => {
    const palette = new GamePalette();
    palette.setRgb(ramp(), HALF_PAL);
    expect(palette.game[3]).toBe((3 * 7) >> 2);
    expect(palette.game[HALF_PAL * 3 - 1]).toBe(((HALF_PAL * 3 - 1) * 7 % 256) >> 2);
    expect(palette.game[HALF_PAL * 3]).toBe(0);
    const one = new GamePalette();
    one.setRgb(ramp(), 1);
    expect(one.game[2]).toBe((2 * 7) >> 2);
    expect(one.game[3]).toBe(0);
    const all = new GamePalette();
    all.setRgb(ramp(), COMPLETE_PAL);
    expect(all.game[767]).toBe((767 * 7 % 256) >> 2);
  });

  it("l'écran reçoit la palette 6 bits x 4 : les deux bits de poids faible sont perdus", () => {
    const palette = new GamePalette();
    palette.setRgb(ramp(), COMPLETE_PAL);
    expect([...palette.shown]).toEqual([...scummvmRgb8(ramp())]);
  });

  it("couleur du texte : colorTable en 6 bits dans la couleur 254, rose tronqué à un octet", () => {
    const palette = new GamePalette();
    palette.setTextColor(TextColor.Red);
    expect([...palette.shown.subarray(TEXT_COLOR * 3, TEXT_COLOR * 3 + 3)]).toEqual([0x38 * 4, 0, 0]);
    palette.setTextColor(TextColor.Yellow);
    expect([...palette.shown.subarray(TEXT_COLOR * 3, TEXT_COLOR * 3 + 3)]).toEqual([0x3f * 4, 0x3f * 4, 0x15 * 4]);
    palette.setTextColor(TextColor.Pink);
    expect([...palette.shown.subarray(TEXT_COLOR * 3, TEXT_COLOR * 3 + 3)]).toEqual([136, 108, 144]);
    expect(palette.textColor).toBe(TextColor.Pink);
  });

  it("écran noir : tout à zéro sauf la couleur 254 jaune ; la palette du jeu reste", () => {
    const palette = new GamePalette();
    palette.setRgb(ramp(), COMPLETE_PAL);
    palette.black();
    expect(palette.shown.filter((v) => v !== 0)).toHaveLength(3);
    expect([...palette.shown.subarray(TEXT_COLOR * 3, TEXT_COLOR * 3 + 3)]).toEqual([252, 252, 84]);
    expect(palette.game[3]).toBe((3 * 7) >> 2);
    palette.show();
    expect(palette.shown[3]).toBe(((3 * 7) >> 2) * 4);
  });

  it("fondu : chaque composante perd 63 - niveau, jamais en dessous de zéro", () => {
    const palette = new GamePalette();
    palette.game.set([63, 40, 10, 0]);
    palette.fade(63);
    expect([...palette.shown.subarray(0, 4)]).toEqual([252, 160, 40, 0]);
    palette.fade(30);
    expect([...palette.shown.subarray(0, 4)]).toEqual([30 * 4, 7 * 4, 0, 0]);
    palette.fade(0);
    expect(palette.shown.every((v) => v === 0)).toBe(true);
    expect(palette.game[0]).toBe(63);
  });

  it("setPaletteBase retire 8 - fade à chaque passe, de darkness à 0, sans passer sous zéro", () => {
    const palette = new GamePalette();
    palette.game[LIGHT_FIRST * 3] = 40;
    palette.game[LIGHT_FIRST * 3 + 1] = 5;
    palette.game[LIGHT_FIRST * 3 + 2] = 63;
    palette.game[3] = 40; // hors de la lumière : intact
    palette.setBase(2);
    // 40 : -6, -7, -8 -> 19 ; 5 : tombe à 0 dès la première passe (5 - 8 + 2 < 0) et y reste ; 63 : 57, 50, 42
    expect([palette.game[LIGHT_FIRST * 3], palette.game[LIGHT_FIRST * 3 + 1], palette.game[LIGHT_FIRST * 3 + 2]]).toEqual([19, 0, 42]);
    expect(palette.game[3]).toBe(40);
    expect(palette.game[LIGHT_END * 3]).toBe(0);
  });

  it("niveaux d'une pièce : bright = niveau, dark = niveau + 2, la pièce démarre en bright", () => {
    const palette = new GamePalette();
    palette.game[LIGHT_FIRST * 3] = 40;
    palette.saveDefault();
    palette.setRoomLevel(0);
    expect(palette.bright[LIGHT_FIRST * 3]).toBe(40);
    expect(palette.dark[LIGHT_FIRST * 3]).toBe(19);
    expect(palette.game[LIGHT_FIRST * 3]).toBe(40);
    palette.setRoomLevel(1);
    expect(palette.bright[LIGHT_FIRST * 3]).toBe(25);
    expect(palette.dark[LIGHT_FIRST * 3]).toBe(14);
    expect(palette.game[LIGHT_FIRST * 3]).toBe(25);
    expect(palette.shown[LIGHT_FIRST * 3]).toBe(100);
    palette.useLight(palette.dark);
    expect(palette.game[LIGHT_FIRST * 3]).toBe(14);
  });
});

describe("palettes des fichiers", () => {
  it("ScummVM divise par 4 puis remultiplie par 4 (8 bits) ou multiplie par 4 (6 bits)", () => {
    expect([...scummvmRgb8(Uint8Array.of(255, 7, 130, 4))]).toEqual([252, 4, 128, 4]);
    expect([...scummvmRgb6(Uint8Array.of(63, 0, 32, 1))]).toEqual([252, 0, 128, 4]);
  });

  it("HALF_PAL garde les 128 premières couleurs de l'image et prend les 128 dernières à la palette de réserve", () => {
    const image = new Uint8Array(768).fill(1);
    const reserved = new Uint8Array(768).fill(2);
    const mixed = halfPalette(image, reserved);
    expect(mixed[128 * 3 - 1]).toBe(1);
    expect(mixed[128 * 3]).toBe(2);
    expect(mixed[767]).toBe(2);
    expect(image[767]).toBe(1);
  });
});

describe.skipIf(!hasOriginalFiles)("palettes des fichiers du jeu", () => {
  it("un décor en HALF_PAL laisse la réserve de 96.ALG : le héros garde ses couleurs", () => {
    const reserved = parseAlg(readOriginal("96.ALG"));
    const room = parseAlg(readOriginal("62.ALG"));
    const palette = new GamePalette();
    palette.setRgb(reserved.palette, COMPLETE_PAL);
    palette.setRgb(room.palette, HALF_PAL);
    expect([...palette.shown.subarray(0, HALF_PAL * 3)]).toEqual([...scummvmRgb8(room.palette).subarray(0, HALF_PAL * 3)]);
    expect([...palette.shown.subarray(HALF_PAL * 3)]).toEqual([...scummvmRgb8(reserved.palette).subarray(HALF_PAL * 3)]);
  });
});
