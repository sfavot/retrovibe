import { describe, expect, it } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import type { Font } from "../../../src/games/tim3/data/font";
import {
  FRAME_STYLES,
  RenderAssets,
  Surface,
  TEXT_CENTER_BLOCK,
  TEXT_CENTER_LINES,
  TEXT_MIDDLE,
  TEXT_WRAP,
  drawFrame,
  drawItf,
  itfButtonLabel,
  itfHitAt,
  itfOrigin,
  layoutItf,
  layoutText,
  mapColor,
  parseTextCodes,
} from "../../../src/games/tim3/render";
import { frenchIndex, original } from "../data/real";
import { image } from "./support";

/** Police de test : chaque caractère fait 4 × 2 pixels pleins. */
const font: Font = { kind: "pft", height: 2, baseline: 2, firstChar: 32, glyphs: Array.from({ length: 96 }, () => ({ width: 4, height: 2, pixels: new Uint8Array(8).fill(1) })) };

describe("cadre en 9 morceaux (44e8e0)", () => {
  // Pièces : coins 2×2 (valeurs 1, 3, 6, 8), bords 1×2 / 2×1 (2, 4, 5, 7).
  const pieces = [
    image([[1, 1], [1, 1]]),
    image([[2], [2]]),
    image([[3, 3], [3, 3]]),
    image([[4, 4]]),
    image([[5, 5]]),
    image([[6, 6], [6, 6]]),
    image([[7], [7]]),
    image([[8, 8], [8, 8]]),
  ];

  it("coins aux angles, bords en mosaïque entre eux, fond dans le reste", () => {
    const s = new Surface(8, 6);
    drawFrame(s, pieces, 0, { x: 1, y: 1, width: 6, height: 5 }, 1);
    const fill = mapColor(1);
    const row = (y: number) => Array.from(s.pixels.subarray(y * 8, y * 8 + 8)).map((v) => (v === fill ? "f" : v.toString(16))).join("");
    expect([row(0), row(1), row(2), row(3), row(4), row(5)]).toEqual(["00000000", "01122330", "01122330", "044ff550", "06677880", "06677880"]);
  });

  it("le fond −1 ne remplit rien", () => {
    const s = new Surface(8, 6);
    drawFrame(s, pieces, 0, { x: 1, y: 1, width: 6, height: 5 }, -1);
    expect(s.pixels[3 * 8 + 3]).toBe(0);
  });

  it("les styles de décor pointent sur des groupes de 8 pièces", () => {
    for (const style of Object.values(FRAME_STYLES)) expect(style.first % 8).toBe(0);
    expect(FRAME_STYLES[3]).toEqual({ first: 0x30, fill: 15 });
    expect(FRAME_STYLES[4]).toEqual({ first: 0x08, fill: 15 });
  });
});

describe("textes des fenêtres (4217d7, 45301c)", () => {
  const base = { mode: 2, color: 5, flags: 0x302, font: "SYS12.PFT" };

  it("codes de tête : couleur, style, alignement ; sans code, lignes centrées", () => {
    expect(parseTextCodes("Bonjour", base)).toEqual({ text: "Bonjour", style: { ...base, flags: 0x1302 } });
    expect(parseTextCodes("~C15Joueur 1", base)).toEqual({ text: "Joueur 1", style: { ...base, color: 15, flags: 0x1302 } });
    expect(parseTextCodes("~S0~JLGauche", base).style).toEqual({ ...base, mode: 0, flags: 0x602 });
    expect(parseTextCodes("~JRDroite", base).style.flags).toBe(0xb02);
  });

  it("mots entiers, lignes entières seulement, défilement par lignes", () => {
    const flags = TEXT_WRAP | TEXT_MIDDLE | TEXT_CENTER_BLOCK | TEXT_CENTER_LINES;
    const all = layoutText(font, "aa bb cc dd", 20, 100, flags);
    expect(all.lines.map((l) => l.text)).toEqual(["aa bb", "cc dd"]);
    expect(layoutText(font, "aa bb cc dd ee", 20, 5, flags)).toMatchObject({ total: 3, height: 4 });
    expect(layoutText(font, "aa bb cc dd ee", 20, 5, flags, 1).lines.map((l) => l.text)).toEqual(["cc dd", "ee"]);
    expect(layoutText(font, "aa bb", 4, 10, 0).lines.map((l) => l.text)).toEqual(["aa bb"]);
  });
});

