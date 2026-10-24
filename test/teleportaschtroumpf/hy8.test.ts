import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HY8_PART_IMAGE, parseHy8 } from "../../src/games/teleportaschtroumpf/data/hy8";
import { placeSprite } from "../../src/games/teleportaschtroumpf/engine/sprites";
import { hasOriginalFiles, listData, readData, withExtension } from "./helpers";

const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

describe("HY8 : données invalides", () => {
  /** HY8 minimal : 1 sprite (1 partie image 0, point (1, -2)), 1 image 16x1 vide, 1 animation vide. */
  function minimal(image: number[] = [0x01, 0x01, 0x00, 0x10]): Uint8Array {
    const bytes = new Uint8Array(24 + 12 + 6 + image.length + 6 + 12);
    const view = new DataView(bytes.buffer);
    // sprites : 24..36
    view.setUint32(24, 4, true);
    bytes.set([0x10, 0x01, 0x01, 0x01, 0x00, 0x00, 0x01, 0xfe], 28);
    // images : 36, offsets sur 4 + 2 octets de remplissage, image à +6
    const images = 36;
    view.setUint32(images, 6, true);
    bytes.set(image, images + 6);
    const animations = images + 6 + image.length;
    view.setUint32(animations, 4, true);
    bytes.set([0x00, 0x00], animations + 4);
    const trailer = animations + 6;
    bytes.set([0x0a], trailer);
    const end = trailer + 12;
    const header = [24, images, animations, trailer, 0, end];
    header.forEach((v, i) => view.setUint32(i * 4, v, true));
    return bytes.subarray(0, end);
  }

  it("décode un fichier minimal construit à la main", () => {
    const hy8 = parseHy8(minimal());
    expect(hy8.images).toHaveLength(1);
    expect(hy8.images[0]).toMatchObject({ width: 16, height: 1 });
    expect(hy8.sprites).toEqual([{ mode: 0x10, parts: [{ kind: HY8_PART_IMAGE, target: 0, flags: 0, points: [{ x: 1, y: -2 }] }] }]);
    expect(hy8.animations).toEqual([{ header: 0, frames: [] }]);
    expect(hy8.trailer).toHaveLength(12);
  });

  it("retourne une image dont le mot d'attributs vaut 0x8000 (stockée en miroir)", () => {
    // Image 16x1 : un span de 3 pixels après 2 transparents, écart de fin 11.
    const image = [0x01, 0x01, 0x01, 0x02, 0x00, 0x03, 7, 8, 9, 11];
    const plain = parseHy8(minimal(image)).images[0].pixels;
    expect([...plain.subarray(0, 5)]).toEqual([0, 0, 7, 8, 9]);
    const bytes = minimal(image);
    bytes.set([0x00, 0x80], 36 + 4); // mot d'attributs de l'image, juste avant elle
    const mirrored = parseHy8(bytes).images[0].pixels;
    expect([...mirrored]).toEqual([...plain].reverse());
  });

  it("refuse un fichier plus court que l'en-tête", () => {
    expect(() => parseHy8(new Uint8Array(20))).toThrow(/HY8 invalide/);
  });

  it("refuse un fichier tronqué", () => {
    const bytes = minimal();
    expect(() => parseHy8(bytes.subarray(0, bytes.length - 1))).toThrow(/HY8 invalide/);
    expect(() => parseHy8(bytes.subarray(0, 30))).toThrow(/HY8 invalide/);
  });

  it("refuse un h[0] différent de 0x18", () => {
    const bytes = minimal();
    bytes[0] = 0x20;
    expect(() => parseHy8(bytes)).toThrow(/h\[0\]/);
  });

  it("refuse une ligne d'image qui déborde ou un écart de fin faux", () => {
    // un span de 17 pixels dans une image de 16 de large
    expect(() => parseHy8(minimal([0x01, 0x01, 0x01, 0x00, 0x00, 0x11, ...new Array(17).fill(1), 0x00]))).toThrow(/déborde/);
    // écart de fin 15 au lieu de 16
    expect(() => parseHy8(minimal([0x01, 0x01, 0x00, 0x0f]))).toThrow(/écart de fin/);
  });

  it("refuse un mode de sprite inconnu", () => {
    const bytes = minimal();
    bytes[28] = 0x30;
    expect(() => parseHy8(bytes)).toThrow(/mode/);
  });
});

