import { describe, expect, it, vi } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { readSolveRes } from "../../../src/games/tim3/data/solutions";
import { interfaceText, parseLines } from "../../../src/games/tim3/data/text";
import { LAB_TAB_COUNT } from "../../../src/games/tim3/engine/bin-tabs";
import { Editor, Zone } from "../../../src/games/tim3/engine/editor";
import { OFF_BOTTOM, OFF_SCREEN, OFF_TOP } from "../../../src/games/tim3/engine/lab-puzzle";
import type { Part } from "../../../src/games/tim3/engine/part";
import { DEFAULT_LAB, Tim3Session, homePuzzleRef, labLevel, puzzleList } from "../../../src/games/tim3/engine/session";
import { BIN_TAB_BUTTON, GOALBAR, PLAYFIELD, RenderAssets, binTabCell, hintRect, imageCount, stateImage } from "../../../src/games/tim3/render";
import { PuzzleCardScreen } from "../../../src/games/tim3/ui/chooser";
import { HINT, hintEditorWindow, HINT_TEXT, labHintVoice, type HintEditorChoice } from "../../../src/games/tim3/ui/hint-window";
import { ItfWindow, inputsOf } from "../../../src/games/tim3/ui/itf-window";
import { HTLOCK, lockWindow } from "../../../src/games/tim3/ui/lock-window";
import { PlayScreen, type PlayEvent } from "../../../src/games/tim3/ui/play";
import { DEFAULT_DELAY, SOLVE, SOLVE_TEXT, solveWindow, type SolveValue } from "../../../src/games/tim3/ui/solve-window";
import { frenchIndex, original } from "../data/real";
import { realTypes } from "../engine/helpers";

