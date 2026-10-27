import { describe, expect, it } from "vitest";
import { decodeMacRoman } from "../../src/data/mac-roman";
import { parseStrl } from "../../src/data/mohawk/strl";

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("decodeMacRoman", () => {
  it("laisse l'ASCII inchangé, retour chariot compris", () => {
    expect(decodeMacRoman(bytes(0x41, 0x7a, 0x0d, 0x20, 0x31))).toBe("Az\r 1");
  });

  it("décode les caractères hauts de Mac OS Roman", () => {
    expect(decodeMacRoman(bytes(0x8e, 0x88, 0xa9, 0x80, 0xff, 0xca, 0xdb))).toBe("éà©Äˇ €");
  });

  it("produit un caractère distinct pour chacun des 128 octets hauts", () => {
    const all = decodeMacRoman(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i));
    expect(new Set(all).size).toBe(128);
  });
});

describe("parseStrl", () => {
  const strl = bytes(1, 0x8e, 0x63, 0x68, 0x6f, 0x75, 0);

  it("décode en Mac OS Roman à la demande", () => {
    expect(parseStrl(strl, "mac-roman")).toEqual(["échou"]);
  });

  it("reste en Windows-1252 par défaut", () => {
    expect(parseStrl(strl)).toEqual(["Žchou"]);
  });
});
