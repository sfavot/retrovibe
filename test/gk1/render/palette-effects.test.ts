import { describe, expect, it } from "vitest";
import { ResourceType } from "../../../src/games/gk1/data/ids";
import { PALETTE_COLORS, type Palette, readPalette } from "../../../src/games/gk1/data/palette";
import { type Cel, drawCel } from "../../../src/games/gk1/render/cel";
import { GamePalette } from "../../../src/games/gk1/render/palette";
import { makeRect } from "../../../src/games/gk1/render/rect";
import { Remap } from "../../../src/games/gk1/render/remap";
import { fnv1a, mainIndex, original } from "../data/real";
import { Scene } from "./scene";

type Rgb = [number, number, number];

function palette(colors: Record<number, Rgb>): Palette {
  const used = new Uint8Array(PALETTE_COLORS);
  const rgb = new Uint8Array(PALETTE_COLORS * 3);
  for (const [index, color] of Object.entries(colors)) {
    used[Number(index)] = 1;
    rgb.set(color, 3 * Number(index));
  }
  return { start: 0, count: PALETTE_COLORS, sharedUsed: false, version: 0, used, rgb, byteLength: 0 };
}

/** Palette du jeu sur une horloge que le test avance. */
function clocked(colors: Record<number, Rgb>): { game: GamePalette; clock: { now: number }; color: (index: number) => number[] } {
  const clock = { now: 0 };
  const game = new GamePalette(() => clock.now);
  game.submit(palette(colors));
  return { game, clock, color: (index) => [...game.screen.subarray(3 * index, 3 * index + 3)] };
}

describe("PalVary : variation vers une palette cible", () => {
  const SOURCE: Record<number, Rgb> = { 1: [100, 200, 30], 2: [10, 10, 10], 3: [0, 0, 0] };
  const TARGET = palette({ 1: [200, 100, 31], 2: [250, 0, 10] });

  it("sans durée, saute au pourcentage ; chaque composante est interpolée, division tronquée vers zéro", () => {
    const { game, color } = clocked(SOURCE);
    game.setVary(TARGET, 50, 0);
    expect(game.varyPercent).toBe(50);
    expect(game.update()).toBe(true);
    expect([color(1), color(2)]).toEqual([
      [150, 150, 30],
      [130, 5, 10],
    ]);
    game.setVaryPercent(33, 0);
    game.update();
    // (200 − 100) × 33 / 100 = 33 ; (100 − 200) × 33 / 100 = −33 ; (0 − 10) × 33 / 100 = −3,3 → −3.
    expect([color(1), color(2)]).toEqual([
      [133, 167, 30],
      [89, 7, 10],
    ]);
    game.varyOff();
    game.update();
    expect([game.varyPercent, color(1)]).toEqual([0, [100, 200, 30]]);
    // Sans palette cible, SetPercent ne fait rien.
    game.setVaryPercent(80, 0);
    expect(game.varyPercent).toBe(0);
  });

  it("avec une durée, avance de 1 % tous les durée / écart ticks, puis s'arrête à la cible ; et revient", () => {
    const { game, clock, color } = clocked(SOURCE);
    game.setVary(TARGET, 100, 600);
    const percents: number[] = [];
    for (clock.now = 0; clock.now <= 660; clock.now += 60) {
      game.update();
      percents.push(game.varyPercent);
    }
    // Un pas tous les 6 ticks, compté quand plus de 6 ticks ont passé depuis le dernier.
    expect(percents).toEqual([0, 9, 19, 29, 39, 49, 59, 69, 79, 89, 99, 100]);
    expect(color(1)).toEqual([200, 100, 31]);
    clock.now = 2000;
    game.update();
    expect(game.varyPercent).toBe(100);

    game.setVaryPercent(90, 100);
    clock.now += 55;
    game.update();
    expect(game.varyPercent).toBe(95);
    clock.now += 1000;
    game.update();
    expect([game.varyPercent, color(1)]).toEqual([90, [190, 110, 30]]);
    // Durée plus courte que l'écart : le pas serait nul, le pourcentage saute.
    game.setVaryPercent(10, 60);
    expect(game.varyPercent).toBe(10);
  });

  it("une palette de départ remplace la source, même à 0 %, sur la plage variée seulement", () => {
    const { game, color } = clocked(SOURCE);
    game.setVaryStart(palette({ 1: [0, 0, 0], 2: [50, 50, 50] }));
    game.update();
    expect([color(1), color(2)]).toEqual([
      [0, 0, 0],
      [50, 50, 50],
    ]);
    game.setVary(TARGET, 50, 0, 2, 2);
    game.update();
    expect([color(1), color(2)]).toEqual([
      [100, 200, 30],
      [150, 25, 30],
    ]);
    game.mergeVaryTarget(palette({ 2: [50, 50, 50] }));
    game.update();
    expect(color(2)).toEqual([50, 50, 50]);
    // Le fondu s'applique après la variation.
    game.setFade(50, 2, 2);
    game.update();
    expect(color(2)).toEqual([25, 25, 25]);
  });
});

