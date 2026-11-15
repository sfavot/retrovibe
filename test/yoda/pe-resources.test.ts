import { describe, expect, it } from "vitest";
import { readPeBitmaps, readPeCursors, readPeIcons, readPeResources, readPeStrings } from "../../src/engine/desktop-adventures/data/pe-resources";
import { originalFiles } from "../support/original";

const original = originalFiles("yoda", "YODESK.DTA");

describe.skipIf(!original.has)("ressources PE de YODESK.EXE", () => {
  const exe = original.read("YODESK.EXE");

  it("parcourt le répertoire .rsrc", () => {
    const resources = readPeResources(exe);
    const count = (type: number) => resources.filter((r) => r.type === type).length;
    expect([count(1), count(3), count(12)]).toEqual([32, 11, 21]); // CURSOR, ICON, GROUP_CURSOR
    expect(count(6)).toBeGreaterThan(0); // STRING
  });

  it("lit les 32 curseurs (ids 12 à 43)", () => {
    const cursors = readPeCursors(exe);
    expect([...cursors.keys()]).toEqual(Array.from({ length: 32 }, (_, i) => 12 + i));
    for (const c of cursors.values()) {
      expect([16, 32]).toContain(c.width);
      expect(c.height).toBe(c.width);
      expect(c.rgba.length).toBe(c.width * c.height * 4);
      expect(c.hotspotX).toBeLessThan(c.width);
      expect(c.hotspotY).toBeLessThan(c.height);
      expect(c.rgba.some((v, i) => i % 4 === 3 && v === 0xff)).toBe(true); // au moins un pixel opaque
    }
    expect([cursors.get(12)!.hotspotX, cursors.get(12)!.hotspotY]).toEqual([15, 15]);
    expect([cursors.get(23)!.width, cursors.get(23)!.hotspotX]).toEqual([16, 1]);
  });

  it("lit les 11 icônes 32×32", () => {
    const icons = readPeIcons(exe);
    expect([...icons.keys()]).toEqual(Array.from({ length: 11 }, (_, i) => 1 + i));
    for (const icon of icons.values()) {
      expect([icon.width, icon.height]).toEqual([32, 32]);
      expect(icon.rgba.some((v, i) => i % 4 === 3 && v === 0xff)).toBe(true);
    }
  });

  it("décode les chaînes UTF-16 avec leurs accents", () => {
    const strings = readPeStrings(exe);
    expect(strings.size).toBeGreaterThan(100);
    expect(strings.get(57344)).toBe("Yoda Stories");
    expect(strings.get(57346)).toBe("Impossible d'ouvrir le fichier de données!");
    expect(strings.get(57363)).toBe("Astroport");
    expect(strings.get(57372)).toContain("Désolé");
    for (const [id, text] of strings) if (id >= 57344) expect(text).not.toMatch(/[�\u0000]/);
  });

  it("lit les boutons de la bulle (mêmes noms que dans DESKADV.EXE)", () => {
    const bitmaps = readPeBitmaps(exe);
    for (const name of ["DNAU", "UPAU", "CLOSEU"]) expect(bitmaps.get(name)).toMatchObject({ width: 16, height: 16 });
  });
});
