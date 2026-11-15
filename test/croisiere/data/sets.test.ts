import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type BitmapEntry, SetFile } from "../../../src/games/croisiere/data/sets";
import { parsePolyRecord } from "../../../src/games/croisiere/data/poly-model";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const hasOriginalFiles = original.has && ["D1", "D2", "D3", "D4", "D5"].every((name) => original.list((n) => n === name).length === 1);
const sha = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex").slice(0, 12);

interface RawEntry {
  width: number;
  height: number;
  type: number;
  transparency?: number;
  data: number[];
}

/** Construit un SET ou SEC minimal (entrées jointes dans l'ordre). */
function buildSet(magic: "SET" | "SEC", entries: RawEntry[]): Uint8Array {
  const table = new Uint8Array(6 + 16 * entries.length);
  const view = new DataView(table.buffer);
  for (let i = 0; i < 3; i++) table[i] = magic.charCodeAt(i);
  view.setUint16(4, entries.length);
  const body: number[] = [];
  entries.forEach((e, i) => {
    const at = 6 + 16 * i;
    view.setUint32(at, body.length);
    view.setUint16(at + 4, e.width);
    view.setUint16(at + 6, e.height);
    view.setUint16(at + 8, e.type);
    view.setUint16(at + 10, e.transparency ?? 0);
    body.push(...e.data);
  });
  return Uint8Array.from([...table, ...body]);
}

