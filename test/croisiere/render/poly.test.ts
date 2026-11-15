import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCtp } from "../../../src/games/croisiere/data/ctp";
import { type PolyModel, type PolyRecord, parsePolyRecord } from "../../../src/games/croisiere/data/poly-model";
import { SetFile } from "../../../src/games/croisiere/data/sets";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { POLY_MASK_SIZE, PolyRasterizer, polyBounds, resolvePoly } from "../../../src/games/croisiere/render/poly";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const hasOriginalFiles = original.has && ["D1", "D2", "D3", "D4", "D5"].every((name) => original.list((n) => n === name).length === 1);

/** Modèle synthétique : points (x, y), polygones [couleur, minScale, ...indices], pivot (lowerX, lowerY). */
function model(points: number[], polygons: number[][], lowerX = points[0]!, lowerY = points[1]!): PolyModel {
  const bytes = [1, 100, 100, lowerX, lowerY, points.length / 2, ...points];
  for (const [color, minScale, ...indices] of polygons) bytes.push(indices.length, color!, 0, minScale! >> 8, minScale! & 255, ...indices);
  bytes.push(0xff, 0, 0, 0, 0);
  const record = parsePolyRecord(Uint8Array.from(bytes));
  if (record.kind !== "model") throw new Error("modèle attendu");
  return record;
}

/** Pixels de couleur `color` d'un écran, ligne par ligne : `y: [xmin, xmax]` (suppose des lignes pleines). */
function rows(screen: Uint8Array, color: number): Record<number, [number, number]> {
  const out: Record<number, [number, number]> = {};
  for (let i = 0; i < screen.length; i++) {
    if (screen[i] !== color) continue;
    const y = Math.floor(i / 320);
    const x = i % 320;
    const row = (out[y] ??= [x, x]);
    row[0] = Math.min(row[0], x);
    row[1] = Math.max(row[1], x);
  }
  return out;
}

const SQUARE = model([10, 10, 20, 10, 20, 20, 10, 20], [[7, 0, 0, 1, 2, 3]]);

