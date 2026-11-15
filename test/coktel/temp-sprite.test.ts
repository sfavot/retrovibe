import { describe, expect, it, vi } from "vitest";
import { fromBase64, slotKey, toBase64 } from "../../src/engine/coktel/saves/encoding";
import { PALETTE_BYTES, TempSpriteHandler, type SaveGraphics } from "../../src/engine/coktel/saves/temp-sprite";

function setup() {
  const sprites = Array.from({ length: 100 }, () => null) as ({ width: number; height: number; pixels: Uint8Array } | null)[];
  sprites[3] = { width: 4, height: 2, pixels: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) };
  sprites[20] = { width: 4, height: 2, pixels: new Uint8Array(8) };
  sprites[21] = { width: 2, height: 4, pixels: new Uint8Array(8) };
  const wanted = new Uint8Array(PALETTE_BYTES).fill(9);
  const gfx: SaveGraphics = {
    core: { wanted, setFullPalette: vi.fn(), touch: vi.fn() },
    draw: { sprites, forceBlit: vi.fn() },
  };
  return { gfx, sprites, wanted, handler: new TempSpriteHandler(gfx) };
}

describe("TempSpriteHandler", () => {
  it("decode l'index de sprite d'une taille négative", () => {
    expect(TempSpriteHandler.spriteIndex(-1)).toBe(0);
    expect(TempSpriteHandler.spriteIndex(-4)).toBe(3);
    expect(TempSpriteHandler.spriteIndex(-1004)).toBe(3);
    expect(TempSpriteHandler.spriteIndex(-4004)).toBe(3);
  });

  it("est absent tant qu'aucun sprite n'est écrit, sans écran il le reste", () => {
    const { handler } = setup();
    expect(handler.getSize()).toBe(-1);
    expect(handler.load(-4)).toBe(false);
    const none = new TempSpriteHandler(null);
    expect(none.save(-4)).toBe(false);
    expect(none.getSize()).toBe(-1);
  });

  it("taille nulle : succès sans effet", () => {
    const { handler } = setup();
    expect(handler.save(0)).toBe(true);
    expect(handler.load(0)).toBe(true);
    expect(handler.getSize()).toBe(-1);
  });

  it("refuse un sprite inexistant ou hors bornes", () => {
    const { handler } = setup();
    expect(handler.save(-5)).toBe(false);
    expect(handler.save(-101)).toBe(false);
    expect(handler.save(5)).toBe(false);
  });

  it("aller-retour des pixels, taille du fichier 9 + pixels + 768", () => {
    const { handler, sprites } = setup();
    expect(handler.save(-4)).toBe(true);
    expect(handler.getSize()).toBe(9 + 8 + PALETTE_BYTES);
    sprites[3]!.pixels.fill(0);
    expect(handler.load(-4)).toBe(true);
    expect([...sprites[3]!.pixels]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("palette seulement sous -1000, et même nombre de pixels exigé", () => {
    const { handler, gfx, wanted, sprites } = setup();
    expect(handler.save(-1004)).toBe(true);
    wanted.fill(0);
    expect(handler.load(-1004)).toBe(true);
    expect(wanted[0]).toBe(9);
    expect(gfx.core.setFullPalette).toHaveBeenCalledTimes(1);
    handler.load(-4);
    expect(gfx.core.setFullPalette).toHaveBeenCalledTimes(1);
    sprites[3] = { width: 3, height: 2, pixels: new Uint8Array(6) };
    expect(handler.load(-4)).toBe(false);
  });

  it("réaffiche les sprites 20 (écran) et 21 (fond)", () => {
    const { handler, gfx } = setup();
    expect(handler.save(-22)).toBe(true); // sprite 21
    expect(handler.load(-22)).toBe(true);
    expect(gfx.draw.forceBlit).toHaveBeenCalledTimes(1);
    expect(gfx.core.touch).not.toHaveBeenCalled();
    expect(handler.save(-21)).toBe(true); // sprite 20
    expect(handler.load(-21)).toBe(true);
    expect(gfx.core.touch).toHaveBeenCalledTimes(1);
  });
});

describe("encodage des sauvegardes", () => {
  it("base64 aller-retour, y compris au-delà d'une tranche", () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => i & 0xff);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(Uint8Array.from([72, 105]))).toBe("SGk=");
    expect(() => fromBase64("***")).toThrow();
  });

  it("clé d'emplacement sur deux chiffres", () => {
    expect(slotKey(3)).toBe("cat.s03");
    expect(slotKey(14)).toBe("cat.s14");
  });
});
