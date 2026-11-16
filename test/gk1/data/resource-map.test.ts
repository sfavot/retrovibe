import { describe, expect, it } from "vitest";
import { COMPRESSION_LZS, COMPRESSION_NONE, ResourceType, resourceTypeName, VOLUME_HEADER_SIZE } from "../../../src/games/gk1/data/ids";
import { parsePatchFileName, readPatchFile, readResourceMap, readVolumeHeader, readVolumeResource, ResourceIndex } from "../../../src/games/gk1/data/resource-map";
import { altIndex, mainIndex, original, PATCH_FILES, tally } from "./real";

/** Map synthétique : `groups` = [type, [numéro, offset][]]. */
function buildMap(groups: [number, [number, number][]][]): Uint8Array {
  const tableSize = 3 * (groups.length + 1) + 4;
  const total = tableSize + 6 * groups.reduce((n, [, e]) => n + e.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = tableSize;
  groups.forEach(([type, entries], i) => {
    out[3 * i] = type;
    view.setUint16(3 * i + 1, p, true);
    for (const [number, offset] of entries) {
      view.setUint16(p, number, true);
      view.setUint32(p + 2, offset, true);
      p += 6;
    }
  });
  out[3 * groups.length] = 0xff;
  view.setUint16(3 * groups.length + 1, total, true);
  out.set([0x34, 0x12, 0, 0], 3 * (groups.length + 1));
  return out;
}

function volumeEntry(type: number, number: number, data: number[], method = COMPRESSION_NONE, unpacked = data.length): number[] {
  const head = new Uint8Array(VOLUME_HEADER_SIZE);
  const view = new DataView(head.buffer);
  head[0] = type;
  view.setUint16(1, number, true);
  view.setUint32(3, data.length, true);
  view.setUint32(7, unpacked, true);
  view.setUint16(11, method, true);
  return [...head, ...data];
}

describe("map et volume SCI2", () => {
  it("lit une map synthétique, doublons compris", () => {
    const map = buildMap([
      [ResourceType.View, [[5, 0], [5, 100]]],
      [ResourceType.Heap, [[64999, 200]]],
    ]);
    expect(readResourceMap(map)).toEqual([
      { type: ResourceType.View, number: 5, offset: 0 },
      { type: ResourceType.View, number: 5, offset: 100 },
      { type: ResourceType.Heap, number: 64999, offset: 200 },
    ]);
  });

  it("refuse une map mal bornée", () => {
    const map = buildMap([[ResourceType.View, [[5, 0]]]]);
    expect(() => readResourceMap(map.subarray(0, map.length - 1))).toThrow(/ne finit pas/);
    expect(() => readResourceMap(Uint8Array.of(0x80, 0, 0))).toThrow(/tronquée/);
  });

  it("lit l'en-tête de volume et les données brutes ou LZS", () => {
    // LZS : littéral 0x41 puis fin de flux → 0 01000001 1 1 0000000, complété par des zéros.
    const lzs = [0b00100000, 0b11100000, 0b00000000];
    const volume = Uint8Array.from([...volumeEntry(ResourceType.Font, 7, [1, 2, 3]), ...volumeEntry(ResourceType.Font, 8, lzs, COMPRESSION_LZS, 1)]);
    expect(readVolumeHeader(volume, 0)).toEqual({ type: ResourceType.Font, number: 7, packedSize: 3, unpackedSize: 3, method: COMPRESSION_NONE });
    expect([...readVolumeResource(volume, 0)]).toEqual([1, 2, 3]);
    expect([...readVolumeResource(volume, 16)]).toEqual([0x41]);
  });

  it("refuse une méthode inconnue, une taille incohérente ou un débordement", () => {
    expect(() => readVolumeResource(Uint8Array.from(volumeEntry(ResourceType.Font, 1, [1], 18)), 0)).toThrow(/méthode de compression 18/);
    expect(() => readVolumeResource(Uint8Array.from(volumeEntry(ResourceType.Font, 1, [1], COMPRESSION_NONE, 2)), 0)).toThrow(/incohérentes/);
    expect(() => readVolumeResource(Uint8Array.from(volumeEntry(ResourceType.Font, 1, [1, 2])).subarray(0, 14), 0)).toThrow(/dépasse/);
    expect(() => readVolumeHeader(new Uint8Array(5), 0)).toThrow(/hors du volume/);
  });

  it("garde la dernière entrée d'un doublon et laisse la priorité aux patchs", () => {
    const volume = Uint8Array.from([...volumeEntry(ResourceType.Sound, 9, [1]), ...volumeEntry(ResourceType.Sound, 9, [2]), ...volumeEntry(ResourceType.Sound, 10, [3])]);
    const map = buildMap([[ResourceType.Sound, [[9, 0], [9, 14], [10, 28]]]]);
    const index = new ResourceIndex();
    expect(index.addVolume(map, volume, "V")).toBe(3);
    expect(index.size).toBe(2);
    expect([...index.get(ResourceType.Sound, 9)]).toEqual([2]);

    index.addPatch("PATCHES/10.SND", Uint8Array.of(ResourceType.Sound, 2, 0xaa, 0xbb, 7, 8));
    expect([...index.get(ResourceType.Sound, 10)]).toEqual([7, 8]);
    expect(index.info(ResourceType.Sound, 10)).toMatchObject({ source: "PATCHES/10.SND", isPatch: true });
    index.addVolume(map, volume, "V");
    expect([...index.get(ResourceType.Sound, 10)]).toEqual([7, 8]);
    expect(index.numbers(ResourceType.Sound)).toEqual([9, 10]);
    expect(index.has(ResourceType.View, 9)).toBe(false);
    expect(() => index.get(ResourceType.View, 9)).toThrow(/introuvable : view 9/);
  });

  it("signale un volume qui ne correspond pas à la map", () => {
    const volume = Uint8Array.from(volumeEntry(ResourceType.Sound, 9, [1]));
    expect(() => new ResourceIndex().addVolume(buildMap([[ResourceType.Sound, [[8, 0]]]]), volume, "V")).toThrow(/contient sound 9/);
  });

  it("reconnaît les noms de patchs", () => {
    expect(parsePatchFileName("PATCHES/316.SND")).toEqual({ type: ResourceType.Sound, number: 316 });
    expect(parsePatchFileName("64999.hep")).toEqual({ type: ResourceType.Heap, number: 64999 });
    expect(parsePatchFileName("PATCHES/A")).toBeUndefined();
    expect(parsePatchFileName("README.TXT")).toBeUndefined();
    expect(parsePatchFileName("70000.SND")).toBeUndefined();
    expect(() => new ResourceIndex().addPatch("PATCHES/A", new Uint8Array(4))).toThrow(/non reconnu/);
    expect(() => readPatchFile(Uint8Array.of(ResourceType.View, 0, 1), ResourceType.Sound)).toThrow(/patch de type view/);
    expect(() => readPatchFile(Uint8Array.of(ResourceType.Sound, 9, 1), ResourceType.Sound)).toThrow(/plus long/);
    expect(resourceTypeName(0x42)).toBe("0x42");
  });
});

describe.skipIf(!original.has)("ressources de Gabriel Knight", () => {
  it("lit les 1 892 entrées de RESOURCE.MAP, qui pavent RESOURCE.000 sans trou", () => {
    const volume = original.read("RESOURCE.000");
    const entries = readResourceMap(original.read("RESOURCE.MAP"));
    expect(entries).toHaveLength(1892);
    const headers = entries.map((e) => ({ ...readVolumeHeader(volume, e.offset), offset: e.offset }));
    expect(Object.fromEntries(tally(headers.map((h) => h.method)))).toEqual({ [COMPRESSION_NONE]: 78, [COMPRESSION_LZS]: 1814 });
    const spans = headers.map((h) => [h.offset, h.offset + VOLUME_HEADER_SIZE + h.packedSize]).sort((a, b) => a[0] - b[0]);
    let position = 0;
    for (const [start, end] of spans) {
      expect(start).toBe(position);
      position = end;
    }
    expect(position).toBe(volume.length);
  });

  it("décompresse les 1 885 ressources distinctes à la taille annoncée", () => {
    const volume = original.read("RESOURCE.000");
    const index = mainIndex();
    expect(index.size).toBe(1885);
    for (const { type, number, offset } of readResourceMap(original.read("RESOURCE.MAP"))) {
      const data = index.get(type, number);
      expect(data.length).toBe(readVolumeHeader(volume, offset).unpackedSize);
    }
    const counts = Object.fromEntries([...tally(index.list().map((r) => resourceTypeName(r.type)))]);
    expect(counts).toEqual({ view: 837, pic: 158, script: 213, sound: 288, vocab: 4, font: 11, patch: 3, palette: 7, message: 77, map: 74, heap: 213 });
    expect(index.numbers(ResourceType.Vocab)).toEqual([994, 996, 997, 998]);
    expect(index.numbers(ResourceType.Font)).toEqual([0, 1, 2, 3, 4, 7, 8, 30, 40, 999, 9561]);
    expect(index.numbers(ResourceType.Palette)).toEqual([260, 330, 370, 500, 510, 999, 3301]);
    expect(index.numbers(ResourceType.Script)).toEqual(index.numbers(ResourceType.Heap));
  });

  it("a 7 doublons dont les deux copies sont identiques", () => {
    const volume = original.read("RESOURCE.000");
    const first = new Map<string, number>();
    const duplicates: string[] = [];
    for (const { type, number, offset } of readResourceMap(original.read("RESOURCE.MAP"))) {
      const id = `${resourceTypeName(type)} ${number}`;
      const before = first.get(id);
      if (before === undefined) {
        first.set(id, offset);
        continue;
      }
      duplicates.push(id);
      expect(offset).not.toBe(before);
      expect(readVolumeResource(volume, offset)).toEqual(readVolumeResource(volume, before));
    }
    expect(duplicates.sort()).toEqual(["heap 93", "heap 94", "pic 900", "script 93", "script 94", "view 663", "view 9591"]);
  });

  it("lit les 59 vues de RESOURCE.ALT, sans recouvrir RESOURCE.000", () => {
    const alt = altIndex();
    expect(alt.size).toBe(59);
    const numbers = alt.numbers(ResourceType.View);
    expect(numbers).toHaveLength(59);
    expect(numbers[0]).toBe(1050);
    expect(numbers[1]).toBe(10100);
    expect(numbers[58]).toBe(19841);
    for (const n of numbers) {
      expect(mainIndex().has(ResourceType.View, n)).toBe(false);
      expect(alt.get(ResourceType.View, n).length).toBeGreaterThan(0);
    }
    // 51 vues 1xxxx doublent la vue de base N − 10000 ; 7 n'en ont pas, et 1050 est seule de son espèce.
    expect(numbers.filter((n) => n >= 10000 && !mainIndex().has(ResourceType.View, n - 10000))).toEqual([10605, 10606, 10607, 10608, 10609, 10700, 11000]);
  });

  it("ajoute les deux patchs de PATCHES/ (sons 316 et 803, absents du volume)", () => {
    const index = new ResourceIndex();
    index.addVolume(original.read("RESOURCE.MAP"), original.read("RESOURCE.000"), "RESOURCE.000");
    for (const path of PATCH_FILES) {
      const id = parsePatchFileName(path)!;
      expect(index.has(id.type, id.number)).toBe(false);
      index.addPatch(path, original.read(path));
      expect(index.get(id.type, id.number)).toHaveLength(96);
      expect(index.info(id.type, id.number)?.isPatch).toBe(true);
    }
    expect(index.size).toBe(1887);
    expect(index.numbers(ResourceType.Sound)).toHaveLength(290);
  });
});
