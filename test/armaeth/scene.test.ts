import { describe, expect, it } from "vitest";
import { BinaryReader } from "../../src/data/reader";
import {
  readScene,
  readSceneLayer,
  unpackNibble,
  unpackRle,
} from "../../src/games/armaeth/data/scene";
import { readSceneArchive } from "../../src/games/armaeth/data/vga-archive";
import { hasOriginalFiles, listOriginal, readOriginal } from "./helpers";

describe("décompresseurs de ligne", () => {
  it("RLE : littéraux et répétitions", () => {
    expect([...unpackRle(Uint8Array.from([0, 3, 7, 8, 9, 4, 1]), 1)]).toEqual([
      7, 8, 9, 1, 1, 1, 1,
    ]);
  });

  it("RLE : sans passe (n = 0) l'entrée est rendue telle quelle", () => {
    expect([...unpackRle(Uint8Array.from([5, 6, 7]), 0)]).toEqual([5, 6, 7]);
  });

  it("nibble : base + quartet haut puis bas, dernier pixel écarté si le compte est impair", () => {
    expect([...unpackNibble(Uint8Array.from([4, 10, 0x12, 0x30]), 1)]).toEqual([
      11, 12, 13, 10,
    ]);
    expect([...unpackNibble(Uint8Array.from([3, 250, 0x1f, 0x70]), 1)]).toEqual(
      [251, 9, 1],
    );
    expect([...unpackNibble(Uint8Array.from([0, 2, 9, 8]), 1)]).toEqual([9, 8]);
  });

  it("nibble : n passes réinterprètent la sortie comme un flux compressé", () => {
    // la passe 1 recopie 3 octets littéraux qui forment eux-mêmes un paquet nibble (`2 5 00` : 5 5).
    const second = Uint8Array.from([2, 5, 0x00]); // sortie de la passe 2 : 5 5
    const first = Uint8Array.from([0, 3, ...second]); // passe 1 : littéral de 3 octets = `second`
    expect([...unpackNibble(first, 2)]).toEqual([5, 5]);
    expect([...unpackNibble(first, 1)]).toEqual([...second]);
  });

  it("refuse les paquets tronqués", () => {
    expect(() => unpackRle(Uint8Array.from([0, 5, 1]), 1)).toThrow(
      /Scène invalide/,
    );
    expect(() => unpackRle(Uint8Array.from([3]), 1)).toThrow(/Scène invalide/);
    expect(() => unpackNibble(Uint8Array.from([4, 1, 0x12]), 1)).toThrow(
      /Scène invalide/,
    );
  });
});

