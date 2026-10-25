import { describe, expect, it } from "vitest";
import {
  ICON_PAGES,
  ICON_SLOTS,
  TOOL_BOOTS,
  TOOL_TABLE,
  decodeIconPages,
  decodeToolTable,
  findTool,
  iconImageSize,
  iconKind,
  inventoryCell,
  isIconAvailable,
  nextPage,
  slotCenterX,
  slotOf,
  topCell,
} from "../../src/games/armaeth/engine/icons";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("table des outils DGROUP:0bc2", () => {
  it("compte 35 enregistrements et les couples (icône, variante) documentés", () => {
    expect(TOOL_TABLE).toHaveLength(35);
    const nums = [...new Set(TOOL_TABLE.map((r) => r.num))];
    expect(nums).toEqual([1, 2, 3, 4, 5, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 198, 199, 111, 112, 113]);
  });

  it("décrit les outils (verbe, préposition, listes, drapeaux)", () => {
    const look = findTool(101, 0)!;
    expect(look).toMatchObject({ verb: 5, preposition: 1, rightInverts: true, hotspots: true, empty: false, inverse: false });
    expect(look.lists).toEqual([true, true, true, true, true]);
    // L'octet de AM1.EXE donne la préposition 1 (dans) pour « lire », là où le tableau d'interface.md § 1 met « — ».
    expect(findTool(101, 1)).toMatchObject({ verb: 20, preposition: 1 });
    expect(findTool(101, 1)!.lists).toEqual([true, true, true, false, true]);
    expect(findTool(102, 0)).toMatchObject({ verb: 6, preposition: 1, rightInverts: false });
    expect(findTool(102, 0)!.lists).toEqual([true, true, false, true, false]);
    expect(findTool(102, 1)).toMatchObject({ verb: 15, grab: true, empty: true, inverse: true });
    expect(findTool(103, 0)).toMatchObject({ verb: 3, preposition: 7, grab: true });
    expect(findTool(103, 1)!.verb).toBe(4);
    expect(findTool(104, 0)).toMatchObject({ verb: 1, inverse: true });
    expect(findTool(108, 0)).toMatchObject({ verb: 32, preposition: 8, inverse: true, grab: true });
    expect(findTool(109, 1)).toMatchObject({ verb: 24, preposition: 8, inverse: true, grab: false });
    expect(findTool(113, 0)!.verb).toBe(39);
    expect(findTool(113, 1)!.verb).toBe(39);
    expect(findTool(TOOL_BOOTS, 0)).toMatchObject({ verb: 0, empty: true });
    expect(findTool(TOOL_BOOTS, 0)!.lists).toEqual([true, false, false, false, false]);
    expect(findTool(1, 0)!.lists).toEqual([true, false, false, false, false]);
    expect(findTool(999, 0)).toBeUndefined();
  });

  it.skipIf(!hasOriginalFiles)("est identique aux octets de AM1.EXE", () => {
    const exe = readOriginal("AM1.EXE");
    expect(decodeToolTable(exe)).toEqual(TOOL_TABLE);
    expect(decodeIconPages(exe)).toEqual(ICON_PAGES);
  });
});

describe("pages d'icônes", () => {
  it("contient 3 pages de 10 numéros comme documenté", () => {
    expect(ICON_PAGES).toEqual([
      [101, 102, 103, 104, 111, 109, 106, 107, 198, 199],
      [101, 102, 103, 105, 108, 112, 113, 110, 198, 199],
      [201, 202, 203, 204, 205, 206, 207, 208, 209, 210],
    ]);
  });

  it("place les icônes sur les 10 emplacements (198 et 199 aux emplacements 9 et 8)", () => {
    for (let p = 0; p < 3; p++) expect([...ICON_SLOTS[p]].sort()).toEqual([...ICON_PAGES[p]].sort());
    expect(slotOf(0, 101)).toBe(0);
    expect(slotOf(0, 199)).toBe(8);
    expect(slotOf(0, 198)).toBe(9);
    expect(slotOf(2, 202)).toBe(0);
    expect(slotOf(2, 210)).toBe(9);
    expect(slotOf(0, 105)).toBe(-1);
  });

  it("n'expose que les icônes de la page courante", () => {
    expect(isIconAvailable(0, 104)).toBe(true);
    expect(isIconAvailable(1, 104)).toBe(false);
    expect(isIconAvailable(1, 105)).toBe(true);
    expect(isIconAvailable(0, 201)).toBe(false);
  });

  it("change de page de façon circulaire : gauche et deux boutons +1, droit -1", () => {
    expect(nextPage(0, false, true)).toBe(1);
    expect(nextPage(2, false, true)).toBe(0);
    expect(nextPage(0, true, false)).toBe(2);
    expect(nextPage(1, true, true)).toBe(2);
  });
});

describe("cases du cadre", () => {
  it("donne les cases du haut x0 = 25+24k puis 178+24k, y 2..17", () => {
    expect([0, 1, 2, 3, 4].map((s) => topCell(s).x0)).toEqual([25, 49, 73, 97, 121]);
    expect([5, 6, 7, 8, 9].map((s) => topCell(s).x0)).toEqual([178, 202, 226, 250, 274]);
    expect(topCell(0)).toMatchObject({ y0: 2, width: 20, height: 16 });
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(slotCenterX)).toEqual([35, 59, 83, 107, 131, 188, 212, 236, 260, 284]);
  });

  it("donne les 12 cases d'inventaire x0 = 18+24k, y 182..197", () => {
    expect(inventoryCell(0)).toMatchObject({ x0: 18, y0: 182 });
    expect(inventoryCell(11).x0).toBe(282);
  });
});

describe("natures et tailles", () => {
  it("classe les icônes", () => {
    expect(iconKind(101)).toBe("tool");
    expect(iconKind(198)).toBe("tool");
    expect(iconKind(199)).toBe("ladder");
    expect(iconKind(205)).toBe("system");
    expect(iconKind(114)).toBeUndefined();
  });

  it("donne la taille de l'image selon la variante", () => {
    expect(iconImageSize(101, 0)).toEqual({ width: 16, height: 7 });
    expect(iconImageSize(101, 1)).toEqual({ width: 10, height: 10 });
    expect(iconImageSize(999)).toBeUndefined();
  });
});