describe("SET / SEC (synthétiques)", () => {
  it("type 8 : pixels chunky, transparence (& 0x1F, 0xFFFF → 31) et masque", () => {
    const set = new SetFile(buildSet("SET", [{ width: 8, height: 2, type: 8, transparency: 0xffff, data: [31, 1, 2, 3, 4, 5, 6, 7, 31, 31, 31, 31, 31, 31, 31, 9] }]));
    const e = set.entry(0) as BitmapEntry;
    expect(e.kind).toBe("sprite");
    expect(set.headers[0]!.transparency).toBe(31);
    expect([e.width, e.height, e.maskStride]).toEqual([8, 2, 1]);
    expect(Array.from(e.mask.subarray(0, 2))).toEqual([0b01111111, 0b00000001]);
  });

  it("type 1 : un plan, 8 pixels par octet de largeur, transparence 0, SEC retire 2 octets de largeur", () => {
    const set = new SetFile(buildSet("SET", [{ width: 2, height: 2, type: 1, transparency: 5, data: [0x80, 0x01, 0xff, 0x00] }]));
    const e = set.entry(0) as BitmapEntry;
    expect(e.kind).toBe("mask");
    expect([e.width, e.height, e.transparency]).toEqual([16, 2, 0]);
    expect(e.pixels[0]).toBe(1);
    expect(e.pixels[15]).toBe(1);
    expect(e.pixels.subarray(16, 24)).toEqual(new Uint8Array(8).fill(1));
    expect(Array.from(e.mask.subarray(0, 4))).toEqual([0x80, 0x01, 0xff, 0x00]);

    const sec = new SetFile(buildSet("SEC", [{ width: 4, height: 1, type: 1, data: [0xf0, 0x0f] }]));
    const m = sec.entry(0) as BitmapEntry;
    expect([m.width, m.height]).toEqual([16, 1]);
    expect(Array.from(m.pixels.subarray(0, 8))).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it("type 5 SET : largeur visible (W-10)*8/5, pas de plan = visible/8 + 2 ; SEC : pas = visible/8", () => {
    // SET, W = 20 : plans de 4 octets, largeur visible 16 px. Plan p, ligne y, octet c : data[y*4 + c + 8*p] (H = 2).
    const data = new Array(40).fill(0);
    data[1] = 0x40; // ligne 0, octet 1, bit 6 -> pixel 9 : plan 0
    data[8 + 1] = 0x40; // plan 1
    data[8 * 4 + 4] = 0x80; // ligne 1, octet 0, pixel 0 : plan 4
    const set = new SetFile(buildSet("SET", [{ width: 20, height: 2, type: 5, transparency: 3, data }]));
    const e = set.entry(0) as BitmapEntry;
    expect([e.width, e.height, e.transparency]).toEqual([16, 2, 3]);
    expect(e.pixels[9]).toBe(3);
    expect(e.pixels[16]).toBe(16);
    expect(e.pixels.reduce((a, b) => a + (b ? 1 : 0), 0)).toBe(2);

    // SEC, W = 20 : W' = 10, largeur visible 16, pas de plan = 2 octets, données (W-10)*H = 20 octets.
    const secData = new Array(20).fill(0);
    secData[1] = 0x01; // ligne 0, octet 1, pixel 15 : plan 0
    secData[8 + 2 + 1] = 0x01; // ligne 1, octet 1, pixel 15 : plan 2 (plans de H * pas = 4 octets)
    const sec = new SetFile(buildSet("SEC", [{ width: 20, height: 2, type: 5, data: secData }]));
    const s = sec.entry(0) as BitmapEntry;
    expect([s.width, s.height]).toEqual([16, 2]);
    expect(s.pixels[15]).toBe(1);
    expect(s.pixels[16 + 15]).toBe(4);
  });

  it("type 0 : octets bruts ; types inconnus, absents et tronqués refusés", () => {
    const set = new SetFile(buildSet("SET", [{ width: 3, height: 1, type: 0, data: [1, 2, 3] }, { width: 1, height: 1, type: 4, data: [0] }]));
    const e = set.entry(0);
    expect(e.kind).toBe("poly");
    expect(e.kind === "poly" && Array.from(e.data)).toEqual([1, 2, 3]);
    expect(() => set.entry(1)).toThrow(/type d'entrée 4/);
    expect(() => set.entry(2)).toThrow(/absente/);
    expect(() => new SetFile(Uint8Array.from([0x58, 0x58, 0x58, 0, 0, 0]))).toThrow(/signature/);
    const truncated = buildSet("SET", [{ width: 4, height: 1, type: 8, data: [1, 2, 3, 4] }]).subarray(0, 24);
    expect(() => new SetFile(truncated).entry(0)).toThrow(/hors du fichier/);
  });
});

/** Empreinte au format du décodeur Python de contrôle : nom, index, largeur, hauteur (LE16), puis les pixels. */
function updateAggregate(hash: ReturnType<typeof createHash>, name: string, index: number, e: BitmapEntry): void {
  hash.update(Buffer.from(name));
  hash.update(Uint8Array.from([index & 255, index >> 8, e.width & 255, e.width >> 8, e.height & 255, e.height >> 8]));
  hash.update(e.pixels);
}

describe.skipIf(!hasOriginalFiles)("SET / SEC et modèles (fichiers originaux)", () => {
  const volumes = CruiseVolumes.open((name) => original.read(name));
  const setEntries = volumes.entries.filter((e) => /\.(SET|SEC)$/.test(e.name));

  it("décode toutes les entrées des 398 fichiers .SET/.SEC (types 0, 1, 5, 8) sans reste", () => {
    const counts: Record<string, number> = {};
    for (const entry of setEntries) {
      const bytes = volumes.readEntry(entry);
      const set = new SetFile(bytes);
      expect(String.fromCharCode(...bytes.subarray(0, 3)), entry.name).toBe(set.kind);
      for (let i = 0; i < set.length; i++) {
        const decoded = set.entry(i);
        const key = `${set.kind} t${decoded.header.type}`;
        counts[key] = (counts[key] ?? 0) + 1;
        if (decoded.kind === "poly") {
          const record = parsePolyRecord(decoded.data);
          if (record.kind === "model") {
            // Le 0xFF final est suivi des 4 octets de bourrage et de rien d'autre.
            expect(record.trailer, `${entry.name}#${i}`).toHaveLength(4);
            expect(record.polygons.length, `${entry.name}#${i}`).toBeGreaterThan(0);
            expect(record.polygons.every((p) => p.indices.length > 1)).toBe(true);
          } else {
            const target = set.headers[i + record.offset];
            expect(target?.type, `${entry.name}#${i} renvoi miroir`).toBe(0);
            const targetEntry = set.entry(i + record.offset);
            expect(targetEntry.kind === "poly" && parsePolyRecord(targetEntry.data).kind, `${entry.name}#${i} cible`).toBe("model");
          }
        } else {
          expect(decoded.pixels).toHaveLength(decoded.width * decoded.height);
          expect(decoded.width % 8, `${entry.name}#${i}`).toBe(0); // le pas de masque `width / 8` du moteur est alors exact
        }
      }
    }
    expect(Object.keys(counts).sort()).toEqual(["SEC t1", "SEC t5", "SET t0", "SET t1", "SET t5", "SET t8"]);
  });

  it("compte les entrées par type (formats.md § 3.2) sur les premiers fichiers de chaque nom", () => {
    const counts: Record<string, number> = {};
    for (const name of [...new Set(setEntries.map((e) => e.name))]) {
      const set = new SetFile(volumes.readFile(name));
      for (const h of set.headers) counts[`${set.kind} t${h.type}`] = (counts[`${set.kind} t${h.type}`] ?? 0) + 1;
    }
    expect(counts).toEqual({ "SET t0": 2250, "SET t1": 35, "SET t5": 53, "SET t8": 449, "SEC t1": 128, "SEC t5": 1212 });
  });

  it("images des types 1, 5 et 8 : empreinte globale recoupée avec un décodeur Python indépendant", () => {
    const hash = createHash("sha1");
    for (const name of [...new Set(setEntries.map((e) => e.name))].sort()) {
      const set = new SetFile(volumes.readFile(name));
      for (let i = 0; i < set.length; i++) {
        if (set.headers[i]!.type === 0) continue;
        updateAggregate(hash, name, i, set.entry(i) as BitmapEntry);
      }
    }
    expect(hash.digest("hex").slice(0, 12)).toBe("3900d7a21f2e");
  });

  it("entrées connues : type 8 (I00.SET), type 5 SEC (HORLOGE.SET), type 5 SET (REM_TOM.SET), type 1 SEC (END1BGMQ.SET)", () => {
    const first = (name: string) => new SetFile(volumes.readFile(name)).entry(0) as BitmapEntry;
    const i00 = first("I00.SET");
    expect([i00.header.type, i00.width, i00.height, sha(i00.pixels)]).toEqual([8, 96, 50, "dec60a1eca51"]);
    const horloge = first("HORLOGE.SET");
    expect([horloge.header.type, horloge.width, horloge.height, sha(horloge.pixels)]).toEqual([5, 80, 66, "9321bb1d56a8"]);
    const remTom = first("REM_TOM.SET");
    expect([remTom.header.type, remTom.width, remTom.height, sha(remTom.pixels)]).toEqual([5, 112, 129, "b55b2cf100f7"]);
    const mask = first("END1BGMQ.SET");
    expect([mask.kind, mask.header.type, mask.width, mask.height, sha(mask.pixels)]).toEqual(["mask", 1, 240, 32, "c4168d7b4763"]);
    // le masque d'un sprite suit `pixel != transparence`
    let opaque = 0;
    for (let i = 0; i < i00.pixels.length; i++) if (i00.pixels[i] !== i00.transparency) opaque++;
    let bits = 0;
    for (const byte of i00.mask) for (let b = 0; b < 8; b++) bits += (byte >> b) & 1;
    expect(bits).toBe(opaque);
  });

  it("BIGRAOUL.SET : 78 entrées de type 0, modèles et renvois miroir", () => {
    const set = new SetFile(volumes.readFile("BIGRAOUL.SET"));
    expect([set.kind, set.length]).toEqual(["SET", 78]);
    expect(set.headers.every((h) => h.type === 0 && h.height === 1)).toBe(true);
    const first = set.entry(0);
    expect(first.kind).toBe("poly");
    if (first.kind !== "poly") return;
    expect(sha(first.data)).toBe("3564d7b072df");
    expect(first.data).toHaveLength(372);
    const model = parsePolyRecord(first.data);
    expect(model.kind).toBe("model");
    if (model.kind !== "model") return;
    expect([model.upperX, model.upperY, model.lowerX, model.lowerY]).toEqual([58, 171, 29, 169]);
    expect(model.points).toHaveLength(2 * 88);
    expect(model.polygons).toHaveLength(15);
    expect(model.polygons[0]).toEqual({ color: 3, unused: 3, minScale: 0, indices: Uint8Array.from([50, 87, 66]) });
    expect(model.trailer).toHaveLength(4);
    const mirrorEntry = set.entry(3);
    expect(mirrorEntry.kind === "poly" && parsePolyRecord(mirrorEntry.data)).toEqual({ kind: "mirror", offset: 6, newX: 0, newY: 0 });
    expect(set.headers[3 + 6]!.type).toBe(0);
  });
});
