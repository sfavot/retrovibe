import { describe, expect, it } from "vitest";
import { readDefaultPalette } from "../../src/games/armaeth/data/palette";
import { parseGph } from "../../src/games/armaeth/data/font";
import { readScene, type Scene } from "../../src/games/armaeth/data/scene";
import { readSprite, type SpriteFrame } from "../../src/games/armaeth/data/sprite";
import { readCountedArchive, readSceneArchive } from "../../src/games/armaeth/data/vga-archive";
import {
  BLIT_OK,
  BLIT_OUTSIDE,
  Compositor,
  HIT,
  HIT_NONE,
  HIT_OUTSIDE,
  OUTSIDE_COLOR,
  OUTSIDE_PRIORITY,
} from "../../src/games/armaeth/render/compositor";
import { drawText } from "../../src/games/armaeth/render/text";
import { applyLight } from "../../src/games/armaeth/render/light";
import { hasOriginalFiles, readOriginal } from "./helpers";

/** Image de `w x h` pixels rangés ligne par ligne. */
function sprite(w: number, h: number, pixels: number[]): SpriteFrame {
  return { width: w, height: h, pixels: Uint8Array.from(pixels) };
}

/** Sprite plein d'une seule valeur. */
function solid(w: number, h: number, value: number): SpriteFrame {
  return sprite(w, h, new Array(w * h).fill(value));
}

/** Scène synthétique : un rectangle, une couche d'image (type 2) et une couche de profondeur (type 0). */
function fakeScene(
  rect: { x: number; y: number; width: number; height: number },
  image: number | null,
  depth: number | null,
): Scene {
  const n = rect.width * rect.height;
  const layers = [];
  if (image !== null) layers.push({ ...rect, type: 2, pixels: new Uint8Array(n).fill(image) });
  if (depth !== null) layers.push({ ...rect, type: 0, pixels: new Uint8Array(n).fill(depth) });
  return { header: { ...rect }, layers } as unknown as Scene;
}

const at = (c: Compositor, x: number, y: number) => c.page.pixels[y * 320 + x];
const prio = (c: Compositor, x: number, y: number) => c.page.priority[y * 320 + x];

