import { describe, expect, it } from "vitest";
import { BLOCK_CEL_DATA, BLOCK_MARKER_SIZE, BLOCK_PALETTE, BLOCK_ROW_TABLES, type CelHeader, CEL_HEADER_SIZE, decodeCel, decodeCelWithUsage, readBlockMarker, readCelHeader } from "../../../src/games/gk1/data/cel-rle";
import { readFont, glyphFor } from "../../../src/games/gk1/data/font";
import { CEL_RAW, CEL_RLE, ResourceType, VIEW_RESOLUTION_320X200, VIEW_RESOLUTION_640X400, VIEW_RESOLUTION_640X480 } from "../../../src/games/gk1/data/ids";
import { paletteToRgba, readPalette } from "../../../src/games/gk1/data/palette";
import { decodePicCel, readPic } from "../../../src/games/gk1/data/pic";
import type { ResourceIndex } from "../../../src/games/gk1/data/resource-map";
import { decodeViewCel, readView } from "../../../src/games/gk1/data/view";
import { altIndex, fnv1a, mainIndex, original, tally } from "./real";

function u16(n: number): number[] {
  return [n & 0xff, n >> 8];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
}

/** Palette synthétique d'une couleur par entrée de `colors` (`[utilisée, r, v, b]` ou `[r, v, b]`). */
function buildPalette(start: number, colors: number[][], shared: boolean): number[] {
  const header = [0x0e, ...new Array(9).fill(0x77), 1, 0, 0, ...u16(22 + colors.flat().length)];
  const entry = [...new Array(10).fill(0x55), start, 0, 0, 0, ...u16(colors.length), 9, shared ? 1 : 0, ...u32(3)];
  return [...header, ...entry, ...colors.flat()];
}

/** Cel RLE synthétique : `rows` = par ligne, [octets de contrôle, littéraux]. Renvoie la ressource (en-tête à 0). */
function buildRleCel(width: number, rows: [number[], number[]][], skip = 255): Uint8Array {
  const control = rows.flatMap(([c]) => c);
  const literal = rows.flatMap(([, l]) => l);
  const dataOffset = CEL_HEADER_SIZE;
  const literalOffset = dataOffset + control.length;
  const rowTableOffset = literalOffset + literal.length;
  const controlRows: number[] = [];
  const literalRows: number[] = [];
  let c = 0;
  let l = 0;
  for (const [rc, rl] of rows) {
    controlRows.push(...u32(c));
    literalRows.push(...u32(l));
    c += rc.length;
    l += rl.length;
  }
  return Uint8Array.from([
    ...u16(width), ...u16(rows.length), ...u16(3), ...u16(0xfffe), skip, CEL_RLE, 0, 0,
    ...u32(control.length + literal.length), ...u32(control.length), ...u32(0), ...u32(dataOffset), ...u32(literalOffset), ...u32(rowTableOffset),
    ...control, ...literal, ...controlRows, ...literalRows,
  ]);
}