describe("couche d'image", () => {
  const rect = { x: 3, y: 4, width: 4, height: 2 };

  it("décode une couche de type 0 ligne par ligne", () => {
    // ligne 0 : n = 1, m = 2, paquet « 4 x 8 » ; ligne 1 : n = 1, m = 6, littéral de 4 octets.
    const bytes = Uint8Array.from([0, 1, 2, 4, 8, 1, 6, 0, 4, 1, 2, 3, 4]);
    const layer = readSceneLayer(bytes, new BinaryReader(bytes), rect);
    expect(layer).toMatchObject({
      type: 0,
      x: 3,
      y: 4,
      width: 4,
      height: 2,
      passes: [1, 1],
      size: 13,
    });
    expect([...layer.pixels]).toEqual([8, 8, 8, 8, 1, 2, 3, 4]);
  });

  it("additionne les octets 0xFF des entiers n et m", () => {
    // m = 255 + 5 = 260 : un littéral de 255 octets (257 avec son en-tête) puis un littéral d'un octet (3).
    const literal = Array.from({ length: 255 }, (_, i) => i);
    const bytes = Uint8Array.from([0, 1, 255, 5, 0, 255, ...literal, 0, 1, 9]);
    const layer = readSceneLayer(bytes, new BinaryReader(bytes), {
      x: 0,
      y: 0,
      width: 256,
      height: 1,
    });
    expect(layer.pixels[255]).toBe(9);
    expect(layer.size).toBe(bytes.length);
    // n = 255 + 1 = 256 passes : au-delà de 100
    const tooMany = Uint8Array.from([0, 255, 1, 2, 4, 8]);
    expect(() =>
      readSceneLayer(tooMany, new BinaryReader(tooMany), {
        x: 0,
        y: 0,
        width: 4,
        height: 1,
      }),
    ).toThrow(/passes/);
  });

  it("applique la table de recoloration aux couches de type 1 seulement", () => {
    const table = Uint8Array.from({ length: 256 }, (_, i) => 255 - i);
    const bytes = Uint8Array.from([1, 1, 2, 4, 9]);
    const one = { x: 0, y: 0, width: 4, height: 1 };
    const recolored = readSceneLayer(bytes, new BinaryReader(bytes), one, {
      recolorType1: table,
    });
    expect([...recolored.pixels]).toEqual([246, 246, 246, 246]);
    expect(recolored.recolored).toBe(true);
    const plain = readSceneLayer(bytes, new BinaryReader(bytes), one);
    expect([...plain.pixels]).toEqual([9, 9, 9, 9]);
    const type0 = Uint8Array.from([0, 1, 2, 4, 9]);
    expect(
      readSceneLayer(type0, new BinaryReader(type0), one, {
        recolorType1: table,
      }).recolored,
    ).toBe(false);
  });

  it("refuse un type inconnu et une largeur qui ne tombe pas juste", () => {
    const bad = Uint8Array.from([3, 1, 2, 4, 9]);
    expect(() =>
      readSceneLayer(bad, new BinaryReader(bad), {
        x: 0,
        y: 0,
        width: 4,
        height: 1,
      }),
    ).toThrow(/type de couche/);
    const bytes = Uint8Array.from([0, 1, 2, 3, 9]);
    expect(() =>
      readSceneLayer(bytes, new BinaryReader(bytes), {
        x: 0,
        y: 0,
        width: 4,
        height: 1,
      }),
    ).toThrow(/au lieu de 4/);
  });
});