describe("blitSprite : règles du pilote", () => {
  it("x = centre (x - largeur / 2), y = bas (haut = y - hauteur + 1)", () => {
    const c = new Compositor();
    expect(c.blitSprite(solid(4, 3, 9), 100, 50, 0)).toBe(BLIT_OK);
    // largeur 4 : colonnes 98..101 ; hauteur 3 : lignes 48..50
    expect(at(c, 98, 48)).toBe(9);
    expect(at(c, 101, 50)).toBe(9);
    expect(at(c, 97, 48)).toBe(0);
    expect(at(c, 102, 50)).toBe(0);
    expect(at(c, 98, 47)).toBe(0);
    expect(at(c, 98, 51)).toBe(0);
    // largeur impaire : 5 -> décalage de 2 (division entière)
    c.blitSprite(solid(5, 1, 7), 20, 10, 0);
    expect(at(c, 18, 10)).toBe(7);
    expect(at(c, 22, 10)).toBe(7);
    expect(at(c, 23, 10)).toBe(0);
  });

  it("0xFF n'est jamais écrit", () => {
    const c = new Compositor();
    c.page.pixels.fill(5);
    c.blitSprite(sprite(2, 2, [1, 0xff, 0xff, 2]), 10, 10, 0);
    expect(at(c, 9, 9)).toBe(1);
    expect(at(c, 10, 9)).toBe(5);
    expect(at(c, 9, 10)).toBe(5);
    expect(at(c, 10, 10)).toBe(2);
    // et la priorité des pixels transparents n'est pas touchée
    c.page.priority.fill(3);
    c.blitSprite(sprite(2, 1, [0xff, 4]), 50, 50, 8);
    expect(prio(c, 49, 50)).toBe(3);
    expect(prio(c, 50, 50)).toBe(8);
  });

  it("rogne à gauche, à droite, en haut et en bas", () => {
    const c = new Compositor();
    // gauche : x = 1, largeur 4 -> colonnes -1..2 : la première colonne (1) est sautée
    c.blitSprite(sprite(4, 1, [1, 2, 3, 4]), 1, 5, 0);
    expect([0, 1, 2, 3].map((x) => at(c, x, 5))).toEqual([2, 3, 4, 0]);
    // droite : x = 318, largeur 4 -> colonnes 316..319 ; x = 319 -> 317..320 : la dernière est sautée
    c.blitSprite(sprite(4, 1, [1, 2, 3, 4]), 319, 6, 0);
    expect([317, 318, 319].map((x) => at(c, x, 6))).toEqual([1, 2, 3]);
    // haut : y = 1, hauteur 4 -> lignes -2..1 : les deux premières sont sautées
    c.blitSprite(sprite(1, 4, [1, 2, 3, 4]), 100, 1, 0);
    expect([0, 1].map((y) => at(c, 100, y))).toEqual([3, 4]);
    // bas : y = 200, hauteur 4 -> lignes 197..200 : la dernière est sautée
    c.blitSprite(sprite(1, 4, [1, 2, 3, 4]), 150, 200, 0);
    expect([197, 198, 199].map((y) => at(c, 150, y))).toEqual([1, 2, 3]);
  });

  it("rend 3 sans rien dessiner si le sprite est entièrement hors de la fenêtre", () => {
    const c = new Compositor();
    const s = solid(4, 4, 9);
    for (const [x, y] of [
      [-3, 50], // x - 2 + 4 = -1 : à gauche
      [322, 50], // colonnes 320..323
      [100, -1], // bas à -1
      [100, 203], // haut à 200
      [-100, -100],
    ]) {
      expect(c.blitSprite(s, x, y, 0)).toBe(BLIT_OUTSIDE);
    }
    expect(c.page.pixels.every((v) => v === 0)).toBe(true);
    expect(c.undoDepth).toBe(0);
    expect(c.dirtyRects.list).toHaveLength(0);
  });

  it("un sprite qui touche juste le bord reste visible (une colonne)", () => {
    const c = new Compositor();
    expect(c.blitSprite(solid(4, 1, 9), -1, 0, 0)).toBe(BLIT_OK); // colonnes -3..0
    expect(at(c, 0, 0)).toBe(9);
    expect(at(c, 1, 0)).toBe(0);
  });

  it("miroir horizontal seulement, avec le même rognage", () => {
    const c = new Compositor();
    const s = sprite(3, 2, [1, 2, 3, 4, 5, 6]);
    c.blitSprite(s, 11, 11, 0, { flip: true });
    expect([10, 11, 12].map((x) => at(c, x, 10))).toEqual([3, 2, 1]);
    expect([10, 11, 12].map((x) => at(c, x, 11))).toEqual([6, 5, 4]);
    // miroir et rognage gauche : x = 0, largeur 3 -> colonnes -1..1, on saute la colonne source 2 (mirroir : lecture de la fin)
    const d = new Compositor();
    d.blitSprite(s, 0, 5, 0, { flip: true });
    expect([0, 1].map((x) => at(d, x, 4))).toEqual([2, 1]);
    // miroir et rognage droit
    const e = new Compositor();
    e.blitSprite(s, 319, 5, 0, { flip: true });
    expect([318, 319].map((x) => at(e, x, 4))).toEqual([3, 2]);
  });

  it("priorité : un pixel n'est écrit que si la priorité mémorisée est <= celle de l'objet, et la met à jour", () => {
    const c = new Compositor();
    c.page.priority.fill(50);
    c.blitSprite(solid(1, 1, 1), 10, 10, 49);
    expect(at(c, 10, 10)).toBe(0); // 50 > 49 : masqué
    expect(prio(c, 10, 10)).toBe(50);
    c.blitSprite(solid(1, 1, 2), 10, 10, 50);
    expect(at(c, 10, 10)).toBe(2); // égalité : écrit
    expect(prio(c, 10, 10)).toBe(50);
    c.blitSprite(solid(1, 1, 3), 10, 10, 51);
    expect(at(c, 10, 10)).toBe(3);
    expect(prio(c, 10, 10)).toBe(51);
    c.blitSprite(solid(1, 1, 4), 10, 10, 20);
    expect(at(c, 10, 10)).toBe(3); // 51 > 20 : le premier reste devant
  });

  it("à égalité de priorité, le dernier dessiné gagne", () => {
    const c = new Compositor();
    c.blitSprite(solid(2, 2, 1), 10, 10, 30);
    c.blitSprite(solid(2, 2, 2), 10, 10, 30);
    expect(at(c, 10, 10)).toBe(2);
  });

  it("objet caché (ghost) : fond + valeur (modulo 256) au lieu du pixel du sprite, avec les mêmes tests", () => {
    const c = new Compositor();
    c.page.pixels.fill(100);
    c.blitSprite(sprite(2, 1, [7, 0xff]), 10, 5, 0, { ghost: 20 });
    expect(at(c, 9, 5)).toBe(120);
    expect(at(c, 10, 5)).toBe(100);
    c.page.pixels.fill(250);
    c.blitSprite(solid(1, 1, 7), 30, 5, 0, { ghost: 10 });
    expect(at(c, 30, 5)).toBe(4);
    c.page.priority.fill(9);
    c.page.pixels.fill(100);
    c.blitSprite(solid(1, 1, 7), 40, 5, 8, { ghost: 1 });
    expect(at(c, 40, 5)).toBe(100); // masqué
  });

  it("le décalage d'origine s'ajoute à x et y", () => {
    const c = new Compositor();
    c.blitSprite(solid(1, 1, 9), 10, 20, 0, { origin: { x: 5, y: 30 } });
    expect(at(c, 15, 50)).toBe(9);
  });

  it("la priorité est limitée à l'octet bas", () => {
    const c = new Compositor();
    c.page.priority.fill(1);
    c.blitSprite(solid(1, 1, 9), 10, 10, 0x100); // octet bas 0 < 1
    expect(at(c, 10, 10)).toBe(0);
  });
});

