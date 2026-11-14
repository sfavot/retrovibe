import { describe, expect, it } from "vitest";
import { DATA_FILE_HEADER_SIZE, decompressedSize, isCompressed, parseDataFileHeader } from "../../../src/games/bass/data/header";
import { SkyDisk } from "../../../src/games/bass/data/disk";
import { RncError } from "../../../src/games/bass/data/rnc";
import { allFiles, hasOriginalFiles, readOriginal, skyDisk } from "./helpers";

describe("en-tête DataFileHeader", () => {
  it("lit 11 mots petit-boutistes dont deux décalages signés, et la taille décompressée", () => {
    const words = [0x8581, 1, 2, 32, 56, 1792, 0x1234, 50, -16, -48, 99];
    const bytes = new Uint8Array(22);
    const view = new DataView(bytes.buffer);
    words.forEach((w, i) => view.setInt16(i * 2, w, true));
    const header = parseDataFileHeader(bytes);
    expect(header).toEqual({ flag: 0x8581, x: 1, y: 2, width: 32, height: 56, spriteSize: 1792, totalSize: 0x1234, numSprites: 50, offsetX: -16, offsetY: -48, compressedSize: 99 });
    expect(isCompressed(header)).toBe(true);
    expect(decompressedSize(header)).toBe(0x851234);
    expect(() => parseDataFileHeader(new Uint8Array(21))).toThrow(/trop court/);
  });
});

/** Disque minimal : index + octets, pour les cas particuliers de `loadFile`. */
function buildDisk(files: Array<{ id: number; bytes: number[]; flags?: number; aligned?: boolean }>): SkyDisk {
  const body: number[] = [];
  const dnr: number[] = [files.length & 0xff, 0, 0, 0];
  for (const f of files) {
    if (f.aligned) while (body.length % 16) body.push(0);
    const position = f.aligned ? (body.length >> 4) | 0x800000 : body.length;
    const flags = (f.flags ?? 0) | f.bytes.length;
    dnr.push(f.id & 0xff, f.id >> 8, position & 0xff, (position >> 8) & 0xff, position >> 16, flags & 0xff, (flags >> 8) & 0xff, flags >> 16);
    body.push(...f.bytes);
  }
  return new SkyDisk(Uint8Array.from(dnr), Uint8Array.from(body));
}

/** Un en-tête de 22 octets avec les drapeaux `flag` et la taille décompressée `totalSize`. */
function header(flag: number, totalSize: number): number[] {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, flag, true);
  view.setUint16(12, totalSize, true);
  return [...bytes];
}

describe("SkyDisk (données synthétiques)", () => {
  it("rend les fichiers non compressés tels quels et refuse un identifiant inconnu", () => {
    const disk = buildDisk([{ id: 5, bytes: [1, 2, 3] }, { id: 7, bytes: [9, 8], aligned: true }]);
    expect(disk.has(5)).toBe(true);
    expect(disk.has(6)).toBe(false);
    expect([...disk.load(5)]).toEqual([1, 2, 3]);
    expect(disk.entry(7)!.offset).toBe(16);
    expect([...disk.load(7)]).toEqual([9, 8]);
    expect(() => disk.load(6)).toThrow(/absent/);
  });

  it("rend une copie : modifier le résultat ne change pas le disque", () => {
    const disk = buildDisk([{ id: 1, bytes: [1, 2, 3] }]);
    disk.load(1)[0] = 99;
    expect(disk.load(1)[0]).toBe(1);
  });

  it("rend brut un fichier au drapeau RNC mais sans signature", () => {
    const bytes = [...header(0x0080, 30), 0, 1, 2, 3];
    const disk = buildDisk([{ id: 1, bytes }]);
    expect([...disk.load(1)]).toEqual(bytes);
  });

  it("rend brut un fichier à signature RNC marqué « non compressé » (bit 23)", () => {
    const bytes = [...header(0x0080, 30), 0x52, 0x4e, 0x43, 0x01, 0, 0];
    const disk = buildDisk([{ id: 1, bytes, flags: 1 << 23 }]);
    expect([...disk.load(1)]).toEqual(bytes);
  });

  it("refuse un flux RNC corrompu et une entrée qui déborde", () => {
    const bad = [...header(0x0080, 30), 0x52, 0x4e, 0x43, 0x01, ...new Array(20).fill(0xff)];
    expect(() => buildDisk([{ id: 1, bytes: bad }]).load(1)).toThrow(RncError);
    const dnr = Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10, 0, 0]);
    expect(() => new SkyDisk(dnr, new Uint8Array(5))).toThrow(/dépasse/);
    expect(() => new SkyDisk(Uint8Array.from([2, 0, 0, 0]), new Uint8Array())).toThrow(/annoncées/);
  });
});

