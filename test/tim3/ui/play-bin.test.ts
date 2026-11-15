import { describe, expect, it } from "vitest";
import { readLev } from "../../../src/games/tim3/data/lev";
import { Editor, createPart } from "../../../src/games/tim3/engine/editor";
import { DEFAULT_LAB, Tim3Session, labLevel, puzzleList } from "../../../src/games/tim3/engine/session";
import { BIN_CLIP, BIN_LEFT, BIN_RIGHT, RenderAssets } from "../../../src/games/tim3/render";
import { PlayScreen, type PlayEvent } from "../../../src/games/tim3/ui/play";
import { frenchIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";

describe.skipIf(!original.has)("écran de jeu : bac", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const make = (session: Tim3Session) => {
    const events: PlayEvent[] = [];
    const screen = new PlayScreen(session, assets, session.level, { goal: "", hints: [], parts: [] }, [], (e) => events.push(e));
    return { screen, events };
  };
  const puzzle = (name: string) => new Tim3Session(realTypes(), readLev(index.get(`${name}.LEV`)), { puzzle: puzzleList().find((p) => p.name === name)! });
  const center = (r: { x: number; y: number; width: number; height: number }) => [r.x + (r.width >> 1), r.y + (r.height >> 1)] as const;

  it("HH17 (32 cases) : sept colonnes ; la flèche droite fait défiler d'une colonne, la gauche revient", () => {
    const { screen } = make(puzzle("HH17"));
    const bin = screen.bin;
    expect([bin.total, bin.columns.length, bin.scroll]).toEqual([32, 7, 0]);
    expect(bin.maxScroll).toBeGreaterThan(0);
    screen.pointerDown(...center(BIN_RIGHT), false);
    screen.pointerUp(...center(BIN_RIGHT));
    expect(screen.binScroll).toBe(bin.columns[1]! - 8);
    screen.pointerDown(...center(BIN_LEFT), false);
    expect(screen.binScroll).toBe(0);
    for (let i = 0; i < 20; i++) screen.scrollBin(1);
    expect(screen.binScroll).toBe(bin.maxScroll);
    screen.render();
    expect(screen.binScroll).toBe(bin.maxScroll);
  });

  it("toucher une case après défilement prend la pièce de cette case ; la case vidée disparaît", () => {
    const s = puzzle("HH17");
    const { screen, events } = make(s);
    screen.scrollBin(1);
    const slot = screen.bin.slots.find((k) => k.x >= BIN_CLIP.x + 4 && k.parts.length === 1)!;
    const before = screen.bin.total;
    screen.pointerDown(...center(slot), true);
    expect(s.editor.held?.type).toBe(slot.type);
    expect(events).toContainEqual({ type: "sound", name: "pick" });
    expect(screen.bin.total).toBe(before - 1);
    // Rendue au bac (appui sans glisser puis Échap) : la case revient.
    s.editor.returnHeld();
    expect(screen.bin.total).toBe(before);
  });

  it("appui long sur une case : infobulle ancrée sur la case visible", () => {
    const { screen, events } = make(puzzle("TLEV3"));
    const slot = screen.bin.slots[2]!;
    screen.pointerDown(...center(slot), true);
    screen.longPress(...center(slot));
    expect(events.at(-1)).toMatchObject({ type: "tip", partType: 14, anchor: { x: slot.x, y: slot.y } });
  });

  it("Labo : toutes les pièces de la palette, sans nombre, joignables au doigt colonne par colonne", () => {
    const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });
    const present = new Set(s.editor.binParts().map((p) => p.type));
    for (const t of Editor.labTypes(s.world)) if (!present.has(t)) createPart(s.world, t);
    const { screen } = make(s);
    const types = new Set<number>();
    let guard = 0;
    for (;;) {
      for (const k of screen.bin.slots) if (k.width >= 16) types.add(k.type);
      if (screen.binScroll === screen.bin.maxScroll || ++guard > 100) break;
      screen.scrollBin(1);
    }
    expect(screen.bin.counts).toBe(false);
    expect(guard).toBeLessThan(40);
    expect([...types].sort((a, b) => a - b)).toEqual([...new Set(s.editor.binParts().map((p) => p.type))].sort((a, b) => a - b));
    // Une case du Labo se prend au doigt.
    const slot = screen.bin.slots.find((k) => k.width >= 16)!;
    screen.pointerDown(...center(slot), true);
    expect(s.editor.held?.type).toBe(slot.type);
  });
});
