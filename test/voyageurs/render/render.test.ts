import { describe, expect, it } from "vitest";
import type { Font } from "../../../src/games/voyageurs/data/font";
import type { Pi1Image } from "../../../src/games/voyageurs/data/pi1";
import type { FrameView, MenuView } from "../../../src/games/voyageurs/engine/services";
import { type AnimSlot, addMessage, addOverlay, addPlayerCommandMessage, createState, type EngineState } from "../../../src/games/voyageurs/engine/state";
import { CURSOR_TRANSPARENT, CURSORS, CursorKind, cursorForCommand } from "../../../src/games/voyageurs/render/cursor";
import { menuBox } from "../../../src/games/voyageurs/render/menus";
import { FwRenderer } from "../../../src/games/voyageurs/render/renderer";
import { drawMessage, fitLine, stringWidth } from "../../../src/games/voyageurs/render/text";

/** Police synthétique : chaque glyphe est un bloc 16 × 8 de couleur 15 (sans transparence). */
const FONT: Font = {
  glyphs: Array.from({ length: 78 }, () => ({ pixels: new Uint8Array(128).fill(15), mask: new Uint8Array(128) })),
};

const at = (page: Uint8Array, x: number, y: number) => page[y * 320 + x];

function background(color: number, palette = new Uint8Array(48).fill(7)): Pi1Image {
  return { resolution: 0, palette, pixels: new Uint8Array(320 * 200).fill(color) };
}

/** Sprite plein `w × h` de couleur `color`, transparent nulle part (ou là où `transparent` le dit). */
function sprite(w: number, h: number, color: number, transparent?: (x: number, y: number) => boolean): AnimSlot {
  const data = new Uint8Array(w * h).fill(color);
  const mask = new Uint8Array(w * h);
  if (transparent) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = transparent(x, y) ? 1 : 0;
  return { kind: "sprite", resource: "T.ANI", part: "", fileIdx: 0, frameIdx: 0, width: w, height: h, var1: w >> 3, realWidth: w, bpp: 4, data, mask, transparentColor: 0 };
}

/** Masque MSK `w × h` : 0 (masquant) partout. */
function maskSlot(w: number, h: number): AnimSlot {
  return { kind: "mask", resource: "T.MSK", part: "", fileIdx: 0, frameIdx: 0, width: w, height: h, var1: w >> 3, realWidth: w, bpp: 1, data: new Uint8Array(w * h), mask: null, transparentColor: 0 };
}

function view(state: EngineState, menus: MenuView[] = [], banner: string | null = null): FrameView {
  return { state, menus, banner };
}

function setup(): { r: FwRenderer; state: EngineState } {
  const r = new FwRenderer(FONT);
  r.loadBackground("T.PI1", background(3));
  return { r, state: createState() };
}

describe("palettes et fondus", () => {
  it("le fond ne change que la palette de secours ; transformPalette s'affiche au dessin suivant, saturée", () => {
    const { r, state } = setup();
    r.drawFrame(view(state));
    expect(Array.from(r.screenPalette).every((c) => c === 0)).toBe(true);
    r.transformPalette(0, 1, 2, -9, 0);
    expect(r.screenPalette[0]).toBe(0);
    r.drawFrame(view(state));
    expect(Array.from(r.screenPalette.slice(0, 6))).toEqual([7, 0, 7, 7, 0, 7]);
    expect(r.screenPalette[6]).toBe(0);
    expect(Array.from(r.screenRgb().slice(0, 3))).toEqual([255, 0, 255]);
  });

  it("fondu depuis le noir (pas 7 à 0) puis au noir (8 pas de -1, depuis l'active) ; le dernier pas efface la page", () => {
    const { r, state } = setup();
    for (let i = 7; i >= 0; i--) {
      r.fadeInStep(i);
      expect(r.screenPalette[0]).toBe(7 - i);
    }
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 5, 5)).toBe(3);
    for (let i = 0; i < 8; i++) {
      r.fadeOutStep(i);
      expect(r.screenPalette[0]).toBe(Math.max(6 - i, 0));
    }
    r.fadeOutDone();
    expect(r.backBuffer.every((p) => p === 0)).toBe(true);
  });

  it("rustine anti-flash (palette noire tout de suite), rotations, retour à la palette de secours", () => {
    const palette = new Uint8Array(48);
    for (let i = 0; i < 16; i++) palette.fill(i % 8, i * 3, i * 3 + 3);
    const r = new FwRenderer(FONT);
    r.loadBackground("T.PI1", background(0, palette));
    r.rotatePalette(0, 0, 0);
    expect(r.screenPalette[3]).toBe(1);
    r.rotatePalette(1, 3, 1);
    expect([r.screenPalette[3], r.screenPalette[6], r.screenPalette[9]]).toEqual([3, 1, 2]);
    r.rotatePalette(1, 3, 2);
    expect([r.screenPalette[3], r.screenPalette[6], r.screenPalette[9]]).toEqual([1, 2, 3]);
    r.setBlackPalette();
    expect(Array.from(r.screenPalette).every((c) => c === 0)).toBe(true);
    expect(r.getPalettes().backup[3]).toBe(1);
  });

  it("getPalettes / setPalettes : copie, et palette active affichée au dessin suivant", () => {
    const { r, state } = setup();
    const p = r.getPalettes();
    p.active = p.active.map((_, i) => i % 8);
    r.setPalettes(p);
    expect(r.screenPalette[1]).toBe(0);
    r.drawFrame(view(state));
    expect(Array.from(r.screenPalette)).toEqual(p.active);
    expect(() => r.setPalettes({ active: [1], backup: [] })).toThrow();
  });
});

