import { describe, expect, it } from "vitest";
import { catalogOf, lureData } from "./catalog-helper";
import { decodeAnimation } from "../../../src/games/lure/data/anim";
import { parsePalette, parsePaletteCollection } from "../../../src/games/lure/data/palette";
import { decodeScreen, vgaDecode } from "../../../src/games/lure/data/picture";
import { hasOriginalFiles } from "./helpers";

describe.skipIf(!hasOriginalFiles)("inventaire des 337 ressources des disques", () => {
  const disks = () => catalogOf().filter((entry) => entry.disk !== 0);
  const ofKind = (kind: string) => disks().filter((entry) => entry.kind === kind).map((entry) => entry.id);

  it("attribue un type à chacune des 337 ressources, sans « inconnue »", () => {
    expect(disks()).toHaveLength(337);
    expect(catalogOf().filter((entry) => entry.kind === "unknown")).toEqual([]);
    expect(new Set(catalogOf().map((entry) => entry.id)).size).toBe(363);
  });

  it("compte les ressources de chaque type", () => {
    const counts = new Map<string, number>();
    for (const entry of disks()) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({
      palette: 49,
      screen: 98,
      animation: 137,
      "sequence-screen": 14,
      "sequence-lines": 15,
      "sound-adlib": 3,
      "sound-roland": 4,
      "driver-code": 2,
      protection: 5,
      cursors: 1,
      font: 1,
      "font-unused": 1,
      "menu-bar": 1,
      names: 1,
      strings: 3,
      "palette-collection": 1,
      unused: 1,
    });
  });

  it("identifie et ignore les ressources Roland, la protection, le code x86 et les ressources sans emploi", () => {
    const ignored = disks().filter((entry) => entry.ignored).map((entry) => entry.id).sort((a, b) => a - b);
    expect(ignored).toEqual([0x03, 0x0a, 0x0b, 0x0c, 0x0f, 0x30, 0x400e, 0x4138, 0x4139, 0x413a, 0x413b, 0x413c, 0xff10]);
    expect(ofKind("sound-roland").sort((a, b) => a - b)).toEqual([0x0b, 0x0c, 0x30, 0xff10]);
    expect(ofKind("sound-adlib").sort((a, b) => a - b)).toEqual([0x0d, 0x31, 0xff11]);
  });

  it("chaque séquence a ses « lignes » dans la ressource suivante", () => {
    const d = lureData();
    for (const id of ofKind("sequence-screen")) {
      expect(d.resources.has(id + 1), `séquence 0x${id.toString(16)}`).toBe(true);
      expect(ofKind("sequence-lines")).toContain(id + 1);
    }
  });

  it("décode toutes les ressources non ignorées de type image, animation, palette et petite ressource", () => {
    const d = lureData();
    for (const entry of disks()) {
      if (entry.ignored) continue;
      const bytes = d.resources.get(entry.id);
      const label = `0x${entry.id.toString(16)} (${entry.kind})`;
      switch (entry.kind) {
        case "screen":
          expect(decodeScreen(bytes), label).toHaveLength(61440);
          break;
        case "menu-bar":
          expect(decodeScreen(bytes), label).toHaveLength(2560);
          break;
        case "sequence-screen":
          expect(vgaDecode(bytes, 300000).length, label).toBeGreaterThanOrEqual(64000);
          break;
        case "animation":
          expect(decodeAnimation(bytes).numFrames, label).toBeGreaterThanOrEqual(1);
          break;
        case "palette":
          expect(parsePalette(bytes).numEntries, label).toBe(entry.id === 0x9bff ? 128 : 220);
          break;
        case "palette-collection":
          expect(parsePaletteCollection(bytes), label).toHaveLength(5);
          break;
        default:
          break;
      }
    }
  });

  it("les ressources de petite taille ont la taille attendue : 26 curseurs de 16 x 16, 115 glyphes, 83 noms", () => {
    const d = lureData();
    expect(d.resources.size(1)).toBe(26 * 256);
    expect(d.resources.size(4)).toBe(115 * 8);
    expect(d.texts.nameCount).toBe(83);
    expect(ofKind("strings")).toEqual([0x10, 0x11, 0x12]);
  });

  it("cite les cas particuliers : 0xFF00 est une palette bien qu'un enregistrement d'animation la désigne, 0x400E n'est pas référencée", () => {
    const entry = (id: number) => catalogOf().find((e) => e.id === id)!;
    expect(entry(0xff00).kind).toBe("palette");
    expect(entry(0x400e)).toMatchObject({ kind: "unused", ignored: true, size: 37504 });
    expect(entry(0x4139).kind).toBe("protection");
    expect(entry(0xc008).kind).toBe("animation");
    expect(entry(0x4100).kind).toBe("screen");
    expect(entry(0x41ff).kind).toBe("palette");
  });
});
