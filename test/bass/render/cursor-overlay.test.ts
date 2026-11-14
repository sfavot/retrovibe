import { describe, expect, it } from "vitest";
import { DATA_FILE_HEADER_SIZE } from "../../../src/games/bass/data/header";
import { Cursor, Var } from "../../../src/games/bass/engine/ids";
import {
  CURSOR_FILE,
  CursorOverlay,
  type CursorState,
  LINC_OBJECT_CURSOR_FILE,
  MouseCursor,
  OBJECT_CURSOR_FILE,
} from "../../../src/games/bass/render/cursor";
import { SCREEN_SIZE, SCREEN_WIDTH } from "../../../src/games/bass/render/frame-buffer";
import { BassScreenRenderer } from "../../../src/games/bass/render/screen";
import { hasOriginalFiles, skyDisk } from "../data/helpers";
import { makeEngine } from "../engine/helpers";
import { readReferenceFrame } from "./harness";

/** Fichier de sprites 2 x 2 dont l'image `i` est remplie de `values[i]`. */
function spriteBytes(values: number[]): Uint8Array {
  const size = 4;
  const bytes = new Uint8Array(DATA_FILE_HEADER_SIZE + values.length * size);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, 2, true);
  view.setUint16(8, 2, true);
  view.setUint16(10, size, true);
  view.setUint16(14, values.length, true);
  values.forEach((v, i) => bytes.fill(v, DATA_FILE_HEADER_SIZE + i * size, DATA_FILE_HEADER_SIZE + (i + 1) * size));
  return bytes;
}

const PALETTE = Uint8Array.from({ length: 768 }, (_, i) => (i % 3 === 0 ? Math.floor(i / 3) : 0)); // rouge = indice

function state(partial: Partial<CursorState> = {}): CursorState {
  return { cursor: MouseCursor.normal, cursorHotspot: [0, 0], objectCursor: -1, heldCursorFile: OBJECT_CURSOR_FILE, pointerX: 10, pointerY: 20, ...partial };
}

