import { describe, expect, it } from "vitest";
import { BamFlag } from "../../../../src/games/fotaq/engine/specials/bam";
import { GROUPS } from "../../../../src/games/fotaq/engine/specials";
import { FIGHT_TABLES } from "../../../../src/games/fotaq/engine/specials/group-5/fight-data";
import { FIGHT_STARTED, FightObject, NO_MORE_IRONSTEIN } from "../../../../src/games/fotaq/engine/specials/group-5/ids";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Un moteur dans la pièce du combat (69) ou dans une autre pièce de jeu, prêt à recevoir un mouvement spécial. */
function start(room = 69): Walkthrough {
  const w = new Walkthrough({ room, voices: false });
  w.settle();
  return w;
}

/** Joue le mouvement spécial `n` jusqu'au bout ; rend la durée en ticks. */
function play(w: Walkthrough, n: number): number {
  w.engine.run(w.engine.executeSpecialMove(n));
  return w.settle(5_000);
}

const roomUpdate = (w: Walkthrough) => GROUPS[5].roomUpdates![69]!(w.engine, w.stage.bobs);
const nameOf = (w: Walkthrough, object: number) => w.engine.state.objects[object].name;

describe("groupe 5 : ce que le groupe définit", () => {
  it("les onze mouvements du groupe, l'animation de la pièce 69, et ni pièce spéciale ni zone éteinte", () => {
    expect(Object.keys(GROUPS[5].specialMoves!).map(Number)).toEqual([9, 10, 11, 12, 13, 14, 26, 27, 28, 29, 30]);
    expect(Object.keys(GROUPS[5].roomUpdates!).map(Number)).toEqual([69]);
    expect(GROUPS[5].specialRooms).toBeUndefined();
    expect(GROUPS[5].specialAreas).toBeUndefined();
  });
});

describe("groupe 5 : tables du combat (BamScene, _fight1Data à _fight3Data)", () => {
  it("trois tables de 46, 55 et 79 lignes, chacune terminée (et seulement terminée) par la commande 99", () => {
    expect(FIGHT_TABLES.map((table) => table.length)).toEqual([46, 55, 79]);
    for (const table of FIGHT_TABLES) {
      expect(table.at(-1)!.sfx).toBe(99);
      expect(table.slice(0, -1).every((row) => [0, 1, 2, 3].includes(row.sfx))).toBe(true);
    }
  });

  it("des lignes lues telles que dans ScummVM (première, une secousse, dernière)", () => {
    expect(FIGHT_TABLES[0][0]).toEqual({ obj1: { x: 75, y: 96, frame: 1 }, obj2: { x: 187, y: 96, frame: -23 }, fx: { x: 58, y: 37, frame: 46 }, sfx: 0 });
    expect(FIGHT_TABLES[0][17].sfx).toBe(3);
    expect(FIGHT_TABLES[1][18]).toEqual({ obj1: { x: 127, y: 96, frame: 12 }, obj2: { x: 147, y: 96, frame: -69 }, fx: { x: 122, y: 94, frame: 36 }, sfx: 3 });
    expect(FIGHT_TABLES[2].at(-1)).toEqual({ obj1: { x: 75, y: 96, frame: 1 }, obj2: { x: 187, y: 96, frame: -23 }, fx: { x: 183, y: 41, frame: 47 }, sfx: 99 });
  });
});

