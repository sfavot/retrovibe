import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "../helpers";
import type { BenchInput } from "../engine/bench";
import { captureFrames, shotHash } from "./capture";

/**
 * Rendu de Ween comparé aux captures du banc ScummVM (`GOB_SHOT_FRAMES`, voir `docs/ween/graphics.md`) : à chaque
 * image échantillonnée, indices de couleur et palette de l'écran 320x200 (sans curseur) identiques au banc. Les
 * références sont des empreintes (`test/ween/fixtures/frames.json`, produites par `make-frames.mts`) ; les images
 * sont les mêmes que celles des traces de `test/ween/engine/boot.test.ts`.
 */
const FRAMES: Record<string, Record<string, string>> = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../fixtures/frames.json"), "utf8"),
);

/** Compare le portage aux empreintes d'un scénario ; retourne les images qui diffèrent. */
async function compare(name: string, inputs: BenchInput[], stop?: number): Promise<string[]> {
  const ref = FRAMES[name];
  const images = Object.keys(ref).map(Number);
  const shots = await captureFrames(images, inputs, stop);
  const bad: string[] = [];
  for (const n of images) {
    const shot = shots.get(n);
    const hash = shot ? shotHash(shot) : "absente";
    if (hash !== ref[n]) bad.push(`${n} : ${hash} (banc ${ref[n]})`);
  }
  return bad;
}

describe.skipIf(!hasOriginalFiles)("Ween : rendu comparé au banc ScummVM", () => {
  it("introduction regardée (surfaces 640x200, défilement, vidéos IMD) jusqu'à EMAJ1000 : 180 images identiques", async () => {
    expect(Object.keys(FRAMES.intro)).toHaveLength(180);
    expect(await compare("intro", [], 7800)).toEqual([]);
  }, 60_000);

  it("Échap, MENU, EMAJ1000, menu des options (survol, fenêtre) : images identiques", async () => {
    const inputs: BenchInput[] = [
      { image: 20, key: "ESC" },
      { image: 300, move: [28, 10] },
      { image: 400, click: [28, 10] },
      { image: 480, move: [58, 37] },
      { image: 500, click: [58, 37] },
      { image: 700, move: [100, 141] },
      { image: 720, click: [100, 141] },
    ];
    expect(await compare("quit", inputs, 724)).toEqual([]);
  }, 60_000);

  it("EMAJ1000 : objets cliqués (boule de cristal, suspension), textes et animations", async () => {
    const inputs: BenchInput[] = [
      { image: 20, key: "ESC" },
      { image: 420, move: [130, 90] },
      { image: 440, click: [130, 90] },
      { image: 900, move: [280, 100] },
      { image: 920, click: [280, 100] },
      { image: 1400, move: [160, 150] },
    ];
    expect(await compare("room", inputs, 1500)).toEqual([]);
  }, 60_000);
});
