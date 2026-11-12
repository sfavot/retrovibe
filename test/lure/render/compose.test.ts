import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameTextToUnicode } from "../../../src/games/lure/data/charset";
import { confirmDialog, infoDialog, popupDialog } from "../../../src/games/lure/render/dialog";
import { LureRenderer } from "../../../src/games/lure/render/renderer";
import { Driver, hasOriginalFiles, makeEngine } from "../engine/test-host";

/**
 * Échantillons de la sortie de ScummVM (banc sans fenêtre, `fixtures/make-scummvm-fixture.mjs`) : la cellule, un menu surgissant, la boîte
 * d'information et la barre de menus, indices et palette.
 */
interface Fixture {
  samplesStep: number;
  samples: string;
  palette: string;
  regions: Record<"popup" | "info" | "bar", { x: number; y: number; w: number; h: number; data: string }>;
}
const fixture = JSON.parse(readFileSync(new URL("./fixtures/scummvm-lure.json", import.meta.url), "utf8")) as Fixture;
const bytes = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

function rowsOf(pixels: Uint8Array, x: number, y: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) out.set(pixels.subarray((y + r) * 320 + x, (y + r) * 320 + x + w), r * w);
  return out;
}

describe.skipIf(!hasOriginalFiles)("composition de la cellule, comparée à ScummVM", () => {
  it("les pixels échantillonnés hors des zones animées et la palette sont ceux de ScummVM", () => {
    const { engine } = makeEngine();
    const renderer = new LureRenderer(engine.data, { cursor: false });
    for (let i = 0; i < 40; i++) {
      engine.tick();
      renderer.render(engine, 80);
    }
    expect(renderer.fading).toBe(false);
    // zones où des hotspots animés peuvent différer d'une phase à l'autre
    const animated = engine.world.activeHotspots.filter((h) => h.numFrames > 1).map((h) => ({ x: h.x - 4, y: h.y - 4, w: h.width + 8, h: h.height + 8 }));
    const samples = bytes(fixture.samples);
    let compared = 0;
    const wrong: string[] = [];
    for (let i = 0; i < samples.length; i++) {
      const x = (i % 40) * fixture.samplesStep;
      const y = Math.floor(i / 40) * fixture.samplesStep;
      if (animated.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
      compared++;
      if (renderer.output[y * 320 + x] !== samples[i]) wrong.push(`(${x},${y}) ${renderer.output[y * 320 + x]} != ${samples[i]}`);
    }
    expect(compared).toBeGreaterThan(700);
    expect(wrong).toEqual([]);
    expect([...renderer.palette]).toEqual([...bytes(fixture.palette)].map((v) => v)); // la palette de ScummVM est celle de 8 bits
  });

  it("le menu surgissant « Regarde / Statut » (trois lignes de ScummVM) est identique à ScummVM", () => {
    const { engine } = makeEngine();
    const region = fixture.regions.popup;
    const { surface, x, y } = popupDialog(engine.data, ["Regarde", "Statut"], 0, { numLines: 3, first: -1 });
    expect([x, y, surface.width, surface.height]).toEqual([region.x, region.y, region.w, region.h]);
    expect([...surface.data]).toEqual([...bytes(region.data)]);
  });

  it("la boîte d'information de la cellule (cadre, police proportionnelle, coupe des lignes) est identique à ScummVM", () => {
    const { engine } = makeEngine();
    const region = fixture.regions.info;
    const text = engine.text(engine.room.descId || engine.world.requireRoom(1).data.descId);
    const { surface, x, y } = infoDialog(engine.data, text);
    expect([x, y, surface.width]).toEqual([region.x, region.y, region.w]);
    expect(surface.height).toBeLessThanOrEqual(region.h);
    const expected = bytes(region.data).subarray(0, surface.width * surface.height);
    expect([...surface.data]).toEqual([...expected]);
    expect(gameTextToUnicode(text).startsWith("LA CELLULE")).toBe(true);
  });

  it("la barre de menus ouverte est l'image de la ressource 5, sans menu déroulé", () => {
    const { engine, host } = makeEngine();
    const renderer = new LureRenderer(engine.data, { cursor: false });
    const d = new Driver(engine, host);
    d.ticks(5);
    d.click(20, 4);
    expect(engine.menuView).toEqual({ kind: "bar", menu: null, index: 0 });
    renderer.render(engine, 80);
    const region = fixture.regions.bar;
    expect([...rowsOf(renderer.output, 0, 0, 320, 8)]).toEqual([...bytes(region.data)]);
  });
});

describe.skipIf(!hasOriginalFiles)("ce que le rendu pose par-dessus la pièce", () => {
  it("un menu de la barre se déroule sous son en-tête mis en valeur, l'entrée visée en blanc", () => {
    const { engine, host } = makeEngine();
    const renderer = new LureRenderer(engine.data, { cursor: false });
    const d = new Driver(engine, host);
    d.ticks(5);
    d.click(150, 4);
    renderer.render(engine, 80);
    const plain = renderer.output.slice();
    const menu = engine.menuBar.menus[1]!;
    // le dropdown commence sous la barre, à x = 13 * 8
    expect(menu.xStart).toBe(104);
    expect(plain[8 * 320 + menu.xStart + 20]).not.toBe(0);
    d.hover(menu.xStart + 20, 8 + 12 + 8 + 2); // 2e entrée
    renderer.render(engine, 80);
    expect(engine.menuView).toMatchObject({ kind: "bar", menu: 1, index: 2 });
    const hot = renderer.output;
    let changed = 0;
    for (let i = (8 + 12 + 8) * 320; i < (8 + 12 + 16) * 320; i++) if (hot[i] !== plain[i]) changed++;
    expect(changed).toBeGreaterThan(20);
  });

  it("la confirmation est une boîte de 190 de large centrée, le curseur est caché", () => {
    const { engine } = makeEngine();
    const { surface, x, y } = confirmDialog(engine.data, engine.data.uiStrings[40]!);
    expect([surface.width, x]).toEqual([190, 65]);
    expect(y).toBe((200 - surface.height) >> 1);
  });

  it("le curseur est dessiné au point chaud (flèche en 0, 0 ; autres en 7, 7) et rogné au bord", () => {
    const { engine, host } = makeEngine();
    const renderer = new LureRenderer(engine.data);
    const d = new Driver(engine, host);
    d.ticks(5);
    d.hover(100, 100);
    renderer.render(engine, 80);
    const withCursor = renderer.output.slice();
    const bare = new LureRenderer(engine.data, { cursor: false });
    bare.render(engine, 0);
    let diff = 0;
    for (let i = 0; i < withCursor.length; i++) if (withCursor[i] !== bare.output[i]) diff++;
    expect(diff).toBeGreaterThan(10);
    expect(diff).toBeLessThanOrEqual(256);
    d.hover(319, 199);
    renderer.render(engine, 80);
  });
});
