import { describe, expect, it } from "vitest";
import { readLev } from "../../../src/games/tim3/data/lev";
import { Editor, createPart } from "../../../src/games/tim3/engine/editor";
import { DEFAULT_LAB, Tim3Session, labLevel, puzzleList } from "../../../src/games/tim3/engine/session";
import { BIN_CLIP, BIN_LEFT, BIN_RIGHT, GOALBAR, PLAYFIELD, RenderAssets, inRect } from "../../../src/games/tim3/render";
import { PlayScreen, TOUCH_LIFT, type PlayEvent } from "../../../src/games/tim3/ui/play";
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

  it("TLEV17 au doigt : le tremplin se pose au ras du sol, le doigt sur la barre du but (pièce 40 px au-dessus)", () => {
    // Glisser depuis le bac puis lâcher.
    const s = puzzle("TLEV17");
    const { screen, events } = make(s);
    const slot = screen.bin.slots.find((k) => k.type === 39)!;
    screen.pointerDown(...center(slot), true);
    const p = s.editor.held!;
    // Pièce en (71, 333) de l'aire, tenue par son centre : le doigt est sous l'aire, sur la barre du but.
    const fx = PLAYFIELD.x + 71 + s.editor.grabX;
    const fy = PLAYFIELD.y + 333 + s.editor.grabY + TOUCH_LIFT;
    expect(inRect(GOALBAR, fx, fy)).toBe(true);
    screen.pointerMove(fx, fy - 20, true);
    screen.pointerMove(fx, fy, true);
    expect(screen.cursor()).toBe("grabbing");
    screen.pointerUp(fx, fy);
    expect(events).toContainEqual({ type: "sound", name: "drop" });
    expect(s.editor.held).toBeNull();
    expect([p.px, p.py]).toEqual([71, 333]);

    // Prise d'un appui puis pose d'un second appui sur la barre du but : la barre ne s'ouvre pas, la pièce se pose.
    const s2 = puzzle("TLEV17");
    const two = make(s2);
    const slot2 = two.screen.bin.slots.find((k) => k.type === 39)!;
    two.screen.pointerDown(...center(slot2), true);
    two.screen.pointerUp(...center(slot2));
    const p2 = s2.editor.held!;
    two.screen.pointerDown(fx, fy, true);
    two.screen.pointerUp(fx, fy);
    expect(two.events.some((e) => e.type === "goal")).toBe(false);
    expect(s2.editor.held).toBeNull();
    expect([p2.px, p2.py]).toEqual([71, 333]);
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
