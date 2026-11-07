import { describe, expect, it } from "vitest";
import type { Shape } from "../../src/data/mohawk/shap";
import { TRAIL_FULL, TRAIL_STARTS, TRAIL_STEP, TrailColoring, trailColors, trailStartIndex } from "../../src/games/zoombinis/scenes/xfer-trail";

/** Un trait horizontal de `n` pixels (indice 1) avec une bordure d'indice 2 en dessous. */
function line(n: number): Shape {
  const width = n;
  const height = 3;
  const pixels = new Uint8Array(width * height);
  for (let x = 0; x < n; x++) {
    pixels[width + x] = 1;
    pixels[2 * width + x] = 2;
  }
  return { width, height, pitch: width, flags: 0, bitsPerPixel: 8, pixels, consumed: 0 } as unknown as Shape;
}

describe("trait du trajet des transitions (11b0:24ed, 1fcd, 214d, 2350)", () => {
  it("couleurs avant / après selon le niveau atteint (ad2e), points de départ de DS:4220", () => {
    expect(trailColors(1)).toEqual([0x2e, 0x2f, 0x30, 0x31]);
    expect(trailColors(0)).toEqual([0x2e, 0x2f, 0x30, 0x31]);
    expect(trailColors(2)).toEqual([0x30, 0x31, 0x32, 0x33]);
    expect(trailColors(4)).toEqual([0x34, 0x35, 0x36, 0x37]);
    expect(TRAIL_STARTS).toHaveLength(16);
    expect(TRAIL_STARTS[1]).toEqual([130, 146]);
    expect(trailStartIndex(1, 2)).toBe(1);
    expect(trailStartIndex(1, 0)).toBe(0);
    expect(trailStartIndex(4, 4)).toBe(15);
  });

  it("premier dessin : le trait noir (1, 2) passe aux couleurs « avant », puis il se colore depuis le départ, 7 ‰ du trait par dessin", () => {
    const source = line(100);
    const trail = new TrailColoring(source, [0, 1], 1);
    trail.step();
    expect(trail.count).toBe(200);
    expect(trail.left).toBe(200);
    const px = trail.shape.pixels;
    expect(px.filter((p) => p === 0x2e)).toHaveLength(100);
    expect(px.filter((p) => p === 0x2f)).toHaveLength(100);
    // L'image source n'est pas modifiée (le port travaille sur une copie).
    expect(source.pixels.filter((p) => p === 1)).toHaveLength(100);
    const after = () => px.filter((p) => p === 0x30 || p === 0x31).length;
    let previous = 0;
    for (let k = 1; k * TRAIL_STEP < TRAIL_FULL; k++) {
      trail.step();
      const done = after();
      expect(done).toBeGreaterThanOrEqual(previous);
      expect(done).toBeGreaterThanOrEqual(Math.floor((200 * k * TRAIL_STEP) / TRAIL_FULL) - 1);
      previous = done;
    }
    // Le remplissage part du point de départ (à gauche) ; au milieu du trait, rien n'est encore coloré. (Le voisin d'abscisse −1 est, comme dans
    // l'original, le dernier pixel de la ligne précédente : le bout droit de la ligne du dessous se colore aussi tôt.)
    const trail2 = new TrailColoring(line(100), [0, 1], 1);
    for (let k = 0; k < 40; k++) trail2.step();
    const row = trail2.shape.pixels.subarray(100, 200);
    expect(row[0]).toBe(0x30);
    expect(row[50]).toBe(0x2e);
  });
});
