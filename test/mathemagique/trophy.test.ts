import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { Roster, RosterStore, achievementBit, gradeOfMask, type PlayerInfo } from "../../src/games/mathemagique/engine/roster";
import { SceneId } from "../../src/games/mathemagique/engine/scene";
import { installServices } from "../../src/games/mathemagique/engine/services";
import {
  CERTIFICATE_IMAGE_HEIGHT,
  CERTIFICATE_IMAGE_WIDTH,
  CERTIFICATE_RIBBON_FILES,
  CERTIFICATE_TITLES,
  CertificateRenderer,
  PAGE_WIDTH_UNITS,
  WMF,
  WmfError,
  achievedLevels,
  buildCertificateData,
  certificateFileName,
  composeCertificate,
  drawWmf,
  parseWmf,
  wmfPhysicalTarget,
  type CertificateCanvas,
  type CertificateContext,
  type CertificateEnvironment,
} from "../../src/games/mathemagique/scenes/certificate";
import {
  CELL_LEFT,
  HallOfFameModel,
  PLAYERS_PER_PAGE,
  RANK_PREFIX,
  buildCell,
  buildPage,
  cellRect,
  clampPage,
  createTrophyScene,
  firstActiveCell,
  lastPageIndex,
} from "../../src/games/mathemagique/scenes/trophy";
import { TestHost, runFor } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

const RANKS = Array.from({ length: 25 }, (_, i) => `Rang ${i + 1}`);

/** Masque avec les réussites données : `[opération, niveau]`. */
function maskOf(...achievements: [number, number][]): number {
  return achievements.reduce((mask, [op, level]) => (mask | (1 << achievementBit(op, level))) >>> 0, 0);
}

function player(id: number, name: string, mask = 0): PlayerInfo {
  return { id, name, mask };
}

// --- WMF synthétique ---

type Rec = [fn: number, ...params: number[]];

/** WMF placeable minimal : en-têtes puis records (`[fn, ...mots]`) et `META_EOF`. */
function buildWmf(records: Rec[], box = { left: 0, top: 0, right: 100, bottom: 50 }): Uint8Array {
  const all: Rec[] = [...records, [WMF.eof]];
  const bodyWords = 9 + all.reduce((sum, r) => sum + 3 + (r.length - 1), 0);
  const bytes = new Uint8Array(22 + bodyWords * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x9ac6cdd7, true);
  view.setInt16(6, box.left, true);
  view.setInt16(8, box.top, true);
  view.setInt16(10, box.right, true);
  view.setInt16(12, box.bottom, true);
  view.setUint16(14, 1620, true);
  view.setUint16(22, 1, true); // type
  view.setUint16(24, 9, true); // taille d'en-tête
  view.setUint16(26, 0x300, true);
  view.setUint32(28, bodyWords, true);
  let at = 22 + 18;
  for (const [fn, ...params] of all) {
    view.setUint32(at, 3 + params.length, true);
    view.setUint16(at + 4, fn, true);
    params.forEach((p, i) => view.setInt16(at + 6 + i * 2, p, true));
    at += (3 + params.length) * 2;
  }
  return bytes;
}

/** Contexte 2D enregistreur : chaque appel et chaque affectation sont notés. */
class RecordingContext implements CertificateContext {
  readonly calls: { op: string; args: unknown[] }[] = [];
  fillStyle: string | object = "";
  strokeStyle: string | object = "";
  lineWidth = 1;
  lineJoin: CanvasLineJoin = "miter";
  lineCap: CanvasLineCap = "butt";
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  /** Largeur par caractère pour `measureText` (px par caractère par px de police, simplifiée). */
  charWidth = 0.5;

  private note(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
  }
  save(): void {
    this.note("save");
  }
  restore(): void {
    this.note("restore");
  }
  setTransform(...m: number[]): void {
    this.note("setTransform", ...m);
  }
  beginPath(): void {
    this.note("beginPath");
  }
  moveTo(x: number, y: number): void {
    this.note("moveTo", x, y);
  }
  lineTo(x: number, y: number): void {
    this.note("lineTo", x, y);
  }
  closePath(): void {
    this.note("closePath");
  }
  rect(...r: number[]): void {
    this.note("rect", ...r);
  }
  clip(): void {
    this.note("clip");
  }
  fill(rule?: CanvasFillRule): void {
    this.note("fill", this.fillStyle, rule);
  }
  stroke(): void {
    this.note("stroke", this.strokeStyle, this.lineWidth);
  }
  fillRect(...r: number[]): void {
    this.note("fillRect", this.fillStyle, ...r);
  }
  fillText(text: string, x: number, y: number): void {
    this.note("fillText", text, x, y, this.font);
  }
  measureText(text: string): { width: number } {
    const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * size * this.charWidth };
  }
  count(op: string): number {
    return this.calls.filter((c) => c.op === op).length;
  }
}

