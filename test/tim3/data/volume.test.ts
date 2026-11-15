import { describe, expect, it } from "vitest";
import { readMap, ResourceIndex } from "../../../src/games/tim3/data/volume";
import { originalFiles } from "../../support/original";

const original = originalFiles("tim3", "RESOURCE.MAP");

function buildMap(volume: string, offsets: number[]): Uint8Array {
  const out = new Uint8Array(6 + 15 + 8 * offsets.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x07040100, true);
  view.setUint16(4, 1, true);
  out.set(new TextEncoder().encode(volume), 6);
  view.setUint16(19, offsets.length, true);
  offsets.forEach((o, i) => view.setUint32(21 + 8 * i + 4, o, true));
  return out;
}

function entry(name: string, data: number[]): number[] {
  const head = new Array(17).fill(0);
  [...name].forEach((c, i) => (head[i] = c.charCodeAt(0)));
  head[13] = data.length & 0xff;
  head[14] = data.length >> 8;
  return [...head, ...data];
}

describe("volume Dynamix", () => {
  it("lit les entrées d'une map synthétique", () => {
    const vol = Uint8Array.from([...entry("A.BMP", [1, 2, 3]), ...entry("b.pal", [9])]);
    const entries = readMap(buildMap("RESOURCE.001", [0, 20]), () => vol);
    expect(entries.map((e) => [e.name, [...e.data]])).toEqual([
      ["A.BMP", [1, 2, 3]],
      ["b.pal", [9]],
    ]);
  });

  it("refuse une entrée qui dépasse le volume", () => {
    const vol = Uint8Array.from(entry("A.BMP", [1, 2, 3])).subarray(0, 19);
    expect(() => readMap(buildMap("V", [0]), () => vol)).toThrow(/dépasse/);
  });

  it("refuse un magic inconnu", () => {
    expect(() => readMap(new Uint8Array(8), () => new Uint8Array())).toThrow(/invalide/);
  });

  it("superpose une langue, sans tenir compte de la casse", () => {
    const base = Uint8Array.from(entry("X.RES", [1]));
    const index = new ResourceIndex().add(buildMap("R", [0]), () => base);
    const datVolume = Uint8Array.from(entry("x.res", [2]));
    const map = buildMap("FR.DAT", [0]);
    const dat = new Uint8Array(map.length + datVolume.length);
    dat.set(map);
    dat.set(datVolume, map.length);
    new DataView(dat.buffer).setUint32(21 + 4, map.length, true);
    index.overlay(dat, "fr.dat");
    expect([...index.get("X.RES")]).toEqual([2]);
    expect(() => index.get("absent")).toThrow(/introuvable/);
  });

  it.skipIf(!original.has)("lit les 1 530 ressources du jeu et les 41 du français", () => {
    const index = new ResourceIndex().add(original.read("RESOURCE.MAP"), (n) => original.read(n));
    expect(index.names().length).toBe(1530);
    const before = index.get("LEVELS.INF").length;
    index.overlay(original.read("FRENCH.DAT"), "FRENCH.DAT");
    expect(index.entry("LEVELS.INF")?.volume).toBe("FRENCH.DAT");
    expect(index.get("LEVELS.INF").length).not.toBe(before);
    expect(index.has("TIM_NEW.PAL")).toBe(true);
  });
});
