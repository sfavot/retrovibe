import { describe, expect, it } from "vitest";
import { Outfit } from "../../../../src/games/fotaq/engine/services";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { BamFlag } from "../../../../src/games/fotaq/engine/specials/bam";
import { CAR_DATA } from "../../../../src/games/fotaq/engine/specials/group-4/car-data";
import { GameVar, Item } from "../../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Un moteur dans la pièce 74 (la course), prêt à recevoir un mouvement spécial. */
function start(room = 74): Walkthrough {
  const w = new Walkthrough({ room, voices: false });
  w.settle();
  return w;
}

/** Joue le mouvement spécial `n` jusqu'au bout ; rend la durée en ticks. */
function play(w: Walkthrough, n: number): number {
  w.engine.run(w.engine.executeSpecialMove(n));
  return w.settle(2_000);
}

describe.skipIf(!hasOriginalFiles)("groupe 4 : mouvements spéciaux de l'hôtel et de la course", () => {
  it("définit les neuf mouvements du groupe, et eux seuls", () => {
    expect(Object.keys(GROUPS[4].specialMoves!).map(Number)).toEqual([2, 3, 4, 5, 6, 7, 8, 31, 32]);
  });

  it("2 : Joe met la robe (tenue 2, la robe quitte l'inventaire, sans cinématique)", () => {
    const w = start(71);
    w.engine.inventory.insert(Item.Dress);
    play(w, 2);
    expect(w.engine.gameState(GameVar.JoeDressingMode)).toBe(Outfit.Dress);
    expect(w.stage.outfit).toBe(Outfit.Dress);
    expect(w.engine.inventory.has(Item.Dress)).toBe(false);
    expect(w.cutaways.played).toEqual([]);
  });

  it("3 : Joe remet ses vêtements (tenue 0, les vêtements quittent l'inventaire)", () => {
    const w = start(71);
    w.engine.inventory.insert(Item.Clothes);
    w.engine.setGameState(GameVar.JoeDressingMode, Outfit.Dress);
    w.stage.setOutfit(w.engine, Outfit.Dress);
    play(w, 3);
    expect(w.engine.gameState(GameVar.JoeDressingMode)).toBe(Outfit.Normal);
    expect(w.stage.outfit).toBe(Outfit.Normal);
    expect(w.engine.inventory.has(Item.Clothes)).toBe(false);
  });

  it("4 : Joe en sous-vêtements (tenue 1)", () => {
    const w = start(73);
    play(w, 4);
    expect(w.engine.gameState(GameVar.JoeDressingMode)).toBe(Outfit.Underwear);
    expect(w.stage.outfit).toBe(Outfit.Underwear);
  });

  it("5 et 6 : la palette de la robe, puis la palette normale (la tenue ne change pas)", () => {
    const w = start(71);
    const calls: string[] = [];
    const { palette } = w.stage.display;
    const dress = palette.setJoeDress.bind(palette);
    const normal = palette.setJoeNormal.bind(palette);
    palette.setJoeDress = () => (calls.push("robe"), dress());
    palette.setJoeNormal = () => (calls.push("normale"), normal());
    play(w, 5);
    play(w, 6);
    expect(calls).toEqual(["robe", "normale"]);
    expect(w.stage.outfit).toBe(Outfit.Normal);
  });

  it("7 : la course commence (animation en marche, trois bobs remis à zéro et allumés, table à sa première ligne)", () => {
    const w = start();
    expect(w.stage.bam.flag).toBe(BamFlag.Stop);
    w.engine.run(w.engine.executeSpecialMove(7));
    expect(w.stage.bam.flag).toBe(BamFlag.Play);
    for (const n of [5, 6, 7]) expect(w.stage.bobs.bob(n).active).toBe(true);
    expect(w.stage.bam.index).toBe(0);
  });

  it("8 : la course finit (animation arrêtée, huile et tirs éteints)", () => {
    const w = start();
    play(w, 7);
    const oil = w.stage.bobs.findBob(w.engine, 594);
    expect(oil).toBeGreaterThan(0);
    w.stage.bobs.bob(oil).active = true;
    w.stage.bobs.bob(7).active = true;
    play(w, 8);
    expect(w.stage.bam.flag).toBe(BamFlag.Stop);
    expect(w.stage.bobs.bob(oil).active).toBe(false);
    expect(w.stage.bobs.bob(7).active).toBe(false);
  });

  it("31 : attend la ligne 60 de la table (la voiture sous le camion), une image par ligne", () => {
    const w = start();
    play(w, 7);
    w.engine.run(w.engine.executeSpecialMove(31));
    const ticks = w.until(() => w.idle, 200);
    expect(w.stage.bam.index).toBe(60);
    expect(ticks).toBeGreaterThanOrEqual(58);
    expect(ticks).toBeLessThanOrEqual(62);
  });

  it("31 : rend la main si la course est arrêtée (ScummVM bouclerait sans fin)", () => {
    const w = start();
    expect(w.stage.bam.flag).toBe(BamFlag.Stop);
    expect(play(w, 31)).toBeLessThanOrEqual(3);
  });

  it("32 : l'écran remonte de 3 lignes pendant une image, puis revient", () => {
    const w = start();
    w.engine.run(w.engine.executeSpecialMove(32));
    expect(w.stage.display.shakeY).toBe(3);
    w.until(() => w.idle, 5);
    expect(w.stage.display.shakeY).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("groupe 4 : la course de voiture (pièce 74, roomUpdates)", () => {
  it("enregistre l'animation de la pièce 74 et d'elle seule", () => {
    expect(Object.keys(GROUPS[4].roomUpdates!).map(Number)).toEqual([74]);
  });

  it("la table a les 75 lignes de ScummVM, la dernière marquée 99", () => {
    expect(CAR_DATA).toHaveLength(75);
    expect(CAR_DATA.filter((row) => row.sfx === 99)).toHaveLength(1);
    expect(CAR_DATA[74].sfx).toBe(99);
    expect(CAR_DATA[0]).toEqual({ obj1: { x: 310, y: 105, frame: 1 }, obj2: { x: 314, y: 106, frame: 17 }, fx: { x: 366, y: 101, frame: 1 }, sfx: 0 });
  });

  it("sans le mouvement 7, la pièce reste immobile", () => {
    const w = start();
    const before = w.stage.bobs.bob(5).x;
    w.wait(10);
    expect(w.stage.bobs.bob(5).x).toBe(before);
    expect(w.stage.bam.index).toBe(0);
  });

  it("une ligne de la table par image : camion (images 40+), Rico (30+), tirs (41+), puis la table repart à la ligne 99", () => {
    const w = start();
    play(w, 7);
    const bobs = w.stage.bobs;
    let previous = w.stage.bam.index;
    for (let tick = 0; tick < 2 * CAR_DATA.length; tick++) {
      w.wait(1);
      const index = w.stage.bam.index;
      expect(index, "une ligne par image").toBe((previous + 1) % CAR_DATA.length);
      previous = index;
      const i = index === 0 ? CAR_DATA.length - 1 : index - 1;
      const row = CAR_DATA[i];
      expect([bobs.bob(5).x, bobs.bob(5).y, bobs.bob(5).frameNum], `ligne ${i} : camion`).toEqual([row.obj1.x, row.obj1.y, 40 + row.obj1.frame]);
      expect([bobs.bob(6).x, bobs.bob(6).y, bobs.bob(6).frameNum], `ligne ${i} : Rico`).toEqual([row.obj2.x, row.obj2.y, 30 + row.obj2.frame]);
      expect([bobs.bob(7).x, bobs.bob(7).y, bobs.bob(7).frameNum], `ligne ${i} : tirs`).toEqual([row.fx.x, row.fx.y, 41 + row.fx.frame]);
    }
  });

  it("la course joue l'effet sonore de la pièce sur les lignes 5, 22, 37, 59 et 68 (sfx 2)", () => {
    const w = start();
    const sfx: number[] = [];
    const original = w.stage.playRoomSfx.bind(w.stage);
    w.stage.playRoomSfx = () => (sfx.push(w.stage.bam.index - 1), original());
    play(w, 7);
    sfx.length = 0;
    w.stage.bam.prepare(w.engine);
    w.wait(CAR_DATA.length);
    const expected = CAR_DATA.flatMap((row, i) => (row.sfx === 2 ? [i] : []));
    expect(expected).toEqual([5, 22, 37, 59, 68]);
    expect(sfx).toEqual(expected);
  });

  it("l'arrêt (mouvement 8) fige la course", () => {
    const w = start();
    play(w, 7);
    w.wait(10);
    play(w, 8);
    const frame = w.stage.bobs.bob(5).x;
    w.wait(10);
    expect(w.stage.bobs.bob(5).x).toBe(frame);
  });
});