describe("cel SCI2", () => {
  it("lit l'en-tête et décode les trois commandes du RLE", () => {
    const cel = buildRleCel(6, [
      [[0x02, 0x83, 0xc1], [10, 11, 12]], // copie 2, répète 12 trois fois, 1 transparent
      [[0xc6], []], // ligne transparente
      [[0x86], [5]], // 6 × 5
    ], 99);
    const header = readCelHeader(cel, 0);
    expect(header).toMatchObject({ width: 6, height: 3, originX: 3, originY: -2, skipColor: 99, compression: CEL_RLE, flags: 0, dataSize: 9, controlSize: 5 });
    const { pixels, usage } = decodeCelWithUsage(cel, header);
    expect([...pixels]).toEqual([10, 11, 12, 12, 12, 99, 99, 99, 99, 99, 99, 99, 5, 5, 5, 5, 5, 5]);
    expect(usage).toEqual({ dataUsed: 5, literalUsed: 4, rowTableSize: 24 });
    expect(decodeCel(cel, header)).toEqual(pixels);
  });

  it("décode un cel brut", () => {
    const head = [...u16(2), ...u16(2), 0, 0, 0, 0, 0, CEL_RAW, 0, 0, ...u32(4), ...u32(0), ...u32(0), ...u32(CEL_HEADER_SIZE), ...u32(0), ...u32(0)];
    const cel = Uint8Array.from([...head, 1, 2, 3, 4]);
    expect([...decodeCel(cel, readCelHeader(cel, 0))]).toEqual([1, 2, 3, 4]);
    expect(() => decodeCel(cel.subarray(0, 38), readCelHeader(cel, 0))).toThrow(/brut hors/);
  });

  it("refuse une ligne qui déborde, une table des lignes fausse et une compression inconnue", () => {
    expect(() => decodeCel(buildRleCel(2, [[[0x83], [1]]]), readCelHeader(buildRleCel(2, [[[0x83], [1]]]), 0))).toThrow(/hors de la ligne/);
    expect(() => decodeCel(buildRleCel(2, [[[0x03], [1, 2, 3]]]), readCelHeader(buildRleCel(2, [[[0x03], [1, 2, 3]]]), 0))).toThrow(/hors limites/);
    const cel = buildRleCel(2, [[[0x82], [1]], [[0x82], [2]]]);
    cel[cel.length - 4] = 9;
    expect(() => decodeCel(cel, readCelHeader(cel, 0))).toThrow(/table des lignes/);
    const bad = buildRleCel(1, [[[0x81], [1]]]);
    bad[9] = 5;
    expect(() => readCelHeader(bad, 0)).toThrow(/compression de cel 5/);
    expect(() => readCelHeader(bad.subarray(0, 20), 0)).toThrow(/hors de la ressource/);
  });

  it("reconnaît un marqueur de bloc", () => {
    expect(readBlockMarker(Uint8Array.of(0, 3, 0x21, 0x04, 0, 0), 0)).toEqual({ tag: BLOCK_PALETTE, size: 1057 });
    expect(readBlockMarker(Uint8Array.of(1, 3, 0, 0, 0, 0), 0)).toBeUndefined();
    expect(readBlockMarker(Uint8Array.of(0, 9, 0, 0, 0, 0), 0)).toBeUndefined();
    expect(readBlockMarker(Uint8Array.of(0, 3, 0), 0)).toBeUndefined();
  });
});

