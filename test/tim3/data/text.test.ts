import { describe, expect, it } from "vitest";
import { loadTexts, parseIdTable, parseInfoRes, parseLevelsInf, parseLines, unescapeNewlines } from "../../../src/games/tim3/data/text";
import { baseIndex, frenchIndex, frenchPackIndex, namesWithExtension, original } from "./real";

const encode = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function levelsInf(puzzles: string[][]): Uint8Array {
  const body: number[] = [];
  const offsets: number[] = [];
  const base = 2 + 2 * puzzles.length;
  for (const strings of puzzles) {
    offsets.push(base + body.length);
    for (const s of strings) body.push(...encode(s), 0);
  }
  const head = [puzzles.length & 255, puzzles.length >> 8, ...offsets.flatMap((o) => [o & 255, o >> 8])];
  return Uint8Array.from([...head, ...body]);
}

describe("LEVELS.INF", () => {
  const hints = (n: number) => [...Array.from({ length: n }, (_, i) => `indice ${i + 1}`), ...Array(8 - n).fill("")];

  it("lit titre, but et huit indices", () => {
    const levels = parseLevelsInf(levelsInf([["Un", "But un", ...hints(2)], ["Deux", "But", ...hints(0)]]));
    expect(levels).toHaveLength(2);
    expect(levels[0]).toEqual({ title: "Un", goal: "But un", hints: hints(2) });
    expect(levels[1].title).toBe("Deux");
  });

  it("lit du Windows-1252", () => {
    const bytes = levelsInf([["Portées", "but", ...hints(0)]]);
    expect(parseLevelsInf(bytes)[0].title).toBe("Portées");
  });

  it("refuse un reste, un tronquage ou un offset faux", () => {
    const ok = levelsInf([["a", "b", ...hints(0)]]);
    expect(() => parseLevelsInf(Uint8Array.from([...ok, 65]))).toThrow(/restants/);
    expect(() => parseLevelsInf(ok.subarray(0, ok.length - 1))).toThrow(/tronqué/);
    const bad = ok.slice();
    bad[2]++;
    expect(() => parseLevelsInf(bad)).toThrow(/offsets/);
  });
});

describe("textes .RES", () => {
  it("lit INFO.RES", () => {
    const parts = parseInfoRes(encode("  0.\tBowling Ball\tHeavy.\r\n148.\tLaser\tA\tB\r\n"));
    expect(parts).toEqual([
      { id: 0, name: "Bowling Ball", description: "Heavy." },
      { id: 148, name: "Laser", description: "A\tB" },
    ]);
    expect(() => parseInfoRes(encode("zéro\r\n"))).toThrow(/illisible/);
  });

  it("lit les tables à identifiant", () => {
    expect(parseIdTable(encode("1000 TIM\r\n\r\n3001 Yeee Haaa!!\r\n"))).toEqual([
      { id: 1000, text: "TIM" },
      { id: 3001, text: "Yeee Haaa!!" },
    ]);
    expect(() => parseIdTable(encode("sans identifiant\r\n"))).toThrow(/illisible/);
  });

  it("découpe les lignes et remplace les \\n littéraux", () => {
    expect(parseLines(encode("a\r\n\r\nb\r\n"))).toEqual(["a", "", "b"]);
    expect(parseLines(encode("a"))).toEqual(["a"]);
    expect(unescapeNewlines("a\\nb")).toBe("a\nb");
  });
});

describe.skipIf(!original.has)("textes réels", () => {
  it("lit LEVELS.INF en anglais : 206 puzzles, et en français", () => {
    const en = parseLevelsInf(baseIndex().get("LEVELS.INF"));
    const fr = parseLevelsInf(frenchPackIndex().get("LEVELS.INF"));
    expect(en).toHaveLength(206);
    expect(fr).toHaveLength(206);
    for (const level of [...en, ...fr]) expect(level.hints).toHaveLength(8);
    expect(fr[0].title).toBe("Portées Disparues");
    expect(fr[0].goal).toBe("Faites disparaître la balle no8 de l'écran.");
    expect(en[0].title).not.toBe(fr[0].title);
  });

  it("INFO.RES : 149 pièces numérotées de 0 à 148, anglais et français", () => {
    for (const index of [baseIndex(), frenchPackIndex()]) {
      const parts = parseInfoRes(index.get("INFO.RES"));
      expect(parts.map((p) => p.id)).toEqual(Array.from({ length: 149 }, (_, i) => i));
      for (const p of parts) expect(p.name.length).toBeGreaterThan(0);
    }
    expect(parseInfoRes(baseIndex().get("INFO.RES"))[0].name).toBe("Bowling Ball");
    expect(parseInfoRes(frenchPackIndex().get("INFO.RES"))[148].name).toBe("Détecteur à Laser");
  });

  it("MUSIC.RES : 19 titres, SOUND.RES : 22 effets", () => {
    const music = parseIdTable(baseIndex().get("MUSIC.RES"));
    expect(music).toHaveLength(19);
    expect(music[0]).toEqual({ id: 1000, text: "TIM" });
    expect(parseIdTable(baseIndex().get("SOUND.RES"))).toHaveLength(22);
    expect(parseIdTable(frenchPackIndex().get("MUSIC.RES")).length).toBeGreaterThan(0);
  });

  it("DESCRIPT.RES et HELP.RES (identifiants à 5 chiffres), SYSTEM.RES", () => {
    for (const name of ["DESCRIPT.RES", "HELP.RES"]) {
      const entries = parseIdTable(baseIndex().get(name));
      expect(entries.length, name).toBeGreaterThan(10);
    }
    const system = parseLines(baseIndex().get("SYSTEM.RES"));
    expect(system[0]).toBe("English");
    expect(unescapeNewlines(system[2])).toContain("\nDo not delete this file!");
  });

  it("lit chaque .RES des deux langues en lignes", () => {
    for (const index of [baseIndex(), frenchPackIndex()]) {
      for (const name of namesWithExtension(index, "RES")) expect(parseLines(index.get(name)).length, name).toBeGreaterThan(0);
    }
  });

  it("loadTexts : l'anglais, puis le français par superposition", () => {
    const en = loadTexts(baseIndex());
    const fr = loadTexts(frenchIndex());
    expect([en.levels.length, en.parts.length]).toEqual([206, 149]);
    expect(en.system[0]).toBe("English");
    expect(fr.system[0]).not.toBe("English");
    expect(fr.levels[0].title).toBe("Portées Disparues");
    expect(fr.parts[0].name).not.toBe(en.parts[0].name);
  });
});