describe("annulation, présentation", () => {
  it("restoreDynamic remet les fonds (pixels et priorités), le dernier dessiné d'abord", () => {
    const c = new Compositor();
    c.page.pixels.fill(5);
    c.page.priority.fill(2);
    c.blitSprite(solid(3, 3, 1), 10, 10, 10);
    c.blitSprite(solid(3, 3, 2), 11, 10, 10); // recouvre le précédent
    c.restoreDynamic();
    expect(c.page.pixels.every((v) => v === 5)).toBe(true);
    expect(c.page.priority.every((v) => v === 2)).toBe(true);
    expect(c.undoDepth).toBe(0);
  });

  it("les sprites fixes ne sont annulés que par undoAll", () => {
    const c = new Compositor();
    c.blitSprite(solid(2, 2, 1), 10, 10, 0, { dynamic: false });
    c.blitSprite(solid(2, 2, 2), 30, 10, 0);
    c.restoreDynamic();
    expect(at(c, 10, 10)).toBe(1);
    expect(at(c, 30, 10)).toBe(0);
    expect(c.undoDepth).toBe(1);
    c.undoAll();
    expect(at(c, 10, 10)).toBe(0);
    expect(c.dirtyRects.all).toBe(true);
  });

  it("present ne recopie que les rectangles touchés, puis les efface de la liste", () => {
    const c = new Compositor();
    c.page.pixels.fill(5);
    c.blitSprite(solid(2, 2, 9), 10, 10, 0);
    c.present();
    expect(c.screen.pixels[10 * 320 + 9]).toBe(9);
    expect(c.screen.pixels[0]).toBe(0); // le reste de la page n'est pas recopié
    expect(c.dirtyRects.list).toHaveLength(0);
  });

  it("presentAndRestore : le prochain present efface l'ancienne position à l'écran", () => {
    const c = new Compositor();
    c.page.pixels.fill(5);
    c.screen.pixels.fill(5);
    c.blitSprite(solid(2, 2, 9), 10, 10, 0);
    c.presentAndRestore();
    expect(c.screen.pixels[10 * 320 + 9]).toBe(9);
    expect(at(c, 9, 10)).toBe(5); // la page est déjà restaurée
    c.blitSprite(solid(2, 2, 9), 50, 10, 0);
    c.presentAndRestore();
    expect(c.screen.pixels[10 * 320 + 9]).toBe(5);
    expect(c.screen.pixels[10 * 320 + 49]).toBe(9);
  });

  it("restoreScreen recopie la page sur l'écran (fermeture d'une fenêtre)", () => {
    const c = new Compositor();
    c.page.pixels.fill(3);
    c.screen.fillRect({ x: 5, y: 5, width: 10, height: 10 }, 8);
    c.restoreScreen({ x: 5, y: 5, width: 5, height: 10 });
    expect(c.screen.pixels[5 * 320 + 5]).toBe(3);
    expect(c.screen.pixels[5 * 320 + 10]).toBe(8);
  });
});

