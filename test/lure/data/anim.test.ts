import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { catalogOf, lureData } from "./catalog-helper";
import { AnimationSequence, PIXELFLAG_HAS_TABLE, animationFrame, decodeAnimation, type Animation } from "../../../src/games/lure/data/anim";
import { SCREEN_SIZE, vgaDecode } from "../../../src/games/lure/data/picture";
import { hasOriginalFiles } from "./helpers";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

describe("animationFrame (données synthétiques)", () => {
  const anim: Animation = { numFrames: 2, frameSizes: [4, 4], nibbles: Uint8Array.from([0x12, 0x34, 0x56, 0x78]) };

  it("sépare les quartets : deux pixels par octet, poids fort d'abord", () => {
    expect([...animationFrame(anim, 0, 2, 2, 0)]).toEqual([1, 2, 3, 4]);
    expect([...animationFrame(anim, 1, 2, 2, 0)]).toEqual([5, 6, 7, 8]);
  });

  it("avec PIXELFLAG_HAS_TABLE, place les images d'après la demi-taille de l'en-tête", () => {
    const withTable: Animation = { numFrames: 2, frameSizes: [2, 4], nibbles: Uint8Array.from([0x12, 0x34, 0x56]) };
    expect([...animationFrame(withTable, 1, 2, 1, PIXELFLAG_HAS_TABLE)]).toEqual([3, 4]);
  });

  it("refuse une image absente", () => {
    expect(() => animationFrame(anim, 2, 2, 2, 0)).toThrow(RangeError);
  });
});

describe("decodeAnimation (données synthétiques)", () => {
  it("refuse une ressource sans image, trop courte ou annonçant 100 images", () => {
    expect(() => decodeAnimation(new Uint8Array(1))).toThrow(/trop courte/);
    expect(() => decodeAnimation(Uint8Array.from([0, 0, 0, 0]))).toThrow(/0 images/);
    expect(() => decodeAnimation(Uint8Array.from([100, 0]))).toThrow(/100 images/);
    expect(() => decodeAnimation(Uint8Array.from([2, 0, 1, 0]))).toThrow(/tronqué/);
  });
});

describe.skipIf(!hasOriginalFiles)("animations du jeu", () => {
  const animations = () => catalogOf().filter((entry) => entry.kind === "animation");

  it("décode les 137 images de sprites : la taille décompressée est la somme des tailles de l'en-tête", () => {
    expect(animations()).toHaveLength(137);
    for (const entry of animations()) {
      const anim = decodeAnimation(lureData().resources.get(entry.id));
      expect(anim.nibbles.length, `animation 0x${entry.id.toString(16)}`).toBe(anim.frameSizes.reduce((sum, size) => sum + size, 0) >> 1);
    }
  });

  // Valeurs relevées avec `AnimationDecoder::decode_data` de ScummVM compilé tel quel et lancé sur les mêmes ressources
  // (comparaison octet à octet sur les 137 animations).
  const animCases: Array<[number, number, string]> = [
    [0x6310, 11448, "629a3c578cdc9438"],
    [0x6327, 12800, "5f23e375eef0bd7e"],
    [0x4120, 27648, "2adc29e31b5232df"],
    [0xc008, 864, "2ef19ea9acb0e878"],
    [0x7901, 1344, "3d0145e5823cf793"],
  ];
  it.each(animCases.map(([id, size, hash]) => [id.toString(16), id, size, hash] as [string, number, number, string]))("la ressource 0x%s décode comme ScummVM (%i octets, empreinte %s)", (_name, id, size, hash) => {
    const anim = decodeAnimation(lureData().resources.get(id));
    expect(anim.nibbles.length).toBe(size);
    expect(sha(anim.nibbles)).toBe(hash);
  });

  it("découpe en images les animations des hotspots : taille de l'en-tête = taille du hotspot, sauf cinq redimensionnés par script", () => {
    const d = lureData();
    const byRecord = new Map(d.anims.map((anim) => [anim.animRecordId, anim]));
    const resized: number[] = [];
    for (const hotspot of d.hotspots) {
      const record = byRecord.get(hotspot.animRecordId);
      if (!record || !d.resources.has(record.animId) || record.animId === 0xff00) continue;
      const anim = decodeAnimation(d.resources.get(record.animId));
      const table = (record.flags & PIXELFLAG_HAS_TABLE) !== 0;
      const expected = table ? anim.frameSizes.reduce((sum, size) => sum + (size >> 1), 0) : anim.numFrames * ((hotspot.width * hotspot.height) >> 1);
      if (expected !== anim.nibbles.length) resized.push(hotspot.hotspotId);
      else for (let frame = 0; frame < anim.numFrames; frame++) expect(Math.max(...animationFrame(anim, frame, hotspot.width, hotspot.height, record.flags))).toBeLessThan(16);
    }
    expect(resized).toEqual([1036, 1040, 1051, 1068, 1069]);
  });
});

describe.skipIf(!hasOriginalFiles)("séquences plein écran du jeu", () => {
  // écran de départ (id) : nombre d'images
  const frames: Array<[number, number]> = [
    [0x40, 76], [0x42, 100], [0x44, 242], [0x46, 123], [0x48, 5],
    [0x404d, 24], [0x404f, 11], [0x4051, 5], [0x4061, 24], [0xe9f1, 176], [0xff01, 138],
  ];

  it.each(frames.map(([id, count]) => [id.toString(16), id, count] as const))("la séquence 0x%s a %i images et consomme ses lignes jusqu'au bout", (_name, id, count) => {
    const d = lureData();
    const lines = d.resources.get(id + 1);
    const seq = new AnimationSequence(d.resources.get(id), lines);
    expect(seq.initialScreen).toHaveLength(SCREEN_SIZE);
    const screen = seq.initialScreen.slice();
    let n = 0;
    while (seq.hasFrame) {
      seq.applyNextFrame(screen);
      n++;
    }
    expect(n).toBe(count);
    seq.rewind();
    expect(seq.hasFrame).toBe(true);
  });

  it("l'écran de départ est le début de la sortie décompressée de l'écran", () => {
    const d = lureData();
    const seq = new AnimationSequence(d.resources.get(0x40), d.resources.get(0x41));
    expect(seq.initialScreen).toEqual(vgaDecode(d.resources.get(0x40), 300000).subarray(0, SCREEN_SIZE));
    const screen = seq.initialScreen.slice();
    seq.applyNextFrame(screen);
    expect(screen).not.toEqual(seq.initialScreen);
  });

  it("les séquences de 0x24, 0xFF03 et 0xFF05 n'ont aucune image en différence (lignes de 4 octets)", () => {
    const d = lureData();
    for (const id of [0x24, 0xff03, 0xff05]) {
      expect(d.resources.size(id + 1)).toBe(4);
      expect(new AnimationSequence(d.resources.get(id), d.resources.get(id + 1)).hasFrame).toBe(false);
    }
  });
});
