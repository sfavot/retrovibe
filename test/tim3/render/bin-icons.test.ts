import { describe, expect, it } from "vitest";
import { BIN_ORDER } from "../../../src/games/tim3/data/tables/bin-order";
import { RenderAssets, SCREEN_HEIGHT, SCREEN_WIDTH, Surface, binLayout, drawBinOverlay } from "../../../src/games/tim3/render";
import { frenchIndex, original } from "../data/real";
import { realWorld } from "../engine/helpers";

/** Types de pièces du jeu : une icône par type dans `ICONS1.BMP` … `ICONS10.BMP` (4171c9). */
const TYPE_COUNT = 281;

describe.skipIf(!original.has)("icônes du bac (4171c9)", () => {
  const assets = new RenderAssets(frenchIndex());

  it("les dix fichiers ICONS donnent 281 images, une par type", () => {
    let n = 0;
    for (let i = 1; i <= 10; i++) n += assets.bitmap(`ICONS${i}.BMP`)!.frames.length;
    expect(n).toBe(TYPE_COUNT);
  });

  it("chaque type possible au bac a une icône non vide, y compris la courroie 8 (sans image dans PART8.ANM), la corde 49 et le type 127 (sans ANM)", () => {
    const types = new Set<number>([...Array.from({ length: TYPE_COUNT }, (_, t) => t), ...BIN_ORDER]);
    const empty = [...types].filter((t) => {
      const icon = assets.binIcon(t);
      return !icon || icon.width === 0 || icon.height === 0 || !icon.pixels.some((v) => v !== 0);
    });
    expect(empty).toEqual([]);
    expect([8, 49, 127].map((t) => assets.binIcon(t) !== null)).toEqual([true, true, true]);
  });

  it("TLEV3 (« Gears and Belts ») : tapis, courroie et engrenages dessinés dans leur case, avec leur nombre", () => {
    const world = realWorld("TLEV3");
    expect(world.bin.toArray().map((p) => p.type)).toEqual([5, 8, 14, 14, 14, 14, 86, 86]);
    const layout = binLayout(assets, world.bin.toArray(), 0);
    expect(layout.slots.map((s) => [s.type, s.parts.length])).toEqual([
      [5, 1],
      [8, 1],
      [14, 4],
      [86, 2],
    ]);
    const screen = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
    drawBinOverlay(screen, assets, { layout, running: false });
    for (const s of layout.slots) {
      const icon = assets.binIcon(s.type)!;
      // Case = icône + 4, + 12 pour le nombre.
      expect(s.height).toBe(icon.height + 16);
      // Icône centrée à 2 pixels du haut de la case : ses pixels (hors des 3 dernières lignes, sous le nombre) sont à l'écran.
      const ox = s.x + ((s.width - icon.width) >> 1);
      const oy = s.y + 2;
      let drawn = 0;
      let expected = 0;
      for (let y = 0; y < icon.height - 3; y++)
        for (let x = 0; x < icon.width; x++) {
          const v = icon.pixels[y * icon.width + x]!;
          if (!v) continue;
          expected++;
          if (screen.pixels[(oy + y) * SCREEN_WIDTH + ox + x] === v) drawn++;
        }
      expect(expected, `type ${s.type}`).toBeGreaterThan(0);
      expect(drawn, `type ${s.type}`).toBe(expected);
      // Le nombre, en couleur 20 (0x14 par 413388), sous l'icône.
      let ink = 0;
      for (let y = oy + icon.height - 3; y < s.y + s.height; y++) for (let x = ox; x < ox + icon.width; x++) if (screen.pixels[y * SCREEN_WIDTH + x] === 20) ink++;
      expect(ink, `nombre du type ${s.type}`).toBeGreaterThan(0);
    }
    // Sans nombre (palette illimitée) : les cases rétrécissent de 12.
    const bare = binLayout(assets, world.bin.toArray(), 0, false);
    expect(bare.slots.map((s) => s.height)).toEqual(layout.slots.map((s) => s.height - 12));
  });
});
