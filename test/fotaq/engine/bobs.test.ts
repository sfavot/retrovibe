import { describe, expect, it } from "vitest";
import { parseBank } from "../../../src/games/fotaq/data/bank";
import { BobSlot, Bobs, FRAMES_JOE, FrameTable, countAnimFrames, parseAnimString } from "../../../src/games/fotaq/engine/bobs";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { gameData } from "./test-host";

describe("bob : déplacement en ligne droite", () => {
  it("arrive exactement à la destination, avec un pas par appel et un pas tout de suite", () => {
    const bob = new BobSlot();
    bob.curPos(10, 20);
    bob.move(50, 30, 1);
    // `move` fait déjà un pas.
    expect(bob.x).toBe(11);
    let steps = 1;
    while (bob.moving) {
      bob.moveOneStep();
      steps++;
    }
    expect([bob.x, bob.y]).toEqual([50, 30]);
    expect(steps).toBe(41);
  });

  it("l'axe principal avance à chaque pas, l'autre selon l'erreur accumulée (Bresenham)", () => {
    const bob = new BobSlot();
    bob.curPos(0, 0);
    bob.move(0, 8, 1);
    expect(bob.xmajor).toBe(false);
    const ys: number[] = [bob.y];
    while (bob.moving) {
      bob.moveOneStep();
      ys.push(bob.y);
    }
    expect(ys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8]);

    const diagonal = new BobSlot();
    diagonal.curPos(0, 0);
    diagonal.move(10, 4, 1);
    expect(diagonal.xmajor).toBe(true);
    const trail: [number, number][] = [[diagonal.x, diagonal.y]];
    while (diagonal.moving) {
      diagonal.moveOneStep();
      trail.push([diagonal.x, diagonal.y]);
    }
    expect(trail[trail.length - 1]).toEqual([10, 4]);
    // Aucun pas ne saute plus d'un pixel en y.
    for (let i = 1; i < trail.length; i++) expect(Math.abs(trail[i][1] - trail[i - 1][1])).toBeLessThanOrEqual(1);
  });

  it("vitesse : au moins 1, proportionnelle à l'échelle, moitié moins sur l'axe y", () => {
    const bob = new BobSlot();
    bob.curPos(0, 0);
    bob.move(100, 0, 0);
    expect(bob.speed).toBe(1);
    bob.scale = 50;
    bob.scaleWalkSpeed(6);
    expect(bob.speed).toBe(3);
    bob.scale = 10;
    bob.scaleWalkSpeed(6);
    expect(bob.speed).toBe(1);
    bob.curPos(0, 0);
    bob.move(0, 100, 1);
    bob.scale = 100;
    bob.scaleWalkSpeed(6);
    expect(bob.speed).toBe(3);
  });
});

