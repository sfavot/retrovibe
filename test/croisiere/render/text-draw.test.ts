/**
 * Mise en forme des textes (`font.cpp::renderText`) et pose des messages et menus (`mainDraw.cpp::drawMessage`, `drawMenu`), sur
 * `SYSTEM.FNT` (interligne 15 : glyphes de 13 lignes, espacements −1). Le rendu complet est vérifié contre le banc dans
 * `screen-bench.test.ts` ; ici, les cas limites que l'intro n'atteint pas.
 */
import { describe, expect, it } from "vitest";
import { drawMenu, drawMessage, type MenuView } from "../../../src/games/croisiere/render/draw";
import { fontFromFile, renderTextWith, type TextGfx } from "../../../src/games/croisiere/render/text";
import type { EngineState } from "../../../src/games/croisiere/engine/state";
import { DisplayState } from "../../../src/games/croisiere/engine/display";
import { original } from "../engine/support";

const hasFont = original.has && original.list((n) => n === "SYSTEM.FNT").length === 1;

describe.skipIf(!hasFont)("textes et menus", () => {
  const font = () => fontFromFile(new Uint8Array(original.read("SYSTEM.FNT")));

  it("rend une ligne centrée sur la largeur demandée, ou rien pour une chaîne vide", () => {
    expect(renderTextWith(font(), 160, "")).toBeNull();
    const gfx = renderTextWith(font(), 160, "Livre")!;
    expect([gfx.width, gfx.height]).toEqual([162, 15]);
    const columns = [...gfx.pixels.keys()].filter((i) => gfx.pixels[i]).map((i) => i % gfx.width);
    const left = Math.min(...columns);
    const right = gfx.width - 1 - Math.max(...columns);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(3);
  });

  it("coupe aux espaces, passe à la ligne sur « | » et borne la largeur à 310", () => {
    expect(renderTextWith(font(), 160, "un|deux|trois")!.height).toBe(3 * 14 + 1);
    const long = renderTextWith(font(), 60, "mot mot mot mot mot mot")!;
    expect(long.height).toBeGreaterThan(15);
    expect(renderTextWith(font(), 400, "x")!.width).toBe(312);
  });

  it("recadre un message dans l'écran (bas à 198, droite à 319)", () => {
    const gfx: TextGfx = { width: 4, height: 2, pixels: Uint8Array.from([2, 1, 0, 2, 2, 2, 2, 2]) };
    const out = new Uint8Array(64000);
    drawMessage(gfx, 400, 250, 4, 7, out);
    const at = (x: number, y: number) => out[y * 320 + x];
    // x = 319 − 4 = 315 ; y = 198 − 2 = 196
    expect([at(315, 196), at(316, 196), at(317, 196), at(318, 196)]).toEqual([7, 0, 0, 7]);
    expect([at(315, 197), at(318, 197)]).toEqual([7, 7]);
  });

  it("répartit un long menu en colonnes de 160 pixels, en haut de l'écran", () => {
    const line: TextGfx = { width: 162, height: 15, pixels: new Uint8Array(162 * 15) };
    const elements = Array.from({ length: 13 }, () => ({ x: 0, y: 0, selected: false, color: -1, gfx: line }));
    const menu: MenuView = { x: 250, y: 100, gfx: line, elements };
    const e = { display: new DisplayState() } as unknown as EngineState;
    drawMenu(e, menu, new Uint8Array(64000));
    // (199 − 30) / 15 = 11 entrées par colonne → 2 colonnes, x ramené à 0, y = hline
    expect(elements.map((el) => [el.x, el.y]).slice(9)).toEqual([[0, 150], [0, 165], [160, 15], [160, 30]]);
  });
});
