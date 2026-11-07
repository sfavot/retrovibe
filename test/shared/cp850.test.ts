import { describe, expect, it } from "vitest";
import { decodeCp850, encodeCp850 } from "../../src/data/cp850";

describe("cp850", () => {
  it("décode l'ASCII tel quel", () => {
    expect(decodeCp850(new TextEncoder().encode("Drascula 1996 !"))).toBe("Drascula 1996 !");
  });

  it("décode les accents français", () => {
    expect(decodeCp850(Uint8Array.of(0x82, 0x8a, 0x85, 0x87, 0x93, 0x97, 0x90, 0xd4, 0xb7))).toBe("éèàçôùÉÈÀ");
    // Diffère de CP437 : 0x9B est ø (437 : ¢), 0xD4 est È (437 : ╘).
    expect(decodeCp850(Uint8Array.of(0x9b, 0xd4))).toBe("øÈ");
  });

  it("rend la table complète : 128 caractères distincts au-dessus de 0x7F", () => {
    const high = Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i);
    const text = decodeCp850(high);
    expect([...text]).toHaveLength(128);
    expect(new Set(text).size).toBe(128);
    expect(text.startsWith("ÇüéâäàåçêëèïîìÄÅ")).toBe(true);
    expect(text.endsWith("³²■ ")).toBe(true);
  });

  it("encode l'inverse de decode pour les 256 octets", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(encodeCp850(decodeCp850(all))).toEqual(all);
  });

  it("remplace un caractère absent de la page de code par ?", () => {
    expect(encodeCp850("a€é")).toEqual(Uint8Array.of(0x61, 0x3f, 0x82));
  });
});
