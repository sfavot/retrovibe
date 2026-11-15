import { describe, expect, it } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { ResourceIndex } from "../../../src/games/tim3/data/volume";
import { originalFiles } from "../../support/original";

const original = originalFiles("tim3", "RESOURCE.MAP");

const w = (...vs: number[]) => vs.flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);

function chunk(tag: string, body: number[]): number[] {
  const n = body.length;
  return [...tag].map((c) => c.charCodeAt(0)).concat([n & 0xff, n >> 8, 0, 0], body);
}

function sample(kinds = [1, 4]): Uint8Array {
  const body = [
    ...str("TBO\x04HINTPROF.ANM").slice(0, -1),
    0,
    ...w(2, ...kinds),
    ...w(kinds[0]!, 21114, -3, 329, 226, 26, 35, 1, 33, -234, -38),
    ...w(kinds[1]!, 21107, -3, 144, 97, 171, 217, 0, 2, -283, -82),
    ...w(0, 15, 0, 151, 101, 155, 211, 1026, 15),
  ];
  return Uint8Array.from([...chunk("ITF:", body), ...chunk("TAG:", [...w(1, 21114), ...str("HT_HELP")])]);
}

describe("ITF", () => {
  it("lit les contrôles, la zone de texte et les noms", () => {
    const itf = readItf(sample());
    expect(itf.anm).toBe("HINTPROF.ANM");
    expect(itf.version).toBe(4);
    expect(itf.controls[0]).toMatchObject({ kind: 1, id: 21114, name: "HT_HELP", x: 329, y: 226, image: 1, value: 33 });
    expect(itf.controls[1]?.text).toMatchObject({ color: 15, x: 151, y: 101, width: 155, height: 211, flags: 1026 });
    expect(itf.controls[1]?.name).toBeUndefined();
  });

  it("refuse un genre qui ne correspond pas à l'en-tête", () => {
    const bad = sample();
    bad[8 + 4 + 13 + 2] = 0; // genre annoncé du premier contrôle
    expect(() => readItf(bad)).toThrow(/annoncé/);
  });

  it.skipIf(!original.has)("lit jusqu'au dernier octet les 44 ITF du jeu et ceux du français", () => {
    const index = new ResourceIndex().add(original.read("RESOURCE.MAP"), (n) => original.read(n));
    const fr = new ResourceIndex().overlay(original.read("FRENCH.DAT"), "FRENCH.DAT");
    const kinds = new Map<number, number>();
    let files = 0;
    for (const source of [index, fr]) {
      for (const name of source.names().filter((n) => n.toUpperCase().endsWith(".ITF"))) {
        const itf = readItf(source.get(name));
        files++;
        for (const c of itf.controls) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
      }
    }
    expect(files).toBe(44 + 12);
    expect(Object.fromEntries(kinds)).toEqual({ 0: 314, 1: 144, 2: 25, 3: 40, 4: 21, 5: 80 });
    const solve = readItf(index.get("SOLVE.ITF"));
    expect(solve.controls.find((c) => c.name === "SO_STATE_SEL")?.kind).toBe(3);
  });
});