describe("WMF : analyse", () => {
  it("rejette les fichiers tronqués ou sans en-tête valide", () => {
    expect(() => parseWmf(new Uint8Array(10))).toThrow(WmfError);
    const good = buildWmf([[WMF.polygon, 2, 0, 0, 1, 1]]);
    expect(() => parseWmf(good.subarray(0, good.length - 4))).toThrow(WmfError);
    const bad = good.slice();
    bad[24] = 7; // taille d'en-tête ≠ 9
    expect(() => parseWmf(bad)).toThrow(WmfError);
  });

  it("lit la boîte placeable, l'en-tête et les records (paramètres signés)", () => {
    const wmf = parseWmf(buildWmf([[WMF.setWindowOrg, -15, -16], [WMF.polygon, 3, 0, 0, 10, 0, 10, 10]], { left: 0, top: 2, right: 640, bottom: 480 }));
    expect(wmf.placeable).toEqual({ left: 0, top: 2, right: 640, bottom: 480, unitsPerInch: 1620 });
    expect(wmf.header).toMatchObject({ type: 1, headerWords: 9, version: 0x300 });
    expect(wmf.records.map((r) => r.fn)).toEqual([WMF.setWindowOrg, WMF.polygon, WMF.eof]);
    expect([...wmf.records[0]!.params]).toEqual([-15, -16]);
    expect(wmf.counts.get(WMF.polygon)).toBe(1);
  });
});