describe.skipIf(!original.has)("GENERIC et PUZZSOLV sur les données d'origine", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const generic = readItf(index.get("GENERIC.ITF"));
  const solved = readItf(index.get("PUZZSOLV.ITF"));

  it("GENERIC : cadre de 311×206 centré sur l'écran, deux boutons de 81×27, zone de texte de 278×132", () => {
    const origin = itfOrigin(generic);
    expect(origin).toEqual({ dx: -24, dy: 11 });
    const layout = layoutItf(assets, generic, { ...origin, texts: { 65004: "Message" } });
    expect(layout.frame).toEqual({ x: 164, y: 137, width: 311, height: 206 });
    const rect = (id: number) => {
      const i = layout.items.find((x) => x.id === id)!;
      return [i.x, i.y, i.width, i.height, i.clickable];
    };
    expect(rect(65001)).toEqual([226, 297, 81, 27, true]);
    expect(rect(65002)).toEqual([323, 297, 81, 27, true]);
    expect(rect(65004)).toEqual([179, 159, 278, 132, false]);
    expect(layout.items.find((x) => x.id === 65001)!.text).toBe("OK");
    expect(layout.items.find((x) => x.id === 65002)!.text).toBe("Annuler");
    expect(itfHitAt(layout, 230, 300)?.id).toBe(65001);
    expect(itfHitAt(layout, 315, 300)).toBeNull();
  });

  it("GENERIC à un bouton : le second caché, le premier centré sous le cadre", () => {
    const layout = layoutItf(assets, generic, { ...itfOrigin(generic), hidden: [65002], moved: { 65001: { x: 188 + 115 } } });
    expect(layout.items.some((i) => i.id === 65002)).toBe(false);
    const ok = layout.items.find((i) => i.id === 65001)!;
    expect(ok.x + ok.width / 2).toBeCloseTo(layout.frame.x + layout.frame.width / 2, 0);
  });

  it("PUZZSOLV : titre, trois boutons à image et leurs libellés", () => {
    const layout = layoutItf(assets, solved, { ...itfOrigin(solved), disabled: [17003] });
    expect(layout.frame).toEqual({ x: 186, y: 160, width: 267, height: 160 });
    expect(layout.items.find((i) => i.id === 17001)!.text).toBe("Vous avez résolu le puzzle!");
    const buttons = layout.items.filter((i) => i.clickable).sort((a, b) => a.x - b.x);
    expect(buttons.map((b) => [b.name, b.x, b.y, b.width, b.height, b.enabled, itfButtonLabel(layout, b)])).toEqual([
      ["PS_PLAY", 211, 207, 53, 55, true, "Même Puzzle"],
      ["PS_RERUN", 282, 206, 70, 55, true, "Rejouer la Solution"],
      ["PS_NEXT", 373, 207, 53, 55, false, "Puzzle Suivant"],
    ]);
  });

  it("rendu : cadre, texte et boutons dessinés ; bouton enfoncé et grisé différents ; même état, même image", () => {
    const draw = (state = {}) => {
      const s = new Surface(640, 480);
      drawItf(s, assets, solved, { ...itfOrigin(solved), ...state });
      return s;
    };
    const s = draw();
    // Fond blanc du style 3 au milieu du cadre, rien hors du cadre.
    expect(s.pixels[230 * 640 + 320]).not.toBe(0);
    expect(s.pixels[100 * 640 + 320]).toBe(0);
    const inRect = (a: Surface, b: Surface, x: number, y: number, w: number, h: number) => {
      let diff = 0;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (a.pixels[yy * 640 + xx] !== b.pixels[yy * 640 + xx]) diff++;
      return diff;
    };
    expect(inRect(s, draw(), 0, 0, 640, 480)).toBe(0);
    expect(inRect(s, draw({ pressed: 17004 }), 282, 206, 70, 55)).toBeGreaterThan(0);
    expect(inRect(s, draw({ disabled: [17003] }), 373, 207, 53, 55)).toBeGreaterThan(0);
    // Le titre est écrit (encre du style 2 : couleur 5) dans sa bande.
    let ink = 0;
    for (let y = 178; y < 201; y++) for (let x = 188; x < 451; x++) if (s.pixels[y * 640 + x] === mapColor(5)) ink++;
    expect(ink).toBeGreaterThan(100);
  });
});
