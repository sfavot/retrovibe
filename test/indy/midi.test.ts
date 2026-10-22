import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMidi } from "../../src/games/indy/audio/midi";
import { hasOriginalFiles } from "./helpers";

const ORIGINAL = resolve(import.meta.dirname, "../../original/indy");

describe.skipIf(!hasOriginalFiles)("musiques MIDI", () => {
  const files = hasOriginalFiles ? readdirSync(ORIGINAL).filter((f) => f.toUpperCase().endsWith(".MID")) : [];

  it("décode toutes les musiques du jeu", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const bytes = readFileSync(resolve(ORIGINAL, file));
      const notes = parseMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      expect(notes.length, file).toBeGreaterThan(10);
      const end = Math.max(...notes.map((n) => n.time + n.duration));
      expect(end, file).toBeGreaterThan(1);
      expect(end, file).toBeLessThan(600);
      expect(notes.every((n) => n.duration > 0 && n.key >= 0 && n.key < 128), file).toBe(true);
    }
  });
});
