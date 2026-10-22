import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type HelpDocument, parseHelp } from "../../src/games/indy/data/help";
import { hasOriginalFiles } from "./helpers";

const hlp = resolve(import.meta.dirname, "../../original/indy/DESKADV.HLP");

describe.skipIf(!hasOriginalFiles)("DESKADV.HLP", () => {
  const doc: HelpDocument = parseHelp(readFileSync(hlp));
  const text = (i: number) =>
    doc.topics[i].paragraphs
      .map((p) => p.spans.map((s) => (s.kind === "text" ? s.text : "")).join(""))
      .join("\n");

  it("lit toutes les rubriques et les images", () => {
    expect(doc.title).toBe("Guide for Indy's Desktop Adventures");
    expect(doc.topics).toHaveLength(34);
    expect(doc.topics.map((t) => t.title).slice(0, 4)).toEqual(["Help Contents", "THE STORY", "HOW TO PLAY", "Quick Tips"]);
    expect(doc.images).toHaveLength(16);
    expect(doc.images[0]).toMatchObject({ width: 32, height: 33 });
  });

  it("restitue le texte dans le bon ordre, avec ses styles", () => {
    expect(text(1)).toContain("It's the mid-1930's, and Indiana Jones");
    const walking = doc.topics.find((t) => t.title === "Walking Around")!;
    const tip = walking.paragraphs.flatMap((p) => p.spans).filter((s) => s.kind === "text");
    expect(tip.find((s) => s.text === "TIP:")?.font.bold).toBe(true);
    expect(tip.find((s) => s.text === "(")?.font.bold).toBe(false);
  });

  it("résout les liens du sommaire", () => {
    const links = doc.topics[0].paragraphs.flatMap((p) => p.spans).filter((s) => s.kind === "text" && s.link);
    expect(links.map((s) => (s.kind === "text" ? s.text : ""))).toEqual([
      "THE STORY",
      "HOW TO PLAY",
      "THE MAP",
      "MENU COMMANDS",
      "HOT KEYS",
      "CREDITS",
      "INSTALLATION",
      "TROUBLESHOOTING",
      "CONTACTING LUCASARTS",
      "WARRANTY INFORMATION",
    ]);
    for (const s of links) {
      if (s.kind !== "text") continue;
      expect(doc.topics[s.link!].title.toLowerCase()).toBe(s.text.toLowerCase());
    }
  });

  it("décode les images", () => {
    for (const image of doc.images) {
      expect(image.rgba).toHaveLength(image.width * image.height * 4);
      expect(image.rgba.some((v, i) => i % 4 !== 3 && v !== 0)).toBe(true);
    }
  });
});