describe("spriteHit", () => {
  it("7 si un pixel opaque tombe sur une priorité égale à celle de l'objet", () => {
    const c = new Compositor();
    c.page.priority.fill(5);
    c.page.priority[10 * 320 + 10] = 40;
    const s = sprite(2, 1, [1, 2]);
    expect(c.spriteHit(s, 10, 10, 40)).toBe(HIT); // pixel x = 10 <-> source 1
    expect(c.spriteHit(sprite(2, 1, [1, 0xff]), 10, 10, 40)).toBe(HIT_NONE); // le pixel opaque est en x = 9
    expect(c.spriteHit(s, 10, 10, 41)).toBe(HIT_NONE);
    expect(c.spriteHit(sprite(2, 1, [0xff, 2]), 10, 10, 40, { flip: true })).toBe(HIT_NONE);
    expect(c.page.pixels.every((v) => v === 0)).toBe(true);
  });

  it("0xFFFF hors de la fenêtre, et ne regarde que la partie rognée", () => {
    const c = new Compositor();
    expect(c.spriteHit(solid(2, 2, 1), -10, 5, 0)).toBe(HIT_OUTSIDE);
    c.page.priority.fill(0);
    expect(c.spriteHit(solid(4, 1, 1), 0, 5, 0)).toBe(HIT);
  });
});

describe("drawScene / setFrame", () => {
  it("le cadre est la scène 0 : priorités 200 / 216 intouchables, 0 dans la fenêtre", () => {
    const c = new Compositor();
    c.setFrame(fakeScene({ x: 0, y: 0, width: 320, height: 200 }, 1, 0));
    c.page.priority.fill(216, 0, 320); // première ligne = cadre
    const room = fakeScene({ x: 0, y: 0, width: 320, height: 200 }, 7, 40);
    c.drawScene(room);
    expect(at(c, 0, 0)).toBe(1);
    expect(prio(c, 0, 0)).toBe(216);
    expect(at(c, 5, 5)).toBe(7);
    expect(prio(c, 5, 5)).toBe(40);
  });

  it("pose l'image dans son rectangle, et 221 / 199 autour là où le cadre le permet", () => {
    const c = new Compositor();
    c.setFrame(fakeScene({ x: 0, y: 0, width: 320, height: 200 }, 1, 0));
    c.page.priority.fill(200, 0, 20 * 320); // bandeau du haut = cadre
    c.drawScene(fakeScene({ x: 100, y: 50, width: 20, height: 10 }, 7, 24));
    expect(at(c, 100, 50)).toBe(7);
    expect(at(c, 119, 59)).toBe(7);
    expect(prio(c, 110, 55)).toBe(24);
    expect(at(c, 99, 50)).toBe(OUTSIDE_COLOR);
    expect(prio(c, 99, 50)).toBe(OUTSIDE_PRIORITY);
    expect(at(c, 100, 60)).toBe(OUTSIDE_COLOR);
    expect(at(c, 10, 10)).toBe(1); // cadre : ni pixel ni priorité modifiés
    expect(prio(c, 10, 10)).toBe(200);
  });

  it("un pixel de salle ne remplace pas un pixel de cadre au milieu de la salle", () => {
    const c = new Compositor();
    c.setFrame(fakeScene({ x: 0, y: 0, width: 320, height: 200 }, 1, 0));
    c.page.priority[100 * 320 + 100] = 216;
    c.drawScene(fakeScene({ x: 0, y: 0, width: 320, height: 200 }, 7, 8));
    expect(at(c, 100, 100)).toBe(1);
    expect(prio(c, 100, 100)).toBe(216);
    expect(at(c, 101, 100)).toBe(7);
  });

  it("abandonne les sprites sauvegardés et marque toute la page", () => {
    const c = new Compositor();
    c.blitSprite(solid(2, 2, 1), 10, 10, 0);
    c.drawScene(fakeScene({ x: 0, y: 0, width: 320, height: 200 }, 7, 0));
    expect(c.undoDepth).toBe(0);
    expect(c.dirtyRects.all).toBe(true);
    c.present();
    expect(c.screen.pixels.every((v) => v === 7)).toBe(true);
  });

  it("un sprite derrière le décor (priorité de la salle plus haute) est masqué", () => {
    const c = new Compositor();
    c.setFrame(fakeScene({ x: 0, y: 0, width: 320, height: 200 }, 1, 0));
    c.drawScene(fakeScene({ x: 0, y: 0, width: 320, height: 200 }, 7, 80));
    c.blitSprite(solid(2, 2, 9), 10, 10, 79);
    expect(at(c, 10, 10)).toBe(7);
    c.blitSprite(solid(2, 2, 9), 10, 10, 80);
    expect(at(c, 10, 10)).toBe(9);
  });
});