describe("calques", () => {
  it("sprite masqué à la position et la frame actuelles ; frame < 0 : rien ; occulteur placé après lui seulement", () => {
    const { r, state } = setup();
    state.anims[0] = sprite(16, 4, 9, (x) => x === 0);
    state.anims[1] = maskSlot(8, 2);
    Object.assign(state.objects[10]!, { x: 100, y: 50, frame: 0, mask: 0 });
    Object.assign(state.objects[11]!, { x: 104, y: 51, frame: 1, mask: 5 });
    addOverlay(state, 10, 0);
    addOverlay(state, 11, 5);
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 100, 50)).toBe(3); // transparent
    expect(at(r.backBuffer, 101, 50)).toBe(9);
    expect(at(r.backBuffer, 104, 51)).toBe(3); // occulté
    expect(at(r.backBuffer, 111, 52)).toBe(3);
    expect(at(r.backBuffer, 112, 52)).toBe(9);
    expect(at(r.backBuffer, 104, 53)).toBe(9);
    // Occulteur avant le sprite dans la liste : sans effet.
    state.objects[11]!.mask = 0;
    state.objects[10]!.mask = 5;
    state.overlays = [];
    addOverlay(state, 11, 5);
    addOverlay(state, 10, 0);
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 104, 51)).toBe(9);
    state.objects[10]!.frame = -1;
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 104, 51)).toBe(3);
  });

  it("type 4 : masque rempli de couleur 0 ; type 1 : non dessiné", () => {
    const { r, state } = setup();
    state.anims[2] = maskSlot(8, 2);
    Object.assign(state.objects[20]!, { x: 0, y: 0, frame: 2 });
    addOverlay(state, 20, 1);
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 0, 0)).toBe(3);
    state.overlays = [];
    addOverlay(state, 20, 4);
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 7, 1)).toBe(0);
    expect(at(r.backBuffer, 8, 1)).toBe(3);
  });

  it("incrustation : dessinée dans le fond avec l'état actuel de l'objet, sprite sans masque ignoré", () => {
    const { r, state } = setup();
    const obj = state.objects[30]!;
    Object.assign(obj, { x: 10, y: 10, frame: 0 });
    const incrust = { objIdx: 30, param: 0, x: 0, y: 0, frame: 0, part: 0, bgIdx: 0 };
    r.incrust(incrust, obj, sprite(16, 2, 12));
    r.incrust({ ...incrust, param: 1 }, { ...obj, x: 40 }, maskSlot(8, 1));
    r.incrust(incrust, { ...obj, x: 60 }, { ...sprite(16, 2, 13), mask: null });
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 10, 10)).toBe(12);
    expect(at(r.backBuffer, 40, 10)).toBe(0);
    expect(at(r.backBuffer, 60, 10)).toBe(3);
    expect(at(r.background!, 10, 11)).toBe(12);
  });

  it("bulle de script (fond `color`, bordure double 2/0) et message d'échec centré en y = 80 sur fond 4", () => {
    const { r, state } = setup();
    state.messages = [Uint8Array.from("AB CD", (c) => c.charCodeAt(0))];
    addMessage(state, 0, 20, 30, 100, 6);
    addMessage(state, 5, 0, 0, 100, 6); // message absent : rien
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 20, 30)).toBe(2);
    expect(at(r.backBuffer, 21, 31)).toBe(0);
    expect(at(r.backBuffer, 22, 32)).toBe(6);
    expect(at(r.backBuffer, 24, 34)).toBe(15); // premier glyphe en (x + 4, y + 4)
    expect(at(r.backBuffer, 20, 30 + 4 + 9 + 4)).toBe(2); // bas de la boîte : 4 + 9 + 4
    state.overlays = [];
    addPlayerCommandMessage(state, 1);
    state.overlays[0]!.failure = 5; // « Cela me semble difficile » : 24 caractères
    r.drawFrame(view(state));
    const width = 6 * 24 + 20;
    const x = Math.trunc((320 - width) / 2);
    expect(at(r.backBuffer, x, 80)).toBe(2);
    expect(at(r.backBuffer, x + 2, 82)).toBe(4);
    expect(at(r.backBuffer, x - 1, 80)).toBe(3);
  });

  it("ligne de commande 301 × 11 en (10, 185), absente si le menu système est bloqué", () => {
    const { r, state } = setup();
    state.commandLine = "PRENDRE";
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 9, 184)).toBe(2);
    expect(at(r.backBuffer, 10, 185)).toBe(0);
    expect(at(r.backBuffer, 12, 187)).toBe(15);
    expect(at(r.backBuffer, 311, 196)).toBe(2);
    state.disableSystemMenu = 1;
    r.drawFrame(view(state));
    expect(at(r.backBuffer, 10, 185)).toBe(3);
  });
});