describe.skipIf(!original.has)("outils du Labo : fenêtres et écran", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const lines = parseLines(index.get("INTRFACE.RES"));
  const text = (id: number) => interfaceText(lines, id);
  const itf = (name: string) => readItf(index.get(name));

  describe("HTLOCK (420810)", () => {
    it("Verrouiller (défaut), Déverrouiller, Annuler (Échap)", () => {
      const choose = vi.fn();
      const w = lockWindow(assets, itf("HTLOCK.ITF"), { choose });
      expect([w.options.defaultId, w.options.cancelId]).toEqual([HTLOCK.lock, HTLOCK.cancel]);
      w.options.choose(HTLOCK.lock);
      w.options.choose(HTLOCK.unlock);
      w.options.choose(HTLOCK.cancel);
      expect(choose.mock.calls).toEqual([[true], [false]]);
      const m = new ItfWindow(assets, w.itf, w.options);
      expect(m.item(HTLOCK.lock)?.enabled).toBe(true);
      expect(text(31132)).toMatch(/verrouillés/);
    });
  });

  describe("éditeur d'indices (HINT.ITF au Labo, 41f3dc)", () => {
    const editor = (o: { text: string | null; count: number }) => {
      const calls = { save: [] as string[], message: [] as string[], choose: [] as HintEditorChoice[] };
      const w = hintEditorWindow(assets, itf("HINT.ITF"), {
        ...o,
        save: (t) => calls.save.push(t),
        message: (t) => calls.message.push(t),
        choose: (c) => calls.choose.push(c),
      });
      return { w, calls, m: new ItfWindow(assets, w.itf, w.options) };
    };

    it("depuis la barre, sans indice : la consigne (31259), Nouveau par défaut, Montrer caché, Échap = Cacher", () => {
      const { w, m } = editor({ text: null, count: 0 });
      expect(w.options.state?.texts?.[HINT.text]).toBe(text(HINT_TEXT.create));
      expect(w.options.state?.hidden).toEqual(expect.arrayContaining([HINT.done, HINT.view]));
      expect([w.options.defaultId, m.escape()]).toEqual([HINT.create, HINT.editDone]);
      expect(inputsOf(w.options)).toEqual([]);
    });

    it("avec des indices : la consigne de Montrer (31264) s'ajoute ; Nouveau, Montrer, Cacher ferment avec leur choix", () => {
      const { w, calls } = editor({ text: null, count: 2 });
      expect(w.options.state?.texts?.[HINT.text]).toBe(`${text(HINT_TEXT.create)} ${text(HINT_TEXT.view)}`);
      expect(w.options.defaultId).toBe(HINT.view);
      expect(w.options.choose(HINT.create)).toBe(false);
      expect(w.options.choose(HINT.view)).toBe(false);
      expect(w.options.choose(HINT.editDone)).toBe(false);
      expect(calls.choose).toEqual(["create", "show", "hide"]);
      expect(calls.save).toEqual([]);
    });

    it("8 indices : Nouveau refusé par 31265, la fenêtre reste", () => {
      const { w, calls } = editor({ text: null, count: 8 });
      expect(w.options.choose(HINT.create)).toBe(true);
      expect(calls.message).toEqual([text(HINT_TEXT.full)]);
      expect(calls.choose).toEqual([]);
    });

    it("voix (41f62e) : une main du Labo a celle de l'indice du même emplacement du dernier puzzle joué ; la barre, aucune", () => {
      const last = puzzleList()[17]!;
      expect(labHintVoice(0, last)).toEqual({ archive: "hint1", index: last.index });
      expect(labHintVoice(6, last)).toEqual({ archive: "hint7", index: last.index });
      // Pas de HINT8.VOC, pas de voix après un puzzle maison ([0x481918] = 6) ni sans puzzle joué.
      expect([labHintVoice(7, last), labHintVoice(0, homePuzzleRef(3)), labHintVoice(0, null)]).toEqual([null, null, null]);
      // Le professeur rejoue la voix (41f926) seulement si la fenêtre en a une.
      const replay = vi.fn();
      const voiced = hintEditorWindow(assets, itf("HINT.ITF"), { text: "Un indice", count: 1, save: () => undefined, message: () => undefined, choose: () => undefined, replay });
      expect(voiced.options.zones?.().map((z) => z.id)).toEqual([HINT.professor]);
      expect(voiced.options.choose(HINT.professor)).toBe(true);
      expect(replay).toHaveBeenCalledTimes(1);
      const { w } = editor({ text: null, count: 0 });
      expect(w.options.zones).toBeUndefined();
      expect(w.options.choose(HINT.professor)).toBe(true);
    });

    it("écrire un indice : un EDIT blanc sur bleu ; vide, 31263 ; sinon il est gardé ; Échap le garde aussi", () => {
      const { w, calls, m } = editor({ text: "", count: 1 });
      const input = inputsOf(w.options)[0]!;
      expect(input).toMatchObject({ id: HINT.text, maxLength: 254, edit: { multiline: true, background: "#0000ef" } });
      expect(w.options.cancelId).toBeUndefined();
      expect(m.item(HINT.text)).toBeNull();
      expect(w.options.choose(HINT.view)).toBe(true);
      expect(calls.message).toEqual([text(HINT_TEXT.empty)]);
      input.input("Utilisez la poulie.");
      expect(w.options.choose(HINT.view)).toBe(false);
      expect([calls.save, calls.choose]).toEqual([["Utilisez la poulie."], ["show"]]);
      const other = editor({ text: "Ancien", count: 1 });
      inputsOf(other.w.options)[0]!.input("Nouveau texte");
      other.w.closed();
      expect([other.calls.save, other.calls.choose]).toEqual([["Nouveau texte"], ["done"]]);
    });
  });

  describe("conditions de réussite (SOLVE.ITF, 426d1c)", () => {
    const solveParts = readSolveRes(index.get("SOLVE.RES"));
    const anm = assets.partAnm(4)!;
    const first = (n: number) => (n === -1 ? imageCount(anm) : Math.max(0, stateImage(anm, n)));
    const make = (o: { condition?: SolveValue | null; others?: number; advanced?: boolean } = {}) => {
      const calls = { set: [] as (SolveValue | null)[], message: [] as string[], delay: [] as number[], position: 0 };
      const w = solveWindow(assets, itf("SOLVE.ITF"), {
        name: "Ballon",
        solve: solveParts[4]!,
        frame: 0,
        first,
        drawPart: () => undefined,
        condition: o.condition ?? null,
        others: o.others ?? 0,
        delay: 0,
        advanced: o.advanced ?? false,
        set: (v) => {
          calls.set.push(v);
          return true;
        },
        setDelay: (d) => calls.delay.push(d),
        setAdvanced: () => undefined,
        message: (t) => calls.message.push(t),
        drawPosition: () => calls.position++,
        help: () => undefined,
      });
      return { w, calls };
    };
    const rect = (r: { x: number; y: number; width: number; height: number }) => ({ rectX: r.x, rectY: r.y, rectWidth: r.width, rectHeight: r.height });

    it("Par le Haut, Par le Bas, De l'Écran, Pas dans la Solution : les rectangles de 427419", () => {
      const { w, calls } = make();
      for (const id of [SOLVE.top, SOLVE.bottom, SOLVE.offscreen, SOLVE.notSolve]) expect(w.options.choose(id)).toBe(true);
      expect(calls.set).toEqual([
        { state1: 0, state2: 0, count: 0, ...rect(OFF_TOP) },
        { state1: 0, state2: 0, count: 0, ...rect(OFF_BOTTOM) },
        { state1: 0, state2: 0, count: 0, ...rect(OFF_SCREEN) },
        null,
      ]);
      expect(w.options.state?.frames?.[SOLVE.notSolve]).toBe(7);
      expect(w.options.checked?.(SOLVE.top)).toBe(false);
    });

    it("état du ballon : « Intact » puis « Éclaté », plages d'images de SOLVE.RES (celles des puzzles du jeu)", () => {
      const { w, calls } = make();
      expect(w.options.state?.hidden).not.toContain(SOLVE.state);
      w.options.choose(SOLVE.state);
      w.options.choose(SOLVE.stateDown);
      expect(calls.set.map((v) => v && [v.state1, v.state2])).toEqual([
        [0, 0],
        [1, 5],
      ]);
      expect(w.options.checked?.(SOLVE.state)).toBe(true);
      // Les puzzles du jeu visent « éclaté » par la plage 1 à 5 (`solutions.md`).
      expect(solveParts[4]!.states.map((s) => s.label)).toHaveLength(2);
    });

    it("pièce sans état (boule de bowling) : pas de voyant d'état", () => {
      const w = solveWindow(assets, itf("SOLVE.ITF"), { ...make().w.options, name: "Boule", solve: solveParts[0]!, frame: 0, first, drawPart: () => undefined, condition: null, others: 0, delay: 0, advanced: false, set: () => true, setDelay: () => undefined, setAdvanced: () => undefined, message: () => undefined, drawPosition: () => undefined, help: () => undefined });
      expect(w.options.state?.hidden).toEqual(expect.arrayContaining([SOLVE.state, SOLVE.stateUp, SOLVE.stateDown, SOLVE.stateText]));
    });

    it("Avancé : la rangée du bas et ses EDIT ; Nombre sans condition (31090), Retarde sans condition (31088), Position ferme", () => {
      const { w, calls } = make();
      expect(w.options.state?.hidden).toEqual(expect.arrayContaining([SOLVE.countSel, SOLVE.frameSel, SOLVE.positionSel]));
      expect(inputsOf(w.options)).toEqual([]);
      w.options.choose(SOLVE.advanced);
      expect(w.options.state?.texts?.[SOLVE.advanced]).toBe(text(SOLVE_TEXT.normal));
      expect(w.options.state?.hidden).not.toContain(SOLVE.countSel);
      expect(inputsOf(w.options).map((i) => [i.id, i.maxLength, i.numeric])).toEqual([
        [SOLVE.countData, 2, true],
        [SOLVE.frameData, 4, true],
      ]);
      w.options.choose(SOLVE.countSel);
      w.options.choose(SOLVE.frameSel);
      expect(calls.message).toEqual([text(SOLVE_TEXT.needCondition), text(SOLVE_TEXT.noCondition)]);
      w.options.choose(SOLVE.top);
      w.options.choose(SOLVE.countSel);
      w.options.choose(SOLVE.frameSel);
      expect(calls.set.at(-1)).toMatchObject({ count: 2, rectY: OFF_TOP.y });
      expect(calls.delay).toEqual([DEFAULT_DELAY]);
      inputsOf(w.options)[0]!.input("4");
      expect(calls.set.at(-1)).toMatchObject({ count: 4 });
      expect(w.options.choose(SOLVE.positionSel)).toBe(false);
      expect(calls.position).toBe(1);
    });

    it("8 conditions déjà : une nouvelle est refusée (31089)", () => {
      const { w, calls } = make({ others: 8 });
      w.options.choose(SOLVE.top);
      expect([calls.set, calls.message]).toEqual([[], [text(SOLVE_TEXT.full)]]);
      expect(w.value()).toBeNull();
    });
  });

  describe("écran du Labo", () => {
    const make = () => {
      const s = new Tim3Session(realTypes(), labLevel(DEFAULT_LAB), { lab: DEFAULT_LAB });
      s.editor.stockLab(Editor.labTypes(s.world, 0));
      const events: PlayEvent[] = [];
      const screen = new PlayScreen(s, assets, s.level, { goal: "consigne", hints: [], parts: [] }, [], (e) => events.push(e));
      return { s, screen, events };
    };
    const place = (s: Tim3Session, type: number, x: number, y: number): Part => {
      const p = s.editor.takeNew(type);
      s.editor.hover(x, y);
      expect(s.editor.click(x, y)).toBe("placed");
      return p;
    };
    const tap = (screen: PlayScreen, x: number, y: number) => {
      screen.pointerDown(x, y, false);
      screen.pointerUp(x, y);
    };
    const handle = (s: Tim3Session, p: Part, zone: number) => s.editor.handles(p).find((h) => h.zone === zone)!;

    it("décor : poignées de plan (42ead8, 42eb25) ; une pièce retournée le signale (sa condition suit, 429d84)", () => {
      const { s, screen, events } = make();
      const forest = place(s, 150, 200, 200);
      const falls = place(s, 151, 230, 210);
      expect([...s.world.statics]).toEqual([falls, forest]);
      screen.focus = forest;
      const front = handle(s, forest, Zone.Front);
      screen.pointerMove(PLAYFIELD.x + front.x + 10, PLAYFIELD.y + front.y + 10, false);
      expect(screen.cursor()).toBe("pointer");
      tap(screen, PLAYFIELD.x + front.x + 10, PLAYFIELD.y + front.y + 10);
      expect([...s.world.statics]).toEqual([forest, falls]);
      screen.focus = forest;
      const back = handle(s, forest, Zone.Back);
      tap(screen, PLAYFIELD.x + back.x + 10, PLAYFIELD.y + back.y + 10);
      expect([...s.world.statics]).toEqual([falls, forest]);
      const cannon = place(s, 18, 400, 100);
      screen.focus = cannon;
      const turn = handle(s, cannon, Zone.Turn);
      events.length = 0;
      tap(screen, PLAYFIELD.x + turn.x + 10, PLAYFIELD.y + turn.y + 10);
      expect(events).toContainEqual({ type: "flipped", part: cannon });
    });

    it("cadenas d'une pièce et poignée « solution » ; la barre du but s'écrit ; le but du puzzle remplace la consigne", () => {
      const { s, screen, events } = make();
      const balloon = place(s, 4, 200, 200);
      const lock = handle(s, balloon, Zone.Lock);
      screen.focus = balloon;
      tap(screen, PLAYFIELD.x + lock.x + 10, PLAYFIELD.y + lock.y + 10);
      expect(events).toContainEqual({ type: "locked", locked: true });
      expect(balloon.flags14 & 0x40).toBe(0x40);
      events.length = 0;
      s.editor.toggleLock(balloon);
      const sol = handle(s, balloon, Zone.Solution);
      screen.focus = balloon;
      tap(screen, PLAYFIELD.x + sol.x + 18, PLAYFIELD.y + sol.y + 20);
      expect(events).toEqual([{ type: "solution", part: balloon }]);
      events.length = 0;
      tap(screen, GOALBAR.x + 100, GOALBAR.y + 20);
      expect(events).toEqual([{ type: "goalEdit" }]);
      s.labPuzzle!.goal = "Mon but";
      expect(() => screen.render()).not.toThrow();
    });

    it("onglets du bac : le bouton ouvre le choix, une case change d'onglet ; Échap le ferme", () => {
      const { screen, events } = make();
      expect(screen.tabAt(BIN_TAB_BUTTON.x + 5, BIN_TAB_BUTTON.y + 5)).toEqual({ tab: 0, button: true });
      tap(screen, BIN_TAB_BUTTON.x + 5, BIN_TAB_BUTTON.y + 5);
      expect([screen.tabPicker, screen.bin.total]).toEqual([true, 0]);
      const cell = binTabCell(LAB_TAB_COUNT - 1);
      expect(cell.y + cell.height).toBeLessThanOrEqual(81 + 36 + 247);
      tap(screen, cell.x + 5, cell.y + 5);
      expect(events).toEqual([{ type: "tab", tab: 13 }]);
      expect([screen.tabPicker, screen.binTab]).toEqual([false, 13]);
      tap(screen, BIN_TAB_BUTTON.x + 5, BIN_TAB_BUTTON.y + 5);
      expect(screen.key("Escape")).toBe(true);
      expect(screen.tabPicker).toBe(false);
    });

    it("nouvelle main : elle suit le pointeur et se pose d'un appui, gardée dans l'aire ; Échap l'abandonne", () => {
      const { screen, events } = make();
      screen.placing = "hint";
      expect(screen.cursor()).toBe("default");
      tap(screen, PLAYFIELD.x + 2, PLAYFIELD.y + 2);
      expect(events).toEqual([{ type: "hintPlaced", x: 0, y: 0 }]);
      expect(screen.placing).toBeNull();
      events.length = 0;
      screen.placing = "hint";
      expect(screen.key("Escape")).toBe(true);
      expect(events).toEqual([{ type: "placeCancel" }]);
    });

    it("mains au Labo : poignées effacer, tourner, modifier (41ffd0) ; la main se déplace en la glissant", () => {
      const { s, screen, events } = make();
      const slot = s.labPuzzle!.addHint(100, 100, "Indice");
      screen.hintsShown = true;
      const r = hintRect(100, 100);
      screen.pointerMove(r.x + 5, r.y + 5, false);
      tap(screen, r.x - 20, r.y - 20);
      tap(screen, r.x - 20, r.y + r.height + 10);
      tap(screen, r.x + r.width + 10, r.y + r.height + 10);
      expect(events).toEqual([{ type: "hintDelete", slot }, { type: "hintChanged" }, { type: "hintEdit", slot }]);
      expect(s.labPuzzle!.hints[slot]!.flip).toBe(1);
      events.length = 0;
      screen.pointerDown(r.x + 5, r.y + 5, false);
      screen.pointerMove(r.x + 45, r.y + 25, false);
      screen.pointerUp(r.x + 45, r.y + 25);
      expect([s.labPuzzle!.hints[slot]!.x, s.labPuzzle!.hints[slot]!.y]).toEqual([140, 120]);
      expect(events).toEqual([{ type: "hintChanged" }]);
      // Au Labo, un appui sur la main ne l'ouvre pas en lecture (c'est la poignée « modifier »).
      events.length = 0;
      tap(screen, r.x + 50, r.y + 30);
      expect(events).toEqual([]);
    });

    it("« Position » de SOLVE.ITF : un rectangle tracé dans l'aire, rendu en coordonnées de l'aire", () => {
      const { screen, events } = make();
      screen.placing = "rect";
      screen.pointerDown(PLAYFIELD.x + 200, PLAYFIELD.y + 150, false);
      screen.pointerMove(PLAYFIELD.x + 120, PLAYFIELD.y + 230, false);
      expect(() => screen.render()).not.toThrow();
      screen.pointerUp(PLAYFIELD.x + 120, PLAYFIELD.y + 230);
      expect(events).toEqual([{ type: "rectDrawn", rect: { x: 120, y: 150, width: 80, height: 80 } }]);
      expect(screen.placing).toBeNull();
    });
  });

  it("fiche d'un puzzle maison : catégorie « Puzzles Personnels », icône PD_HOME, pas de numéro (425fee)", () => {
    const card = new PuzzleCardScreen(assets, itf("PUZZDISP.ITF"), homePuzzleRef(4), "La fusée");
    expect(card.categoryText()).toBe("Puzzles Personnels");
    expect(card.numberText()).toBe("");
    expect(card.options.state?.hidden).not.toContain(34011);
  });
});
