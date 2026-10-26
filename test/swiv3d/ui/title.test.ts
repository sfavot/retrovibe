import { describe, expect, it } from "vitest";
import { decodeManual, parseManual } from "../../../src/games/swiv3d/ui/manual";
import { hasOriginalFiles, readOriginal } from "../helpers";

describe("manuel de SWIV 3D", () => {
  it("découpe les sections soulignées de tirets", () => {
    const sections = parseManual("SWIV 3D\n\nScénario\n--------\n\nUn texte.\r\nSuite.\n\nSon\n---\nBruit\n");
    expect(sections.map((s) => s.title)).toEqual(["", "Scénario", "Son"]);
    expect(sections[1]!.body).toBe("Un texte.\nSuite.");
    expect(sections[2]!.body).toBe("Bruit");
  });

  it.runIf(hasOriginalFiles)("lit MANUEL.TXT d'origine, accents compris", () => {
    const sections = parseManual(decodeManual(readOriginal("MANUEL.TXT")));
    const titles = sections.map((s) => s.title);
    expect(titles).toContain("Scénario");
    expect(titles).toContain("Commandes");
    expect(sections.every((s) => !s.body.includes("�"))).toBe(true);
  });
});
