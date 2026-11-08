import { describe, expect, it } from "vitest";
import { parseCredits } from "../../../src/games/fotaq/data/credits";
import { hasOriginalFiles, readOriginal } from "../helpers";

const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("parseCredits (données synthétiques)", () => {
  it("accumule les lignes avec l'état courant et les range à chaque .p", () => {
    const credits = parseCredits(bytes([".c", ".i 3", "Jeu de", ".i 11", "Nom", ".p 4", ".l", ".1", ".b", "Gauche", ".p 0", "EN", "jamais vue"].join("\r\n")));
    expect(credits.hasEnd).toBe(true);
    expect(credits.pages).toHaveLength(2);
    expect(credits.pages[0].pause).toBe(40);
    expect(credits.pages[0].lines).toEqual([
      { text: "Jeu de", color: 3, fontSize: 0, align: "center", zone: 0, zoneX: 0, y: 0 },
      { text: "Nom", color: 11, fontSize: 0, align: "center", zone: 0, zoneX: 0, y: 10 },
    ]);
    // `.p 0` attend le changement de pièce ; `.1` choisit la zone 0, `.b` la grande police.
    expect(credits.pages[1].pause).toBe(-1);
    expect(credits.pages[1].lines[0]).toMatchObject({ text: "Gauche", align: "left", fontSize: 1, zone: 0 });
    expect(credits.unshown).toEqual([]);
  });

  it("calcule la zone de la grille 3 x 3 : colonne x 106, ligne y 66", () => {
    const credits = parseCredits(bytes([".8", "A", "B", ".p 1"].join("\r\n")));
    expect(credits.pages[0].lines.map((l) => [l.zone, l.zoneX, l.y])).toEqual([
      [7, 106, 132],
      [7, 106, 142],
    ]);
    const first = parseCredits(bytes([".6", "A", ".p 1"].join("\r\n")));
    expect(first.pages[0].lines[0]).toMatchObject({ zone: 5, zoneX: 212, y: 66 });
  });

  it("garde à part les lignes qui suivent le dernier .p, qui ne sont jamais affichées", () => {
    const credits = parseCredits(bytes(["A", ".p 1", "B", "C"].join("\r\n")));
    expect(credits.pages).toHaveLength(1);
    expect(credits.unshown.map((l) => l.text)).toEqual(["B", "C"]);
    expect(credits.hasEnd).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("génériques du jeu", () => {
  const files = ["CREDIT1.CRD", "CREDIT2.CRD", "DATA"];

  it("lit les trois fichiers jusqu'à leur ligne EN, sans reste", () => {
    const pageCounts = files.map((name) => {
      const credits = parseCredits(readOriginal(name));
      expect(credits.hasEnd, name).toBe(true);
      expect(credits.unshown, name).toEqual([]);
      for (const page of credits.pages) expect(page.pause === -1 || page.pause > 0, name).toBe(true);
      return credits.pages.length;
    });
    expect(pageCounts).toEqual([11, 22, 11]);
  });

  it("lit CREDIT1.CRD en français : « Jeu de Steve Stamatiadis et John Passfield »", () => {
    const credits = parseCredits(readOriginal("CREDIT1.CRD"));
    expect(credits.pages[0].lines.map((l) => l.text).slice(0, 4)).toEqual(["Jeu de", "Steve Stamatiadis", "et", "John Passfield"]);
    expect(credits.pages[0].pause).toBe(-1);
  });

  it("garde dans DATA la version anglaise du premier générique (« A game by »), sans accents", () => {
    const credits = parseCredits(readOriginal("DATA"));
    expect(credits.pages[0].lines[0].text).toBe("A game by");
    expect(readOriginal("DATA").some((byte) => byte >= 0x80)).toBe(false);
  });
});