describe.skipIf(!hasOriginalFiles)("HY8 des fichiers originaux", () => {
  const files = listData(withExtension("HY8"));

  it("décode les 33 fichiers", () => {
    expect(files).toHaveLength(33);
    for (const path of files) {
      const hy8 = parseHy8(readData(path));
      expect(hy8.images.length, path).toBeGreaterThan(0);
      expect(hy8.sprites.length, path).toBeGreaterThan(0);
      expect(hy8.trailer, path).toHaveLength(12);
      for (const image of hy8.images) expect(image.pixels, path).toHaveLength(image.width * image.height);
    }
  });

  it("compte les images", () => {
    expect(parseHy8(readData("S01/S01A/S01A000S.HY8")).images).toHaveLength(138);
    expect(parseHy8(readData("S08/S08A/S08A000S.HY8")).images).toHaveLength(17);
    expect(parseHy8(readData("S25/S25A/S25A000S.HY8")).images).toHaveLength(1);
  });

  it("donne les dimensions de quelques images", () => {
    const s08 = parseHy8(readData("S08/S08A/S08A000S.HY8"));
    expect([s08.images[0].width, s08.images[0].height]).toEqual([80, 151]);
    const s25 = parseHy8(readData("S25/S25A/S25A000S.HY8"));
    expect([s25.images[0].width, s25.images[0].height]).toEqual([32, 30]);
    const s01 = parseHy8(readData("S01/S01A/S01A000S.HY8"));
    expect([s01.images[100].width, s01.images[100].height]).toEqual([32, 23]);
  });

  // Empreintes calculées avec le prototype scripts/teleportaschtroumpf/proto/hy8.py.
  it("produit les mêmes pixels que le prototype Python", () => {
    const s08 = parseHy8(readData("S08/S08A/S08A000S.HY8"));
    expect(sha1(s08.images[0].pixels)).toBe("114fa18ac9a8f8511d66a9332722ede4d0ac74d3");
    const s01 = parseHy8(readData("S01/S01A/S01A000S.HY8"));
    expect(sha1(s01.images[100].pixels)).toBe("d22705c8f22dd0721c95fcfa5ffef76ad85d73f7");
    const s25 = parseHy8(readData("S25/S25A/S25A000S.HY8"));
    expect(sha1(s25.images[0].pixels)).toBe("941a04541857f5d9065d2cd1060d03ddd8a01d67");
    expect(s25.images[0].pixels.filter((p) => p !== 0)).toHaveLength(384);
  });

  it("décode les sprites et la table d'animations de S02A000S", () => {
    const hy8 = parseHy8(readData("S02/S02A/S02A000S.HY8"));
    expect(hy8.sprites).toEqual([
      { mode: 0x10, parts: [{ kind: HY8_PART_IMAGE, target: 0, flags: 0, points: [{ x: -17, y: 0 }] }] },
      { mode: 0x10, parts: [{ kind: HY8_PART_IMAGE, target: 1, flags: 0, points: [{ x: -8, y: 0 }] }] },
    ]);
    expect(hy8.animations).toEqual([{ header: 0, frames: [] }]);
  });

  it("décode les sprites en coordonnées 16 bits et les animations de S22A000S", () => {
    const hy8 = parseHy8(readData("S22/S22A/S22A000S.HY8"));
    expect(hy8.sprites).toHaveLength(15);
    expect(hy8.sprites[0].mode).toBe(0x00);
    expect(hy8.sprites[0].parts).toHaveLength(8);
    expect(hy8.sprites[0].parts[0]).toEqual({ kind: HY8_PART_IMAGE, target: 0, flags: 0, points: [{ x: -41, y: -9 }] });
    expect(hy8.sprites[6].mode).toBe(0x10);
    expect(hy8.animations).toHaveLength(2);
    expect(hy8.animations[0].frames.map((f) => f.sprite)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(hy8.animations[1].frames.map((f) => f.sprite)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(hy8.animations[0].frames[0]).toEqual({ sprite: 0, flags: 0, duration: 1, dx: 0, dy: 0 });
  });

  it("pose une image stockée en miroir sans la décaler : chaque animation tournée à gauche est le miroir exact de celle de droite", () => {
    const hy8 = parseHy8(readData("S01/S01A/S01A000S.HY8"));
    expect(hy8.images.filter((image) => image.storedMirrored)).toHaveLength(35);
    // Pixels non transparents d'une frame, de la colonne la plus à gauche à la plus à droite (relatives à l'ancre).
    const extent = (sprite: number, mirror: boolean): [number, number] => {
      let min = Infinity;
      let max = -Infinity;
      for (const p of placeSprite(hy8, sprite & 0x0fff, mirror)) {
        const { width, height, pixels } = p.image;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++)
            if (pixels[y * width + x]) {
              const column = p.left + (p.mirror ? width - 1 - x : x);
              min = Math.min(min, column);
              max = Math.max(max, column);
            }
      }
      return [min, max];
    };
    const frames = (animation: number) => hy8.animations[animation].frames.map((f) => extent(f.sprite, (f.flags & 0x8000) !== 0));
    // Saut, course, impatience, arrivée (droite, gauche) et oiseau du décor (vers la gauche, vers la droite).
    for (const [right, left] of [[4, 5], [6, 7], [9, 0xb], [0xc, 0xd], [0x1c, 0x1f]]) {
      expect(frames(left), `animations ${right} / ${left}`).toEqual(frames(right).map(([min, max]) => [-max, -min]));
    }
  });

  it("garde les animations vides de S33A001S", () => {
    const hy8 = parseHy8(readData("S33/S33A/S33A001S.HY8"));
    expect(hy8.sprites).toHaveLength(6);
    expect(hy8.animations).toHaveLength(37);
    expect(hy8.animations[0].frames).toHaveLength(6);
    expect(hy8.animations.slice(1).every((a) => a.frames.length === 0)).toBe(true);
  });
});
