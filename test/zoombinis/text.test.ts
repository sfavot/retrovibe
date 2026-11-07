import { describe, expect, it, vi } from "vitest";
import { Surface } from "../../src/engine/mohawk/graphics/surface";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FONTS, installText, TextFlags, ZOOMBINIS_TEXT, ZoombinisText, TextStrings } from "../../src/games/zoombinis/engine/text";
import { ZOOMBINI_SCREEN_NAMES_STRL } from "../../src/games/zoombinis/data/archives";
import { emSize, thresholdAlpha } from "../../src/ui/mohawk/font-raster";
import { originalFiles } from "../support/original";
import { FakeText, TestHost } from "./engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

/** Texte sans archive : les tests de mise en page n'ont pas besoin des `STRL`. */
function makeText(): ZoombinisText {
  return new ZoombinisText(new FakeText(), new TextStrings(null as never));
}

/** Boîte englobante des pixels de couleur `color` : `{ x0, y0, x1, y1 }` (inclusifs), ou `null`. */
function inkBox(surface: Surface, color: number) {
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      if (surface.get(x, y) !== color) continue;
      box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
    }
  }
  return box;
}

// Police factice : petite 13 -> 8 px par caractère et 13 de haut ; grande 16 -> 10 et 16.
describe("mise en page du texte", () => {
  it("mesure avec les hauteurs 13 et 16 du français", () => {
    const text = makeText();
    expect(FONTS.small.height).toBe(-13);
    expect(FONTS.large.height).toBe(-16);
    expect(text.measure("small", "abc")).toBe(24);
    expect(text.lineHeight("large")).toBe(16);
  });

  it("coupe aux espaces quand la ligne dépasse, et sur les retours explicites", () => {
    const text = makeText();
    // 8 px par caractère : 80 px = 10 caractères.
    expect(text.layout("small", "un deux trois", 80).lines).toEqual(["un deux", "trois"]);
    expect(text.layout("small", "un\ndeux", 80).lines).toEqual(["un", "deux"]);
    expect(text.layout("small", "abcdefghijkl", 80).lines).toEqual(["abcdefghij", "kl"]);
    const layout = text.layout("small", "un deux trois", 80);
    expect(layout.height).toBe(26);
    expect(layout.width).toBe(56);
  });

  it("dessine à gauche, centré, à droite, en haut, au milieu et en bas", () => {
    const text = makeText();
    const rect = { x: 20, y: 30, w: 100, h: 60 };
    const draw = (flags: number) => {
      const surface = new Surface(200, 200);
      text.drawText(surface, "small", "abcd", rect, flags, 7);
      return inkBox(surface, 7)!;
    };
    // 4 caractères = 32 px de large, 13 de haut.
    expect(draw(0)).toEqual({ x0: 20, y0: 30, x1: 51, y1: 42 });
    expect(draw(TextFlags.center)).toEqual({ x0: 54, y0: 30, x1: 85, y1: 42 });
    expect(draw(TextFlags.right)).toEqual({ x0: 88, y0: 30, x1: 119, y1: 42 });
    expect(draw(TextFlags.vcenter | TextFlags.center).y0).toBe(30 + 30 - 6);
    expect(draw(TextFlags.bottom).y1).toBe(30 + 60 - 1);
  });

  it("utilise l'indice de couleur donné et respecte la découpe", () => {
    const text = makeText();
    const surface = new Surface(100, 40);
    surface.fill(3);
    text.drawText(surface, "large", "ab", { x: 0, y: 0, w: 100, h: 20 }, 0, 200, { x: 0, y: 0, w: 12, h: 8 });
    expect(inkBox(surface, 200)).toEqual({ x0: 0, y0: 0, x1: 11, y1: 7 });
    expect(surface.get(12, 0)).toBe(3);
  });
});

describe("rastérisation", () => {
  it("applique la règle LOGFONT : négatif = em, positif = cellule", () => {
    expect(emSize(-13, 250)).toBe(13);
    expect(emSize(25, 250)).toBe(20);
    expect(emSize(0, 250)).toBe(12);
  });

  it("seuille l'alpha à 128", () => {
    const rgba = new Uint8Array([0, 0, 0, 127, 0, 0, 0, 128, 0, 0, 0, 255, 0, 0, 0, 0]);
    expect([...thresholdAlpha(rgba, 4, 1)]).toEqual([0, 1, 1, 0]);
  });
});

describe.skipIf(!original.has)("chaînes STRL de TEXTSTR.MHK", () => {
  async function start() {
    const host = new TestHost();
    const engine = createZoombinisEngine(host, { seed: 1 });
    const text = await installText(engine);
    return { engine, text };
  }

  it("enregistre le service et lit les 16 noms de lieux en Mac Roman", async () => {
    const { engine, text } = await start();
    expect(engine.services.get(ZOOMBINIS_TEXT)).toBe(text);
    const names = text.strings.list(ZOOMBINI_SCREEN_NAMES_STRL);
    expect(names).toHaveLength(16);
    // Aucun caractère de remplacement ni de contrôle : les accents sont décodés.
    for (const name of names) expect(name).toMatch(/^[\p{L}\p{N} '’.,:!?()-]+$/u);
    expect(names.join("")).toMatch(/[éèêàçô]/);
  });

  it("numérote les chaînes à partir de 1", async () => {
    const { text } = await start();
    const names = text.strings.list(ZOOMBINI_SCREEN_NAMES_STRL);
    expect(text.strings.get(ZOOMBINI_SCREEN_NAMES_STRL, 1)).toBe(names[0]);
    expect(text.strings.get(ZOOMBINI_SCREEN_NAMES_STRL, 16)).toBe(names[15]);
    expect(text.strings.get(ZOOMBINI_SCREEN_NAMES_STRL, 0)).toBeNull();
    expect(text.strings.get(ZOOMBINI_SCREEN_NAMES_STRL, 17)).toBeNull();
    expect(text.strings.ids).toContain(2000);
  });
});