describe.skipIf(!hasOriginalFiles)("groupe 5 : le combat final (pièce 69)", () => {
  it("l'animation de la pièce 69 ne fait rien tant que le combat n'est pas lancé", () => {
    const w = start();
    const bob = w.stage.bobs.bob(5);
    bob.x = 7;
    for (let i = 0; i < 3; i++) roomUpdate(w);
    expect(bob.x).toBe(7);
  });

  it("9 : le combat repart (bobs 5 à 7 remis à zéro et allumés, première ligne), l'état 148 passe à 1", () => {
    const w = start();
    w.stage.bobs.bob(6).x = 99;
    expect(play(w, 9)).toBeLessThanOrEqual(2);
    expect(w.stage.bam.flag).toBe(BamFlag.Play);
    expect(w.engine.gameState(FIGHT_STARTED)).toBe(1);
    for (const n of [5, 6, 7]) expect(w.stage.bobs.bob(n).active).toBe(true);
    // Une image de la pièce place les trois bobs sur la première ligne de la table : Frank, le robot retourné, l'effet.
    w.stage.bam.prepare(w.engine);
    roomUpdate(w);
    const [frank, robot, fx] = [5, 6, 7].map((n) => w.stage.bobs.bob(n));
    expect([frank.x, frank.y, frank.frameNum, frank.xflip]).toEqual([75, 96, 41, false]);
    expect([robot.x, robot.y, robot.frameNum, robot.xflip]).toEqual([187, 96, 63, true]);
    expect([fx.x, fx.y, fx.frameNum]).toEqual([58, 37, 86]);
  });

  it("une ligne de table par image : secousse (3 et 1), retour à la normale (0), à la fin le cycle repart sur une table au hasard", () => {
    const w = start();
    play(w, 9);
    w.stage.bam.prepare(w.engine);
    const shake = () => w.stage.display.shakeY;
    for (let i = 0; i < 17; i++) roomUpdate(w);
    expect(shake()).toBe(0);
    roomUpdate(w); // ligne 17 : sfx 3 (effet et secousse)
    expect(shake()).toBe(3);
    roomUpdate(w); // ligne 18 : sfx 1
    expect(shake()).toBe(3);
    roomUpdate(w); // ligne 19 : sfx 0, l'écran se remet en place
    expect(shake()).toBe(0);
    for (let i = 20; i < 46; i++) roomUpdate(w);
    expect(w.stage.bam.flag).toBe(BamFlag.Play);
    // Le cycle suivant repart de la première ligne de la table tirée.
    roomUpdate(w);
    const [frank] = [w.stage.bobs.bob(5)];
    expect([frank.x, frank.y]).toEqual([75, 96]);
  });

  it("10 : le combat s'arrête à la fin de son cycle (Frank est à sa place) ; les images passent en attendant", () => {
    const w = start();
    play(w, 9);
    w.wait(10);
    const ticks = play(w, 10);
    expect(w.stage.bam.flag).toBe(BamFlag.Stop);
    // La première table fait 46 lignes : dix ont passé, trente-six restent (la ligne 99 est la dernière).
    expect(ticks).toBeGreaterThanOrEqual(34);
    expect(ticks).toBeLessThanOrEqual(40);
    // Arrêté : plus aucune ligne n'est lue.
    const frank = w.stage.bobs.bob(5);
    const [x, y] = [frank.x, frank.y];
    w.wait(5);
    expect([frank.x, frank.y]).toEqual([x, y]);
  });

  it("10 : rend la main aussitôt si le jeu se termine pendant l'attente", () => {
    const w = start();
    play(w, 9);
    w.engine.endGame();
    expect(() => play(w, 10)).not.toThrow();
  });

  it("11 : Frank grandit (image 38 de la banque de la pièce, échelle de 10 à 98 % par 4, puis 21 images), les objets de la scène changent, l'état 157 passe à 1", () => {
    const w = start();
    w.engine.state.objects[FightObject.Dinoray].name = -Math.abs(w.engine.state.objects[FightObject.Dinoray].name);
    const ticks = play(w, 11);
    expect(ticks).toBe(23 + 21);
    const bob = w.stage.bobs.bob(5);
    expect([bob.x, bob.y, bob.scale, bob.frameNum, bob.active]).toEqual([160, 200, 98, 38, true]);
    expect(w.stage.bobs.frames.frame(38)?.image).toBe(1);
    expect(nameOf(w, FightObject.Dinoray)).toBeGreaterThan(0);
    expect(nameOf(w, FightObject.Frank)).toBeGreaterThan(0);
    for (const hidden of [FightObject.Tmpd, FightObject.FlodaGuards, FightObject.Sparky]) expect(nameOf(w, hidden)).toBeLessThanOrEqual(0);
    expect(w.engine.gameState(NO_MORE_IRONSTEIN)).toBe(1);
  });

  it("12 : le robot grandit de la même façon ; Azura et l'objet de Frank disparaissent", () => {
    const w = start();
    expect(play(w, 12)).toBe(23 + 21);
    const bob = w.stage.bobs.bob(5);
    expect([bob.x, bob.y, bob.scale, bob.frameNum]).toEqual([160, 200, 98, 38]);
    expect(nameOf(w, FightObject.Azura)).toBeLessThanOrEqual(0);
    expect(nameOf(w, FightObject.Frank)).toBeLessThanOrEqual(0);
  });

  it("13 : le robot (bob 6) rapetisse de 100 à 35 % par 5, en quatorze images", () => {
    const w = start();
    w.stage.bobs.bob(6).scale = 100;
    expect(play(w, 13)).toBe(14);
    expect(w.stage.bobs.bob(6).scale).toBe(35);
  });
});

