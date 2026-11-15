import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Bundle, BundleError } from "../../../src/games/voyageurs/data/bundle";
import { BUNDLE_NAMES, bundle, extensionOf, hasOriginalFiles, sha256 } from "./helpers";

/** Bundle synthétique : une entrée brute (taille égale) et un nom de 14 octets plein. */
function syntheticBundle(): Uint8Array {
  const names = ["Hello.TXT", "ABCDEFGHIJKLMN"];
  const payloads = [Uint8Array.of(1, 2, 3), Uint8Array.of(9)];
  const table = 4 + names.length * 30;
  const out = new Uint8Array(table + 4);
  const view = new DataView(out.buffer);
  view.setUint16(0, names.length);
  view.setUint16(2, 30);
  let offset = table;
  names.forEach((name, i) => {
    const base = 4 + i * 30;
    for (let c = 0; c < name.length; c++) out[base + c] = name.charCodeAt(c);
    view.setUint32(base + 14, offset);
    view.setUint32(base + 18, payloads[i]!.length);
    view.setUint32(base + 22, payloads[i]!.length);
    out.set(payloads[i]!, offset);
    offset += payloads[i]!.length;
  });
  return out;
}

describe("Bundle (données synthétiques)", () => {
  it("cherche sans tenir compte de la casse et lit les entrées brutes", () => {
    const bundle = new Bundle(syntheticBundle());
    expect(bundle.entries.map((e) => e.name)).toEqual(["Hello.TXT", "ABCDEFGHIJKLMN"]);
    expect(bundle.indexOf("HELLO.txt")).toBe(0);
    expect(bundle.has("nope")).toBe(false);
    expect([...bundle.read("hello.txt")]).toEqual([1, 2, 3]);
    expect([...bundle.read(1)]).toEqual([9]);
    // une copie neuve : modifier le résultat ne touche pas le bundle
    bundle.read(0)[0] = 42;
    expect(bundle.read(0)[0]).toBe(1);
  });

  it("refuse un fichier absent, un répertoire hors du fichier et une entrée hors du fichier", () => {
    const data = syntheticBundle();
    expect(() => new Bundle(data).read("absent")).toThrow(BundleError);
    expect(() => new Bundle(data.subarray(0, 40))).toThrow(BundleError);
    expect(() => new Bundle(data.subarray(0, 4 + 60 + 3)).read("ABCDEFGHIJKLMN")).toThrow(/hors du fichier/);
    expect(() => new Bundle(new Uint8Array(2))).toThrow(BundleError);
  });
});

/** sha256 de la concaténation des fichiers décompressés d'un bundle, dans l'ordre du répertoire (extraction de référence). */
const REFERENCE_BUNDLE_HASHES: Record<string, string> = {
  PART01: "2b05472544741fdefb7a1488e81b96fdbf8ae4340d63f45f17ae201707712111",
  PART02: "17c733e7ffa15ebdb51a896e95bdcb715450fb635da25207d63aa2bd796af10c",
  PART03: "3715f5d66ee91e51fc35c970dca5228cbce45146f765465c67df89a73af8c6d1",
  PART04: "e153784ddb9eef99b6f1c41640bd6b36e7aed8590255e1ed42aea408b80006bc",
  PART04B: "e16f572c438441af8004aeb3e86ea2209d2427342895b563f683ad691a2c8ad0",
};

const REFERENCE_FILE_HASHES: [string, string, string][] = [
  ["PART01", "L1.PI1", "2e977fdca36db869084d864c4130e1f97cf261d35d3ec612a2fefe4850bfe0fd"],
  ["PART01", "MARCHE.ANI", "306e700db14b6bb2f2c991022902012f34937f42fe2a8c726c2fc3595e45df8c"],
  ["PART01", "PART01.PRC", "b0b5d021b4981753c4fc06fe2881b69cdf25149b48298f7bce701d3b33eceeda"],
  ["PART01", "L1_MK.NEO", "a342b5b613d05d66509e3be0006a1524f653bc3764ed39035e813966f53e0132"],
  ["PART01", "ELECT375.SPL", "92f8a31cb432738fc491e5a71972e33b4cfc8ecb9e2948df59c087fe7039f5f5"],
  ["PART02", "L10.PI1", "c3a5a8819b17fe8555d0d373f941b8c968ff42a52c32be2942f9e0d8b3b0cebf"],
  ["PART01", "PART01A.MSG", "c6c474d4e0afba3a491cb3e9e7331227903f49d32c1e07dbbde91732e18ba6f0"],
  ["PART02", "PART02A.MSG", "45bc7feeea47e7797740d369f3053018106c2c42103c7eecc800feb7c770db47"],
];

describe.skipIf(!hasOriginalFiles)("bundles PARTxx (fichiers d'origine)", () => {
  it("compte 655 entrées dans les cinq bundles livrés (BASESON.SND n'est pas fourni)", () => {
    const counts = Object.fromEntries(BUNDLE_NAMES.map((name) => [name, bundle(name).entries.length]));
    expect(counts).toEqual({ PART01: 173, PART02: 181, PART03: 162, PART04: 88, PART04B: 51 });
  });

  it("dépaquette chacune des entrées à la taille annoncée, sans doublon de nom", () => {
    let rawEntries = 0;
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      expect(new Set(b.entries.map((e) => e.name.toLowerCase())).size).toBe(b.entries.length);
      for (const [index, entry] of b.entries.entries()) {
        expect(b.read(index).length, `${name}/${entry.name}`).toBe(entry.unpackedSize);
        if (entry.packedSize === entry.unpackedSize) rawEntries++;
      }
    }
    expect(rawEntries).toBe(27);
  });

  it("compte les fichiers par type comme l'inventaire de référence", () => {
    const counts: Record<string, number> = {};
    for (const name of BUNDLE_NAMES) for (const e of bundle(name).entries) counts[extensionOf(e.name)] = (counts[extensionOf(e.name)] ?? 0) + 1;
    expect(counts).toEqual({ ANI: 348, ANM: 2, MSK: 139, PI1: 56, NEO: 35, PRC: 10, REL: 6, OBJ: 7, MSG: 7, SPL: 42, DAT: 3 });
  });

  it("restitue les mêmes octets que l'extraction de référence (somme par bundle)", () => {
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      const hash = createHash("sha256");
      for (let i = 0; i < b.entries.length; i++) hash.update(b.read(i));
      expect(hash.digest("hex"), name).toBe(REFERENCE_BUNDLE_HASHES[name]);
    }
  });

  it("restitue les mêmes octets que l'extraction de référence (fichiers isolés)", () => {
    for (const [name, file, expected] of REFERENCE_FILE_HASHES) expect(sha256(bundle(name as "PART01").read(file)), `${name}/${file}`).toBe(expected);
  });

  it("complète d'un zéro les flux dont le trailer annonce un octet de moins que le répertoire", () => {
    // PART01A.MSG : 7393 octets (impair) au répertoire
    const entry = bundle("PART01").find("part01a.msg")!;
    const data = bundle("PART01").read("PART01A.MSG");
    expect(data.length).toBe(entry.unpackedSize);
    expect(data.length % 2).toBe(1);
    expect(data[data.length - 1]).toBe(0);
  });
});