describe("rastériseur de polygones (synthétique)", () => {
  it("dessine un carré à 100 % (512) depuis le premier point, bornes incluses", () => {
    const screen = new Uint8Array(320 * 200);
    new PolyRasterizer().drawModel(SQUARE, 100, 50, 512, screen);
    const expected: Record<number, [number, number]> = {};
    for (let y = 50; y <= 60; y++) expected[y] = [100, 110];
    expect(rows(screen, 7)).toEqual(expected);
  });

  it("miroir (échelle négative) : x opposés autour du point d'origine", () => {
    const screen = new Uint8Array(320 * 200);
    new PolyRasterizer().drawModel(SQUARE, 100, 50, -512, screen);
    expect(rows(screen, 7)[55]).toEqual([90, 100]);
  });

  it("demi-résolution sous 0x180 (coordonnées >> 1, échelle doublée) et LOD par polygone", () => {
    const lod = model([10, 10, 20, 10, 20, 20, 10, 20], [[7, 0, 0, 1, 2, 3], [9, 0x100, 0, 1, 2]]);
    const screen = new Uint8Array(320 * 200);
    new PolyRasterizer().drawModel(lod, 100, 50, 0xff, screen);
    expect(rows(screen, 7)[50]).toEqual([100, 105]); // 10 >> 1 = 5 pixels, à l'échelle 0x1FE ≈ 100 %
    expect(rows(screen, 9)).toEqual({});
  });

  it("masque : seuls les bits à 1 sont peints", () => {
    const screen = new Uint8Array(320 * 200);
    const mask = new Uint8Array(POLY_MASK_SIZE).fill(0xff);
    mask[55 * 40 + 13] = 0; // x de 104 à 111 sur la ligne 55
    new PolyRasterizer().drawModel(SQUARE, 100, 50, 512, screen, mask);
    expect(screen.subarray(55 * 320 + 100, 55 * 320 + 111)).toEqual(Uint8Array.from([7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0]));
  });

  it("hit-test (findPoly) et boîte de getPolySize", () => {
    const raster = new PolyRasterizer();
    expect(raster.hitTest(SQUARE, 100, 50, 512, 105, 55)).toBe(true);
    expect(raster.hitTest(SQUARE, 100, 50, 512, 111, 55)).toBe(false);
    expect(polyBounds(SQUARE, 100, 50, 512)).toEqual({ left: 90, right: 190, top: 40, bottom: 140 });
  });

  it("polygone hors écran : nbligne = -1 et XMIN_XMAX[0] = -1, rien n'est touché", () => {
    const raster = new PolyRasterizer();
    const screen = new Uint8Array(320 * 200);
    raster.drawModel(SQUARE, 400, 50, 512, screen);
    expect(raster.lineCount).toBe(-1);
    expect(raster.snapshot()[1024]).toBe(-1); // XMIN_XMAX[0]
    expect(screen.every((v) => v === 0)).toBe(true);
  });

  it("renvoi miroir : cible relative, échelle opposée, position décalée ; cible invalide ignorée", () => {
    const mirror: PolyRecord = { kind: "mirror", offset: -1, newX: 3, newY: -2 };
    const records: PolyRecord[] = [SQUARE, mirror];
    expect(resolvePoly(1, mirror, 100, 50, 512, (i) => records[i] ?? null)).toEqual({ model: SQUARE, x: 97, y: 52, scale: -512 });
    expect(resolvePoly(0, mirror, 100, 50, 512, (i) => records[i] ?? null)).toBeNull();
    expect(new PolyRasterizer().drawCell(1, mirror, 100, 50, 512, new Uint8Array(64000), null, (i) => records[i] ?? null)).toEqual({
      left: 5,
      top: 40,
      right: 125,
      bottom: 144,
    });
  });

  it("zone de marche (renderCTPWalkBox + lecture de makeCtStruct)", () => {
    const raster = new PolyRasterizer();
    raster.rasterizeWalkbox([3, 10, 10, 20, 10, 10, 14], 15, 12, 15, 12, 0x200);
    expect(raster.spanTable()).toEqual({
      top: 10,
      spans: [
        [10, 21], // l'arête en pente faible déborde d'un pixel à chaque changement de ligne (comme ScummVM)
        [10, 18],
        [10, 16],
        [10, 13],
        [10, 11],
      ],
    });
  });

  it("débordement de l'anneau miroir dans XMIN_XMAX (FIXME de ScummVM) : même forme altérée que ScummVM", () => {
    // 40 sommets sur 185 lignes, dessinés juste après un polygone de 2 sommets (nbseg = 2) : en miroir, l'anneau descend dans XMIN_XMAX.
    const points = [
      25, 160, 20, 149, 15, 137, 12, 123, 11, 109, 10, 95, 11, 81, 12, 67, 15, 53, 20, 41, 25, 30, 31, 21, 37, 13, 45, 8, 52, 4, 60, 3,
      68, 4, 75, 8, 83, 13, 89, 21, 95, 30, 100, 41, 105, 53, 108, 67, 109, 81, 110, 95, 109, 109, 108, 123, 105, 137, 100, 149, 95, 160,
      89, 169, 83, 177, 75, 182, 68, 186, 60, 187, 52, 186, 45, 182, 37, 177, 31, 169,
    ];
    const tall = model(points, [[5, 0, 0, 1], [9, 0, ...Array.from({ length: 40 }, (_, i) => i)]], 60, 95);
    const raster = new PolyRasterizer();
    const screen = new Uint8Array(320 * 200);
    // Empreintes FNV-1a de l'écran et pixels de couleur 9, relevés sur le code de ScummVM compilé.
    const fnv1a = (bytes: Uint8Array) => bytes.reduce((h, b) => Math.imul(h ^ b, 16777619) >>> 0, 0x811c9dc5);
    const count = () => screen.reduce((n, v) => n + (v === 9 ? 1 : 0), 0);
    raster.drawModel(tall, 160, 100, 512, screen);
    expect([fnv1a(screen).toString(16), count(), raster.lineCount]).toEqual(["3c5043f8", 14559, 185]);
    screen.fill(0);
    raster.drawModel(tall, 160, 100, -512, screen);
    expect([fnv1a(screen).toString(16), count(), raster.lineCount]).toEqual(["9e00d7aa", 36977, 185]);
  });

  it("refuse un polygone de moins de 2 sommets", () => {
    expect(() => new PolyRasterizer().rasterizeWalkbox([1, 10, 10], 0, 0, 0, 0, 0x200)).toThrow(RangeError);
  });
});

// -----------------------------------------------------------------------------------------------------------------------------------
// Bit à bit contre ScummVM : `fixtures/poly-scummvm.txt` vient d'un banc C++ qui compile les fonctions de `mainDraw.cpp`
// (de `flipPoly` à `findPoly`), `renderCTPWalkBox` et `testMask` extraites telles quelles, avec un pilote reprenant `mainDrawPolygons`
// sans les masques de décor. Une seule instance d'état enchaîne toutes les opérations (dessins, hit-tests, zones de marche), comme le
// moteur : `nbseg` et les tampons laissés par l'opération précédente comptent. Chaque ligne : opération = empreinte FNV-1a 32 bits
// (écran 320 × 200 pour D et I, puis `bigPolyBuf` en int16 petit-boutiste), `nbseg`, `nbligne`, et le résultat (rectangle, touché,
// ou ligne de départ, nombre et empreinte des intervalles de la zone).
//   D set entrée x y échelle masque : `mainDrawPolygons` (masque 1 = plein, 2 = motif) ;
//   I set entrée x y échelle : `buildPolyModel` sans masque (incrustation) ;
//   H set entrée x y échelle souris_x souris_y : `findObject` (renvoi miroir puis `findPoly`) ;
//   W ctp zone élargie : `makeCtStruct` (échelle 0x200, ou `walkboxZoom * 20 + 0x200`).
// -----------------------------------------------------------------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 16777619;
function fnv(hash: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i]!, FNV_PRIME) >>> 0;
  return hash;
}
const hex = (n: number) => n.toString(16).padStart(8, "0");
const le16 = (words: Int16Array) => new Uint8Array(words.buffer, words.byteOffset, words.byteLength); // petit-boutiste (x86, ARM)

