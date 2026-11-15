import { describe, expect, it } from "vitest";
import { contextHash, parseContents, parseHelp } from "../../src/engine/desktop-adventures/data/help";
import { originalFiles } from "../support/original";

const yoda = originalFiles("yoda", "YODESK.HLP");

describe.skipIf(!yoda.has)("YODESK.HLP", () => {
  const doc = parseHelp(yoda.read("YODESK.HLP"));
  const text = doc.topics
    .flatMap((t) => t.paragraphs)
    .map((p) => p.spans.map((s) => (s.kind === "text" ? s.text : "")).join(""))
    .join("\n");

  it("lit toutes les rubriques et le titre du sommaire", () => {
    expect(doc.topics.length).toBeGreaterThan(0);
    expect(doc.title).toBe("AIDE DE YODA STORIES");
    expect(doc.topics[0].title).toBe("Introduction");
  });

  it("décode les accents en page de code 1252", () => {
    expect(text).toContain("é");
    expect(text).toContain("droïdes");
    expect(text).not.toMatch(/[�]|Ã/);
  });

  it("décode les images à palette avec des pixels visibles", () => {
    expect(doc.images.length).toBeGreaterThan(0);
    expect(doc.images[0]).toMatchObject({ width: 32, height: 32 });
    for (const image of doc.images) {
      expect(image.rgba).toHaveLength(image.width * image.height * 4);
      const colors = new Set<number>();
      for (let i = 0; i < image.rgba.length; i += 4) {
        colors.add((image.rgba[i] << 16) | (image.rgba[i + 1] << 8) | image.rgba[i + 2]);
        expect(image.rgba[i + 3]).toBeGreaterThan(0);
      }
      expect(colors.size).toBeGreaterThan(1);
    }
  });

  it("lit le sommaire d'origine (YODESK.CNT) : chapitres et rubriques retrouvées par leur contexte", () => {
    const contents = parseContents(yoda.read("YODESK.CNT"), doc);
    const chapters = contents.filter((e) => e.topic === null);
    const topics = contents.filter((e) => e.topic !== null);
    expect(chapters[0]).toEqual({ depth: 1, title: "BIENVENUE DANS LE MONDE DE YODA STORIES", topic: null });
    expect(chapters).toHaveLength(11);
    expect(topics).toHaveLength(23);
    expect(doc.topics[topics.find((e) => e.title === "La Force")!.topic!].title).toBe("La Force");
  });
});

describe("hash de contexte WinHelp", () => {
  it("ne dépend pas de la casse", () => {
    expect(contextHash("The_Force")).toBe(contextHash("THE_FORCE"));
    expect(contextHash("a")).not.toBe(contextHash("b"));
  });
});
