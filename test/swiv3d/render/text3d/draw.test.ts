import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseBd } from "../../../../src/games/swiv3d/data/bd";
import { parseGlobal } from "../../../../src/games/swiv3d/data/global";
import { radarColorTable } from "../../../../src/games/swiv3d/render/hud";
import { createText3d, MessagePool } from "../../../../src/games/swiv3d/render/text3d";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../../src/games/swiv3d/render/view";
import { hasOriginalFiles, readOriginal } from "../../helpers";

const SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;
const hash = (pixels: Uint8Array): string => createHash("sha1").update(pixels).digest("hex");
const text = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe.skipIf(!hasOriginalFiles)("texte 3D (fichiers du jeu)", () => {
  const global = parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
  // Table de couleurs du niveau (bloc 11003 + 0x300) : `colors[teinte + lumière]` donne l'indice de palette.
  const colors = radarColorTable(parseBd(readOriginal("TERRAN00.SLV"), "TERRAN00").get(11003));
  const t3 = createText3d({ font: global.vectorFont, glyphIndex: (c) => global.font.glyphIndex(c, 0), colors });

  /** Message figé au centre (type 10 après 80 ticks), à `ticks` ticks de plus. */
  function held(message: string, tint: number, extra = 0): Uint8Array {
    const pool = new MessagePool();
    pool.spawn(text(message), tint, 10);
    for (let i = 0; i < 80 + extra; i++) pool.tick();
    const fb = new Uint8Array(SIZE);
    t3.draw(fb, pool);
    return fb;
  }
  const bounds = (fb: Uint8Array) => {
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let i = 0; i < SIZE; i++) if (fb[i] !== 0) {
      const x = i % SCREEN_WIDTH, y = Math.floor(i / SCREEN_WIDTH);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0, x1, y0, y1 };
  };

  it("dessine des lettres extrudées centrées, de façon déterministe", () => {
    const fb = held("Game over !", 0x1000);
    const b = bounds(fb);
    expect(b.x1 - b.x0).toBeGreaterThan(150);
    expect((b.x0 + b.x1) / 2).toBeGreaterThan(130);
    expect((b.x0 + b.x1) / 2).toBeLessThan(190);
    expect(b.y1 - b.y0).toBeGreaterThan(15);
    expect(hash(fb)).toBe(hash(held("Game over !", 0x1000)));
  });

  it("la teinte choisit la ligne de la table de couleurs, la lumière varie sur les faces", () => {
    const red = held("OO", 0x1000);
    const blue = held("OO", 0x100);
    const palette = (fb: Uint8Array) => new Set(fb.filter((v) => v !== 0));
    expect(palette(red).size).toBeGreaterThan(1);
    expect(hash(red)).not.toBe(hash(blue));
    for (const v of palette(red)) expect(Array.from({ length: 128 }, (_, l) => colors[0x1000 + l]).includes(v)).toBe(true);
    for (const v of palette(blue)) expect(Array.from({ length: 128 }, (_, l) => colors[0x100 + l]).includes(v)).toBe(true);
  });

  it("une chaîne à deux lignes (`|`) occupe plus de hauteur qu'une seule", () => {
    const one = bounds(held("Objectif", 0x1400));
    const two = bounds(held("Objectif|Accompli", 0x1400));
    expect(two.y1 - two.y0).toBeGreaterThan((one.y1 - one.y0) * 1.5);
  });

  it("n'écrit rien pour un texte vide ou sans glyphe, et jamais hors de l'image", () => {
    expect(held("", 0x1000).some((v) => v !== 0)).toBe(false);
    expect(held(" - ' ", 0x1000).some((v) => v !== 0)).toBe(false);
    const guard = 4096;
    const buffer = new Uint8Array(SIZE + guard);
    const pool = new MessagePool();
    pool.spawn(text("Missiles Module de verrouillage"), 0x1000, 0);
    for (let i = 0; i < 80; i++) {
      t3.draw(buffer.subarray(0, SIZE), pool);
      pool.tick();
    }
    expect(buffer.subarray(SIZE).every((v) => v === 0)).toBe(true);
  });

  it("le message de type 0 traverse l'écran puis disparaît", () => {
    const pool = new MessagePool();
    pool.spawn(text("Power Up"), 0x400, 0);
    const seen: boolean[] = [];
    for (let i = 0; i < 75; i++) {
      const fb = new Uint8Array(SIZE);
      t3.draw(fb, pool);
      seen.push(fb.some((v) => v !== 0));
      pool.tick();
    }
    expect(seen.slice(20, 66).every(Boolean)).toBe(true);
    expect(seen.slice(72).some(Boolean)).toBe(false);
  });
});
