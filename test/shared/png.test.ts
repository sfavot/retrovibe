import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, encodePng } from "../../scripts/lib/png.mjs";

const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0]);

/** Découpe un PNG en chunks `type -> corps`, en vérifiant leur CRC. */
function chunks(png: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    expect(png.readUInt32BE(offset + 8 + length)).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)));
    out.set(type, body);
    offset += 12 + length;
  }
  return out;
}

describe("crc32", () => {
  it("valeur de référence", () => {
    expect(crc32(Buffer.from("123456789", "latin1"))).toBe(0xcbf43926);
    expect(crc32(Buffer.from("IEND", "latin1"))).toBe(0xae426082);
  });
});

describe("encodePng", () => {
  it("écrit la signature, l'IHDR et un IEND valide (RGBA 2x2)", () => {
    const png = encodePng(2, 2, { rgba });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const all = chunks(png);
    const ihdr = all.get("IHDR")!;
    expect([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9]]).toEqual([2, 2, 8, 6]);
    // CRC de l'IHDR figé : toute dérive de l'encodeur casse ce test.
    expect(png.readUInt32BE(8 + 4 + 4 + 13)).toBe(crc32(png.subarray(12, 12 + 4 + 13)));
    expect(all.get("IEND")!.length).toBe(0);
    expect(png.subarray(png.length - 12).readUInt32BE(8)).toBe(0xae426082);
  });

  it("les données décompressées font (largeur x 4 + 1) x hauteur octets et retrouvent les pixels", () => {
    const raw = inflateSync(chunks(encodePng(2, 2, { rgba })).get("IDAT")!);
    expect(raw.length).toBe((2 * 4 + 1) * 2);
    expect(raw[0]).toBe(0);
    expect([...raw.subarray(1, 9)]).toEqual([...rgba.subarray(0, 8)]);
    expect([...raw.subarray(10, 18)]).toEqual([...rgba.subarray(8, 16)]);
  });

  it("image indexée : PLTE et un octet par pixel", () => {
    const palette = Uint8Array.from([0, 0, 0, 255, 255, 255]);
    const all = chunks(encodePng(2, 2, { indexed: Uint8Array.from([0, 1, 1, 0]), palette }));
    expect(all.get("IHDR")![9]).toBe(3);
    expect([...all.get("PLTE")!]).toEqual([...palette]);
    expect([...inflateSync(all.get("IDAT")!)]).toEqual([0, 0, 1, 0, 1, 0]);
  });

  it("refuse une taille de données incohérente", () => {
    expect(() => encodePng(2, 2, { rgba: new Uint8Array(3) })).toThrow();
    expect(() => encodePng(1, 1, { indexed: new Uint8Array(1), palette: new Uint8Array(4) })).toThrow();
  });
});