describe.skipIf(!hasOriginalFiles)("rastériseur de polygones : identique à ScummVM (fichiers originaux)", () => {
  it("2 064 opérations sur BIGRAOUL.SET (78 entrées × 4 zooms × miroir), 300 modèles au hasard et les 210 zones de marche", () => {
    const volumes = CruiseVolumes.open((name) => original.read(name));
    const sets = new Map<string, (index: number) => PolyRecord | null>();
    const setOf = (name: string) => {
      let records = sets.get(name);
      if (!records) {
        const set = new SetFile(volumes.readFile(name));
        const cache = new Map<number, PolyRecord | null>();
        records = (index) => {
          if (!cache.has(index)) {
            const entry = index < set.length ? set.entry(index) : null;
            cache.set(index, entry?.kind === "poly" ? parsePolyRecord(entry.data) : null);
          }
          return cache.get(index)!;
        };
        sets.set(name, records);
      }
      return records;
    };
    const ctps = new Map<string, ReturnType<typeof parseCtp>>();
    const ctpOf = (name: string) => {
      if (!ctps.has(name)) ctps.set(name, parseCtp(volumes.readFile(name)));
      return ctps.get(name)!;
    };

    const fullMask = new Uint8Array(POLY_MASK_SIZE).fill(0xff);
    const patternMask = new Uint8Array(POLY_MASK_SIZE).map((_, i) => i * 73 + (i >> 7) * 29);
    const screen = new Uint8Array(320 * 200);
    const raster = new PolyRasterizer();
    const lines = readFileSync(resolve(import.meta.dirname, "fixtures/poly-scummvm.txt"), "utf8").trim().split("\n");
    const mismatches: string[] = [];

    lines.forEach((line, opIndex) => {
      const [op, expected] = line.split(" = ") as [string, string];
      const [kind, name, ...rest] = op.split(" ");
      const [entry, x, y, scale, a, b] = rest.map(Number) as number[];
      screen.fill((opIndex * 37 + 11) & 0xff);
      let extra = "-";
      let withScreen = false;
      if (kind === "D" || kind === "I" || kind === "H") {
        const records = setOf(name!);
        const record = records(entry!)!;
        if (kind === "D") {
          const rect = raster.drawCell(entry!, record, x!, y!, scale!, screen, a === 2 ? patternMask : fullMask, records);
          if (rect) extra = `${rect.left},${rect.top},${rect.right},${rect.bottom}`;
          withScreen = true;
        } else if (kind === "I") {
          raster.drawModel(record as PolyModel, x!, y!, scale!, screen);
          withScreen = true;
        } else {
          extra = raster.hitTestRecord(entry!, record, x!, y!, scale!, a!, b!, records) ? "1" : "0";
        }
      } else {
        const ctp = ctpOf(name!);
        const [walkbox, extended] = rest.map(Number) as [number, number];
        const row = ctp.walkboxRows[walkbox]!;
        let minX = 1000;
        let minY = 1000;
        let maxX = -1;
        let maxY = -1;
        for (let i = 0; i < row[0]!; i++) {
          minX = Math.min(minX, row[i * 2 + 1]!);
          maxX = Math.max(maxX, row[i * 2 + 1]!);
          minY = Math.min(minY, row[i * 2 + 2]!);
          maxY = Math.max(maxY, row[i * 2 + 2]!);
        }
        const centerX = Math.trunc((maxX - minX) / 2) + minX;
        const centerY = Math.trunc((maxY - minY) / 2) + minY;
        raster.rasterizeWalkbox(row, centerX, centerY, centerX, centerY, 0x200 + (extended ? ctp.walkboxes[walkbox]!.zoom * 20 : 0));
        const table = raster.spanTable();
        const hash = fnv(FNV_OFFSET, le16(Int16Array.from(table.spans.flat())));
        extra = `${table.top},${table.spans.length},${hex(hash)}`;
      }
      let hash = withScreen ? fnv(FNV_OFFSET, screen) : FNV_OFFSET;
      hash = fnv(hash, le16(raster.snapshot()));
      const actual = `${hex(hash)} ${raster.segmentCount} ${raster.lineCount} ${extra}`;
      if (actual !== expected) mismatches.push(`#${opIndex} ${op} : ${actual} au lieu de ${expected}`);
    });

    expect(lines).toHaveLength(2064);
    expect(mismatches.slice(0, 10)).toEqual([]);
  });
});