describe("CursorOverlay (fichiers synthétiques)", () => {
  const files = new Map<number, Uint8Array>([
    [CURSOR_FILE, spriteBytes([11, 12, 13, 14, 15, 16, 17, 18, 19])],
    [OBJECT_CURSOR_FILE, spriteBytes([100, 101, 102, 103])],
    [LINC_OBJECT_CURSOR_FILE, spriteBytes([200, 201, 202, 203])],
  ]);
  const overlay = () => new CursorOverlay((id) => files.get(id) ?? null);
  const blank = () => new Uint8ClampedArray(SCREEN_SIZE * 4);

  it("dessine l'image du curseur au pointeur, décalée du point chaud, avec la palette de l'écran", () => {
    const rgba = blank();
    expect(overlay().draw(rgba, PALETTE, state({ cursor: MouseCursor.normal, cursorHotspot: [1, 1], pointerX: 10, pointerY: 20 }))).toBe(true);
    const at = (x: number, y: number) => rgba[(y * SCREEN_WIDTH + x) * 4];
    expect([at(9, 19), at(10, 20), at(11, 20), at(8, 19), at(12, 19)]).toEqual([12, 12, 0, 0, 0]);
    expect(rgba[(19 * SCREEN_WIDTH + 9) * 4 + 3]).toBe(255);
  });

  it("curseur masqué (blank) ou fichiers absents : rien", () => {
    expect(overlay().image(state({ cursor: MouseCursor.blank }))).toBeNull();
    expect(overlay().draw(blank(), PALETTE, state({ cursor: MouseCursor.blank }))).toBe(false);
    expect(new CursorOverlay(() => null).image(state())).toBeNull();
  });

  it("objet tenu : l'image de la planche d'objets (2 x rang + ouvert) du fichier d'où elle vient, point chaud (5, 5)", () => {
    const o = overlay();
    const held = state({ cursor: Cursor.OBJECT, cursorHotspot: [5, 5], objectCursor: 3, heldCursorFile: OBJECT_CURSOR_FILE });
    expect(o.image(held)!.pixels[0]).toBe(103);
    expect(o.image(held)!.hotspot).toEqual({ x: 5, y: 5 });
    // Section de Linc : l'autre planche.
    expect(o.image({ ...held, objectCursor: 1, heldCursorFile: LINC_OBJECT_CURSOR_FILE })!.pixels[0]).toBe(201);
    // Retour au curseur normal : les images du fichier 60300 ne sont pas abîmées.
    expect(o.image(state())!.pixels[0]).toBe(12);
  });

  it("rogné aux bords : un curseur à moitié hors de l'écran ne déborde pas", () => {
    const rgba = blank();
    expect(overlay().draw(rgba, PALETTE, state({ pointerX: 319, pointerY: 199 }))).toBe(true);
    expect(rgba[(199 * SCREEN_WIDTH + 319) * 4]).toBe(12);
    expect(overlay().draw(blank(), PALETTE, state({ pointerX: -10, pointerY: 0 }))).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("le curseur et l'écran du banc", () => {
  it("barre d'inventaire (b-inv) : l'écran est identique au banc avec ou sans curseur dans le moteur ; le curseur est un calque", () => {
    const renderer = new BassScreenRenderer();
    const { engine } = makeEngine({ screen: (e) => renderer.attach(e) });
    engine.startAfterIntro();
    engine.pointerMove(160, 100);
    engine.vars[69] = 65;
    engine.vars[70] = 9;
    const compare = (name: string) => {
      const ref = readReferenceFrame(name);
      let different = 0;
      for (let i = 0; i < 64000; i++) if (ref.pixels[i] !== renderer.frame.pixels[i]) different++;
      expect(different).toBe(0);
      expect(renderer.frame.palette.subarray(0, 720)).toEqual(ref.palette.subarray(0, 720));
    };
    const run = (to: number) => engine.runCycles(to - engine.completedCycles);
    run(36);
    engine.pointerMove(160, 0);
    run(45);
    compare("inv-0045"); // barre ouverte : deux objets et les flèches, sans curseur
    run(51);
    engine.pointerMove(40, 12);
    run(62);
    engine.pointerMove(40, 12);
    engine.pointerDown("right");
    engine.pointerUp("right");
    run(74);
    engine.pointerMove(36, 72);
    run(80);

    // Objet tenu au-dessus d'une zone : main ouverte avec l'objet 65 (premier de `_mouseMainObjects` : rang 0, image 1), au pointeur.
    const mouse = engine.mouse;
    expect([mouse.cursor, mouse.objectCursor, mouse.cursorHotspot]).toEqual([Cursor.OBJECT, 1, [5, 5]]);
    expect(engine.vars[Var.OBJECT_HELD]).toBe(65);
    const overlay = new CursorOverlay((id) => skyDisk().load(id));
    const image = overlay.image(mouse)!;
    expect(image.pixels.some((p) => p !== 0)).toBe(true);
    const plain = renderer.frame.toRgba();
    const withCursor = renderer.toRgbaWithCursor(overlay, mouse);
    let changed = 0;
    for (let i = 0; i < plain.length; i += 4) if (plain[i] !== withCursor[i] || plain[i + 1] !== withCursor[i + 1] || plain[i + 2] !== withCursor[i + 2]) changed++;
    expect(changed).toBeGreaterThan(20);
    // Toutes les différences sont dans le carré de 22 x 22 du curseur.
    for (let i = 0; i < plain.length; i += 4) {
      if (plain[i] === withCursor[i] && plain[i + 1] === withCursor[i + 1] && plain[i + 2] === withCursor[i + 2]) continue;
      const x = (i / 4) % SCREEN_WIDTH;
      const y = Math.floor(i / 4 / SCREEN_WIDTH);
      expect(x).toBeGreaterThanOrEqual(mouse.pointerX - 5);
      expect(x).toBeLessThan(mouse.pointerX - 5 + 22);
      expect(y).toBeGreaterThanOrEqual(mouse.pointerY - 5);
      expect(y).toBeLessThan(mouse.pointerY - 5 + 22);
    }
    // `frame` n'a pas été touchée.
    expect(renderer.frame.toRgba()).toEqual(plain);

    // Utiliser l'objet : Foster marche vers la zone ; l'écran reste celui du banc.
    run(85);
    engine.pointerMove(36, 72);
    engine.pointerDown("right");
    engine.pointerUp("right");
    run(100);
    compare("inv-0100"); // image entière, libellé de la zone survolée compris (sprite de texte de `fn_pointer_text`)
  });
});