describe("bob : animations", () => {
  it("animation en boucle : une image tous les `speed` appels, retour à la première", () => {
    const bob = new BobSlot();
    bob.animNormal(10, 12, 2, false, false);
    const frames: number[] = [];
    for (let i = 0; i < 12; i++) {
      bob.animOneStep();
      frames.push(bob.frameNum);
    }
    expect(frames).toEqual([10, 11, 11, 12, 12, 10, 10, 11, 11, 12, 12, 10]);
  });

  it("aller-retour (rebound)", () => {
    const bob = new BobSlot();
    bob.animNormal(1, 3, 1, true, false);
    const frames: number[] = [];
    for (let i = 0; i < 8; i++) {
      bob.animOneStep();
      frames.push(bob.frameNum);
    }
    expect(frames).toEqual([2, 3, 2, 1, 2, 3, 2, 1]);
  });

  it("une vitesse nulle fige l'animation (comme ScummVM)", () => {
    const bob = new BobSlot();
    bob.animNormal(5, 8, 0, false, false);
    for (let i = 0; i < 10; i++) bob.animOneStep();
    expect(bob.frameNum).toBe(5);
  });

  it("animation par chaîne : durée en quarts, retour au début à la fin de la chaîne", () => {
    const bob = new BobSlot();
    bob.animString([
      { frame: 7, speed: 8 },
      { frame: 8, speed: 4 },
      { frame: 9, speed: 12 },
    ]);
    expect(bob.frameNum).toBe(7);
    expect(bob.animating).toBe(true);
    const frames: number[] = [];
    for (let i = 0; i < 12; i++) {
      bob.animOneStep();
      frames.push(bob.frameNum);
    }
    // 7 pendant 2 appels, 8 pendant 1, 9 pendant 3, puis la chaîne reprend.
    expect(frames).toEqual([7, 8, 9, 9, 9, 7, 7, 8, 9, 9, 9, 7]);
  });

  it("une entrée à l'image 0 termine la chaîne", () => {
    const bob = new BobSlot();
    bob.animString([
      { frame: 3, speed: 4 },
      { frame: 0, speed: 4 },
      { frame: 4, speed: 4 },
    ]);
    const frames: number[] = [];
    for (let i = 0; i < 4; i++) {
      bob.animOneStep();
      frames.push(bob.frameNum);
    }
    expect(frames).toEqual([3, 3, 3, 3]);
  });

  it("image d'effet sonore (> 500) : l'effet est demandé et le numéro ramené à l'image", () => {
    const bobs = new Bobs();
    let sfx = 0;
    bobs.onSfx = () => sfx++;
    const bob = bobs.bob(5);
    bob.animString([
      { frame: 20, speed: 4 },
      { frame: 521, speed: 4 },
    ]);
    bobs.sortBobs();
    expect(sfx).toBe(1);
    expect(bob.frameNum).toBe(21);
    bobs.sortBobs();
    expect(bob.frameNum).toBe(20);
    expect(sfx).toBe(1);
  });

  it("chaîne d'un acteur : couples sur 4 + 4 caractères, point tolérée, fin à l'image 0", () => {
    expect(parseAnimString("038,008,039,006,000,000,")).toEqual([
      { frame: 38, speed: 8 },
      { frame: 39, speed: 6 },
    ]);
    // Une chaîne du jeu a un point à la place d'une virgule.
    expect(parseAnimString("001,128,002,010.001,128,000,000,")).toEqual([
      { frame: 1, speed: 128 },
      { frame: 2, speed: 10 },
      { frame: 1, speed: 128 },
    ]);
    expect(countAnimFrames(parseAnimString("001,128,521,010,001,128,000,000,"))).toBe(2);
  });
});

describe("tri des bobs", () => {
  it("par ordonnée des pieds, puis par numéro d'emplacement ; les bobs éteints sont absents", () => {
    const bobs = new Bobs();
    bobs.bob(3).curPos(100, 90);
    bobs.bob(0).curPos(50, 120);
    bobs.bob(7).curPos(10, 90);
    bobs.bob(20).curPos(30, 40);
    bobs.bob(9).curPos(0, 0);
    bobs.bob(9).clear();
    bobs.sortBobs();
    expect(bobs.sorted).toEqual([bobs.bob(20), bobs.bob(3), bobs.bob(7), bobs.bob(0)]);
  });

  it("le tri suit les déplacements (Joe passe derrière puis devant un meuble)", () => {
    const bobs = new Bobs();
    bobs.bob(0).curPos(40, 50);
    bobs.bob(20).curPos(40, 80);
    bobs.sortBobs();
    expect(bobs.sorted[0]).toBe(bobs.bob(0));
    bobs.bob(0).move(40, 110, 3);
    for (let i = 0; i < 20; i++) bobs.sortBobs();
    expect(bobs.sorted[1]).toBe(bobs.bob(0));
  });

  it("un bob qui se déplace avance de `speed` pas par image", () => {
    const bobs = new Bobs();
    const bob = bobs.bob(1);
    bob.curPos(0, 0);
    bob.move(100, 0, 4);
    expect(bob.x).toBe(1);
    bobs.sortBobs();
    expect(bob.x).toBe(5);
    bobs.sortBobs();
    expect(bob.x).toBe(9);
  });
});

