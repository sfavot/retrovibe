import { describe, expect, it } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { loadTexts, parseIdTable } from "../../../src/games/tim3/data/text";
import { puzzleList, type PuzzleRef } from "../../../src/games/tim3/engine/session";
import { RenderAssets, Surface } from "../../../src/games/tim3/render";
import { centeredTop, listGeometry, listRowAt } from "../../../src/games/tim3/render/itf-list";
import { ItfWindow, screenOptions, type ItfScreen } from "../../../src/games/tim3/ui/itf-window";
import {
  BIN_OF_CATEGORY,
  BinScreen,
  DOSBIN,
  DOSBOX,
  DOUBLE_CLICK_MS,
  PUZZDISP,
  PuzzleCardScreen,
  PuzzleListScreen,
  currentPuzzle,
} from "../../../src/games/tim3/ui/chooser";
import { frenchIndex, original } from "../data/real";

const puzzles = puzzleList();
const progressOf = (solved: string[], last: string | null) => {
  const set = new Set(solved);
  return { isSolved: (n: string) => set.has(n), last };
};

describe("puzzle en cours (42cbad(−1))", () => {
  it("premier non résolu de la catégorie à partir du dernier joué, en reprenant au début de la catégorie", () => {
    expect(currentPuzzle(puzzles, progressOf([], null)).name).toBe("TLEV1");
    expect(currentPuzzle(puzzles, progressOf([], "ELEV4")).name).toBe("ELEV4");
    expect(currentPuzzle(puzzles, progressOf(["ELEV4", "ELEV5"], "ELEV4")).name).toBe("ELEV6");
    const allButFirst = puzzles.filter((p) => p.category === 1 && p.number > 1).map((p) => p.name);
    expect(currentPuzzle(puzzles, progressOf(allButFirst, "ELEV20")).name).toBe("ELEV1");
  });

  it("catégorie toute résolue : premier non résolu du jeu ; tout résolu : le dernier joué", () => {
    const tutorial = puzzles.filter((p) => p.category === 0).map((p) => p.name);
    expect(currentPuzzle(puzzles, progressOf([...tutorial, "ELEV1"], "TLEV3")).name).toBe("ELEV2");
    expect(currentPuzzle(puzzles, progressOf(puzzles.map((p) => p.name), "MLEV7")).name).toBe("MLEV7");
  });
});

describe("liste à défilement (41bf29)", () => {
  const font = { height: 20 } as never;
  const rect = { x: 72, y: 136, width: 382, height: 206 };

  it("rangées de la hauteur de la police + 2, marge de 8 et reste partagé ; texte à x + 48", () => {
    const g = listGeometry(font, rect);
    expect(g).toEqual({ y: 136 + 8 + 7, rowHeight: 22, visible: 8, textX: 120, textWidth: 72 + 382 - 120 - 8 });
  });

  it("rangée sous le point et première rangée centrée sur la rangée choisie", () => {
    const g = listGeometry(font, rect);
    expect(listRowAt(g, rect, 0, 40, 200, g.y + 1)).toBe(0);
    expect(listRowAt(g, rect, 5, 40, 200, g.y + 22 * 2 + 3)).toBe(7);
    expect(listRowAt(g, rect, 0, 3, 200, g.y + 22 * 4)).toBeNull();
    expect(listRowAt(g, rect, 0, 40, 10, g.y)).toBeNull();
    expect(centeredTop(2, 40, 8)).toBe(0);
    expect(centeredTop(20, 40, 8)).toBe(16);
    expect(centeredTop(39, 40, 8)).toBe(32);
  });
});

