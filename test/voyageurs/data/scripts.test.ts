import { describe, expect, it } from "vitest";
import { BOOT_SCRIPT_INDEX, decodeBootPrc, readBootPrc } from "../../../src/games/voyageurs/data/boot";
import { INTRO_OBJ_NAME, readObj } from "../../../src/games/voyageurs/data/obj";
import { readPrc } from "../../../src/games/voyageurs/data/prc";
import { readRel } from "../../../src/games/voyageurs/data/rel";
import { BUNDLE_NAMES, bundle, extensionOf, hasOriginalFiles, readOriginal } from "./helpers";

function be16(...values: number[]): number[] {
  return values.flatMap((v) => [v >> 8, v & 0xff]);
}

describe("PRC / REL / OBJ (synthétiques)", () => {
  it("lit un PRC : tailles puis scripts concaténés, taille 0 = absent", () => {
    const prc = readPrc(Uint8Array.of(...be16(3, 2, 0, 1), 0xaa, 0xbb, 0xcc));
    expect(prc.scripts.map((s) => [...s])).toEqual([[0xaa, 0xbb], [], [0xcc]]);
  });

  it("refuse un PRC tronqué ou de plus de 50 scripts", () => {
    expect(() => readPrc(Uint8Array.of(...be16(1, 4), 1, 2))).toThrow(RangeError);
    expect(() => readPrc(Uint8Array.of(...be16(2, 1)))).toThrow(RangeError);
    expect(() => readPrc(Uint8Array.of(...be16(51)))).toThrow(RangeError);
  });

  it("lit un REL : en-têtes de 8 octets puis corps", () => {
    const rel = readRel(Uint8Array.of(...be16(2, 1, 5, 6, 0xffff, 0, 7, 8, 9), 0x42));
    expect(rel).toHaveLength(2);
    expect(rel[0]).toMatchObject({ p1: 5, p2: 6, p3: 0xffff });
    expect([...rel[0]!.script]).toEqual([0x42]);
    expect(rel[1]).toMatchObject({ p1: 7, p2: 8, p3: 9 });
    expect(rel[1]!.script).toHaveLength(0);
    expect(() => readRel(Uint8Array.of(...be16(1, 3, 0, 0, 0), 1))).toThrow(RangeError);
  });

  it("lit un OBJ : champs signés et nom terminé par un zéro", () => {
    const entry = new Uint8Array(32);
    new DataView(entry.buffer).setInt16(0, -5);
    new DataView(entry.buffer).setInt16(8, -2);
    entry.set([...Buffer.from("seau d'eau")], 10);
    new DataView(entry.buffer).setUint16(30, 3);
    const objects = readObj(Uint8Array.of(...be16(1, 32), ...entry));
    expect(objects).toEqual([{ x: -5, y: 0, mask: 0, frame: 0, costume: -2, name: "seau d'eau", part: 3 }]);
    expect(INTRO_OBJ_NAME).toBe("INTRO.OBJ");
    expect(() => readObj(Uint8Array.of(...be16(1, 31)))).toThrow(RangeError);
    expect(() => readObj(Uint8Array.of(...be16(1, 32), 0))).toThrow(RangeError);
  });
});

describe("AUTO00.PRC chiffré (synthétique)", () => {
  it("tourne chaque octet d'un bit vers la gauche", () => {
    expect([...decodeBootPrc(Uint8Array.of(0x00, 0x19, 0x00, 0x00, 0x00, 0xcb))]).toEqual([0x00, 0x32, 0x00, 0x00, 0x00, 0x97]);
    expect([...decodeBootPrc(Uint8Array.of(0x01, 0x80))]).toEqual([0x02, 0x01]);
  });
});

describe.skipIf(!hasOriginalFiles)("scripts et tables (fichiers d'origine)", () => {
  it("décode AUTO00.PRC en 50 scripts dont un seul, l'index 1, de 151 octets", () => {
    const raw = readOriginal("AUTO00.PRC");
    expect(raw).toHaveLength(253);
    const prc = readBootPrc(raw);
    expect(prc.scripts).toHaveLength(50);
    const nonEmpty = prc.scripts.map((s, i) => [i, s.length]).filter(([, n]) => n! > 0);
    expect(nonEmpty).toEqual([[BOOT_SCRIPT_INDEX, 151]]);
    // le script de boot nomme PART01 et les tables d'objets de l'intro
    const text = String.fromCharCode(...prc.scripts[BOOT_SCRIPT_INDEX]!);
    for (const name of ["PART01", "TOTO.OBJ", "INTRO.OBJ"]) expect(text).toContain(name);
  });

  it("lit les 10 PRC : 50 scripts chacun, tailles cohérentes avec le fichier", () => {
    let count = 0;
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (extensionOf(entry.name) !== "PRC") continue;
        const data = b.read(index);
        const prc = readPrc(data);
        expect(prc.scripts, entry.name).toHaveLength(50);
        const total = prc.scripts.reduce((sum, s) => sum + s.length, 0);
        // le répertoire arrondit la taille au pair : au plus un octet de remplissage
        expect(data.length - (2 + 100 + total), entry.name).toBeLessThanOrEqual(1);
        count++;
      }
    }
    expect(count).toBe(10);
  });

  it("lit les 6 REL (255 entrées) : PART01.REL a 110 scripts non vides", () => {
    let count = 0;
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (extensionOf(entry.name) !== "REL") continue;
        const rel = readRel(b.read(index));
        expect(rel, entry.name).toHaveLength(255);
        if (entry.name === "PART01.REL") expect(rel.filter((r) => r.script.length > 0)).toHaveLength(110);
        count++;
      }
    }
    expect(count).toBe(6);
  });

  it("lit les 7 OBJ (255 objets) : PART01.OBJ commence par le héros", () => {
    let count = 0;
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (extensionOf(entry.name) !== "OBJ") continue;
        expect(readObj(b.read(index)), entry.name).toHaveLength(255);
        count++;
      }
    }
    expect(count).toBe(7);
    const objects = readObj(bundle("PART01").read("PART01.OBJ"));
    expect(objects[1]).toEqual({ x: 180, y: 105, mask: 28, frame: 18, costume: 6, name: "heros", part: 0 });
    expect(objects[2]!.name).toBe("echafaudage");
    expect(objects[3]!.name).toBe("seau d'eau");
    expect(objects[4]!.name).toBe("eau");
  });
});
