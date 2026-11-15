import { describe, expect, it, vi } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { readLev } from "../../../src/games/tim3/data/lev";
import { interfaceText, parseIdTable, parseLines } from "../../../src/games/tim3/data/text";
import { Duel, type DuelSettings } from "../../../src/games/tim3/engine/duel";
import { Tim3Session, duelPuzzleList } from "../../../src/games/tim3/engine/session";
import { DUEL_BOARD, DUEL_GOAL_WIDTH, GOALBAR, H2H, RenderAssets, Surface, drawDuelBoard, drawGoalBar, layoutItf, mapColor } from "../../../src/games/tim3/render";
import { HEDTOHED, duelSetupWindow, DUEL_NAME_MISSING } from "../../../src/games/tim3/ui/duel-window";
import { ItfWindow, type ItfInput } from "../../../src/games/tim3/ui/itf-window";
import { PlayScreen, type PlayEvent, type ToolbarButton } from "../../../src/games/tim3/ui/play";
import { TOOLBAR_NAMES } from "../../../src/games/tim3/ui/toolbar";
import { frenchIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";

describe.skipIf(!original.has)("deux joueurs : fenêtres et écran (HEDTOHED.ITF, H2H.ITF)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const lines = parseLines(index.get("INTRFACE.RES"));
  const text = (id: number) => interfaceText(lines, id);
  const descriptions = new Map(parseIdTable(index.get("DESCRIPT.RES")).map((e) => [e.id, e.text.replace(/^[@!&%$*]+/, "")]));
  const settings = (): DuelSettings => ({ games: 3, times: [45_000, 45_000], names: [text(2100), text(2101)] });

  const setup = (s = settings()) => {
    const calls = { message: vi.fn(), start: vi.fn(), cancel: vi.fn() };
    const w = duelSetupWindow(readItf(index.get("HEDTOHED.ITF")), { settings: s, text, ...calls });
    return { s, calls, w, m: new ItfWindow(assets, w.itf, w.options, descriptions) };
  };

  it("réglages : noms par défaut du jeu, chiffres des parties et des durées ; flèches bornées ; noms des contrôles", () => {
    const { s, w, m } = setup();
    expect(s.names).toEqual(["Joueur 1", "Joueur 2"]);
    const frames = () => w.options.state!.frames!;
    expect([frames()[HEDTOHED.games], frames()[HEDTOHED.p1Tens], frames()[HEDTOHED.p1Seconds]]).toEqual([3, 4, 5]);
    expect(w.options.choose(HEDTOHED.gamesUp)).toBe(true);
    expect(frames()[HEDTOHED.games]).toBe(5);
    for (let i = 0; i < 20; i++) w.options.choose(HEDTOHED.p2Down);
    expect([s.times[1], frames()[HEDTOHED.p2Tens], frames()[HEDTOHED.p2Seconds]]).toEqual([10_000, 1, 0]);
    expect(m.status()).toBe("Parties : 5. Durée d'un tour : 45 secondes pour le joueur 1, 10 secondes pour le joueur 2.");
    const names = m.controls().map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Nom du joueur 1", "Nom du joueur 2", "Durée du tour du joueur 2 : moins", "Nombre de parties : plus", "OK", "Annuler"]));
    expect(m.options.defaultId).toBe(HEDTOHED.ok);
    expect(m.escape()).toBe(HEDTOHED.cancel);
  });

  it("OK : un nom vide donne 31179 et la fenêtre reste ; deux noms lancent le match ; Annuler", () => {
    const { w, calls } = setup();
    const inputs = w.options.input as readonly ItfInput[];
    inputs[1]!.input("   ");
    expect(w.options.choose(HEDTOHED.ok)).toBe(true);
    expect(calls.message).toHaveBeenCalledWith("Vous devez choisir un nom.");
    expect(text(DUEL_NAME_MISSING)).toBe("Vous devez choisir un nom.");
    inputs[0]!.input("Anastasia la grande");
    inputs[1]!.input("Bob");
    expect(w.options.state!.texts![HEDTOHED.p1Name]).toBe("Anastasia ");
    expect(w.options.choose(HEDTOHED.ok)).toBe(false);
    expect(calls.start).toHaveBeenCalledWith({ games: 3, times: [45_000, 45_000], names: ["Anastasia ", "Bob"] });
    expect(setup().w.options.choose(HEDTOHED.cancel)).toBe(false);
  });

  it("tableau : joueur du tour, noms (15 / 7), manches, temps restant ; dessin à droite de la barre du but", () => {
    const itf = readItf(index.get("H2H.ITF"));
    const layout = layoutItf(assets, itf, { dx: DUEL_BOARD.x, dy: DUEL_BOARD.y });
    expect(layout.frame).toEqual({ x: 294, y: 414, width: 346, height: 64 });
    const draw = (turn: 0 | 1, remaining: number) => {
      const s = new Surface(640, 480);
      drawDuelBoard(s, assets, itf, { names: ["Ana", "Bob"], turn, wins: [1, 0], remaining });
      return s.pixels;
    };
    const a = draw(0, 37_400);
    const b = draw(1, 37_400);
    const c = draw(0, 12_000);
    const diff = (x: Uint8Array, y: Uint8Array) => x.some((v, i) => v !== y[i]);
    expect(diff(a, b)).toBe(true);
    expect(diff(a, c)).toBe(true);
    expect(a.slice(0, 640 * 414).every((v) => v === 0)).toBe(true);
    expect(H2H.board).toBe(37002);
  });

  it("tableau : le nom qui attend (couleur 7, gris sur gris dans l'original) reçoit un relief ; celui du tour reste plat", () => {
    const itf = readItf(index.get("H2H.ITF"));
    const names = [H2H.p1Name, H2H.p2Name].map((id) => itf.controls.find((c) => c.id === id)!);
    const colors = (turn: 0 | 1, who: 0 | 1) => {
      const s = new Surface(640, 480);
      drawDuelBoard(s, assets, itf, { names: ["Ana", "Bob"], turn, wins: [1, 0], remaining: 37_400 });
      const c = names[who]!;
      const seen = new Set<number>();
      for (let y = 0; y < c.height + 2; y++) for (let x = 0; x < c.width; x++) seen.add(s.pixels[(DUEL_BOARD.y + c.y + y) * 640 + DUEL_BOARD.x + c.x + x]!);
      return seen;
    };
    // Joueur 2 attend : sa moitié est grise (7), son nom est en 7 avec une ombre (8) et un reflet (15).
    const waiting = colors(0, 1);
    expect(waiting.has(mapColor(8))).toBe(true);
    expect(waiting.has(mapColor(15))).toBe(true);
    // Le nom du tour garde son dessin plat : sans nom, seule la couleur 15 de ses lettres disparaît, pas d'ombre ajoutée.
    const bare = new Surface(640, 480);
    drawDuelBoard(bare, assets, itf, { names: ["", "Bob"], turn: 0, wins: [1, 0], remaining: 37_400 });
    const named = new Surface(640, 480);
    drawDuelBoard(named, assets, itf, { names: ["Ana", "Bob"], turn: 0, wins: [1, 0], remaining: 37_400 });
    const added = new Set<number>();
    named.pixels.forEach((v, i) => v !== bare.pixels[i] && added.add(v));
    expect([...added]).toEqual([mapColor(15)]);
    // Symétrique : joueur 1 attend.
    expect(colors(1, 0).has(mapColor(8))).toBe(true);
  });

  it("barre du but réduite : un but long est coupé aux lignes entières (comme l'original), sans passer sur le reflet du bord", () => {
    const goal = "Allumez la lampe, faites rouler la balle sur le tapis puis laissez-la tomber dans le seau avant que le chat ne s'en mêle, sans toucher au ventilateur.";
    const draw = (text?: string) => {
      const s = new Surface(640, 480);
      drawGoalBar(s, assets, text, DUEL_GOAL_WIDTH);
      return s.pixels;
    };
    const bare = draw();
    const full = draw(goal);
    let minX = 640;
    let maxX = -1;
    let maxY = -1;
    full.forEach((v, i) => {
      if (v === bare[i]) return;
      minX = Math.min(minX, i % 640);
      maxX = Math.max(maxX, i % 640);
      maxY = Math.max(maxY, Math.floor(i / 640));
    });
    expect(maxX).toBeGreaterThan(minX);
    // Seulement deux lignes de 21 pixels dans le cadre (y = 9 … 51), pas une de plus ; le texte s'arrête avant le bord recollé (40 px).
    expect(maxY).toBeLessThan(GOALBAR.y + 9 + 2 * 21);
    expect(maxX).toBeLessThan(DUEL_GOAL_WIDTH - 40);
  });

  it("écran de jeu : barre des deux joueurs, « Terminer le Tour », bac fermé et pièce interdite refusés", () => {
    const ref = duelPuzzleList().find((p) => p.name === "HH23")!;
    const duel = new Duel({ games: 3, times: [45_000, 45_000], names: ["Ana", "Bob"] });
    const session = new Tim3Session(realTypes(), readLev(index.get("HH23.LEV")), { puzzle: ref, guard: duel.round });
    const wt = readItf(index.get("WTOOLBAR.ITF"));
    const toolbar: ToolbarButton[] = TOOLBAR_NAMES.flatMap((name) => {
      const c = wt.controls.find((k) => k.name === name);
      return c ? [{ name, id: c.id, x: c.x, y: c.y - 66, width: c.width, height: c.height }] : [];
    });
    const events: PlayEvent[] = [];
    const screen = new PlayScreen(session, assets, session.level, { goal: "But", hints: [], parts: [] }, toolbar, (e) => events.push(e));
    screen.duel = duel;
    duel.prepareTurn();
    duel.startTurn();
    expect(screen.toolbarAt(530, 10)).toMatchObject({ name: "TB_END_TURN", disabled: false });
    expect(screen.toolbarAt(90, 10)).toMatchObject({ name: "TB_GOTO_H2H", pressed: true });
    expect(screen.goalRect.width).toBe(294);
    screen.render();
    // Une pièce du bac prise et posée : le bac se ferme.
    const slot = screen.bin.slots.find((x) => x.type === 37)!;
    screen.pointerDown(slot.x + 4, slot.y + 4, false);
    expect(session.editor.held?.type).toBe(37);
    screen.pointerMove(300, 300, false);
    screen.pointerUp(300, 300);
    expect(session.editor.held).toBeNull();
    const other = screen.bin.slots[0]!;
    events.length = 0;
    screen.pointerDown(other.x + 4, other.y + 4, false);
    expect(events).toEqual([{ type: "duelRefused", reason: "bin" }]);
    expect(session.editor.held).toBeNull();
    // Tour de Bob : une autre pièce du bac ; tour d'Ana : elle retourne sa pièce, celle de Bob lui est refusée.
    duel.switchTurn();
    duel.startTurn();
    const slot2 = screen.bin.slots.find((x) => x.type !== 37 && x.type !== 10 && x.type !== 8)!;
    screen.pointerDown(slot2.x + 4, slot2.y + 4, false);
    screen.pointerMove(150, 150, false);
    screen.pointerUp(150, 150);
    expect(session.editor.held).toBeNull();
    duel.switchTurn();
    duel.startTurn();
    const mine = [...session.world.staticThenMobile()].find((p) => p.type === 37)!;
    const theirs = [...session.world.staticThenMobile()].find((p) => p.type === slot2.type)!;
    expect(session.editor.flip(mine, "x") || session.editor.resize(mine, 1) || (session.editor.grab(mine, mine.px, mine.py), session.editor.returnHeld(), true)).toBe(true);
    expect(session.editor.mayTouch(theirs)).toBe(false);
    const r = session.editor.partRect(theirs);
    events.length = 0;
    screen.pointerMove(r.x + (r.w >> 1), r.y + 36 + (r.h >> 1), false);
    expect(screen.focus).toBeNull();
    screen.pointerDown(r.x + (r.w >> 1), r.y + 36 + (r.h >> 1), false);
    expect(events).toEqual([{ type: "duelRefused", reason: "moved" }]);
    expect(session.editor.held).toBeNull();
  });
});