describe.skipIf(!original.has)("choix du puzzle sur les données d'origine (DOSBOX, DOSBIN, PUZZDISP)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const texts = loadTexts(index);
  const descriptions = new Map(parseIdTable(index.get("DESCRIPT.RES")).map((e) => [e.id, e.text]));
  const strings = {
    title: "Choisir un puzzle",
    puzzleTitle: (p: PuzzleRef) => texts.levels[p.index]?.title ?? "",
    solved: "résolu",
  };
  const sounds: number[] = [];
  const list = (category: number, current: PuzzleRef | null, solved: string[] = []) =>
    new PuzzleListScreen(assets, readItf(index.get("DOSBOX.ITF")), puzzles, progressOf(solved, null), strings, category, current, (s) => sounds.push(s.id));
  /** Fenêtre ouverte sur un écran, et le résultat qui la ferme (comme l'hôte). */
  const open = <R,>(screen: ItfScreen<R>) => {
    const out: { result: R | null | undefined } = { result: undefined };
    const options = screenOptions(screen, (r) => (out.result = r));
    const m = new ItfWindow(assets, screen.itf, options, descriptions);
    /** Choix d'un contrôle : vrai s'il garde la fenêtre ouverte ; sinon le résultat est rendu. */
    const choose = (id: number) => {
      if (options.choose(id) === true) return true;
      options.onClose!();
      return false;
    };
    return { m, choose, out };
  };
  const rowPoint = (m: ItfWindow, s: PuzzleListScreen, row: number) => {
    const r = m.listRect()!;
    const g = s.view.geometry()!;
    return { x: r.x + 100, y: m.origin.dy + g.y + (row - s.view.top) * g.rowHeight + 2 };
  };

  it("rangées « %2d. Titre » de la catégorie, marque des résolus, rangée choisie = puzzle en cours", () => {
    const s = list(0, puzzles[2]!, ["TLEV1", "TLEV5"]);
    const rows = s.view.rows;
    expect(rows).toHaveLength(40);
    expect(rows[0]).toEqual({ text: ` 1. ${texts.levels[0]!.title}`, solved: true });
    expect(rows[1]!.solved).toBe(false);
    expect(rows[4]!.solved).toBe(true);
    expect(s.view.selected).toBe(2);
    expect(s.options.list!.label(0)).toBe(` 1. ${texts.levels[0]!.title}, résolu`);
    expect(list(3, null, ["HLEV1"]).view.selected).toBe(1);
  });

  it("titre de la catégorie (31048 + catégorie) ; titre et champ « enregistrer » cachés ; « Avancé » grisé", () => {
    const s = list(2, null);
    const { m } = open(s);
    expect(s.options.title).toBe("Choisir un puzzle : Puzzles Moyennement Difficiles");
    expect(m.layout.items.find((i) => i.id === DOSBOX.categoryTitle)?.text).toBe("Puzzles Moyennement Difficiles");
    expect(m.layout.items.some((i) => i.id === DOSBOX.titleField || i.id === DOSBOX.titleLabel)).toBe(false);
    expect(m.greyed(DOSBOX.advanced)).toBe(true);
    expect(s.action(DOSBOX.advanced)).toEqual({ kind: "unavailable" });
    const labels = m.buttons().map((b) => m.name(b));
    expect(labels).toEqual(
      expect.arrayContaining(["Aide", "Autres Puzzles", "Faire défiler vers le haut", "Faire défiler vers le bas", "Avancé (non disponible)", "Lancer", "Annuler"]),
    );
    // Changer de catégorie change le titre lu à la prochaine ouverture.
    s.setCategory(3, null);
    expect(s.options.title).toBe("Choisir un puzzle : Puzzles Difficiles");
  });

  it("clic : choisit la rangée (son 0xE1B) ; double clic ou « Lancer » : charge ; « Annuler », Échap : ferme", () => {
    const s = list(1, puzzles.find((p) => p.name === "ELEV1")!);
    const { m, choose, out } = open(s);
    const p = rowPoint(m, s, 3);
    sounds.length = 0;
    m.pointerDown(p.x, p.y, 1000);
    expect(m.drain()).toEqual([]);
    expect(s.view.selected).toBe(3);
    expect(sounds).toEqual([0xe1b]);
    m.pointerDown(p.x, p.y, 1000 + DOUBLE_CLICK_MS + 1);
    expect(m.drain()).toEqual([]);
    m.pointerDown(p.x, p.y, 1000 + DOUBLE_CLICK_MS + 100);
    expect(m.drain()).toEqual([DOSBOX.load]);
    const elev4 = puzzles.find((q) => q.name === "ELEV4");
    expect(s.action(DOSBOX.load)).toEqual({ kind: "load", puzzle: elev4 });
    expect(choose(DOSBOX.load)).toBe(false);
    expect(out.result).toEqual({ kind: "load", puzzle: elev4 });
    expect(s.action(DOSBOX.cancel)).toEqual({ kind: "cancel" });
    expect(m.escape()).toBe(DOSBOX.cancel);
    expect(s.action(DOSBOX.bins)).toEqual({ kind: "bins" });
    expect(s.options.defaultId).toBe(DOSBOX.load);
  });

  it("flèches (44ee9d) : une rangée de défilement à la fin de l'animation, répétée tenue, sans changer la rangée choisie ; bornées", () => {
    const s = list(0, null);
    const { m, choose } = open(s);
    /** Passes de la boucle des contrôles, avec les choix des flèches comme l'hôte. */
    const passes = (n: number) => {
      for (let i = 0; i < n; i++) for (const id of m.pass().fire) choose(id);
    };
    const down = m.item(DOSBOX.down)!;
    const frames = down.frameCount!;
    m.pointerDown(down.x + 5, down.y + 5);
    passes(frames - 2);
    expect(s.view.top).toBe(0);
    passes(1);
    expect(s.view.top).toBe(1);
    passes(frames - 2);
    expect(s.view.top).toBe(1);
    passes(1);
    expect(s.view.top).toBe(2);
    m.pointerUp(down.x + 5, down.y + 5);
    // Relâchée, la flèche finit son animation (une dernière action) puis s'arrête.
    passes(40);
    expect(s.view.top).toBe(3);
    expect(s.view.selected).toBe(0);
    s.view.scrollBy(-10);
    expect(s.view.top).toBe(0);
    s.view.scrollBy(100);
    expect(s.view.top).toBe(40 - s.view.visible());
  });

  it("clavier : la liste suit la rangée choisie ; Entrée, c'est « Lancer »", () => {
    const s = list(0, null);
    const { m } = open(s);
    s.options.list!.select(20);
    expect(s.view.selected).toBe(20);
    expect(s.view.top).toBeLessThanOrEqual(20);
    expect(s.view.top + 8).toBeGreaterThan(20);
    expect(m.listKey("PageDown")).toBe(20 + s.view.page());
    expect(m.listKey("End")).toBe(39);
    expect(m.status()).toBe(`21. ${texts.levels[20]!.title}`);
  });

  it("rendu : ampoule allumée devant un résolu, éteinte sinon ; rangée choisie dans une autre couleur", () => {
    const solved = new Surface(640, 480);
    const unsolved = new Surface(640, 480);
    open(list(0, puzzles[1]!, ["TLEV1"])).m.render(solved);
    open(list(0, puzzles[1]!, [])).m.render(unsolved);
    const { m } = open(list(0, null));
    const r = m.listRect()!;
    const g = listGeometry(assets.font("SYS12.PFT")!, r);
    const diff = (a: Surface, b: Surface, x0: number, x1: number) => {
      let n = 0;
      for (let y = g.y; y < g.y + g.rowHeight; y++) for (let x = x0; x < x1; x++) if (a.pixels[y * 640 + x] !== b.pixels[y * 640 + x]) n++;
      return n;
    };
    // Icône (x + 20, 24 × 15) seulement : le texte de la rangée 1 est le même.
    expect(diff(solved, unsolved, r.x + 20, r.x + 44)).toBeGreaterThan(20);
    expect(diff(solved, unsolved, g.textX, g.textX + g.textWidth)).toBe(0);
  });

  it("DOSBIN : bacs des catégories, deux joueurs et maison grisés, focus sur la catégorie en cours", () => {
    const bins = new BinScreen(readItf(index.get("DOSBIN.ITF")), "Bacs", 3);
    const { m } = open(bins);
    expect(bins.options.defaultId).toBe(DOSBIN.hard);
    expect(BIN_OF_CATEGORY.slice(0, 5)).toEqual([DOSBIN.tutorial, DOSBIN.easy, DOSBIN.medium, DOSBIN.hard, DOSBIN.reallyHard]);
    expect(bins.action(DOSBIN.easy)).toEqual({ kind: "category", category: 1 });
    expect(bins.action(DOSBIN.tutorial)).toEqual({ kind: "category", category: 0 });
    expect(bins.action(DOSBIN.duel)).toEqual({ kind: "unavailable" });
    expect(bins.action(DOSBIN.user)).toEqual({ kind: "unavailable" });
    expect(bins.action(DOSBIN.cancel)).toEqual({ kind: "cancel" });
    expect(bins.action(DOSBIN.help)).toEqual({ kind: "help" });
    expect(m.name(m.item(DOSBIN.duel)!)).toBe("À Deux Joueurs (non disponible)");
    expect(m.name(m.item(DOSBIN.reallyHard)!)).toBe("Très Difficiles");
    expect(m.escape()).toBe(DOSBIN.cancel);
  });

  it("PUZZDISP : catégorie, « Puzzle no N », titre ; seule l'icône de la catégorie ; OK, Entrée, Échap", () => {
    const ref = puzzles.find((p) => p.name === "HLEV5")!;
    const card = new PuzzleCardScreen(assets, readItf(index.get("PUZZDISP.ITF")), ref, texts.levels[ref.index]!.title);
    const { m } = open(card);
    expect(card.options.title).toBe("Puzzles Difficiles");
    expect(card.numberText()).toBe("Puzzle no 5");
    expect(m.texts()).toEqual(["Puzzle no 5", texts.levels[ref.index]!.title]);
    const icons = m.layout.items.filter((i) => i.id >= PUZZDISP.tutorial && i.id <= PUZZDISP.home).map((i) => i.id);
    expect(icons).toEqual([PUZZDISP.hard]);
    expect(card.action(PUZZDISP.done)).toBe("ok");
    expect(m.escape()).toBe(PUZZDISP.done);
    expect(card.options.defaultId).toBe(PUZZDISP.done);
    const s = new Surface(640, 480);
    m.render(s);
    const t = m.rect(PUZZDISP.title)!;
    const inside = s.pixels.subarray(t.y * 640, (t.y + t.height) * 640);
    expect(new Set(inside).size).toBeGreaterThan(3);
  });

  it("fenêtre fermée sans choix : résultat nul", () => {
    const { out, m } = open(list(0, null));
    m.options.onClose?.();
    expect(out.result).toBeNull();
  });
});
