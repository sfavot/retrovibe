import { describe, expect, it } from "vitest";
import { readFont } from "../../../src/games/gk1/data/font";
import { ResourceType } from "../../../src/games/gk1/data/ids";
import { collectGarbage } from "../../../src/games/gk1/engine/gc";
import { ArrayType } from "../../../src/games/gk1/engine/ids";
import { type Reg, SciArray, toSint16 } from "../../../src/games/gk1/engine/memory";
import { TextAlign } from "../../../src/games/gk1/render/ids";
import { makeRect } from "../../../src/games/gk1/render/rect";
import type { TextBitmapStyle } from "../../../src/games/gk1/render/text";
import { fnv1a, mainIndex, original } from "../data/real";
import { Scene } from "./scene";

/** « é », « ê », « à » et « ° » en CP850. */
const E_ACUTE = "\x82";
const E_CIRC = "\x88";
const A_GRAVE = "\x85";
const DEGREE = "\xf8";
const SENTENCE = `Gabriel Knight : les p${E_ACUTE}ch${E_ACUTE}s des anc${E_CIRC}tres. Une enqu${E_CIRC}te ${A_GRAVE} La Nouvelle-Orl${E_ACUTE}ans.`;
const FORE = 7;
const BACK = 3;
const BORDER = 9;

function style(text: string, overrides: Partial<TextBitmapStyle> = {}): TextBitmapStyle {
  return { text, textRect: makeRect(0, 0, 320, 200), foreColor: FORE, backColor: BACK, skipColor: 250, font: 0, borderColor: -1, dimmed: false, ...overrides };
}

/** Colonnes extrêmes des pixels d'encre de la ligne de texte qui commence à `top`. */
function inkSpan(pixels: Uint8Array, width: number, top: number, bottom: number): [number, number] {
  let left = width;
  let right = -1;
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] !== FORE) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return [left, right];
}

describe.skipIf(!original.has)("texte : mesure et retour à la ligne sur les polices du CD", () => {
  const scene = new Scene();
  const text = scene.frameout.text;
  const font = (id: number) => readFont(mainIndex().get(ResourceType.Font, id));
  const widthOf = (id: number, value: string): number => [...value].reduce((sum, char) => sum + (font(id).glyphs[char.charCodeAt(0)]?.width ?? 0), 0);

  it("la largeur d'une ligne est la somme des largeurs de ses glyphes, accents compris", () => {
    for (const id of [0, 1, 2, 7]) expect(text.stringWidth(SENTENCE, id), `police ${id}`).toBe(widthOf(id, SENTENCE));
    expect([0, 1, 2, 7].map((id) => text.stringWidth(SENTENCE, id))).toMatchInlineSnapshot(`
      [
        488,
        399,
        367,
        852,
      ]
    `);
    // « ° » (0xF8) n'existe que dans la police 2 : ailleurs il ne prend pas de place.
    expect(text.stringWidth(`37${DEGREE}`, 0)).toBe(widthOf(0, "37"));
    expect(text.stringWidth(`37${DEGREE}`, 2)).toBeGreaterThan(widthOf(2, "37"));
  });

  it("un code |f…| change de police pour la suite, les autres codes ne comptent pas", () => {
    expect(text.stringWidth("ab|f7|cd", 0)).toBe(widthOf(0, "ab") + widthOf(7, "cd"));
    expect(text.stringWidth("ab|c12|cd|a1|", 0)).toBe(widthOf(0, "abcd"));
  });

  it("coupe aux espaces qui tiennent, avale les espaces de la coupure, coupe un mot trop long au caractère", () => {
    expect(text.wrap(SENTENCE, 0, 100)).toEqual(["Gabriel Knight :", `les p${E_ACUTE}ch${E_ACUTE}s des`, `anc${E_CIRC}tres. Une`, `enqu${E_CIRC}te ${A_GRAVE} La`, "Nouvelle-Orl\x82a", "ns."]);
    for (const line of text.wrap(SENTENCE, 0, 100)) expect(widthOf(0, line)).toBeLessThanOrEqual(100);
    expect(text.wrap(SENTENCE, 2, 100)).toHaveLength(4);
    expect(text.wrap("deux   un", 0, widthOf(0, "deux") + 1)).toEqual(["deux", "un"]);
    expect(text.wrap("un\r\ndeux\n\ntrois\rfin", 0, 300)).toEqual(["un", "deux", "", "trois", "fin"]);
    expect(text.wrap("", 0, 100)).toEqual([]);
    // Largeur plus petite qu'un caractère : un caractère par ligne, sans boucle.
    expect(text.wrap("abc", 0, 1)).toEqual(["a", "b", "c"]);
  });

  it("TextSize : plus longue ligne et hauteur de toutes les lignes", () => {
    const lines = text.wrap(SENTENCE, 0, 100);
    expect(text.textSize(SENTENCE, 0, 100)).toEqual(makeRect(0, 0, Math.max(...lines.map((line) => widthOf(0, line))), lines.length * font(0).lineHeight));
    // Sans largeur maximale : 192 pixels ; largeur négative : une seule ligne, hauteur nulle (1 après l'arrondi d'échelle).
    expect(text.textSize(SENTENCE, 1, 0).bottom).toBe(text.wrap(SENTENCE, 1, 192).length * font(1).lineHeight);
    expect(text.textSize(SENTENCE, 1, -1)).toEqual(makeRect(0, 0, widthOf(1, SENTENCE), 1));
    expect(text.textSize(SENTENCE, 1, -1, false).bottom).toBe(0);
    // Une ligne plus large que la limite garde la limite.
    expect(text.textSize("abcdefghij", 0, 20).right).toBe(20);
    expect(text.textSize("", 0, 100)).toEqual(makeRect(0, 0, 1, 1));
  });

  it("le noyau écrit le rectangle dans le tableau, bords compris", () => {
    const rect = scene.vm.memory.arrays.allocate(new SciArray(ArrayType.Int16, 4));
    const string = scene.vm.memory.arrays.allocate(new SciArray(ArrayType.String));
    scene.vm.memory.setString(string, SENTENCE);
    scene.vm.acc = 77;
    expect(scene.vm.kernel.call(scene.vm, scene.vm.kernel.indexOf("TextSize"), Uint32Array.of(rect, string, 0, 100))).toBe(77);
    const size = text.textSize(SENTENCE, 0, 100);
    expect([0, 1, 2, 3].map((index) => toSint16(scene.vm.memory.array(rect).get(index)))).toEqual([0, 0, size.right - 1, size.bottom - 1]);
    expect(scene.vm.kernel.call(scene.vm, scene.vm.kernel.indexOf("TextWidth"), Uint32Array.of(string, 2))).toBe(widthOf(2, SENTENCE));
  });
});