describe("drawFrameRect (+0x6a)", () => {
  it("bordure d'un pixel et remplissage", () => {
    const c = new Compositor();
    c.drawFrameRect({ x: 10, y: 10, width: 4, height: 3 }, 9, 5);
    const row = (y: number) => [9, 10, 11, 12, 13, 14].map((x) => c.screen.pixels[y * 320 + x]);
    expect(row(10)).toEqual([0, 9, 9, 9, 9, 0]);
    expect(row(11)).toEqual([0, 9, 5, 5, 9, 0]);
    expect(row(12)).toEqual([0, 9, 9, 9, 9, 0]);
  });

  it("creux : l'intérieur n'est pas touché", () => {
    const c = new Compositor();
    c.screen.pixels.fill(2);
    c.drawFrameRect({ x: 10, y: 10, width: 4, height: 3 }, 9, null);
    expect(c.screen.pixels[11 * 320 + 11]).toBe(2);
    expect(c.screen.pixels[11 * 320 + 10]).toBe(9);
    expect(c.screen.pixels[11 * 320 + 13]).toBe(9);
  });

  it("tailles limites : nulle, 1 de large, 1 de haut, 2 de large", () => {
    const c = new Compositor();
    c.drawFrameRect({ x: 10, y: 10, width: 0, height: 5 }, 9, 5);
    c.drawFrameRect({ x: 10, y: 10, width: 5, height: -1 }, 9, 5);
    expect(c.screen.pixels.every((v) => v === 0)).toBe(true);
    c.drawFrameRect({ x: 10, y: 10, width: 1, height: 3 }, 9, 5);
    expect([10, 11, 12].map((y) => c.screen.pixels[y * 320 + 10])).toEqual([9, 9, 9]);
    c.drawFrameRect({ x: 20, y: 10, width: 4, height: 1 }, 7, 5);
    expect([20, 21, 22, 23, 24].map((x) => c.screen.pixels[10 * 320 + x])).toEqual([7, 7, 7, 7, 0]);
    c.drawFrameRect({ x: 30, y: 10, width: 2, height: 3 }, 6, 5);
    expect([30, 31].map((x) => c.screen.pixels[11 * 320 + x])).toEqual([6, 6]);
  });

  it("rogne aux bords de l'écran", () => {
    const c = new Compositor();
    c.drawFrameRect({ x: 316, y: 197, width: 10, height: 10 }, 9, 5);
    expect(c.screen.pixels[197 * 320 + 319]).toBe(9);
    expect(c.screen.pixels[198 * 320 + 316]).toBe(9);
    expect(c.screen.pixels[198 * 320 + 317]).toBe(5);
  });
});

/** Lecture des fichiers du jeu pour les tests de données réelles. */
function loadScene(id: number): Scene {
  const file = `A1F${String(Math.floor(id / 100)).padStart(2, "0")}${String.fromCharCode(65 + Math.floor((id % 100) / 5))}.VGA`;
  return readScene(readSceneArchive(readOriginal(file)).bytes(id));
}

