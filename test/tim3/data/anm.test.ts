import { describe, expect, it } from "vitest";
import { readAnm } from "../../../src/games/tim3/data/anm";
import { readChunks } from "../../../src/games/tim3/data/dgds-chunk";
import { ResourceIndex } from "../../../src/games/tim3/data/volume";
import { originalFiles } from "../../support/original";

const original = originalFiles("tim3", "RESOURCE.MAP");

function chunk(tag: string, body: number[]): number[] {
  const n = body.length;
  return [...tag].map((c) => c.charCodeAt(0)).concat([n & 0xff, n >> 8, 0, 0], body);
}

const w = (...vs: number[]) => vs.flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);

/** Deux images : un bitmap, puis un rectangle et un son ; séquence 1, 0 ; un état. */
function sample(version = 1001): Uint8Array {
  const commands = [...w(2, 1, 0, 3, -4, 2), ...w(0), ...w(3, 0, 0, 10, 5, 11, 0x800b), ...w(5, 3001), ...w(0), ...w(1)];
  const long = version >= 1002;
  const frame = (off: number) => [...w(1, 2, 32, 27, off), ...(long ? w(7) : [])];
  const body = [
    0x54,
    0x42,
    ...w(version, 2, 2, 1, commands.length, 32, 27),
    ...(long ? w(20, 0, 23) : []),
    ...w(1, 0),
    ...frame(0),
    ...frame(7),
    ...w(0, 4),
    ...commands,
  ];
  return Uint8Array.from([...chunk("ANM:", body), ...chunk("TAG:", [...w(1, 1), ...str("part0.bmp")])]);
}

describe("ANM", () => {
  it("lit en-tête, images, états, commandes et TAG", () => {
    const anm = readAnm(sample());
    expect(anm).toMatchObject({ version: 1001, width: 32, height: 27, sequence: [1, 0], states: [{ first: 0, state: 4 }] });
    expect(anm.images).toEqual([{ id: 1, name: "part0.bmp" }]);
    expect(anm.frames[0]?.commands).toEqual([{ op: "bitmap", image: 1, frame: 0, x: 3, y: -4, flip: 2 }]);
    expect(anm.frames[1]?.commands).toEqual([
      { op: "rect", x: 0, y: 0, width: 10, height: 5, color: 11, fill: 0x800b },
      { op: "sound", sound: 3001 },
    ]);
    expect(anm.commands.at(-1)).toEqual({ op: "end" });
  });

  it("lit la forme longue (≥ 1002)", () => {
    const anm = readAnm(sample(1002));
    expect(anm.unknownHeader).toEqual([20, 0, 23]);
    expect(anm.frames.map((f) => f.unknown0A)).toEqual([7, 7]);
  });

  it("refuse une commande inconnue ou une taille fausse", () => {
    const bad = sample();
    const i = bad.findIndex((_, k) => bad[k] === 5 && bad[k + 1] === 0 && bad[k + 2] === 0xb9);
    bad[i] = 6;
    expect(() => readAnm(bad)).toThrow(/inconnue/);
    expect(() => readChunks(Uint8Array.from([65, 78, 77, 58, 9, 0, 0, 0]))).toThrow(/dépasse/);
  });

  it.skipIf(!original.has)("lit jusqu'au dernier octet les 438 ANM du jeu et ceux du français", () => {
    const index = new ResourceIndex().add(original.read("RESOURCE.MAP"), (n) => original.read(n));
    const fr = new ResourceIndex().overlay(original.read("FRENCH.DAT"), "FRENCH.DAT");
    let files = 0;
    let commands = 0;
    for (const source of [index, fr]) {
      for (const name of source.names().filter((n) => n.toUpperCase().endsWith(".ANM"))) {
        const anm = readAnm(source.get(name));
        files++;
        commands += anm.commands.length;
        for (const c of anm.commands) {
          if (c.op === "bitmap") expect(anm.images.some((im) => im.id === c.image), name).toBe(true);
        }
      }
    }
    expect(files).toBe(442);
    expect(commands).toBe(32_495);
    expect(readAnm(index.get("PART0.ANM")).images[0]?.name.toLowerCase()).toBe("part0.bmp");
  });
});