describe("PalCycle : cycles de couleurs", () => {
  const RAMP: Record<number, Rgb> = { 9: [9, 9, 9], 10: [10, 0, 0], 11: [11, 0, 0], 12: [12, 0, 0], 13: [13, 0, 0], 14: [14, 0, 0] };
  const reds = (game: GamePalette): number[] => [9, 10, 11, 12, 13, 14].map((index) => game.screen[3 * index]);

  it("fait tourner les couleurs première … dernière − 1 d'un cran par délai, en partant du cran « première modulo nombre »", () => {
    const { game, clock } = clocked(RAMP);
    game.setCycle(10, 14, 1, 5);
    game.update();
    // Quatre couleurs (10 à 13) ; le cran de départ vaut 10 modulo 4 = 2, comme dans l'original.
    expect(reds(game)).toEqual([9, 12, 13, 10, 11, 14]);
    expect([...game.cycleMap.subarray(9, 15)]).toEqual([0, 1, 1, 1, 1, 0]);
    clock.now = 5;
    game.update();
    expect(reds(game)).toEqual([9, 12, 13, 10, 11, 14]);
    clock.now = 6;
    expect(game.update()).toBe(true);
    expect(reds(game)).toEqual([9, 13, 10, 11, 12, 14]);
    clock.now = 16;
    game.update();
    expect(reds(game)).toEqual([9, 11, 12, 13, 10, 14]);
    game.doCycle(10, 2);
    game.update();
    expect(reds(game)).toEqual([9, 13, 10, 11, 12, 14]);
    game.cycleOff(10);
    game.update();
    expect(reds(game)).toEqual([9, 10, 11, 12, 13, 14]);
    expect(game.cycleMap.some((taken) => taken !== 0)).toBe(false);
  });

  it("à rebours ; plusieurs cycles ; arrêt de tous ; chevauchement signalé", () => {
    const { game, clock } = clocked(RAMP);
    const warnings: string[] = [];
    game.onWarning = (message) => warnings.push(message);
    game.setCycle(12, 14, -1, 10);
    game.setCycle(9, 11, 1, 0);
    game.update();
    expect(reds(game)).toEqual([10, 9, 11, 12, 13, 14]);
    clock.now = 11;
    game.update();
    expect(reds(game)).toEqual([10, 9, 11, 13, 12, 14]);
    game.setCycle(10, 13, 1, 1);
    expect(warnings).toHaveLength(1);
    game.cycleOff();
    game.update();
    expect(reds(game)).toEqual([9, 10, 11, 12, 13, 14]);
  });
});