describe.skipIf(!hasOriginalFiles)("WMF : fichiers du jeu", () => {
  const FILES: [string, { polygons: number; polylines: number; pens: number; brushes: number; bottom: number; upi: number; extY: number }][] = [
    ["BKG.WMF", { polygons: 571, polylines: 309, pens: 544, brushes: 31, bottom: 12532, upi: 1620, extY: 12562 }],
    ["RIB1.WMF", { polygons: 18, polylines: 10, pens: 17, brushes: 3, bottom: 12495, upi: 1636, extY: 12525 }],
    ["RIB2.WMF", { polygons: 18, polylines: 10, pens: 18, brushes: 3, bottom: 12495, upi: 1636, extY: 12525 }],
    ["RIB3.WMF", { polygons: 18, polylines: 10, pens: 18, brushes: 3, bottom: 12495, upi: 1636, extY: 12525 }],
    ["RIB4.WMF", { polygons: 18, polylines: 10, pens: 18, brushes: 3, bottom: 12495, upi: 1636, extY: 12525 }],
    ["RIBB.WMF", { polygons: 18, polylines: 10, pens: 18, brushes: 3, bottom: 12495, upi: 1636, extY: 12525 }],
  ];

  it.each(FILES)("%s : nombre de records et boîte de la page", (file, expected) => {
    const wmf = parseWmf(readOriginal(file));
    expect(wmf.counts.get(WMF.polygon)).toBe(expected.polygons);
    expect(wmf.counts.get(WMF.polyline)).toBe(expected.polylines);
    expect(wmf.counts.get(WMF.createPenIndirect)).toBe(expected.pens);
    expect(wmf.counts.get(WMF.createBrushIndirect)).toBe(expected.brushes);
    expect(wmf.counts.get(WMF.eof)).toBe(1);
    // Boîte placeable : 16 405 unités de large, paysage ; 1 620 unités par pouce pour le fond (10,1 pouces), 1 636 pour les rubans.
    expect(wmf.placeable).toMatchObject({ left: 0, top: 2, right: 16405, bottom: expected.bottom, unitsPerInch: expected.upi });
    // Fenêtre logique du fichier : 16 437 unités de large.
    const ext = wmf.records.find((r) => r.fn === WMF.setWindowExt)!;
    expect(ext.params[1]).toBe(16437);
    expect(ext.params[0]).toBe(expected.extY);
  });

  it("tous les records des six fichiers sont pris en charge (rien d'ignoré)", () => {
    for (const [file] of FILES) {
      const ctx = new RecordingContext();
      const stats = drawWmf(ctx, parseWmf(readOriginal(file)), { x: 0, y: 0, w: 2000, h: 1528 });
      expect([...stats.skipped], file).toEqual([]);
    }
  });

  it("BKG.WMF : appels de dessin, échelle de la fenêtre vers la cible, restitution du contexte", () => {
    const wmf = parseWmf(readOriginal("BKG.WMF"));
    const ctx = new RecordingContext();
    const target = wmfPhysicalTarget(wmf, 200, 10, 20); // 200 px par pouce : 16 405 / 1 620 pouces de large
    expect(target.w).toBeCloseTo((16405 / 1620) * 200, 6);
    expect(target.h).toBeCloseTo((12530 / 1620) * 200, 6);
    const stats = drawWmf(ctx, wmf, target);
    expect(stats).toMatchObject({ polygons: 571, polylines: 309 });
    // Transformation finale : fenêtre (-16, -15) de 16 437 × 12 562 étirée sur la cible.
    const first = ctx.calls.filter((c) => c.op === "setTransform").at(-1)!.args as number[];
    expect(first[0]).toBeCloseTo(target.w / 16437, 6);
    expect(first[3]).toBeCloseTo(target.h / 12562, 6);
    expect(first[4]).toBeCloseTo(10 + 16 * (target.w / 16437), 6);
    expect(first[5]).toBeCloseTo(20 + 15 * (target.h / 12562), 6);
    // Découpe de la page (INTERSECTCLIPRECT) puis une affectation de style par remplissage.
    expect(ctx.calls.filter((c) => c.op === "rect")[0]!.args).toEqual([-16, -15, 16437, 12562]);
    expect(ctx.count("clip")).toBe(1);
    expect(ctx.count("fill")).toBe(571); // aucun pinceau creux : un remplissage par polygone
    expect(ctx.count("stroke")).toBeGreaterThan(309); // polylignes + contours de polygones à crayon visible
    expect(ctx.count("stroke")).toBeLessThan(309 + 571);
    expect(ctx.count("save")).toBe(ctx.count("restore"));
    expect(ctx.calls[0]!.op).toBe("save");
    expect(ctx.calls.at(-1)!.op).toBe("restore");
    // Les crayons ont des largeurs de la table du fichier (1 pour le contour fin, 11, 23, 45, 135 unités).
    const widths = new Set(ctx.calls.filter((c) => c.op === "stroke").map((c) => c.args[1]));
    expect([...widths].every((w) => [1, 11, 23, 45, 135].includes(w as number))).toBe(true);
    expect(widths.has(45)).toBe(true);
  });

  it("un ruban dessine ses 18 polygones avec les couleurs de son fichier, un peu plus petit que le fond (1 636 unités par pouce)", () => {
    const ctx = new RecordingContext();
    const rib = parseWmf(readOriginal("RIB1.WMF"));
    const bkg = parseWmf(readOriginal("BKG.WMF"));
    expect(wmfPhysicalTarget(rib, 200).w).toBeLessThan(wmfPhysicalTarget(bkg, 200).w);
    drawWmf(ctx, rib, wmfPhysicalTarget(rib, 200));
    expect(ctx.count("fill")).toBe(18);
    const colors = new Set(ctx.calls.filter((c) => c.op === "fill").map((c) => c.args[0]));
    expect(colors.size).toBeGreaterThan(1);
    for (const color of colors) expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});

describe("WMF : rendu (records synthétiques)", () => {
  const target = { x: 0, y: 0, w: 200, h: 100 };

  it("crayon nul : pas de contour ; pinceau creux : pas de remplissage", () => {
    const ctx = new RecordingContext();
    drawWmf(
      ctx,
      parseWmf(
        buildWmf([
          [WMF.createPenIndirect, 5, 1, 0, 0, 0], // PS_NULL
          [WMF.createBrushIndirect, 0, 0xff, 0, 0], // plein, rouge
          [WMF.selectObject, 0],
          [WMF.selectObject, 1],
          [WMF.polygon, 3, 0, 0, 10, 0, 10, 10],
          [WMF.createBrushIndirect, 1, 0, 0, 0], // creux
          [WMF.selectObject, 2],
          [WMF.createPenIndirect, 0, 7, 0, 0xff00, 0], // plein, vert
          [WMF.selectObject, 3],
          [WMF.polygon, 3, 0, 0, 10, 0, 10, 10],
        ]),
        ),
      target,
    );
    expect(ctx.calls.filter((c) => c.op === "fill").map((c) => c.args[0])).toEqual(["rgb(255, 0, 0)"]);
    expect(ctx.calls.filter((c) => c.op === "stroke").map((c) => c.args)).toEqual([["rgb(0, 255, 0)", 7]]);
  });

  it("COLORREF : octets R, G puis B", () => {
    const ctx = new RecordingContext();
    drawWmf(ctx, parseWmf(buildWmf([[WMF.createBrushIndirect, 0, 0x4477, 0x0238, 0], [WMF.selectObject, 0], [WMF.polygon, 3, 0, 0, 1, 0, 1, 1]])), target);
    expect(ctx.calls.find((c) => c.op === "fill")!.args[0]).toBe("rgb(119, 68, 56)");
  });

  it("table d'objets : un objet supprimé libère son emplacement, réutilisé par la création suivante", () => {
    const ctx = new RecordingContext();
    drawWmf(
      ctx,
      parseWmf(
        buildWmf([
          [WMF.createBrushIndirect, 0, 0x00ff, 0, 0], // emplacement 0 : rouge
          [WMF.createBrushIndirect, 0, 0xff00, 0, 0], // emplacement 1 : vert
          [WMF.deleteObject, 0],
          [WMF.createBrushIndirect, 0, 0x0000, 0xff, 0], // emplacement 0 : bleu
          [WMF.selectObject, 0],
          [WMF.polygon, 3, 0, 0, 1, 0, 1, 1],
        ]),
      ),
      target,
    );
    expect(ctx.calls.find((c) => c.op === "fill")!.args[0]).toBe("rgb(0, 0, 255)");
  });

  it("mode de remplissage : alterné par défaut du jeu, enroulement si demandé", () => {
    const ctx = new RecordingContext();
    drawWmf(ctx, parseWmf(buildWmf([[WMF.polygon, 3, 0, 0, 1, 0, 1, 1], [WMF.setPolyFillMode, 2], [WMF.polygon, 3, 0, 0, 1, 0, 1, 1]])), target);
    expect(ctx.calls.filter((c) => c.op === "fill").map((c) => c.args[1])).toEqual(["evenodd", "nonzero"]);
  });

  it("polyligne : contour seul ; fenêtre : fenêtre logique puis étirement anisotrope", () => {
    const ctx = new RecordingContext();
    drawWmf(
      ctx,
      parseWmf(buildWmf([[WMF.setWindowOrg, 10, 20], [WMF.setWindowExt, 50, 400], [WMF.polyline, 2, 0, 0, 5, 5]], { left: 0, top: 0, right: 100, bottom: 50 })),
      { x: 4, y: 8, w: 200, h: 100 },
    );
    const transforms = ctx.calls.filter((c) => c.op === "setTransform");
    expect(transforms.at(-1)!.args).toEqual([200 / 400, 0, 0, 100 / 50, 4 - 20 * (200 / 400), 8 - 10 * (100 / 50)]);
    expect(ctx.count("fill")).toBe(0);
    expect(ctx.count("stroke")).toBe(1);
  });

  it("compte les records inconnus au lieu de les exécuter", () => {
    const ctx = new RecordingContext();
    const stats = drawWmf(ctx, parseWmf(buildWmf([[0x0418, 1, 2, 3, 4], [WMF.setBkMode, 1]])), target);
    expect([...stats.skipped]).toEqual([[0x0418, 1]]);
  });

  it("SAVEDC / RESTOREDC : rend le contexte du canevas et la fenêtre", () => {
    const ctx = new RecordingContext();
    drawWmf(
      ctx,
      parseWmf(buildWmf([[WMF.saveDc], [WMF.setWindowExt, 10, 10], [WMF.restoreDc, -1]], { left: 0, top: 0, right: 100, bottom: 50 })),
      target,
    );
    const transforms = ctx.calls.filter((c) => c.op === "setTransform");
    expect(transforms.at(-1)!.args).toEqual(transforms[0]!.args);
    expect(ctx.count("save")).toBe(ctx.count("restore"));
  });
});

describe("Certificat : données", () => {
  it("six titres de la table MATH, dans l'ordre + − × ÷ = ≈", () => {
    expect(CERTIFICATE_TITLES).toEqual([
      "Addition Certificate of Merit",
      "Subtraction Certificate of Merit",
      "Multiplication Certificate of Merit",
      "Division Certificate of Merit",
      "Equivalence Certificate of Merit",
      "Estimation Certificate of Merit",
    ]);
  });

  it("un ruban par niveau réussi de l'opération : RIB1 à RIB4, RIBB pour le bonus", () => {
    const mask = maskOf([2, 0], [2, 2], [2, 4], [0, 1], [5, 3]);
    expect(achievedLevels(mask, 2)).toEqual([0, 2, 4]);
    const data = buildCertificateData({ playerName: "Léa", mask, operation: 2, ranks: RANKS })!;
    expect(data.title).toBe("Multiplication Certificate of Merit");
    expect(data.levels).toEqual([0, 2, 4]);
    expect(data.ribbonFiles).toEqual(["RIB1.WMF", "RIB3.WMF", "RIBB.WMF"]);
    expect(buildCertificateData({ playerName: "Léa", mask, operation: 5, ranks: RANKS })!.ribbonFiles).toEqual(["RIB4.WMF"]);
    expect(buildCertificateData({ playerName: "Léa", mask, operation: 0, ranks: RANKS })!.ribbonFiles).toEqual(["RIB2.WMF"]);
  });

  it("rang global : 1 + niveaux 0 à 3 de toutes les opérations (le bonus ne compte pas)", () => {
    const mask = maskOf([0, 0], [0, 1], [1, 3], [3, 4], [4, 4]);
    expect(gradeOfMask(mask)).toBe(4);
    const data = buildCertificateData({ playerName: "Max", mask, operation: 3, ranks: RANKS })!;
    expect(data.grade).toBe(4);
    expect(data.rank).toBe("Rang 4");
    // Tous les niveaux sauf le bonus : rang 25.
    let full = 0;
    for (let op = 0; op < 6; op++) for (let level = 0; level < 5; level++) full |= 1 << achievementBit(op, level);
    expect(buildCertificateData({ playerName: "Max", mask: full >>> 0, operation: 1, ranks: RANKS })!.rank).toBe("Rang 25");
  });

  it("rien à imprimer sans niveau réussi ; opération invalide refusée", () => {
    expect(buildCertificateData({ playerName: "Zoé", mask: maskOf([1, 0]), operation: 0, ranks: RANKS })).toBeNull();
    expect(() => buildCertificateData({ playerName: "Zoé", mask: 1, operation: 6, ranks: RANKS })).toThrow(RangeError);
    expect(() => buildCertificateData({ playerName: "Zoé", mask: 1, operation: 0, ranks: [] })).toThrow(RangeError);
  });

  it("nom de fichier : opération en français, nom sans accent ni espace", () => {
    expect(certificateFileName("Léa Dupont", 1)).toBe("certificat-soustraction-lea-dupont.png");
    expect(certificateFileName("???", 0)).toBe("certificat-addition.png");
  });
});

describe("Certificat : composition", () => {
  function fakeEnvironment() {
    const ctx = new RecordingContext();
    const fonts: string[] = [];
    const canvases: [number, number][] = [];
    const env: CertificateEnvironment = {
      createCanvas(width, height): CertificateCanvas {
        canvases.push([width, height]);
        return { getContext: () => ctx, toPng: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }) };
      },
      async loadFont(family) {
        fonts.push(family);
      },
    };
    return { ctx, env, fonts, canvases };
  }

  const wmfA = parseWmf(buildWmf([[WMF.createBrushIndirect, 0, 0xff, 0, 0], [WMF.selectObject, 0], [WMF.polygon, 3, 0, 0, 9, 0, 9, 9]]));

  it("dessine papier, textes, fond puis rubans, avec les polices du jeu", () => {
    const { ctx } = fakeEnvironment();
    const data = buildCertificateData({ playerName: "Léa", mask: maskOf([0, 0], [0, 4]), operation: 0, ranks: RANKS })!;
    composeCertificate(ctx, data, wmfA, [wmfA, wmfA], CERTIFICATE_IMAGE_WIDTH, CERTIFICATE_IMAGE_HEIGHT);
    expect(ctx.calls[0]!.op).toBe("fillRect");
    expect(ctx.calls[0]!.args).toEqual(["#ffffff", 0, 0, CERTIFICATE_IMAGE_WIDTH, CERTIFICATE_IMAGE_HEIGHT]);
    const texts = ctx.calls.filter((c) => c.op === "fillText");
    expect(texts.map((c) => c.args[0])).toEqual(["Addition Certificate of Merit", "this certificate is awarded to", "Léa", "who has achieved the rank of", "Rang 2"]);
    expect(texts.map((c) => (c.args[3] as string).match(/"(.+)"/)![1])).toEqual(["MW Market", "MW NewZurica", "MW Market", "MW NewZurica", "MW Market"]);
    // Textes d'abord, puis fond (3 appels `save` : 1 par WMF), les rubans à la suite.
    const lastText = ctx.calls.lastIndexOf(texts.at(-1)!);
    const saves = ctx.calls.map((c, i) => [c.op, i] as const).filter(([op]) => op === "save");
    expect(saves).toHaveLength(3);
    expect(saves[0]![1]).toBeGreaterThan(lastText);
    expect(ctx.count("fill")).toBe(3);
  });

  it("centre chaque texte dans son rectangle et réduit un nom trop long", () => {
    const { ctx } = fakeEnvironment();
    const data = buildCertificateData({ playerName: "M".repeat(28), mask: 1, operation: 0, ranks: RANKS })!;
    composeCertificate(ctx, data, wmfA, [], CERTIFICATE_IMAGE_WIDTH, CERTIFICATE_IMAGE_HEIGHT);
    const pxPerInch = CERTIFICATE_IMAGE_WIDTH / (PAGE_WIDTH_UNITS / 1620);
    const name = ctx.calls.find((c) => c.op === "fillText" && c.args[0] === "M".repeat(28))!;
    expect(name.args[1]).toBeCloseTo(((2.423 + 6.813) / 2) * pxPerInch, 5);
    expect(name.args[2]).toBeCloseTo(((2.003 + 2.403) / 2) * pxPerInch, 5);
    const size = Number(/(\d+)px/.exec(name.args[3] as string)![1]);
    expect(size).toBeLessThan(Math.round(0.35 * pxPerInch));
    expect(28 * size * ctx.charWidth).toBeLessThanOrEqual((6.813 - 2.423) * pxPerInch);
    expect(ctx.textAlign).toBe("center");
  });

  it("CertificateRenderer : charge polices et WMF une fois, produit un PNG de 2000 × 1528", async () => {
    const { env, fonts, canvases } = fakeEnvironment();
    const loaded: string[] = [];
    const renderer = new CertificateRenderer(env, async (path) => {
      loaded.push(path);
      return /\.WMF$/.test(path) ? buildWmf([[WMF.polygon, 3, 0, 0, 9, 0, 9, 9]]) : new Uint8Array([1, 2, 3]);
    });
    const data = buildCertificateData({ playerName: "Léa", mask: maskOf([4, 0], [4, 1]), operation: 4, ranks: RANKS })!;
    const blob = await renderer.render(data);
    expect(blob.type).toBe("image/png");
    expect(canvases).toEqual([[2000, 1528]]);
    expect(fonts.sort()).toEqual(["MW Market", "MW NewZurica"]);
    expect(loaded.sort()).toEqual(["BKG.WMF", "MARKET__.TTF", "NEWZURCA.TTF", "RIB1.WMF", "RIB2.WMF"]);
    await renderer.render(data);
    expect(loaded).toHaveLength(5);
    expect(fonts).toHaveLength(2);
    expect(CERTIFICATE_RIBBON_FILES).toHaveLength(5);
  });

  it("CertificateRenderer : un fichier manquant rejette sans garder l'échec", async () => {
    const { env } = fakeEnvironment();
    let fail = true;
    const renderer = new CertificateRenderer(env, async (path) => {
      if (fail && path === "BKG.WMF") throw new Error("absent");
      return /\.WMF$/.test(path) ? buildWmf([]) : new Uint8Array(1);
    });
    const data = buildCertificateData({ playerName: "Léa", mask: 1, operation: 0, ranks: RANKS })!;
    await expect(renderer.render(data)).rejects.toThrow("absent");
    fail = false;
    await expect(renderer.render(data)).resolves.toBeInstanceOf(Blob);
  });
});