describe.skipIf(!hasOriginalFiles)("groupe 5 : la fin et les mouvements de C69G / C75B", () => {
  it("14 : quarante images, puis la partie est finie (l'hôte quitte une fois)", () => {
    const w = start();
    w.engine.run(w.engine.executeSpecialMove(14));
    w.wait(38);
    expect(w.engine.ended).toBe(false);
    w.wait(5);
    expect(w.engine.ended).toBe(true);
    expect(w.host.exits).toBe(1);
  });

  it("26 : panoramique de 320 à 144 par pas de 8, la caméra libre ; rien si le décor est déjà en deçà", () => {
    const w = start();
    w.engine.horizontalScroll = 320;
    expect(play(w, 26)).toBe(22);
    expect(w.engine.horizontalScroll).toBe(144);
    expect(w.stage.bobs.cameraBob).toBe(-1);
    w.engine.horizontalScroll = 100;
    play(w, 26);
    expect(w.engine.horizontalScroll).toBe(100);
  });

  it("27 : le décor défile vers 320 par pas de 8 ; Azura (bob 5) et Joe (bob 6) avancent de 8, ou se rapprochent (10 et 6) si l'écart dépasse 128", () => {
    const w = start();
    const [azura, joe] = [w.stage.bobs.bob(5), w.stage.bobs.bob(6)];
    azura.x = 0;
    joe.x = 100;
    w.engine.horizontalScroll = 0;
    expect(play(w, 27)).toBe(40);
    expect(w.engine.horizontalScroll).toBe(320);
    expect(w.stage.bobs.cameraBob).toBe(-1);
    // 100 d'écart : 40 pas de 8 chacun.
    expect([azura.x, joe.x]).toEqual([320, 420]);
    azura.x = 0;
    joe.x = 200;
    w.engine.horizontalScroll = 0;
    play(w, 27);
    // 200 d'écart : le premier pas rapproche de 4 (10 et 6) ; l'écart passe à 196, puis à 192… jusqu'à 128, ensuite 8 et 8.
    expect(joe.x - azura.x).toBe(128);
  });

  it("28 : l'avion traverse l'écran en grossissant, l'éclair le frappe (effet sonore, images de la banque), il plonge dans la jungle ; caméra rendue à Joe", () => {
    const w = start(1);
    const bobs = w.stage.bobs;
    const [plane, fire, lightning] = [bobs.bob(5), bobs.bob(6), bobs.bob(20)];
    plane.frameNum = 60;
    fire.frameNum = 61;
    lightning.frameNum = 62;
    let sfx = 0;
    w.stage.playRoomSfx = () => sfx++;
    const scrolls: number[] = [];
    w.engine.run(w.engine.executeSpecialMove(28));
    for (let i = 0; i < 200 && w.engine.busy; i++) {
      scrolls.push(w.engine.horizontalScroll);
      w.wait(1);
    }
    expect(w.engine.busy).toBe(false);
    // 83 images de traversée (l'avion de 660 à 168), une image de chute, 20 images de plongée.
    expect(scrolls.length).toBeGreaterThanOrEqual(104);
    expect(scrolls.length).toBeLessThanOrEqual(106);
    expect(scrolls[1]).toBe(320);
    expect(sfx).toBe(1);
    expect(plane.scale).toBe(100);
    expect([plane.x, fire.x, lightning.x, lightning.y]).toEqual([-27, -27, 160, 0]);
    expect(bobs.frames.frame(lightning.frameNum)?.image).toBe(18);
    expect(bobs.frames.frame(plane.frameNum)?.image).toBe(2);
    expect(bobs.frames.frame(fire.frameNum)?.image).toBe(39);
    expect(fire.animating).toBe(true);
    expect(bobs.cameraBob).toBe(0);
  });

  it("29 : le dirigeable (bob 7) s'éloigne vers le centre en rapetissant, jusqu'à l'abscisse 150", () => {
    const w = start();
    const blimp = w.stage.bobs.bob(7);
    blimp.x = 190;
    blimp.y = 60;
    play(w, 29);
    expect(blimp.x).toBeLessThanOrEqual(150);
    expect(blimp.x).toBeGreaterThan(145);
    // L'ordonnée tend vers 112 comme l'abscisse vers 150, mais plus lentement (elle part de 60 + 112).
    expect(blimp.y).toBeGreaterThan(112);
    expect(blimp.y).toBeLessThan(172);
    expect(blimp.scale).toBeLessThan(100);
    expect(blimp.scale).toBeGreaterThan(0);
  });

  it("30 : le dirigeable s'éteint, l'écran de fin (bob 20) grossit de 5 à 100 % en (160, 100), cinquante images de pause, fondu au noir", () => {
    const w = start();
    const blimp = w.stage.bobs.bob(7);
    blimp.active = true;
    const ticks = play(w, 30);
    expect(blimp.active).toBe(false);
    const ending = w.stage.bobs.bob(20);
    expect([ending.x, ending.y, ending.scale, ending.active]).toEqual([160, 100, 100, true]);
    expect(ticks).toBeGreaterThanOrEqual(70);
  });
});
