import { describe, expect, it } from "vitest";
import { RenderAssets, SCREEN_HEIGHT, SCREEN_WIDTH, Surface, drawBinOverlay, type BinLayout } from "../../../src/games/tim3/render";
import { drawAnmImage, imageFrame } from "../../../src/games/tim3/render/anm-draw";
import { BIN_PANEL } from "../../../src/games/tim3/render/screen";
import { frenchIndex, original } from "../data/real";

/** Bac sans case, défilement donné ; le panneau de `PARTSBIN.ANM` dessiné dessous comme à l'écran. */
function render(assets: RenderAssets, scroll: number, maxScroll: number): Surface {
  const s = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  drawAnmImage(s, assets, assets.anm("PARTSBIN.ANM")!, 1, 0, BIN_PANEL.y);
  const layout = { slots: [], scroll, maxScroll, columns: [8], count: 0 } as unknown as BinLayout;
  drawBinOverlay(s, assets, { layout, running: false });
  return s;
}

describe.skipIf(!original.has)("flèches du bac (PARTSBIN.ANM, états 5 et 6)", () => {
  const assets = new RenderAssets(frenchIndex());
  const anm = assets.anm("PARTSBIN.ANM")!;
  // Image 0 de l'état 5 (flèche de gauche) et de l'état 6 (droite) : 10 et 13.
  const left = imageFrame(anm, 10)!;
  const right = imageFrame(anm, 13)!;
  /** Pixels de l'image seule de la flèche (sans le panneau). */
  const arrowPixels = (image: number, f: typeof left): { x: number; y: number }[] => {
    const only = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
    drawAnmImage(only, assets, anm, image, 0, BIN_PANEL.y);
    const out: { x: number; y: number }[] = [];
    for (let y = f.y + BIN_PANEL.y; y < f.y + BIN_PANEL.y + f.height; y++) for (let x = f.x; x < f.x + f.width; x++) if (only.pixels[y * SCREEN_WIDTH + x]) out.push({ x, y });
    return out;
  };

  it("l'ANM n'a pas d'image « inactive » : l'image 0 de chaque état est la flèche normale, les suivantes la flèche enfoncée", () => {
    expect(left.commands.find((c) => c.op === "bitmap")).toMatchObject({ frame: 15 });
    expect(imageFrame(anm, 11)!.commands.find((c) => c.op === "bitmap")).toMatchObject({ frame: 16 });
    expect(right.commands.find((c) => c.op === "bitmap")).toMatchObject({ frame: 17 });
  });

  it("une flèche inactive est atténuée (fadeTable) pixel par pixel ; le fond du panneau autour ne change pas", () => {
    const fade = assets.fadeTable();
    const active = render(assets, 50, 100);
    for (const [scroll, max, image, f] of [[0, 100, 10, left], [100, 100, 13, right]] as const) {
      const s = render(assets, scroll, max);
      const pixels = arrowPixels(image, f);
      expect(pixels.length).toBeGreaterThan(100);
      for (const { x, y } of pixels) expect(s.pixels[y * SCREEN_WIDTH + x]).toBe(fade[active.pixels[y * SCREEN_WIDTH + x]!]);
      // Clairement distincte : la plupart des pixels changent de couleur.
      const changed = pixels.filter(({ x, y }) => s.pixels[y * SCREEN_WIDTH + x] !== active.pixels[y * SCREEN_WIDTH + x]).length;
      expect(changed / pixels.length).toBeGreaterThan(0.8);
      // Hors de la flèche, rien ne change.
      const inArrow = new Set(pixels.map(({ x, y }) => y * SCREEN_WIDTH + x));
      const other = image === 10 ? arrowPixels(13, right) : arrowPixels(10, left);
      for (const p of other) inArrow.add(p.y * SCREEN_WIDTH + p.x);
      let outside = 0;
      for (let i = 0; i < s.pixels.length; i++) if (!inArrow.has(i) && s.pixels[i] !== active.pixels[i]) outside++;
      expect(outside).toBe(0);
    }
  });

  it("tout tient (rien à défiler) : les deux flèches sont atténuées", () => {
    const s = render(assets, 0, 0);
    const active = render(assets, 50, 100);
    const fade = assets.fadeTable();
    for (const [image, f] of [[10, left], [13, right]] as const) for (const { x, y } of arrowPixels(image, f)) expect(s.pixels[y * SCREEN_WIDTH + x]).toBe(fade[active.pixels[y * SCREEN_WIDTH + x]!]);
  });
});
