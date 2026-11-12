import { describe, expect, it } from "vitest";
import { DAT_FILE_NAME, DISK_FILE_NAMES, HeywowContainer, LureResources, areaScreenId, diskOfId } from "../../../src/games/lure/data/container";
import { hasOriginalFiles, lureResources, readOriginal } from "./helpers";

/** Construit un conteneur `heywow` : `entries` = `[id, contenu]`, rangés sur des multiples de 32 octets. */
function build(disk: number, entries: Array<[number, number[]]>, extension?: { id: number; size: number }): Uint8Array {
  const header = new Uint8Array(8 + 0xbf * 8).fill(0xff);
  header.set([...Buffer.from("heywow"), disk >> 8, disk & 0xff]);
  const bodies: number[][] = [];
  let offset = Math.ceil(header.length / 32);
  entries.forEach(([id, content], index) => {
    const at = 8 + index * 8;
    const size = extension && extension.id === id ? extension.size : content.length;
    header.set([id & 0xff, id >> 8, 0xff, size > 0xffff ? 1 : 0, size & 0xff, (size >> 8) & 0xff, offset & 0xff, offset >> 8], at);
    const padded = [...content, ...new Array((32 - (content.length % 32)) % 32).fill(0)];
    bodies.push(padded);
    offset += Math.ceil(padded.length / 32);
  });
  return Uint8Array.from([...header, ...bodies.flat()]);
}

describe("HeywowContainer (données synthétiques)", () => {
  it("lit l'en-tête, le numéro de disque grand-boutiste et les ressources alignées sur 32 octets", () => {
    const container = new HeywowContainer(build(3, [[0x10, [1, 2, 3]], [0x8001, [9]]]));
    expect(container.diskNumber).toBe(3);
    expect(container.ids).toEqual([0x10, 0x8001]);
    expect([...container.get(0x10)]).toEqual([1, 2, 3]);
    expect(container.size(0x8001)).toBe(1);
    expect(container.entry(0x8001).offset % 32).toBe(0);
    expect(container.has(0x11)).toBe(false);
    expect(() => container.get(0x11)).toThrow(/absente/);
  });

  it("ajoute 0x10000 à la taille quand l'octet d'extension est non nul", () => {
    const bytes = build(1, [[5, new Array(10).fill(7)]]);
    // l'extension fait déborder la ressource hors du fichier : refusée
    bytes[8 + 3] = 1;
    expect(() => new HeywowContainer(bytes)).toThrow(/dépasse/);
  });

  it("refuse une signature absente, un fichier trop court et un identifiant en double", () => {
    expect(() => new HeywowContainer(new Uint8Array(10))).toThrow(/trop court/);
    const bad = build(1, [[1, [1]]]);
    bad[0] = 0;
    expect(() => new HeywowContainer(bad)).toThrow(/signature/);
    expect(() => new HeywowContainer(build(1, [[1, [1]], [1, [2]]]))).toThrow(/double/);
  });
});

describe("diskOfId et areaScreenId", () => {
  it("attribue le disque d'après les deux bits de poids fort, et lure.dat aux identifiants 0x3Fxx", () => {
    expect(diskOfId(0x0010)).toBe(1);
    expect(diskOfId(0x4120)).toBe(2);
    expect(diskOfId(0x8700)).toBe(3);
    expect(diskOfId(0xff01)).toBe(4);
    expect(diskOfId(0x3f05)).toBe(0);
  });

  it("inverse le bit 0x8000 des quatre écrans de remplacement quand AREA_FLAG est non nul", () => {
    for (const id of [0x4008, 0x4120, 0x4311, 0x4410]) {
      expect(areaScreenId(id, 1)).toBe(id ^ 0x8000);
      expect(areaScreenId(id, 0)).toBe(id);
    }
    expect(areaScreenId(0x4121, 1)).toBe(0x4121);
  });
});

describe.skipIf(!hasOriginalFiles)("conteneurs du jeu", () => {
  const res = new Proxy({} as LureResources, { get: (_target, key) => (lureResources() as never)[key] });

  it("compte 39, 103, 118 et 77 ressources sur les disques, 26 dans lure.dat", () => {
    expect(res.disks.map((disk) => disk.entries.length)).toEqual([39, 103, 118, 77]);
    expect(res.disks.map((disk) => disk.diskNumber)).toEqual([1, 2, 3, 4]);
    expect(res.dat.entries.length).toBe(26);
    expect(res.dat.diskNumber).toBe(0);
    expect(res.dat.ids).toEqual(Array.from({ length: 26 }, (_, i) => 0x3f01 + i));
    expect(res.allIds()).toHaveLength(363);
  });

  it("range chaque identifiant sur le disque que donne diskOfId, sans doublon, et finit à moins de 32 octets de la fin", () => {
    res.disks.forEach((disk, index) => {
      for (const entry of disk.entries) expect(diskOfId(entry.id)).toBe(index + 1);
      const last = disk.entries.reduce((max, entry) => Math.max(max, entry.offset + entry.size), 0);
      expect(disk.byteLength).toBeGreaterThanOrEqual(last);
      expect(disk.byteLength - last).toBeLessThan(32);
    });
  });

  it("donne accès à une ressource par identifiant sur les quatre disques et le bloc", () => {
    expect(res.get(0x3f01)).toHaveLength(768);
    expect(res.size(1)).toBe(6656);
    expect(res.size(0x4120)).toBe(9735);
    expect(res.size(0x8700)).toBe(10955);
    expect(res.size(0xff01)).toBe(66702);
    expect(res.has(0x4121)).toBe(true);
    expect(res.has(0x4122)).toBe(false);
    expect(() => res.get(0x4122)).toThrow(/absente/);
  });

  it("contient les quatre écrans de remplacement de la zone sur le disque 4", () => {
    for (const id of [0xc008, 0xc120, 0xc311, 0xc410]) expect(res.has(id)).toBe(true);
  });

  it("refuse des fichiers dans le mauvais ordre", () => {
    const [d1, d2, d3, d4] = DISK_FILE_NAMES.map(readOriginal);
    expect(() => new LureResources({ disks: [d2!, d1!, d3!, d4!], dat: readOriginal(DAT_FILE_NAME) })).toThrow(/numéro de disque/);
    expect(() => new LureResources({ disks: [d1!, d2!, d3!, d4!], dat: d1! })).toThrow(/numéro de disque/);
  });
});
