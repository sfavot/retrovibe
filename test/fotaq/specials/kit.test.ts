import { describe, expect, it } from "vitest";
import { BamFlag, BamScene, bam } from "../../../src/games/fotaq/engine/specials/bam";
import { bobOf, shake } from "../../../src/games/fotaq/engine/specials/kit";
import { hasOriginalFiles } from "../helpers";
import { Walkthrough } from "../walkthrough";

/** Table de voiture de trois lignes : pose, effet sonore de la pièce (2), puis la fin (99). */
const CAR = [bam([310, 105, 1], [314, 106, 17], [366, 101, 1], 0), bam([303, 105, 2], [307, 106, 18], [214, 0, 10], 2), bam([297, 104, 3], [301, 105, 19], [214, 0, 10], 99)];
/** Table de combat : rien, secousse (1), rien (retour de la secousse), puis la fin. */
const FIGHT = [bam([75, 96, 1], [187, 96, -23], [58, 37, 46], 0), bam([75, 96, 2], [187, 96, -23], [58, 37, 46], 1), bam([75, 96, 3], [187, 96, -24], [58, 37, 46], 0), bam([75, 96, 4], [187, 96, 24], [0, 0, 0], 99)];

describe.skipIf(!hasOriginalFiles)("aides communes des mouvements spéciaux (specials/kit.ts, bam.ts)", () => {
  it("la secousse remonte l'écran de trois lignes et le bas devient noir", () => {
    const w = new Walkthrough({ room: 1 });
    w.settle();
    w.engine.render();
    const calm = w.host.frames.at(-1)!.pixels.slice();
    shake(w.engine, true);
    w.engine.render();
    const shaken = w.host.frames.at(-1)!.pixels;
    // Hors du curseur (en haut à gauche, dessiné après la secousse) : chaque ligne est celle de trois lignes plus bas.
    expect(shaken.subarray(20 * 320, 100 * 320)).toEqual(calm.subarray(23 * 320, 103 * 320));
    expect(shaken.subarray(197 * 320).every((value) => value === 0)).toBe(true);
    shake(w.engine, false);
    w.engine.render();
    expect(w.host.frames.at(-1)!.pixels).toEqual(calm);
  });

  it("BamScene (voiture) : trois bobs posés ligne par ligne, +40 / +30 / +41 aux images, l'effet de la pièce, retour au début à 99", () => {
    const w = new Walkthrough({ room: 1 });
    w.settle();
    const scene = new BamScene();
    scene.prepare(w.engine);
    for (const n of [5, 6, 7]) expect(bobOf(w.engine, n).active).toBe(true);
    const before = bobOf(w.engine, 5).x;
    scene.updateCar(w.engine, CAR);
    expect(scene.flag).toBe(BamFlag.Stop);
    expect(bobOf(w.engine, 5).x).toBe(before);
    scene.flag = BamFlag.Play;
    scene.updateCar(w.engine, CAR);
    expect([bobOf(w.engine, 5).x, bobOf(w.engine, 5).y, bobOf(w.engine, 5).frameNum]).toEqual([310, 105, 41]);
    expect(bobOf(w.engine, 6).frameNum).toBe(47);
    expect(bobOf(w.engine, 7).frameNum).toBe(42);
    scene.updateCar(w.engine, CAR);
    expect(bobOf(w.engine, 5).frameNum).toBe(42);
    scene.updateCar(w.engine, CAR);
    expect(bobOf(w.engine, 5).frameNum).toBe(43);
    // 99 : la table repart du début.
    scene.updateCar(w.engine, CAR);
    expect(bobOf(w.engine, 5).x).toBe(310);
  });

  it("BamScene (combat) : images négatives retournées, secousse puis retour, arrêt demandé à la fin du cycle", () => {
    const w = new Walkthrough({ room: 1 });
    w.settle();
    const scene = new BamScene();
    scene.prepare(w.engine);
    scene.flag = BamFlag.Play;
    const display = w.stage.display;
    scene.updateFight(w.engine, [FIGHT]);
    expect([bobOf(w.engine, 6).frameNum, bobOf(w.engine, 6).xflip, bobOf(w.engine, 5).xflip]).toEqual([63, true, false]);
    scene.updateFight(w.engine, [FIGHT]);
    expect(display.shakeY).toBe(3);
    scene.updateFight(w.engine, [FIGHT]);
    expect(display.shakeY).toBe(0);
    scene.flag = BamFlag.RequestStop;
    scene.updateFight(w.engine, [FIGHT]);
    expect(scene.flag).toBe(BamFlag.Stop);
  });
});
