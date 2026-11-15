import { describe, expect, it } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { readLev } from "../../../src/games/tim3/data/lev";
import { Tim3Session, labLevel, DEFAULT_LAB, puzzleList } from "../../../src/games/tim3/engine/session";
import { solutionSession } from "../../../src/games/tim3/engine/solution";
import { RenderAssets, SCREEN_WIDTH, drawToolbar, Surface } from "../../../src/games/tim3/render";
import { PlayScreen, type PlayEvent, type ToolbarButton } from "../../../src/games/tim3/ui/play";
import { TOOLBAR_NAMES } from "../../../src/games/tim3/ui/toolbar";
import { frenchIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";

describe.skipIf(!original.has)("écran de jeu : barre d'outils", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const itf = readItf(index.get("WTOOLBAR.ITF"));
  const toolbar: ToolbarButton[] = TOOLBAR_NAMES.flatMap((name) => {
    const c = itf.controls.find((k) => k.name === name);
    return c ? [{ name, id: c.id, x: c.x, y: c.y - 66, width: c.width, height: c.height }] : [];
  });
  const level = readLev(index.get("TLEV1.LEV"));
  const make = (session: Tim3Session) => {
    const events: PlayEvent[] = [];
    const screen = new PlayScreen(session, assets, level, { goal: "", hints: [], parts: [] }, toolbar, (e) => events.push(e));
    return { screen, events };
  };
  const puzzle = () => new Tim3Session(realTypes(), level, { puzzle: puzzleList()[0] });
  const lab = () => new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });

  it("les boutons des seize noms existent dans WTOOLBAR.ITF", () => {
    expect(toolbar.map((b) => b.name)).toEqual([...TOOLBAR_NAMES]);
  });

  it("Jeu : l'emplacement du cadenas (x = 500) est vide, l'ampoule (x = 540) n'apparaît qu'une fois le puzzle résolu", () => {
    const { screen } = make(puzzle());
    expect(screen.toolbarAt(510, 10)).toBeNull();
    expect(screen.toolbarAt(550, 10)).toBeNull();
    screen.solved = true;
    expect(screen.toolbarAt(550, 10)?.name).toBe("TB_SOLUTION");
    expect(screen.toolbarAt(10, 10)).toMatchObject({ name: "TB_GOTO_PUZ", pressed: true, disabled: false });
    expect(screen.toolbarAt(90, 10)).toMatchObject({ name: "TB_GOTO_H2H", disabled: true });
  });

  it("Labo : cadenas et levier d'essai grisés, clé enfoncée", () => {
    const { screen } = make(lab());
    screen.solved = true;
    expect(screen.toolbarAt(510, 10)).toMatchObject({ name: "TB_LOCKED", disabled: true });
    expect(screen.toolbarAt(550, 10)).toMatchObject({ name: "TB_TEST", disabled: true });
    expect(screen.toolbarAt(50, 10)).toMatchObject({ name: "TB_GOTO_WORK", pressed: true });
  });

  it("un clic sur un bouton le transmet ; un appui long au doigt donne l'infobulle sans cliquer", () => {
    const { screen, events } = make(puzzle());
    screen.pointerDown(390, 10, false);
    screen.pointerUp(390, 10);
    expect(events).toEqual([{ type: "toolbar", name: "TB_SWEEP" }]);
    events.length = 0;
    screen.pointerDown(90, 10, true);
    screen.longPress(90, 10);
    screen.pointerUp(90, 10);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "toolbarTip", button: { name: "TB_GOTO_H2H", disabled: true } });
  });

  it("dessin : bouton enfoncé et bouton grisé changent l'image, un bouton caché laisse l'emplacement vide", () => {
    const at = (s: Surface, x: number) => Array.from({ length: 34 }, (_, y) => s.pixels.subarray(y * SCREEN_WIDTH + x, y * SCREEN_WIDTH + x + 40).join(",")).join("|");
    const draw = (views: Parameters<typeof drawToolbar>[3]) => {
      const s = new Surface(SCREEN_WIDTH, 34);
      drawToolbar(s, assets, false, views);
      return s;
    };
    const plain = draw([{ name: "TB_GOTO_H2H" }, { name: "TB_GOTO_PUZ" }]);
    const styled = draw([{ name: "TB_GOTO_H2H", disabled: true }, { name: "TB_GOTO_PUZ", pressed: true }]);
    expect(at(styled, 80)).not.toBe(at(plain, 80));
    expect(at(styled, 0)).not.toBe(at(plain, 0));
    expect(at(plain, 500)).toBe(at(new Surface(SCREEN_WIDTH, 34), 500));
  });

  it("la balayette en Jeu range au bac les pièces posées, celles de la solution comprises, sans toucher au puzzle", () => {
    const s = solutionSession(realTypes(), level);
    const fixed = [...s.world.staticThenMobile()].filter((p) => !s.editor.isMovable(p)).length;
    expect([...s.world.staticThenMobile()].some((p) => s.editor.isMovable(p))).toBe(true);
    s.editor.clearField();
    const left = [...s.world.staticThenMobile()];
    expect(left.some((p) => s.editor.isMovable(p))).toBe(false);
    expect(left).toHaveLength(fixed);
    expect(s.editor.binParts().length).toBe(puzzle().editor.binParts().length);
  });
});