describe("palette SCI2", () => {
  it("lit les deux formats", () => {
    const four = Uint8Array.from(buildPalette(2, [[1, 10, 20, 30], [0, 40, 50, 60]], false));
    const p4 = readPalette(four);
    expect(p4).toMatchObject({ start: 2, count: 2, sharedUsed: false, version: 3, byteLength: four.length });
    expect([...p4.rgb.subarray(6, 12)]).toEqual([10, 20, 30, 40, 50, 60]);
    expect([...p4.used.subarray(0, 5)]).toEqual([0, 0, 1, 0, 0]);

    const three = Uint8Array.from([0xaa, ...buildPalette(254, [[1, 2, 3], [4, 5, 6]], true)]);
    const p3 = readPalette(three, 1);
    expect(p3).toMatchObject({ start: 254, count: 2, sharedUsed: true, byteLength: three.length - 1 });
    expect([...p3.used.subarray(253)]).toEqual([0, 9, 9]);
    const rgba = paletteToRgba(p3);
    expect([...rgba.subarray(4 * 255)]).toEqual([4, 5, 6, 255]);
    expect([...rgba.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  it("refuse une signature inconnue, plusieurs palettes et des couleurs hors limites", () => {
    const bytes = Uint8Array.from(buildPalette(0, [[1, 2, 3]], true));
    expect(() => readPalette(bytes.subarray(0, 20))).toThrow(/tronquée/);
    expect(() => readPalette(Uint8Array.from([0x0f, ...bytes.subarray(1)]))).toThrow(/signature/);
    const two = bytes.slice();
    two[10] = 2;
    expect(() => readPalette(two)).toThrow(/2 palettes/);
    expect(() => readPalette(Uint8Array.from(buildPalette(255, [[1, 2, 3], [4, 5, 6]], true)))).toThrow(/hors limites/);
    expect(() => readPalette(bytes.subarray(0, bytes.length - 1))).toThrow(/hors limites/);
  });
});

describe("police SCI", () => {
  it("déplie les glyphes, un octet par pixel", () => {
    // Deux glyphes : 3×2 (101 / 010) et 9×1 (100000001).
    const font = readFont(Uint8Array.from([0, 0, ...u16(2), ...u16(8), ...u16(10), ...u16(14), 3, 2, 0b10100000, 0b01000000, 9, 1, 0x80, 0x80]));
    expect(font.lineHeight).toBe(8);
    expect(font.byteLength).toBe(18);
    expect(glyphFor(font, 0)).toEqual({ width: 3, height: 2, pixels: Uint8Array.of(1, 0, 1, 0, 1, 0) });
    expect([...glyphFor(font, 1)!.pixels]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(glyphFor(font, 2)).toBeUndefined();
  });

  it("refuse une police tronquée", () => {
    expect(() => readFont(Uint8Array.of(0, 0, 1))).toThrow(/tronquée/);
    expect(() => readFont(Uint8Array.from([0, 0, ...u16(4), ...u16(8), 0, 0]))).toThrow(/table des glyphes/);
    expect(() => readFont(Uint8Array.from([0, 0, ...u16(1), ...u16(8), ...u16(8), 8, 2, 0xff]))).toThrow(/glyphe tronqué/);
  });
});

/** Marque les octets d'un cel et vérifie que le décodage consomme exactement les tailles annoncées. */
function coverCel(data: Uint8Array, used: Uint8Array, cel: CelHeader): void {
  const { pixels, usage } = decodeCelWithUsage(data, cel);
  expect(pixels).toHaveLength(cel.width * cel.height);
  expect(cel.paletteOffset).toBe(0);
  expect(cel.flags).toBe(0);
  if (cel.compression === CEL_RLE) {
    expect(usage.dataUsed).toBe(cel.controlSize);
    expect(usage.literalUsed).toBe(cel.dataSize - cel.controlSize);
    mark(used, cel.literalOffset, usage.literalUsed);
    mark(used, cel.rowTableOffset, usage.rowTableSize);
  }
  mark(used, cel.dataOffset, usage.dataUsed);
}

function mark(used: Uint8Array, offset: number, size: number): void {
  for (let i = offset; i < offset + size; i++) used[i]++;
}

/** Les octets non marqués doivent être exactement les marqueurs de bloc ; renvoie leurs étiquettes, dans l'ordre. */
function expectOnlyBlockMarkers(data: Uint8Array, used: Uint8Array, paletteSize: number): number[] {
  expect(used.some((n) => n > 1)).toBe(false);
  const tags: number[] = [];
  let i = 0;
  while (i < data.length) {
    if (used[i]) {
      i++;
      continue;
    }
    const marker = readBlockMarker(data, i);
    expect(marker).toBeDefined();
    for (let k = 0; k < BLOCK_MARKER_SIZE; k++) expect(used[i + k]).toBe(0);
    const end = i + BLOCK_MARKER_SIZE;
    if (marker!.tag === BLOCK_PALETTE) expect(marker!.size).toBe(paletteSize);
    if (marker!.tag === BLOCK_ROW_TABLES) expect(marker!.size).toBe(0);
    if (marker!.tag === BLOCK_CEL_DATA) {
      // Le bloc va jusqu'au marqueur suivant ou jusqu'à la fin ; sa taille est écrite modulo 65 536 pour les cels bruts 640×480.
      let next = end;
      while (next < data.length && used[next]) next++;
      expect(marker!.size === next - end || marker!.size === (next - end) % 0x10000).toBe(true);
    }
    tags.push(marker!.tag);
    i = end;
  }
  return tags;
}

function checkViews(index: ResourceIndex): { cels: number; mirrors: number; unmirroredLinks: number; raw: number; resolutions: Map<number, number>; layouts: Map<string, number> } {
  let cels = 0;
  let mirrors = 0;
  let unmirroredLinks = 0;
  let raw = 0;
  const resolutions: number[] = [];
  const layouts: string[] = [];
  for (const n of index.numbers(ResourceType.View)) {
    const data = index.get(ResourceType.View, n);
    const view = readView(data);
    expect([view.headerSize, view.loopHeaderSize, view.celHeaderSize]).toEqual([18, 16, 36]);
    expect(view.palette).toBeDefined();
    resolutions.push(view.resolution);
    const used = new Uint8Array(data.length);
    mark(used, 0, view.headerSize + view.loops.length * view.loopHeaderSize);
    mark(used, view.paletteOffset, view.palette!.byteLength);
    let own = 0;
    const seen = new Set<CelHeader>();
    view.loops.forEach((loop, l) => {
      if (loop.source !== undefined) {
        mirrors++;
        if (!loop.mirrored) unmirroredLinks++;
        expect(loop.cels).toBe(view.loops[loop.source].cels);
        return;
      }
      expect(loop.mirrored).toBe(false);
      const celsOffset = new DataView(data.buffer, data.byteOffset).getUint32(view.headerSize + l * view.loopHeaderSize + 12, true);
      mark(used, celsOffset, loop.cels.length * view.celHeaderSize);
      loop.cels.forEach((cel, c) => {
        expect(seen.has(cel)).toBe(false);
        seen.add(cel);
        coverCel(data, used, cel);
        if (cel.compression === CEL_RAW) raw++;
        if (c === 0 && l === 0) expect(decodeViewCel(view, l, c)).toHaveLength(cel.width * cel.height);
        own++;
      });
    });
    expect(own).toBe(view.celCount);
    // Octet @4 de l'en-tête : la vue a-t-elle des cels compressés ?
    expect(data[4]).toBe([...seen].some((cel) => cel.compression === CEL_RLE) ? 1 : 0);
    cels += own;
    layouts.push(expectOnlyBlockMarkers(data, used, view.palette!.byteLength).join(","));
  }
  return { cels, mirrors, unmirroredLinks, raw, resolutions: tally(resolutions), layouts: tally(layouts) };
}

describe.skipIf(!original.has)("graphismes de Gabriel Knight", () => {
  it("décode les 15 698 cels des 837 vues jusqu'au dernier octet", () => {
    const result = checkViews(mainIndex());
    expect(result.cels).toBe(15698);
    expect(result.mirrors).toBe(148);
    expect(result.unmirroredLinks).toBe(1);
    expect(result.raw).toBe(0);
    expect([...result.resolutions]).toEqual([[VIEW_RESOLUTION_320X200, 837]]);
    expect([...result.layouts]).toEqual([[`${BLOCK_PALETTE},${BLOCK_CEL_DATA},${BLOCK_ROW_TABLES}`, 837]]);
  }, 60_000);

  it("décode les 814 cels des 59 vues haute résolution de RESOURCE.ALT", () => {
    const result = checkViews(altIndex());
    expect(result.cels).toBe(814);
    expect(result.mirrors).toBe(0);
    expect(result.raw).toBe(15);
    expect(Object.fromEntries(result.resolutions)).toEqual({ [VIEW_RESOLUTION_640X480]: 48, [VIEW_RESOLUTION_640X400]: 11 });
    expect(Object.fromEntries(result.layouts)).toEqual({ [`${BLOCK_PALETTE},${BLOCK_CEL_DATA}`]: 15, [`${BLOCK_PALETTE},${BLOCK_CEL_DATA},${BLOCK_ROW_TABLES}`]: 44 });
  });

  it("décode les 459 cels des 158 pics jusqu'au dernier octet", () => {
    const index = mainIndex();
    const compressions: number[] = [];
    const priorities = new Set<number>();
    const celCounts: number[] = [];
    const backgrounds: string[] = [];
    for (const n of index.numbers(ResourceType.Pic)) {
      const data = index.get(ResourceType.Pic, n);
      const pic = readPic(data);
      expect([pic.headerSize, pic.celHeaderSize]).toEqual([14, 42]);
      expect(pic.palette).toBeDefined();
      const used = new Uint8Array(data.length);
      mark(used, 0, pic.headerSize + pic.cels.length * pic.celHeaderSize);
      mark(used, pic.paletteOffset, pic.palette!.byteLength);
      pic.cels.forEach((cel, c) => {
        coverCel(data, used, cel);
        compressions.push(cel.compression);
        expect([cel.originX, cel.originY]).toEqual([0, 0]);
        expect(cel.x).toBeGreaterThanOrEqual(0);
        expect(cel.y).toBeGreaterThanOrEqual(0);
        expect(cel.x + cel.width).toBeLessThanOrEqual(320);
        expect(cel.y + cel.height).toBeLessThanOrEqual(200);
        if (c === 0) expect(cel.priority).toBe(-1000);
        else priorities.add(cel.priority);
      });
      // Octet @3 de l'en-tête : le pic a-t-il des cels compressés ?
      expect(data[3]).toBe(pic.cels.some((cel) => cel.compression === CEL_RLE) ? 1 : 0);
      celCounts.push(pic.cels.length);
      backgrounds.push(`${pic.cels[0].width}x${pic.cels[0].height}`);
      const tags = expectOnlyBlockMarkers(data, used, pic.palette!.byteLength);
      expect(tags.slice(0, 2)).toEqual([BLOCK_PALETTE, BLOCK_CEL_DATA]);
    }
    expect(celCounts).toHaveLength(158);
    expect(celCounts.reduce((a, b) => a + b, 0)).toBe(459);
    expect(celCounts.filter((n) => n === 1)).toHaveLength(102);
    expect(Math.max(...celCounts)).toBe(11);
    expect(Object.fromEntries(tally(compressions))).toEqual({ [CEL_RLE]: 297, [CEL_RAW]: 162 });
    expect([...priorities].sort((a, b) => a - b)).toEqual([53, 64, 74, 85, 95, 106, 116, 121, 127, 138, 148, 159, 169, 180, 1000]);
    expect(tally(backgrounds).get("320x190")).toBe(95);
  });

  it("compose le décor de la librairie (pic 210) à l'identique", () => {
    const pic = readPic(mainIndex().get(ResourceType.Pic, 210));
    expect(pic.cels.map((c) => c.priority)).toEqual([-1000, 95, 106, 116, 127, 138, 148, 159, 169, 180, 1000]);
    const screen = new Uint8Array(320 * 200);
    pic.cels.forEach((cel, c) => {
      const pixels = decodePicCel(pic, c);
      for (let y = 0; y < cel.height; y++) {
        for (let x = 0; x < cel.width; x++) {
          const v = pixels[y * cel.width + x];
          if (v !== cel.skipColor) screen[(cel.y + y) * 320 + cel.x + x] = v;
        }
      }
    });
    expect(fnv1a(screen)).toBe(PIC_210_CHECKSUM);
  });

  it("lit les 7 palettes : 255 couleurs à partir de 0, sans reste", () => {
    const index = mainIndex();
    const sizes: number[] = [];
    for (const n of index.numbers(ResourceType.Palette)) {
      const data = index.get(ResourceType.Palette, n);
      const palette = readPalette(data);
      expect(palette).toMatchObject({ start: 0, count: 255, version: 0, byteLength: data.length });
      expect(palette.sharedUsed).toBe(data.length === 802);
      expect(palette.used[255]).toBe(0);
      sizes.push(data.length);
    }
    expect(sizes.sort()).toEqual([1057, 1057, 1057, 802, 802, 802, 802]);
  });

  it("lit les 11 polices jusqu'au dernier octet : 2 516 glyphes", () => {
    const index = mainIndex();
    let glyphs = 0;
    const lineHeights: number[] = [];
    for (const n of index.numbers(ResourceType.Font)) {
      const data = index.get(ResourceType.Font, n);
      const font = readFont(data);
      expect(font.byteLength).toBe(data.length);
      expect(font.glyphs).toHaveLength(n === 2 ? 256 : 226);
      glyphs += font.glyphs.length;
      lineHeights.push(font.lineHeight);
    }
    expect(glyphs).toBe(2516);
    expect(Math.min(...lineHeights)).toBe(7);
    expect(Math.max(...lineHeights)).toBe(23);
    // « é » (CP850 0x82) de la police 0 : un glyphe de 7 ou 8 pixels avec de l'encre.
    const e = glyphFor(readFont(index.get(ResourceType.Font, 0)), 0x82)!;
    expect(e.width).toBeGreaterThanOrEqual(7);
    expect(e.pixels.some((p) => p === 1)).toBe(true);
  });
});

const PIC_210_CHECKSUM = 975657463;