describe("Hall of Fame : pages et rubans", () => {
  const many = Array.from({ length: 17 }, (_, i) => player(i + 1, `Joueur ${String(i).padStart(2, "0")}`, i === 9 ? maskOf([0, 0]) : 0));

  it("8 joueurs par page, dernière page = (n - 1) / 8", () => {
    expect([0, 1, 8, 9, 16, 17, 40].map(lastPageIndex)).toEqual([0, 0, 0, 1, 1, 2, 4]);
    expect(PLAYERS_PER_PAGE).toBe(8);
    expect(clampPage(-3, 17)).toBe(0);
    expect(clampPage(9, 17)).toBe(2);
    const page = buildPage(many, 2, RANKS);
    expect(page.map((row) => row?.player.name ?? null)).toEqual(["Joueur 16", null, null, null, null, null, null, null]);
    expect(buildPage(many, 1, RANKS)[1]!.player.name).toBe("Joueur 09");
  });

  it("une cellule par opération : quintet, activité et un ruban par bit (0 à 4)", () => {
    const mask = maskOf([0, 0], [0, 3], [2, 4], [5, 1], [5, 2]);
    const cells = Array.from({ length: 6 }, (_, op) => buildCell(mask, op));
    expect(cells.map((c) => c.active)).toEqual([true, false, true, false, false, true]);
    expect(cells[0]!.levels).toEqual([true, false, false, true, false]);
    expect(cells[2]!.levels).toEqual([false, false, false, false, true]);
    expect(cells[5]!.levels).toEqual([false, true, true, false, false]);
    expect(cells[5]!.quintet).toBe(0b00110);
  });

  it("géométrie : cellules en (172 + 60 c, 75 + 37 r), 51 × 30", () => {
    expect(cellRect(0, 0)).toEqual({ x: CELL_LEFT, y: 75, w: 51, h: 30 });
    expect(cellRect(7, 5)).toEqual({ x: 172 + 300, y: 75 + 37 * 7, w: 51, h: 30 });
  });

  it("rang affiché : STRL 5000 à l'indice (rang - 1) ; préfixe d'origine", () => {
    const rows = buildPage([player(1, "Ana", maskOf([0, 0], [1, 1]))], 0, RANKS);
    expect(rows[0]!.grade).toBe(3);
    expect(rows[0]!.rank).toBe("Rang 3");
    expect(RANK_PREFIX).toBe("Rank: ");
  });

  it("présélectionne la première cellule active, ligne par ligne, et la retrouve à chaque page", () => {
    const players = [player(1, "A"), player(2, "B", maskOf([3, 0], [1, 0])), ...Array.from({ length: 7 }, (_, i) => player(i + 3, `C${i}`, maskOf([5, 2])))];
    const model = new HallOfFameModel(RANKS);
    model.setPlayers(players);
    expect(model.selection).toEqual({ row: 1, operation: 1 });
    expect(model.pageCount).toBe(2);
    expect(model.movePage(1)).toBe(true);
    expect(model.page).toBe(1);
    expect(model.selection).toEqual({ row: 0, operation: 5 });
    expect(model.movePage(1)).toBe(false); // pas de rebouclage
    expect(model.movePage(-1)).toBe(true);
    expect(model.movePage(-1)).toBe(false);
    expect(firstActiveCell(buildPage([player(1, "A")], 0, RANKS))).toBeNull();
  });

  it("sélection par clic : seulement une cellule active ; certificat de la cellule choisie", () => {
    const model = new HallOfFameModel(RANKS);
    model.setPlayers([player(1, "Ana", maskOf([0, 0], [2, 1], [2, 4]))]);
    expect(model.selectCell(0, 1)).toBe(false); // inactive
    expect(model.selectCell(1, 0)).toBe(false); // ligne vide
    expect(model.selection).toEqual({ row: 0, operation: 0 });
    expect(model.selectCell(0, 2)).toBe(true);
    const data = model.selectedCertificate()!;
    expect(data.title).toBe("Multiplication Certificate of Merit");
    expect(data.ribbonFiles).toEqual(["RIB2.WMF", "RIBB.WMF"]);
    expect(data.playerName).toBe("Ana");
    const empty = new HallOfFameModel(RANKS);
    empty.setPlayers([]);
    expect(empty.selectedCertificate()).toBeNull();
    expect(empty.pageCount).toBe(1);
  });

  it("setPlayers conserve la page, ramenée dans les limites si des joueurs disparaissent", () => {
    const model = new HallOfFameModel(RANKS);
    model.setPlayers(many, 2);
    expect(model.page).toBe(2);
    model.setPlayers(many.slice(0, 5));
    expect(model.page).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("Hall of Fame : scène (TROPHY.DAT)", () => {
  async function boot(players: { name: string; mask: number }[], options: Parameters<typeof createTrophyScene>[1] = {}) {
    const host = new TestHost();
    const roster = Roster.createEmpty();
    for (const { name, mask } of players) {
      const added = roster.addPlayer(name);
      if (!added.ok) throw new Error(name);
      roster.setMask(added.id, mask);
    }
    new RosterStore(host.storage).save(roster);
    const engine = new Engine(host, { seed: 1 });
    const services = installServices(engine);
    engine.register(SceneId.trophy, () => createTrophyScene(services, options));
    engine.register(SceneId.hub, () => ({ enter() {}, leave: () => services.endScene(), tick() {} }));
    engine.start(SceneId.trophy);
    await runFor(engine, host, 1500);
    return { host, engine, services };
  }

  /** Pixels non noirs d'un rectangle de l'écran présenté. */
  function ink(host: TestHost, x: number, y: number, w: number, h: number): number {
    const pixels = host.frames.at(-1)!.pixels;
    let n = 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (pixels[j * 576 + i] === 0) n++;
    return n;
  }

  const players = Array.from({ length: 10 }, (_, i) => ({ name: `Joueur${i}`, mask: i === 0 ? maskOf([0, 0], [0, 1], [2, 4]) : 0 }));

  it("affiche le fond, le nom, le rang et les rubans des niveaux réussis", async () => {
    const { host, engine } = await boot(players, { certificates: { download() {} } });
    expect(engine.failed).toBe(false);
    const pixels = host.frames.at(-1)!.pixels;
    // Le nom (noir, indice 0) est dessiné dans la 1re barre, ligne de base 87 ; rien dans la barre vide du joueur suivant... qui a un nom aussi.
    expect(ink(host, 48, 75, 120, 30)).toBeGreaterThan(40);
    // Cellule (0, +) : rubans 1 et 2 ; cellule (0, ×) : ruban bonus à la 5e position.
    const fill = (x: number, y: number) => pixels[y * 576 + x];
    expect(fill(172 + 2 + 7, 77 + 4)).not.toBe(fill(172 + 2 + 18 + 7, 77 + 4)); // rubans de couleurs différentes côte à côte
    expect(fill(172 + 120 + 36 + 2 + 7, 77 + 4)).toBeDefined();
    // Cadre de sélection sur la 1re cellule active (+).
    expect(pixels[(75 - 2) * 576 + 172 + 10]).toBe(0);
    expect(pixels[(75 - 2) * 576 + 172 + 60 + 10]).not.toBe(0);
  });

  it("flèches : page suivante puis précédente (bornées) ; la page courante est conservée d'un accès à l'autre", async () => {
    const { host, engine, services } = await boot(players, { certificates: { download() {} } });
    const before = host.frames.at(-1)!.pixels.slice();
    host.click(47, 60); // flèche bas
    host.input.moveMouse(300, 200);
    await runFor(engine, host, 200);
    const after = host.frames.at(-1)!.pixels.slice();
    expect(after).not.toEqual(before);
    expect(ink(host, 48, 75, 120, 30)).toBeGreaterThan(40); // page 2 : joueurs 9 et 10
    expect(ink(host, 48, 75 + 37 * 2, 120, 30)).toBe(0); // 3e ligne vide : fond seul
    host.click(47, 60); // dernière page : sans effet
    host.input.moveMouse(300, 200);
    await runFor(engine, host, 200);
    expect(host.frames.at(-1)!.pixels).toEqual(after);
    // Retour au hub puis nouvel accès : la page 2 est restituée.
    host.click(519, 389); // EXIT
    host.input.moveMouse(300, 200);
    await runFor(engine, host, 200);
    expect(engine.scenes.currentId).toBe(SceneId.hub);
    engine.scenes.request(SceneId.trophy);
    await runFor(engine, host, 1500);
    expect(host.frames.at(-1)!.pixels).toEqual(after);
    expect(services).toBeDefined();
  });

  it("« Print My Certificate » : rend le PNG de la cellule sélectionnée et le remet au port", async () => {
    const downloads: { blob: Blob; filename: string }[] = [];
    const canvases: [number, number][] = [];
    const ctx = new RecordingContext();
    const { host, engine } = await boot(players, {
      certificates: { download: (blob, filename) => downloads.push({ blob, filename }) },
      certificateEnvironment: {
        createCanvas(w, h) {
          canvases.push([w, h]);
          return { getContext: () => ctx, toPng: async () => new Blob(["png"], { type: "image/png" }) };
        },
        async loadFont() {},
      },
    });
    host.click(280, 390);
    await runFor(engine, host, 300);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.filename).toBe("certificat-addition-joueur0.png");
    expect(downloads[0]!.blob.type).toBe("image/png");
    expect(canvases).toEqual([[2000, 1528]]);
    expect(ctx.calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toContain("Joueur0");
    // Les fichiers réels ont été lus : fond, 2 rubans (niveaux 1 et 2), 2 polices.
    expect(host.loaded).toEqual(expect.arrayContaining(["BKG.WMF", "RIB1.WMF", "RIB2.WMF", "MARKET__.TTF", "NEWZURCA.TTF"]));
    expect(ctx.count("fill")).toBeGreaterThan(571);
  });

  it("sélection d'une autre cellule, puis impression de son certificat", async () => {
    const downloads: string[] = [];
    const ctx = new RecordingContext();
    const { host, engine } = await boot(players, {
      certificates: { download: (_blob, filename) => downloads.push(filename) },
      certificateEnvironment: { createCanvas: () => ({ getContext: () => ctx, toPng: async () => new Blob(["x"]) }), async loadFont() {} },
    });
    host.click(172 + 120 + 20, 90); // cellule × du 1er joueur
    await runFor(engine, host, 100);
    host.click(280, 390);
    await runFor(engine, host, 300);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(downloads).toEqual(["certificat-multiplication-joueur0.png"]);
  });

  it("sans port de téléchargement, l'impression est inactive ; sans joueur à certifier, rien n'est rendu", async () => {
    const created: number[] = [];
    const env: CertificateEnvironment = { createCanvas: () => (created.push(1), { getContext: () => null, toPng: async () => new Blob() }), async loadFont() {} };
    const { host, engine } = await boot(players, { certificateEnvironment: env });
    host.click(280, 390);
    await runFor(engine, host, 300);
    const none = await boot([{ name: "Zoe", mask: 0 }], { certificates: { download() { throw new Error("jamais"); } }, certificateEnvironment: env });
    none.host.click(280, 390);
    await runFor(none.engine, none.host, 300);
    expect(created).toEqual([]);
  });

  it("EXIT et demande de sortie ramènent au hub (ou à `exitTo`)", async () => {
    const a = await boot(players);
    a.host.click(519, 389);
    await runFor(a.engine, a.host, 200);
    expect(a.engine.scenes.currentId).toBe(SceneId.hub);
    const b = await boot(players, { exitTo: SceneId.hub });
    expect(b.engine.scenes.requestExit()).toBe(true);
    await runFor(b.engine, b.host, 200);
    expect(b.engine.scenes.currentId).toBe(SceneId.hub);
  });
});