describe("RemapColors : couleurs de remplacement", () => {
  const SKIP = 255;
  const shade = (pixels: number[]): Cel => ({ width: pixels.length, height: 1, originX: 0, originY: 0, skipColor: SKIP, mirrored: false, hasRemap: true, pixels: Uint8Array.from(pixels), palette: undefined });
  const drawOver = (background: number[], source: Cel, remap: Remap): number[] => {
    const target = Uint8Array.from(background);
    drawCel(target, target.length, source, makeRect(0, 0, target.length, 1), 0, 0, false, 128, 128, remap);
    return [...target];
  };
  const GREYS: Record<number, Rgb> = { 0: [0, 0, 0], 1: [200, 200, 200], 2: [100, 100, 100], 3: [50, 50, 50], 4: [90, 110, 100], 5: [255, 0, 0] };

  it("par plage : la couleur de l'écran est décalée ; une couleur de remplacement inactive ne dessine rien", () => {
    const { game } = clocked(GREYS);
    const remap = new Remap(game);
    const source = shade([254, 254, 254, 253, 7, SKIP]);
    expect(drawOver([10, 20, 30, 10, 10, 10], source, remap)).toEqual([10, 20, 30, 10, 7, 10]);
    remap.byRange(254, 10, 20, 5);
    expect(remap.count).toBe(1);
    expect(remap.update(game.update())).toBe(true);
    expect(drawOver([10, 20, 30, 10, 10, 10], source, remap)).toEqual([15, 25, 30, 10, 7, 10]);
    expect([remap.enabled(254), remap.enabled(253), remap.enabled(100)]).toEqual([true, false, false]);
    remap.off(254);
    remap.update(false);
    expect([remap.count, drawOver([10, 20, 30, 10, 10, 10], source, remap)]).toEqual([0, [10, 20, 30, 10, 7, 10]]);
  });

  it("par pourcentage : chaque couleur prend la plus proche d'elle-même assombrie ; la couleur 0 ne bouge pas", () => {
    const { game } = clocked(GREYS);
    game.update();
    const remap = new Remap(game);
    remap.byPercent(240, 50);
    remap.update(false);
    // 200 → 100 (couleur 2) ; 100 → 50 (couleur 3) ; (255, 0, 0) → (127, 0, 0), au plus près de (50, 50, 50).
    expect(drawOver([1, 2, 5, 0], shade([240, 240, 240, 240]), remap)).toEqual([2, 3, 3, 0]);
    // La palette change : la couleur 4 devient le gris à 100 exact, plus proche de l'idéal de la couleur 1 que… la couleur 2 à égalité : le choix reste.
    game.submit(palette({ 4: [100, 100, 100] }));
    expect(remap.update(game.update())).toBe(false);
    expect(drawOver([1], shade([240]), remap)).toEqual([2]);
    // La couleur choisie change : nouvelle recherche.
    game.submit(palette({ 2: [0, 0, 0] }));
    expect(remap.update(game.update())).toBe(true);
    expect(drawOver([1], shade([240]), remap)).toEqual([4]);
    // Une couleur en cycle n'est plus choisie, à la recherche suivante (quand l'idéal change) : reste le gris à 50.
    game.setCycle(4, 6, 1, 0);
    game.submit(palette({ 1: [210, 200, 200] }));
    expect(remap.update(game.update())).toBe(true);
    expect(drawOver([1], shade([240]), remap)).toEqual([3]);
    remap.off();
    expect(remap.count).toBe(0);
  });

  it("refuse une couleur hors de 236 à 254 et une plage qui déborde", () => {
    const warnings: string[] = [];
    const remap = new Remap(clocked(GREYS).game, (message) => warnings.push(message));
    remap.byPercent(100, 50);
    remap.byRange(254, 10, 240, 1);
    remap.off(255);
    expect([remap.count, warnings.length]).toEqual([0, 3]);
  });
});

describe.skipIf(!original.has)("palette : fonctions du noyau sur les palettes du CD", () => {
  it("PalVary, PalCycle et RemapColors ne sont plus des souches et agissent au FrameOut suivant", () => {
    const scene = new Scene();
    const { vm, frameout } = scene;
    const target = readPalette(mainIndex().get(ResourceType.Palette, 500));
    scene.plane(0, 0, 319, 199, { picture: 100 });
    frameout.frameOut();
    const before = frameout.palette.screen.slice();
    vm.acc = 5;
    expect(scene.kernel("PalVary", 0, 500)).toBe(5);
    expect(scene.kernel("PalVary", 2)).toBe(100);
    frameout.frameOut();
    for (let c = 0; c < 3 * 255; c++) expect(frameout.palette.screen[c]).toBe(target.rgb[c]);
    expect(scene.kernel("PalVary", 1, 0, 50)).toBe(5);
    frameout.frameOut();
    for (let c = 0; c < 3 * 255; c++) expect(frameout.palette.screen[c]).toBe(Math.trunc(((target.rgb[c] - before[c]) * 50) / 100) + before[c]);
    expect(fnv1a(frameout.palette.screen).toString(16)).toMatchInlineSnapshot(`"c0fd314c"`);
    expect(scene.kernel("PalVary", 8, 510)).toBe(50);
    scene.kernel("PalVary", 3);
    frameout.frameOut();
    expect(frameout.palette.screen).toEqual(before);

    scene.kernel("PalCycle", 0, 64, 72, 1, 4);
    vm.ticks += 5;
    frameout.frameOut();
    expect([...frameout.palette.screen.subarray(3 * 64, 3 * 72)]).toEqual([...before.subarray(3 * 65, 3 * 72), ...before.subarray(3 * 64, 3 * 65)]);
    scene.kernel("PalCycle", 4);
    scene.kernel("RemapColors", 2, 250, 50, 0);
    scene.kernel("RemapColors", 1, 251, 0, 10, 3, 0);
    frameout.frameOut();
    expect([frameout.palette.screen, frameout.remap.count]).toEqual([before, 2]);
    scene.kernel("RemapColors", 0);
    expect(frameout.remap.count).toBe(0);
    scene.kernel("PalVary", 0, 12345);
    expect([...vm.warnings.keys()]).toEqual(["PalVary : palette 12345 absente"]);
    for (const name of ["PalVary", "PalCycle", "RemapColors"]) expect(vm.kernel.journal.stubs.has(name), name).toBe(false);
  });
});
