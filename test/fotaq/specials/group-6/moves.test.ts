import { describe, expect, it } from "vitest";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Un moteur dans une pièce de jeu, prêt à recevoir un mouvement spécial. */
function start(): Walkthrough {
  const w = new Walkthrough({ room: 1 });
  w.settle();
  return w;
}

/** Joue le mouvement spécial `n` jusqu'au bout ; rend la durée en ticks. */
function play(w: Walkthrough, n: number): number {
  w.engine.run(w.engine.executeSpecialMove(n));
  return w.settle(2_000);
}

describe.skipIf(!hasOriginalFiles)("groupe 6 : mouvements spéciaux de l'introduction", () => {
  it("définit les neuf mouvements du groupe, et eux seuls", () => {
    expect(Object.keys(GROUPS[6].specialMoves!).map(Number)).toEqual([15, 16, 17, 18, 34, 36, 37, 38, 39]);
  });

  it("15 : la caméra quitte Joe, le décor défile à 320 par pas de 16, puis la caméra suit le bob 1", () => {
    const w = start();
    expect(play(w, 15)).toBe(20);
    expect(w.engine.horizontalScroll).toBe(320);
    expect(w.stage.bobs.cameraBob).toBe(1);
  });

  it("16 : la caméra suit Joe", () => {
    const w = start();
    w.stage.bobs.cameraBob = -1;
    play(w, 16);
    expect(w.stage.bobs.cameraBob).toBe(0);
  });

  it("17 : panoramique à droite jusqu'à 285 en mode rapide (dix images par tick), caméra libre", () => {
    const w = start();
    w.engine.horizontalScroll = 0;
    const ticks = play(w, 17);
    expect(w.engine.horizontalScroll).toBe(285);
    expect(w.stage.bobs.cameraBob).toBe(-1);
    expect(w.engine.input.fastMode).toBe(false);
    expect(ticks).toBeLessThanOrEqual(31);
    expect(ticks).toBeGreaterThanOrEqual(28);
  });

  it("18 : panoramique à gauche jusqu'à 0 par pas de 4", () => {
    const w = start();
    w.engine.horizontalScroll = 320;
    const ticks = play(w, 18);
    expect(w.engine.horizontalScroll).toBe(0);
    expect(w.engine.input.fastMode).toBe(false);
    expect(ticks).toBeLessThanOrEqual(10);
  });

  it("34 : le titre (bob 5) monte de 80 lignes en grossissant jusqu'à 100 %, en vingt images", () => {
    const w = start();
    const bob = w.stage.bobs.bob(5);
    bob.animating = true;
    expect(play(w, 34)).toBe(20);
    expect([bob.x, bob.y, bob.scale, bob.animating]).toEqual([161, 120, 100, false]);
  });

  it("36 : panoramique à 160 par pas de 8, chaque groupe de bobs glisse à sa vitesse", () => {
    const w = start();
    const bobs = w.stage.bobs;
    for (const n of [20, 21, 22, 1, 23, 24, 25, 26]) bobs.bob(n).x = 0;
    w.engine.horizontalScroll = 0;
    play(w, 36);
    expect(w.engine.horizontalScroll).toBe(160);
    // 20 pas : le premier garde (fusil décalé de 45), les autres, Hugh, le second groupe.
    expect(bobs.bob(20).x).toBe(160 - 45 - 16 * 20);
    expect(bobs.bob(21).x).toBe(160 - 16 * 20);
    expect(bobs.bob(1).x).toBe(320 - 24 * 20);
    expect(bobs.bob(24).x).toBe(320 - 24 * 20);
    expect(bobs.bob(26).x).toBe(480 - 32 * 20);
  });

  it("37 : un éclair blanc d'une image, la palette revient ensuite", () => {
    const w = start();
    const palette = w.stage.display.palette;
    const before = Array.from(palette.shown);
    const calls: boolean[] = [];
    const flash = palette.flash.bind(palette);
    palette.flash = (on: boolean) => {
      calls.push(on);
      flash(on);
    };
    expect(play(w, 37)).toBeLessThanOrEqual(2);
    expect(calls).toEqual([true, false]);
    expect(Array.from(palette.shown)).toEqual(before);
  });

  it("38 : panoramique à 290, un pixel par image ; les bobs de décor glissent à leur vitesse", () => {
    const w = start();
    const bobs = w.stage.bobs;
    for (const n of [20, 21, 22, 23, 24]) bobs.bob(n).x = 0;
    w.engine.horizontalScroll = 0;
    const ticks = play(w, 38);
    expect(w.engine.horizontalScroll).toBe(290);
    expect(bobs.bob(20).x).toBe(560 - 2 * 290);
    expect(bobs.bob(21).x).toBe(30 - 290);
    expect(bobs.bob(22).x).toBe(540 - 3 * 290);
    expect(bobs.bob(24).x).toBe(-2 * 290);
    expect(ticks).toBeLessThanOrEqual(31);
  });

  it("39 : panoramique à gauche jusqu'à 0 tant que la bombe n'est pas à sa place (bob 21 à 136 au moins)", () => {
    const w = start();
    const bobs = w.stage.bobs;
    bobs.bob(21).x = 0;
    bobs.bob(22).x = 0;
    w.engine.horizontalScroll = 320;
    play(w, 39);
    expect(w.engine.horizontalScroll).toBe(0);
    expect(bobs.bob(21).x).toBeGreaterThanOrEqual(136);
    expect(bobs.bob(22).x).toBeGreaterThan(5 * 64 - 1);
  });

  it("36, 38 et 39 s'arrêtent à la demande de passage de la cinématique (cutawayQuit)", () => {
    for (const n of [36, 38, 39]) {
      const w = start();
      w.engine.horizontalScroll = 100;
      w.engine.input.cutawayQuit = true;
      play(w, n);
      expect(w.engine.horizontalScroll, `mouvement ${n}`).toBe(100);
    }
  });
});