describe("table d'images", () => {
  it("unpack range une référence ; l'image 0 est la première ; effacer vide la table sauf Joe", () => {
    const frames = new FrameTable();
    frames.load("JOE_A.BBK", 13);
    frames.unpack(1, 11, 13);
    frames.unpack(0, FRAMES_JOE + 1, 13);
    expect(frames.frame(11)).toEqual({ bank: "JOE_A.BBK", image: 1 });
    expect(frames.frame(FRAMES_JOE + 1)).toEqual({ bank: "JOE_A.BBK", image: 1 });
    frames.eraseFrames(false);
    expect(frames.frame(11)).toBeDefined();
    expect(frames.frame(FRAMES_JOE + 1)).toBeUndefined();
    frames.close(13);
    expect(() => frames.unpack(1, 12, 13)).toThrow();
  });
});

describe.skipIf(!hasOriginalFiles)("chaînes d'animation des acteurs (QUEEN2.JAS)", () => {
  it("les chaînes des acteurs se lisent, finissent par l'image 0 et tiennent dans les 29 entrées de ScummVM", () => {
    const { actors } = gameData().jas;
    const { actorAnimations } = gameData().texts;
    const used = new Set(actors.filter((a) => a.animation !== 0).map((a) => a.animation));
    expect(used.size).toBeGreaterThan(30);
    for (const n of used) {
      const text = actorAnimations[n];
      const frames = parseAnimString(text);
      expect(frames.length, text).toBeGreaterThan(0);
      expect(frames.length, text).toBeLessThan(30);
    }
    // L'animation 9 (« A 0,(9,15)(10,15); ») est au format des cinématiques : aucun acteur de pièce ne l'utilise.
    expect(used.has(9)).toBe(false);
  });

  it("une banque se lit par la référence de la table (JOE_A.BBK : les images de marche de Joe)", () => {
    expect(parseBank(readOriginal("JOE_A.BBK")).frameCount).toBeGreaterThanOrEqual(20);
  });
});

describe("table d'images : surimpression (overpack) et animation de cinématique", () => {
  it("overpack garde l'image de base et empile les surimpressions, une seule fois chacune (la dernière copie l'emporte)", () => {
    const frames = new FrameTable();
    frames.load("A.BBK", 7);
    frames.load("B.BBK", 10);
    frames.unpack(3, 31, 7);
    frames.overpack(5, 31, 7);
    frames.overpack(6, 31, 10);
    frames.overpack(5, 31, 7);
    expect(frames.frame(31)).toEqual({
      bank: "A.BBK",
      image: 3,
      overs: [
        { bank: "B.BBK", image: 6 },
        { bank: "A.BBK", image: 5 },
      ],
    });
    // Un `unpack` repart de zéro.
    frames.unpack(2, 31, 7);
    expect(frames.frame(31)).toEqual({ bank: "A.BBK", image: 2 });
  });

  it("overpack sur une image vide est un unpack ; sans banque chargée, une erreur", () => {
    const frames = new FrameTable();
    frames.load("A.BBK", 7);
    frames.overpack(4, 40, 7);
    expect(frames.frame(40)).toEqual({ bank: "A.BBK", image: 4 });
    expect(() => frames.overpack(1, 40, 9)).toThrow();
  });

  it("une animation de cinématique s'applique au bob (retourné ou non) sans toucher aux chaînes des personnes", () => {
    const bobs = new Bobs();
    bobs.setCutawayAnim(2, true, [
      { frame: 45, speed: 8 },
      { frame: 46, speed: 8 },
    ]);
    const bob = bobs.bob(2);
    expect([bob.active, bob.animating, bob.xflip, bob.frameNum]).toEqual([true, true, true, 45]);
    expect(bobs.newAnim[2]).toEqual([]);
    expect(() => bobs.setCutawayAnim(21, false, [])).toThrow();
  });

  it("curPos range les coordonnées 16 bits non signées du fichier en 16 bits signés (65444 est -92)", () => {
    const bob = new BobSlot();
    bob.curPos(161, 65444);
    expect([bob.x, bob.y]).toEqual([161, -92]);
  });
});