describe.skipIf(!original.has)("texte : bitmaps", () => {
  const scene = new Scene();
  const text = scene.frameout.text;
  const lineHeight = readFont(mainIndex().get(ResourceType.Font, 0)).lineHeight;

  it("fond, bord d'un pixel, texte dans son rectangle", () => {
    const bitmap = text.createBitmap(120, 30, TextAlign.Left, style("Gabriel", { borderColor: BORDER, textRect: makeRect(4, 3, 116, 27) }));
    expect([bitmap.width, bitmap.height, bitmap.skipColor, bitmap.pixels.length]).toEqual([120, 30, 250, 3600]);
    const at = (x: number, y: number): number => bitmap.pixels[y * 120 + x];
    expect([at(0, 0), at(119, 0), at(0, 29), at(119, 29), at(60, 0), at(0, 15), at(119, 15), at(60, 29)]).toEqual(new Array(8).fill(BORDER));
    expect([at(1, 1), at(118, 28), at(60, 28)]).toEqual([BACK, BACK, BACK]);
    const [left, right] = inkSpan(bitmap.pixels, 120, 3, 3 + lineHeight);
    expect(left).toBeGreaterThanOrEqual(4);
    expect(right).toBeLessThan(4 + text.stringWidth("Gabriel", 0));
    expect(new Set(bitmap.pixels)).toEqual(new Set([BACK, BORDER, FORE]));
    expect(fnv1a(bitmap.pixels).toString(16)).toMatchInlineSnapshot(`"d38ec265"`);
  });

  it("aligne à gauche, au centre et à droite, ligne par ligne", () => {
    const width = text.stringWidth("Knight", 0);
    const spans = [TextAlign.Left, TextAlign.Center, TextAlign.Right].map((alignment) => inkSpan(text.createBitmap(200, 20, alignment, style("Knight")).pixels, 200, 0, 20));
    const [leftAligned, centered, rightAligned] = spans;
    expect(centered[0] - leftAligned[0]).toBe(Math.trunc((200 - width) / 2));
    expect(rightAligned[0] - leftAligned[0]).toBe(200 - width);
    expect(rightAligned[1]).toBeLessThan(200);
    // Deux lignes : la seconde commence une hauteur de ligne plus bas.
    const two = text.createBitmap(200, 40, TextAlign.Left, style("Gabriel\nKnight"));
    expect(inkSpan(two.pixels, 200, lineHeight, 2 * lineHeight)[0]).toBe(leftAligned[0]);
  });

  it("codes de couleur et de police, texte grisé en damier, glyphe rogné au bord", () => {
    const colored = text.createBitmap(100, 20, TextAlign.Left, style("a|c12|b"));
    expect(new Set(colored.pixels)).toEqual(new Set([BACK, FORE, 12]));
    const plain = text.createBitmap(100, 20, TextAlign.Left, style("MMMM"));
    const dimmed = text.createBitmap(100, 20, TextAlign.Left, style("MMMM", { dimmed: true }));
    let kept = 0;
    plain.pixels.forEach((pixel, index) => {
      if (pixel !== FORE) expect(dimmed.pixels[index]).toBe(BACK);
      else {
        const x = index % 100;
        const y = Math.trunc(index / 100);
        // Lignes impaires : colonnes paires du glyphe ; lignes paires : colonnes impaires. Tous les glyphes « M » ont la même largeur.
        if (dimmed.pixels[index] === FORE) kept++;
        expect(dimmed.pixels[index] === FORE ? (y + (x % text.stringWidth("M", 0))) % 2 : 1).toBe(1);
      }
    });
    expect(kept).toBeGreaterThan(0);
    const clipped = text.createBitmap(5, 4, TextAlign.Left, style("MMMM"));
    expect(clipped.pixels).toHaveLength(20);
    expect(text.createBitmap(50, 10, TextAlign.Left, style("", { borderColor: BORDER })).pixels.filter((pixel) => pixel === BORDER)).toHaveLength(2 * 50 + 2 * 8);
  });

  it("CreateTextBitmap : le bitmap d'un DText se dessine à la place de sa vue, et vit tant qu'on le référence", () => {
    const vm = scene.vm;
    const string = vm.memory.arrays.allocate(new SciArray(ArrayType.String));
    vm.memory.setString(string, "Gabriel");
    const plane = scene.plane(0, 0, 319, 199, { back: 1 });
    const label = scene.make("DText", { plane, text: string, fore: FORE, back: BACK, skip: 250, font: 0, borderColor: -1, mode: TextAlign.Left, textLeft: 0, textTop: 0, textRight: 59, textBottom: 11, x: 100, y: 50, fixPriority: 1, priority: 5 });
    const create = (...args: Reg[]): Reg => vm.kernel.call(vm, vm.kernel.indexOf("CreateTextBitmap"), Uint32Array.from(args));
    const bitmap = create(0, 60, 12, label);
    expect(vm.memory.bitmaps.get(bitmap)).toMatchObject({ width: 60, height: 12 });
    scene.set(label, { bitmap });
    scene.kernelOn("AddScreenItem", label);
    scene.frameout.frameOut();
    expect(vm.warnings.size).toBe(0);
    expect([scene.pixel(99, 50), scene.pixel(100, 50), scene.pixel(159, 61), scene.pixel(160, 61), scene.pixel(100, 62)]).toEqual([1, BACK, BACK, 1, 1]);
    const drawn = Array.from({ length: 12 }, (_, y) => [...scene.frameout.screen.subarray((50 + y) * 320 + 100, (50 + y) * 320 + 160)]).flat();
    expect(drawn).toEqual([...vm.memory.bitmaps.get(bitmap)!.pixels]);
    expect(drawn).toContain(FORE);
    expect(scene.nowSeen(label)).toEqual([100, 50, 159, 61]);

    // Ramasse-miettes : gardé par la propriété de l'objet, puis par l'élément d'écran ; libéré par DisposeTextBitmap.
    const orphan = create(0, 10, 10, label);
    expect(collectGarbage(vm).bitmaps).toBe(1);
    expect(vm.memory.bitmaps.get(orphan)).toBeUndefined();
    expect(vm.memory.bitmaps.get(bitmap)).toBeDefined();
    scene.kernelOn("DisposeTextBitmap", bitmap);
    expect(vm.memory.bitmaps.get(bitmap)).toBeUndefined();
    scene.frameout.frameOut();
    expect(scene.pixel(100, 50)).toBe(1);

    // Sous-fonction 1 : la taille et le fond viennent d'un cel de vue (bouton du titre, 35×10).
    const button = scene.make("DText", { text: string, fore: FORE, back: BACK, skip: 250, font: 0, borderColor: -1, view: 100, loop: 0, cel: 0, textLeft: 0, textTop: 0, textRight: 34, textBottom: 9 });
    expect(vm.memory.bitmaps.get(create(1, button))).toMatchObject({ width: 35, height: 10 });
    expect(create(5, button)).toBe(0);
    expect([...vm.warnings.keys()]).toEqual(["CreateTextBitmap : sous-fonction 5 inconnue"]);
  });
});