describe.skipIf(!hasOriginalFiles)("scènes d'Armaeth", () => {
  const files = listOriginal((n) => /^A1F0\d[A-E]\.VGA$/.test(n));

  it("décode toutes les couches de toutes les scènes avec une consommation exacte", () => {
    let scenes = 0;
    let layers = 0;
    const types = new Set<number>();
    const passes = new Set<number>();
    for (const name of files) {
      const archive = readSceneArchive(readOriginal(name));
      for (const entry of archive.entries) {
        // readScene lance si une ligne déborde, si une couche ne fait pas la taille annoncée ou s'il reste des octets.
        const scene = readScene(archive.bytes(entry.id));
        expect(scene.header.id).toBe(entry.id);
        for (const layer of scene.layers) {
          expect(layer.pixels).toHaveLength(layer.width * layer.height);
          expect(layer.x + layer.width).toBeLessThanOrEqual(320);
          expect(layer.y + layer.height).toBeLessThanOrEqual(200);
          types.add(layer.type);
          for (const n of layer.passes) passes.add(n);
          layers++;
        }
        scenes++;
      }
    }
    expect(scenes).toBe(60);
    expect(layers).toBe(120);
    expect([...types].sort()).toEqual([0, 2]);
    // lignes à plusieurs passes (n > 1) et lignes copiées telles quelles (n = 0) présentes et décodées
    expect(Math.max(...passes)).toBe(7);
    expect(passes.has(0)).toBe(true);
    expect(passes.has(2)).toBe(true);
  });

  it("A1F00A id 2 : la ligne 125 (n = 2) fait 320 pixels", () => {
    const scene = readScene(
      readSceneArchive(readOriginal("A1F00A.VGA")).bytes(2),
    );
    expect(scene.layers[0].type).toBe(2);
    expect(scene.layers[0].passes[125]).toBe(2);
    expect(scene.layers[0]).toMatchObject({
      x: 0,
      y: 10,
      width: 320,
      height: 180,
    });
  });

  it("A1F00A id 0 : le cadre d'interface couvre l'écran de 320 x 200", () => {
    const scene = readScene(
      readSceneArchive(readOriginal("A1F00A.VGA")).bytes(0),
    );
    expect(scene.layers[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 320,
      height: 200,
    });
  });

  it("points sensibles, décors et étendues par rangée : compteurs, bornes et enregistrements typés", () => {
    let hotspots = 0;
    let withRect = 0;
    let decors = 0;
    for (const name of files) {
      const archive = readSceneArchive(readOriginal(name));
      for (const entry of archive.entries) {
        const scene = readScene(archive.bytes(entry.id));
        expect(scene.hotspots).toHaveLength(scene.header.hotspotCount);
        expect(scene.decors).toHaveLength(scene.header.decorCount);
        expect(scene.rowRanges).toHaveLength(20);
        for (const range of scene.rowRanges) expect(Math.max(range.min, range.max)).toBeLessThanOrEqual(320);
        for (const spot of scene.hotspots) {
          if (spot.rect === null) continue;
          withRect++;
          expect(spot.rect.x0).toBeLessThanOrEqual(spot.rect.x1);
          expect(spot.rect.y0).toBeLessThanOrEqual(spot.rect.y1);
        }
        for (const decor of scene.decors) {
          expect([0, 1, 255]).toContain(decor.hor);
          expect(decor.x).toBeLessThanOrEqual(320);
        }
        hotspots += scene.hotspots.length;
        decors += scene.decors.length;
      }
    }
    // engine.md § 5.2 : 601 enregistrements de 10 octets dont 428 rectangles
    expect(hotspots).toBe(601);
    expect(withRect).toBe(428);
    expect(decors).toBeGreaterThan(0);
  });

  it("limites de la salle (mots 9 à 14) et zones typées (movement.md § 1.1)", () => {
    let zones = 0;
    const types = new Set<number>();
    for (const name of files) {
      const archive = readSceneArchive(readOriginal(name));
      for (const entry of archive.entries) {
        const scene = readScene(archive.bytes(entry.id));
        const { header } = scene;
        const { limits } = header;
        expect(Object.values(limits)).toEqual([...header.words.subarray(9, 15)]);
        expect(limits.xMin).toBeLessThanOrEqual(limits.xMax);
        expect(limits.yMin).toBeLessThanOrEqual(limits.yMax);
        expect(limits.pMin).toBeLessThanOrEqual(limits.pMax);
        expect(limits.xMax).toBeLessThanOrEqual(319);
        expect(limits.yMax).toBeLessThanOrEqual(199);
        expect(limits.pMax).toBeLessThanOrEqual(255);
        expect(scene.zones).toHaveLength(header.zoneCount);
        for (const zone of scene.zones) {
          expect(zone.plane).toBe(0xff);
          expect(zone.colEnd).toBeGreaterThanOrEqual(zone.colStart);
          expect(zone.high).toBeGreaterThanOrEqual(zone.low);
          expect(zone.row).toBeGreaterThanOrEqual(0);
          expect(zone.row).toBeLessThan(21);
          expect(zone.colEnd).toBeLessThan(81);
          types.add(zone.type);
          zones++;
        }
      }
    }
    expect(zones).toBe(71);
    expect([...types].sort((a, b) => a - b)).toEqual([11, 15, 16, 17, 19, 48, 49, 50, 51, 59]);
  });

  it("scène 3 : limites 0, 199, 0, 99, 8, 111", () => {
    for (const name of files) {
      const archive = readSceneArchive(readOriginal(name));
      for (const entry of archive.entries) {
        if (entry.id !== 3) continue;
        expect(readScene(archive.bytes(3)).header.limits).toEqual({
          xMin: 0, xMax: 199, yMin: 0, yMax: 99, pMin: 8, pMax: 111,
        });
        return;
      }
    }
    throw new Error("scène 3 introuvable");
  });
});