describe.skipIf(!hasOriginalFiles)("composition de données réelles", () => {
  const frameScene = loadScene(0);
  const room = loadScene(2);
  const hero = readSprite(readCountedArchive(readOriginal("A1FOBJ.VGA")).bytes(1)).frames[0];

  it("le cadre protège l'interface : la salle 2 ne change que la fenêtre de jeu", () => {
    const c = new Compositor();
    c.setFrame(frameScene);
    const frame = c.page.pixels.slice();
    const mask = c.page.priority.slice();
    c.drawScene(room);
    let changed = 0;
    for (let i = 0; i < 64000; i++) {
      if (mask[i] >= 200) {
        expect(c.page.pixels[i]).toBe(frame[i]);
        expect(c.page.priority[i]).toBe(mask[i]);
      } else if (c.page.pixels[i] !== frame[i]) changed++;
    }
    expect(changed).toBeGreaterThan(40000);
    // fenêtre de jeu : x 8..311, y 20..179 (hors coins arrondis)
    expect(c.page.priority[100 * 320 + 160]).toBeLessThan(200);
    expect(c.page.priority[5 * 320 + 160]).toBeGreaterThanOrEqual(200);
    // la salle 2 a une carte de profondeur en multiples de 8
    const depths = new Set<number>();
    for (let y = 20; y < 180; y++) for (let x = 8; x < 312; x++) if (c.page.priority[y * 320 + x] < 200) depths.add(c.page.priority[y * 320 + x]);
    expect([...depths].every((v) => v % 8 === 0 && v <= 160)).toBe(true);
  });

  it("le héros de CFG en (219, 146) est posé à l'écran et caché derrière un avant-plan plus proche", () => {
    const c = new Compositor();
    c.setFrame(frameScene);
    c.drawScene(room);
    const origin = { x: room.header.x, y: room.header.y };
    const before = c.page.pixels.slice();
    expect(c.blitSprite(hero, 219, 146, 113, { origin })).toBe(BLIT_OK);
    let drawn = 0;
    for (let i = 0; i < 64000; i++) if (c.page.pixels[i] !== before[i]) drawn++;
    expect(drawn).toBeGreaterThan(100);
    expect(drawn).toBeLessThanOrEqual(hero.width * hero.height);
    // ses pieds sont sur la ligne y = origine + 146
    const bottom = origin.y + 146;
    let touchedRows = 0;
    for (let y = bottom - hero.height + 1; y <= bottom; y++)
      for (let x = 0; x < 320; x++) if (c.page.pixels[y * 320 + x] !== before[y * 320 + x]) { touchedRows++; break; }
    expect(touchedRows).toBeGreaterThan(hero.height / 2);

    // priorité 0 : tout ce qui est devant (priorité > 0) le masque : il ne reste que les pixels de sol à 0
    const d = new Compositor();
    d.setFrame(frameScene);
    d.drawScene(room);
    d.blitSprite(hero, 219, 146, 0, { origin });
    let drawnBehind = 0;
    for (let i = 0; i < 64000; i++) if (d.page.pixels[i] !== before[i]) drawnBehind++;
    expect(drawnBehind).toBeLessThanOrEqual(drawn);
  });

  it("composition complète : image, héros, texte et fenêtre, convertie par la palette éclairée", () => {
    const font = parseGph(readOriginal("A1FGPH.SYS"));
    const palette = readDefaultPalette(readOriginal("AM1.EXE"));
    const c = new Compositor();
    c.setFrame(frameScene);
    c.drawScene(room);
    c.blitSprite(hero, 219, 146, 113, { origin: { x: room.header.x, y: room.header.y } });
    c.presentAndRestore();
    c.drawFrameRect({ x: 38, y: 168, width: 244, height: 11 }, 238, 250);
    drawText(c.screen, font, 41, 170, "abc", { color: 221, shadow: 238 });
    expect(c.screen.pixels[168 * 320 + 38]).toBe(238);
    expect(c.screen.pixels.includes(221)).toBe(true);
    expect(applyLight(palette, -10)).toHaveLength(768);
    // fermer la fenêtre : la page reprend la place
    c.restoreScreen({ x: 38, y: 168, width: 244, height: 11 });
    expect(c.screen.pixels[168 * 320 + 38]).toBe(c.page.pixels[168 * 320 + 38]);
  });
});