/** Valeurs de `scripts/bass/split_dsk.py` (`charger`, `python3 -I`) sur les mêmes `sky.dnr` / `sky.dsk` : [fichiers, octets décompressés, octets stockés]. */
const EXPECTED_BY_RANGE: Array<[string, number, number, [number, number, number]]> = [
  ["sections 0 à 49 999 (décors, sprites, palettes, scripts)", 0, 49999, [1231, 23373212, 4959400]],
  ["introduction du CD", 59494, 59672, [159, 9308256, 4440188]],
  ["grilles", 60000, 60069, [70, 8400, 8400]],
  ["polices, curseurs, panneau, musique, effets", 60070, 60599, [82, 4788088, 2966841]],
  ["textes", 60600, 60663, [64, 928795, 928795]],
];

describe.skipIf(!hasOriginalFiles)("SkyDisk (fichiers du jeu)", () => {
  it("lit l'index : 1 606 fichiers, pas de voix, identifiants uniques", () => {
    const disk = skyDisk();
    expect(disk.fileCount).toBe(1606);
    expect(new Set(disk.entries.map((e) => e.id)).size).toBe(1606);
    expect(disk.has(50000)).toBe(false);
    expect(disk.has(55277)).toBe(false);
    expect(disk.has(60616)).toBe(true);
    // Les fichiers se suivent dans l'ordre de l'index et le dernier finit à la fin de sky.dsk.
    const last = disk.entries[disk.entries.length - 1]!;
    expect(last.offset + last.storedSize).toBe(readOriginal("sky.dsk").length);
  });

  it("charge les 1 606 fichiers", () => {
    const files = allFiles();
    expect(files.size).toBe(1606);
  });

  it.each(EXPECTED_BY_RANGE)("somme des tailles identique à celle du lecteur Python : %s", (_name, first, last, [count, unpacked, stored]) => {
    const disk = skyDisk();
    const entries = disk.entries.filter((e) => e.id >= first && e.id <= last);
    expect(entries).toHaveLength(count);
    expect(entries.reduce((n, e) => n + allFiles().get(e.id)!.length, 0)).toBe(unpacked);
    expect(entries.reduce((n, e) => n + e.storedSize, 0)).toBe(stored);
  });

  it("répartition des cas : 1 273 RNC, 26 « bit 7 sans signature », 4 « signature mais non compressé »", () => {
    const dsk = readOriginal("sky.dsk");
    let rnc = 0;
    let noSignature = 0;
    let uncompressedWithSignature = 0;
    for (const e of skyDisk().entries) {
      if (e.storedSize < DATA_FILE_HEADER_SIZE) continue;
      const flagCompressed = (dsk[e.offset]! & 0x80) !== 0;
      const signature = dsk[e.offset + 22] === 0x52 && dsk[e.offset + 23] === 0x4e && dsk[e.offset + 24] === 0x43 && dsk[e.offset + 25] === 1;
      if (e.uncompressed) {
        if (signature) uncompressedWithSignature++;
      } else if (flagCompressed) {
        if (signature) rnc++;
        else noSignature++;
      }
    }
    expect([rnc, noSignature, uncompressedWithSignature]).toEqual([1273, 26, 4]);
  });

  it("rend les cas particuliers tels quels et les fichiers RNC à la taille de l'en-tête", () => {
    const disk = skyDisk();
    const dsk = readOriginal("sky.dsk");
    for (const e of disk.entries) {
      const loaded = allFiles().get(e.id)!;
      const stored = dsk.subarray(e.offset, e.offset + e.storedSize);
      if (loaded.length === stored.length && loaded.every((v, i) => v === stored[i])) continue;
      // Contenu décompressé : l'en-tête est recopié devant, sauf bit 22, et la taille est celle de l'en-tête.
      const h = parseDataFileHeader(stored);
      expect(isCompressed(h), `fichier ${e.id}`).toBe(true);
      expect(e.uncompressed).toBe(false);
      expect(loaded.length, `fichier ${e.id}`).toBe(decompressedSize(h));
      expect(disk.declaredSize(e.id)).toBe(decompressedSize(h));
      if (!e.headerDropped) expect([...loaded.subarray(0, DATA_FILE_HEADER_SIZE)]).toEqual([...stored.subarray(0, DATA_FILE_HEADER_SIZE)]);
    }
  });
});