describe("textes", () => {
  const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

  it("largeurs : espace 5, glyphe + 1 ; getStringWidth rend la dernière ligne ; | force la ligne", () => {
    expect(stringWidth(bytes("AB C"))).toBe(7 + 7 + 5 + 7);
    expect(stringWidth(bytes("ABCDEF|A"))).toBe(7);
    expect(fitLine(bytes("AB|CD"), 0, 100)).toEqual({ length: 3, words: 0, width: 14 });
    // « AAAA BBBB » dans 40 px : coupe après l'espace.
    expect(fitLine(bytes("AAAA BBBB"), 0, 40)).toEqual({ length: 5, words: 0, width: 28 });
  });

  it("une bulle qui déborde du bas est remontée (rustine #11708)", () => {
    const page = new Uint8Array(320 * 200);
    const text = bytes("AAAA BBBB CCCC DDDD EEEE FFFF");
    const bottom = drawMessage(page, FONT, text, 0, 180, 48, 1, false);
    expect(bottom).toBeGreaterThan(199);
    drawMessage(page, FONT, text, 0, 180, 48, 1);
    // Boîte de hauteur `bottom - 180` remontée : son bord bas tombe en 199.
    expect(page[199 * 320 + 10]).toBe(2);
    expect(page[(180 - (bottom - 199)) * 320 + 10]).toBe(2);
  });
});

describe("menus", () => {
  it("boîte ramenée dans l'écran, fond messageBg, bordure double, ligne choisie sur fond 0", () => {
    const { r, state } = setup();
    state.messageBg = 5;
    const menu: MenuView = { kind: "verbs", items: ["EXAMINER", "PRENDRE", "INVENTAIRE"], x: 300, y: 190, width: 70, selection: 1 };
    const box = menuBox(menu);
    expect(box).toEqual({ x: 249, y: 162, width: 70, height: 37 });
    r.drawFrame(view(state, [menu]));
    expect(at(r.backBuffer, 249, 162)).toBe(2);
    expect(at(r.backBuffer, 250, 163)).toBe(0);
    expect(at(r.backBuffer, 251, 164)).toBe(5);
    expect(at(r.backBuffer, 251, 175)).toBe(0 + 0); // ligne 1 : x + 2.., y + 4 + 9 - 1
    expect(at(r.backBuffer, 318, 175)).toBe(0);
    expect(at(r.backBuffer, 253, 167)).toBe(15); // texte de la ligne 0 en (x + 4, y + 4)
  });

  it("bandeau de pause centré en y = 80, fond 4", () => {
    const { r, state } = setup();
    r.drawFrame(view(state, [], "PAUSE"));
    const width = 5 * 7 + 20;
    expect(at(r.backBuffer, Math.trunc((320 - width) / 2), 80)).toBe(2);
    expect(at(r.backBuffer, Math.trunc((320 - width) / 2) + 2, 82)).toBe(4);
  });
});

describe("curseurs", () => {
  it("trois curseurs 16 × 16, points chauds (1,1), (0,0), (7,7) ; croix quand un verbe est choisi", () => {
    expect(CURSORS.map((c) => [c.hotspotX, c.hotspotY])).toEqual([[1, 1], [0, 0], [7, 7]]);
    const normal = CURSORS[CursorKind.Normal]!.pixels;
    expect(normal[0]).toBe(0); // contour noir
    expect(normal[16 + 1]).toBe(1); // flèche blanche
    expect(normal[15]).toBe(CURSOR_TRANSPARENT);
    expect(cursorForCommand(-1)).toBe(CURSORS[CursorKind.Normal]);
    expect(cursorForCommand(3)).toBe(CURSORS[CursorKind.Cross]);
  });
});
