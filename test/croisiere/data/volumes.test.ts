import { describe, expect, it } from "vitest";
import { CruiseVolumes, parseDirectory, parseVolCnf } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const REQUIRED = ["VOL.CNF", "D1", "D2", "D3", "D4", "D5"];
const hasOriginalFiles = original.has && REQUIRED.every((name) => original.list((n) => n === name).length === 1);

let cached: CruiseVolumes | undefined;
function volumes(): CruiseVolumes {
  cached ??= CruiseVolumes.open((name) => original.read(name));
  return cached;
}

/** Catalogue et volume minimaux (un fichier brut, un fichier packé, un doublon) pour les cas sans fichiers originaux. */
function tinyDisk(entries: Array<{ name: string; bytes: number[]; extSize?: number }>): Uint8Array {
  const dirSize = 4 + 30 * entries.length;
  const body: number[] = [];
  const out = new Uint8Array(dirSize);
  const view = new DataView(out.buffer);
  view.setInt16(0, entries.length);
  view.setInt16(2, 30);
  entries.forEach((e, i) => {
    const base = 4 + 30 * i;
    for (let k = 0; k < e.name.length; k++) out[base + k] = e.name.charCodeAt(k);
    out[base + e.name.length + 1] = 0x54; // octet parasite après le NUL
    view.setUint32(base + 14, dirSize + body.length);
    view.setUint32(base + 18, e.bytes.length);
    view.setUint32(base + 22, e.extSize ?? e.bytes.length);
    view.setUint32(base + 26, 0x442e4d2e);
    body.push(...e.bytes);
  });
  return Uint8Array.from([...out, ...body]);
}

function tinyCnf(names: string[][]): Uint8Array {
  const out: number[] = [0, names.length, 0, 20, ...new Array(20 * names.length).fill(0)];
  for (const list of names) {
    const size = 13 * list.length;
    out.push(size >>> 24, (size >> 16) & 255, (size >> 8) & 255, size & 255);
    for (const name of list) for (let k = 0; k < 13; k++) out.push(name.charCodeAt(k) || 0);
  }
  return Uint8Array.from(out);
}

describe("volumes (synthétiques)", () => {
  const disks = [
    tinyDisk([{ name: "A.TXT", bytes: [1, 2, 3] }, { name: "B.TXT", bytes: [9] }]),
    tinyDisk([{ name: "B.TXT", bytes: [7, 7] }]),
    tinyDisk([]),
    tinyDisk([]),
    tinyDisk([]),
  ];
  const cnf = tinyCnf([["A.TXT", "B.TXT"], ["B.TXT"], [], [], []]);

  it("lit le catalogue et les répertoires (nom jusqu'au premier NUL)", () => {
    expect(parseVolCnf(cnf).map((l) => l.length)).toEqual([2, 1, 0, 0, 0]);
    expect(parseDirectory(disks[0]!, 1).map((e) => e.name)).toEqual(["A.TXT", "B.TXT"]);
  });

  it("garde la première entrée d'un nom en double, sans tenir compte de la casse", () => {
    const v = new CruiseVolumes(cnf, disks);
    expect(v.entries).toHaveLength(3);
    expect(v.find("b.txt")?.disk).toBe(1);
    expect(Array.from(v.readFile("a.txt"))).toEqual([1, 2, 3]);
    expect(v.has("C.TXT")).toBe(false);
    expect(() => v.readFile("C.TXT")).toThrow(/absent/);
  });

  it("refuse un répertoire qui ne correspond pas au catalogue", () => {
    expect(() => new CruiseVolumes(tinyCnf([["A.TXT"], ["B.TXT"], [], [], []]), disks)).toThrow(/ne correspond pas/);
  });
});

describe.skipIf(!hasOriginalFiles)("volumes (fichiers originaux)", () => {
  it("compte les 1 096 entrées par disque, packées ou non (formats.md § 1)", () => {
    const v = volumes();
    expect(v.entries).toHaveLength(1096);
    for (const [disk, count] of [[1, 189], [2, 192], [3, 255], [4, 235], [5, 225]] as const) {
      expect(v.entries.filter((e) => e.disk === disk)).toHaveLength(count);
    }
    expect(v.entries.filter((e) => e.packed)).toHaveLength(853);
    expect(new Set(v.entries.map((e) => e.name)).size).toBe(867);
  });

  it("dépaquette les 1 096 entrées à leur taille annoncée (CRC vérifié pour les 853 packées)", () => {
    const v = volumes();
    let total = 0;
    for (const entry of v.entries) {
      const bytes = v.readEntry(entry);
      expect(bytes.length, entry.name).toBe(entry.extSize);
      total += bytes.length;
    }
    expect(total).toBe(14_128_743);
  });

  it("complète à extSize les 18 fichiers que le flux rend d'un octet plus court", () => {
    const v = volumes();
    const short = v.entries.filter((e) => {
      if (!e.packed) return false;
      const raw = v.readRaw(e);
      return new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(raw.length - 4) === e.extSize - 1;
    });
    expect(short).toHaveLength(18);
    for (const e of short) expect(v.readEntry(e)[e.extSize - 1], e.name).toBe(0);
    expect(short.map((e) => e.name)).toEqual(expect.arrayContaining(["SUPER.OVL", "LOGO.FR", "I00.FR", "HORLOGE2.SPL"]));
  });

  it("retrouve les fichiers connus par leur nom (premier trouvé, casse ignorée)", () => {
    const v = volumes();
    expect(v.find("auto00.ovl")?.name).toBe("AUTO00.OVL");
    const palette = v.readFile("S01PAL.PI1");
    expect(Array.from(palette.subarray(0, 4))).toEqual([0x50, 0x41, 0x4c, 0]); // « PAL\0 » : palette seule
    expect(palette.length).toBe(4 + 768);
    const background = v.readFile("I00.PI1");
    expect(background[1]).toBe(8); // mode 256 couleurs
    expect(background.length).toBe(64_770);
    expect(v.readFile("XX2.PI1").length).toBe(40_066); // mode 5 plans
    expect(Array.from(v.readFile("I00.PI1").subarray(0, 2))).toEqual([0, 8]);
  });
});
