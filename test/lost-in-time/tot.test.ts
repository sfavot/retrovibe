import { describe, expect, it } from "vitest";
import { decodeSprite } from "../../src/games/lost-in-time/data/sprite";
import { parseExtTable, readExtResource } from "../../src/games/lost-in-time/data/ext";
import { palette6ToRgb } from "../../src/games/lost-in-time/data/palette";
import { getTotResource, loadTot, localizedTextFile, type Tot } from "../../src/games/lost-in-time/data/tot";
import { hasOriginalFiles, loadArchive } from "./helpers";

function totNames(): string[] {
  return loadArchive("INTRO.STK")
    .entries.filter((e) => e.name.endsWith(".TOT"))
    .map((e) => e.name.replace(/\.TOT$/, ""));
}

describe.skipIf(!hasOriginalFiles)("TOT", () => {
  const archive = loadArchive("INTRO.STK");

  it("lit les 61 en-têtes (version 1.3) et leurs textes", () => {
    const names = totNames();
    expect(names).toHaveLength(61);
    let withTexts = 0;
    for (const name of names) {
      const tot = loadTot(archive, name, "fr")!;
      expect(tot.header.version, name).toBe("1.3");
      expect(tot.header.functions).toHaveLength(14);
      expect(tot.script.length).toBe(tot.header.scriptEnd);
      if (tot.texts) {
        withTexts++;
        for (let i = 0; i < tot.texts.count; i++) tot.texts.get(i);
      }
    }
    expect(withTexts).toBeGreaterThan(40);
  });

  it("lit les textes dans les autres langues", () => {
    expect(localizedTextFile("EMAM1000", "us")).toBe("EMAM1000.USA");
    for (const language of ["fr", "us", "gb", "de", "it", "es"] as const) {
      const tot = loadTot(archive, "EMAM1000", language)!;
      expect(tot.texts, language).not.toBeNull();
      expect(tot.texts!.count, language).toBeGreaterThan(0);
    }
  });

  it("lit les ressources internes des TOT", () => {
    for (const name of totNames()) {
      const tot = loadTot(archive, name)!;
      tot.resources?.forEach((item, id) => {
        if (!item.inIm && item.size > 0) expect(getTotResource(tot, id), `${name}#${id}`).not.toBeNull();
      });
    }
  });

  it("décode tous les sprites EXT", () => {
    const commun = archive.get("COMMUN.EX1")!;
    let count = 0;
    for (const name of totNames()) {
      const file = archive.get(`${name}.EXT`);
      if (!file) continue;
      const items = parseExtTable(file);
      items.forEach((item, i) => {
        const res = readExtResource(file, item, commun);
        if (!res.width || !res.height) return;
        const sprite = decodeSprite(res.data, res.width, res.height);
        expect(sprite.pixels.length, `${name}#${i}`).toBe(res.width * res.height);
        count++;
      });
    }
    expect(count).toBeGreaterThan(200);
  });

  it("décode le fond de EMAM1000 avec sa palette", () => {
    const file = archive.get("EMAM1000.EXT")!;
    const items = parseExtTable(file);
    const res = readExtResource(file, items[3]);
    expect([res.width, res.height]).toEqual([320, 200]);
    const sprite = decodeSprite(res.data, 320, 200);

    const tot: Tot = loadTot(archive, "EMAM1000")!;
    const palette = getTotResource(tot, 3)!;
    expect(palette.data.length).toBeGreaterThanOrEqual(768);
    const rgb = palette6ToRgb(palette.data);

    const probe = PROBES.map(([x, y]) => {
      const index = sprite.pixels[y * 320 + x];
      return [x, y, index, rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2]];
    });
    expect(probe).toEqual(EXPECTED_PIXELS);
  });
});

const PROBES = [
  [10, 10],
  [160, 100],
  [300, 20],
  [100, 150],
  [40, 60],
  [200, 40],
];

/** [x, y, indice, r, g, b] relevés une fois sur le décodage validé visuellement. */
const EXPECTED_PIXELS = [
  [10, 10, 248, 24, 24, 12],
  [160, 100, 250, 36, 40, 28],
  [300, 20, 148, 255, 255, 219],
  [100, 150, 162, 85, 89, 44],
  [40, 60, 185, 121, 109, 93],
  [200, 40, 151, 105, 93, 69],
];
