import { describe, expect, it } from "vitest";
import { formatSize, hexDump } from "../../src/ui/asset-viewer/helpers";

describe("formatSize", () => {
  it("octets, Ko puis Mo", () => {
    expect(formatSize(0)).toBe("0 o");
    expect(formatSize(1023)).toBe("1023 o");
    expect(formatSize(1024)).toBe("1.0 Ko");
    expect(formatSize(34 * 1024 + 512)).toBe("34.5 Ko");
    expect(formatSize(1 << 20)).toBe("1.0 Mo");
    expect(formatSize(Math.round(1.25 * (1 << 20)))).toBe("1.3 Mo");
  });
});

describe("hexDump", () => {
  it("16 octets par ligne avec décalage sur 6 chiffres", () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i * 13);
    expect(hexDump(bytes).split("\n")).toEqual([
      "000000  00 0d 1a 27 34 41 4e 5b 68 75 82 8f 9c a9 b6 c3",
      "000010  d0 dd ea f7",
    ]);
  });
  it("vide -> chaîne vide ; tronqué à max", () => {
    expect(hexDump(new Uint8Array(0))).toBe("");
    expect(hexDump(new Uint8Array(100), 32).split("\n")).toHaveLength(2);
  });
});
