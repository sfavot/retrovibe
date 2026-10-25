import { describe, expect, it } from "vitest";
import { readSprite } from "../../src/games/armaeth/data/sprite";
import { readCountedArchive } from "../../src/games/armaeth/data/vga-archive";
import { hasOriginalFiles, readOriginal } from "./helpers";

function u16(v: number): number[] {
  return [v & 0xff, v >> 8];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24];
}

/** Ressource d'une image de 3 colonnes de 2 pixels (colonne par colonne : 1 2 | 3 4 | 5 6) et d'une animation de 1 enregistrement (les 4 directions sur la séquence 0) + 2 mots (en-tête, pas). */
function minimal(): Uint8Array {
  const image = [2, 3, 1, 2, 3, 4, 5, 6];
  return Uint8Array.from([
    ...u16(2001),
    ...u16(1),
    ...u16(1),
    ...u16(2),
    ...u32(image.length),
    ...u16(0x16),
    ...new Array(18).fill(0),
    ...u32(0),
    ...[0, 0xff, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0],
    ...u16(1),
    ...u16(0x8200),
    ...image,
  ]);
}

describe("sprite (données synthétiques)", () => {
  it("passe les images de colonne par colonne à ligne par ligne", () => {
    const sprite = readSprite(minimal());
    expect(sprite.id).toBe(2001);
    expect(sprite.frames).toHaveLength(1);
    expect(sprite.frames[0]).toMatchObject({ width: 3, height: 2 });
    expect([...sprite.frames[0].pixels]).toEqual([1, 3, 5, 2, 4, 6]);
  });

  it("conserve la section d'animation brute", () => {
    const { animation } = readSprite(minimal());
    expect(animation).toMatchObject({ records: 1, words: 2 });
    expect([...animation.bytes]).toEqual([0, 0xff, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0x82]);
  });

  it("décode les enregistrements et les pas (durée << 8) | image", () => {
    const [fig] = readSprite(minimal()).animation.figs;
    expect(fig).toMatchObject({ index: 0, mirrorLeft: 0xff, dpX: 3, dpY: 4 });
    expect(fig.directions[0]).toBe(fig.directions[3]);
    expect(fig.directions[0]).toEqual({
      start: 0,
      headerHigh: 0,
      steps: [{ frame: 0, duration: 2, mirror: true }],
    });
  });

  it("refuse une séquence hors du tableau de mots ou qui le déborde", () => {
    const outside = minimal();
    outside[0x20 + 4 + 4] = 5; // direction 0 -> mot 5, hors du tableau
    expect(() => readSprite(outside)).toThrow(/séquence 5 hors/);
    const overflow = minimal();
    overflow[0x20 + 4 + 12] = 5; // en-tête : 5 pas, il n'en reste qu'un
    expect(() => readSprite(overflow)).toThrow(/déborde/);
  });

  it("refuse une ressource dont les images ne finissent pas à sa fin", () => {
    const bytes = minimal();
    expect(() => readSprite(bytes.subarray(0, bytes.length - 1))).toThrow(
      /Sprite invalide/,
    );
    expect(() => readSprite(new Uint8Array(10))).toThrow(/Sprite invalide/);
  });
});

describe.skipIf(!hasOriginalFiles)("sprites d'Armaeth", () => {
  const families = [
    { file: "A1FINT.VGA", resources: 30, frames: 82, base: 0 },
    { file: "A1FDEC.VGA", resources: 20, frames: 182, base: 1000 },
    { file: "A1FOBJ.VGA", resources: 92, frames: 493, base: 2000 },
    { file: "A1FANM.VGA", resources: 47, frames: 271, base: 3000 },
  ];

  it.each(families)(
    "$file : $resources ressources, $frames images, décodées sans reste",
    ({ file, resources, frames, base }) => {
      const archive = readCountedArchive(readOriginal(file));
      expect(archive.entries).toHaveLength(resources);
      let total = 0;
      for (const entry of archive.entries) {
        const sprite = readSprite(archive.bytes(entry.id));
        expect(sprite.id).toBe(base + entry.id);
        expect(sprite.animation.bytes).toHaveLength(
          12 * sprite.animation.records + 2 * sprite.animation.words,
        );
        for (const frame of sprite.frames) {
          expect(frame.pixels).toHaveLength(frame.width * frame.height);
          expect(frame.width).toBeLessThanOrEqual(48);
          expect(frame.height).toBeLessThanOrEqual(58);
        }
        total += sprite.frames.length;
      }
      expect(total).toBe(frames);
    },
  );

  it("animations : séquences sans chevauchement, images dans les bornes (sauf exceptions connues)", () => {
    const outOfRange: string[] = [];
    const unreferenced: string[] = [];
    for (const { file } of families) {
      const archive = readCountedArchive(readOriginal(file));
      for (const entry of archive.entries) {
        const { frames, animation } = readSprite(archive.bytes(entry.id));
        const label = `${file}#${entry.id}`;
        expect(animation.figs).toHaveLength(animation.records);
        const covered = new Array<number>(animation.words).fill(0);
        const seen = new Set<number>();
        animation.figs.forEach((fig, i) => {
          expect(fig.index, label).toBe(i);
          for (const sequence of fig.directions) {
            expect(sequence.headerHigh, label).toBe(0);
            sequence.steps.forEach((step) => {
              if (step.frame >= frames.length) outOfRange.push(`${label} Fig ${i}`);
            });
            if (seen.has(sequence.start)) continue;
            seen.add(sequence.start);
            for (let k = 0; k <= sequence.steps.length; k++) covered[sequence.start + k]++;
          }
        });
        expect(Math.max(0, ...covered), label).toBeLessThanOrEqual(1);
        const free = covered.flatMap((c, i) => (c === 0 ? [i] : []));
        if (free.length > 0) unreferenced.push(`${label}:${free.join(",")}`);
      }
    }
    // seule exception : INT 3 (1 image) dont la Fig 2 « cachée » vise l'image 1, absente (Fig jamais utilisée)
    expect([...new Set(outOfRange)]).toEqual(["A1FINT.VGA#3 Fig 2"]);
    // seul mot libre : la séquence 0 (en-tête + 1 pas), jamais visée par un enregistrement (rôle de séquence « vide » probable)
    expect(unreferenced.filter((u) => !u.endsWith(":0,1"))).toEqual([]);
  });

  it("INT 1 : Fig 1 = images 1 à 4 de durée 2 (visages rouges), Fig 2 = image 5", () => {
    const { animation } = readSprite(
      readCountedArchive(readOriginal("A1FINT.VGA")).bytes(1),
    );
    expect(animation.figs[1].directions[0].steps).toEqual(
      [1, 2, 3, 4].map((frame) => ({ frame, duration: 2, mirror: false })),
    );
    expect(animation.figs[2].directions[0].steps).toEqual([{ frame: 5, duration: 1, mirror: false }]);
  });

  it("OBJ 1 (le héros) : 102 images dont la première est transparente à plus de 40 %", () => {
    const sprite = readSprite(
      readCountedArchive(readOriginal("A1FOBJ.VGA")).bytes(1),
    );
    expect(sprite.frames).toHaveLength(102);
    expect(sprite.animation.bytes).toHaveLength(518);
    const transparent =
      sprite.frames[0].pixels.filter((v) => v === 0xff).length /
      sprite.frames[0].pixels.length;
    expect(transparent).toBeGreaterThan(0.4);
  });
});
