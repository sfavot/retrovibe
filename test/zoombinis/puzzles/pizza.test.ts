import { describe, expect, it, vi } from "vitest";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId, type Scene } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import {
  PIZZA_LEVEL_PARAMS,
  PIZZA_LEVELS,
  TROLL_LEAVE,
  TROLL_OBJECT,
  allSatisfied,
  ambientScript,
  availableIngredients,
  canContinue,
  departureScripts,
  drawSplit,
  has,
  hintScript,
  ingredientsOf,
  isDuplicate,
  newPizza,
  pizzaRobot,
  playRobot,
  popcount,
  presentTrolls,
  savedAfterExit,
  serveMeal,
  toggleIngredient,
  verdictOf,
  type PizzaState,
} from "../../../src/games/zoombinis/game/puzzles/pizza";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { PIZZA_COUNTER, PIZZA_INGREDIENT_REGIONS, PIZZA_PLACES, PIZZA_SERVE_REGIONS, createPizzaScene, pizzaStateOf } from "../../../src/games/zoombinis/scenes/puzzles/pizza";
import { BUTTON_GO, BUTTON_MAP, HELP_KEY } from "../../../src/games/zoombinis/scenes/puzzle-kit";
import { Snoid } from "../../../src/games/zoombinis/scenes/snoid";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

// ---------------------------------------------------------------------------------------------------------------------------
// Règles

/** Un état de départ dont les ensembles aimés sont imposés (les tirages de la répartition ne servent pas). */
function craft(level: number, liked: number[], options?: { duplicateCostsBudget?: boolean }): PizzaState {
  const state = newPizza(new MsvcRandom(1), level, options);
  (state as unknown as { liked: number[] }).liked = liked;
  state.history.length = 0;
  state.plates.length = 0;
  return state;
}

const mask = (...ks: number[]) => ks.reduce((m, k) => m | (1 << k), 0);

function serve(state: PizzaState, meal: number, rng = new MsvcRandom(5)) {
  state.meal = 0;
  for (const k of ingredientsOf(meal)) toggleIngredient(state, k);
  return serveMeal(state, rng)!;
}

describe("règles de la hutte à pizza : tirages", () => {
  it("niveaux : trolls, ingrédients, probabilité, minimum, budget", () => {
    expect(PIZZA_LEVELS).toBe(4);
    expect(PIZZA_LEVEL_PARAMS.map((p) => [p.trolls, p.ingredients, p.chance, p.minLiked, p.budget])).toEqual([
      [1, 5, 500, 2, 6],
      [2, 7, 800, 3, 7],
      [3, 7, 1000, 3, 7],
      [3, 8, 1000, 4, 7],
    ]);
    expect(availableIngredients(0)).toEqual([0, 1, 2, 3, 4]);
    expect(availableIngredients(1)).toEqual([0, 1, 2, 3, 5, 6]);
    expect(availableIngredients(2)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(availableIngredients(3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  // Valeurs relevées une fois (graines 1 à 3) : une régression de l'ordre des tirages les ferait bouger.
  it.each([
    [0, 1, 15, [15], []],
    [0, 2, 23, [23], []],
    [0, 3, 23, [23], []],
    [1, 1, 111, [7, 104], []],
    [1, 2, 111, [68, 43], []],
    [1, 3, 103, [4, 99], []],
    [2, 1, 127, [33, 6, 88], []],
    [2, 2, 127, [88, 37, 2], []],
    [2, 3, 127, [58, 65, 4], []],
    [3, 1, 255, [80, 131, 44], [144, 18, 34, 160]],
    [3, 2, 255, [44, 83, 128], [6, 5, 129, 130]],
    [3, 3, 255, [29, 32, 194], [48, 36, 6, 18]],
  ])("niveau %i, graine %i : base %i, ensembles %j, assiettes de départ %j", (level, seed, base, liked, plates) => {
    const state = newPizza(new MsvcRandom(seed), level);
    expect(state.base).toBe(base);
    expect(state.liked).toEqual(liked);
    expect(state.history).toEqual(plates);
  });

  it("base : au moins le minimum, jamais l'indice exclu (niveau 1), dans les ingrédients du niveau ; ensembles disjoints dont l'union est la base", () => {
    for (let level = 0; level < PIZZA_LEVELS; level++) {
      const params = PIZZA_LEVEL_PARAMS[level]!;
      for (let seed = 1; seed <= 300; seed++) {
        const split = drawSplit(new MsvcRandom(seed), level);
        expect(popcount(split.base), `niveau ${level}, graine ${seed}`).toBeGreaterThanOrEqual(params.minLiked);
        expect(split.base >> params.ingredients).toBe(0);
        if (level === 1) expect(has(split.base, 4)).toBe(false);
        const sets = split.liked.slice(0, params.trolls);
        expect(sets.reduce((a, b) => a | b, 0)).toBe(split.base);
        expect(sets.reduce((sum, s) => sum + popcount(s), 0)).toBe(popcount(split.base));
        if (level >= 2) for (const set of sets) expect(set).not.toBe(0);
      }
    }
  });

  it("niveau 0 : tout à Arno ; niveau 1 : un ensemble peut être vide (point ouvert 1, repris tel quel)", () => {
    expect(drawSplit(new MsvcRandom(2), 0).liked[0]).toBe(drawSplit(new MsvcRandom(2), 0).base);
    let empty = 0;
    for (let seed = 1; seed <= 400; seed++) if (drawSplit(new MsvcRandom(seed), 1).liked.slice(0, 2).includes(0)) empty++;
    // 2 × 2^-s pour une base de s éléments : un peu moins d'une graine sur dix.
    expect(empty).toBeGreaterThan(10);
    expect(empty).toBeLessThan(120);
  });

  it("niveau 3 : quatre assiettes de départ {A, C}, {C, B}, {B, D}, {A, D}, A et B dans le plus gros ensemble, C et D dans les deux autres", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const state = newPizza(new MsvcRandom(seed), 3);
      const [p0, p1, p2, p3] = state.history as [number, number, number, number];
      expect(state.history).toHaveLength(4);
      for (const plate of state.history) expect(popcount(plate)).toBe(2);
      // Chaque ingrédient est dans deux assiettes consécutives du cycle.
      const [a, c, b, d] = [p0 & p3, p0 & p1, p1 & p2, p2 & p3];
      for (const one of [a, b, c, d]) expect(popcount(one)).toBe(1);
      expect(p0 | p1 | p2 | p3).toBe(a | b | c | d);
      const big = state.liked.findIndex((set) => (set & a) !== 0 && (set & b) !== 0);
      expect(big, `graine ${seed}`).toBeGreaterThanOrEqual(0);
      const sizes = state.liked.map(popcount);
      expect(sizes[big]).toBe(Math.max(...sizes));
      const others = [0, 1, 2].filter((k) => k !== big);
      expect([state.liked[others[0]!]! & c, state.liked[others[1]!]! & d].map(popcount)).toEqual([1, 1]);
      // Les assiettes de départ sont dans l'historique : les resservir est un doublon.
      expect(isDuplicate(state, p0)).toBe(true);
    }
  });

  it("égalité : le plus petit indice est le plus gros ensemble (niveau 3, graine 1 : Willa 3, Shyler 3)", () => {
    const state = newPizza(new MsvcRandom(1), 3);
    expect(state.liked.map(popcount)).toEqual([2, 3, 3]);
    // A et B (7 et 1) sont dans l'ensemble de Willa (131 = k0, k1, k7).
    expect(ingredientsOf(state.liked[1]!)).toEqual([0, 1, 7]);
    expect(ingredientsOf(state.history[0]! & state.history[3]!)).toEqual([7]);
  });
});

describe("règles de la hutte à pizza : verdict", () => {
  it("un seul de trop : 0 ; plusieurs : 4 ; parfait : 2 ; incomplet : 1", () => {
    const liked = mask(0, 1, 2);
    expect(verdictOf(liked, mask(0, 1, 2))).toBe(2);
    expect(verdictOf(liked, mask(0, 1))).toBe(1);
    expect(verdictOf(liked, 0)).toBe(1);
    expect(verdictOf(liked, mask(0, 1, 2, 3))).toBe(0);
    expect(verdictOf(liked, mask(3))).toBe(0);
    expect(verdictOf(liked, mask(0, 1, 2, 3, 4))).toBe(4);
    expect(verdictOf(liked, mask(3, 4))).toBe(4);
  });

  it("ensemble vide : seul le repas vide est parfait", () => {
    expect(verdictOf(0, 0)).toBe(2);
    expect(verdictOf(0, mask(1))).toBe(0);
    expect(verdictOf(0, mask(1, 2))).toBe(4);
  });

  it("toggleIngredient : refuse les indices sans bouton (niveau 1 : 4 et 7 ; niveau 0 : 5 à 7)", () => {
    const l1 = craft(1, [1, 2]);
    expect(toggleIngredient(l1, 4)).toBeNull();
    expect(toggleIngredient(l1, 7)).toBeNull();
    expect(toggleIngredient(l1, 5)).toBe(true);
    expect(toggleIngredient(l1, 5)).toBe(false);
    expect(toggleIngredient(craft(0, [1]), 5)).toBeNull();
    expect(l1.meal).toBe(0);
  });
});

describe("règles de la hutte à pizza : service", () => {
  it("un troll parfait part et arrête la chaîne : les suivants ne jugent pas, le repas ne coûte rien et n'entre pas dans l'historique", () => {
    const state = craft(2, [mask(0), mask(1), mask(2)]);
    const result = serve(state, mask(1));
    expect(result.reactions.map((r) => [r.troll, r.verdict])).toEqual([[0, 0], [1, 2]]);
    expect(result.perfect).toBe(1);
    expect(state.trolls).toEqual(["present", "content", "present"]);
    expect(result.missed).toBe(false);
    expect(state.budget).toBe(7);
    expect(state.history).toEqual([]);
    expect(result.plate).toBeNull();
    expect(result.allSatisfied).toBe(false);
    const first = serve(craft(2, [mask(0), mask(1), mask(2)]), mask(0));
    expect(first.reactions).toHaveLength(1);
    expect(first.reactions[0]).toMatchObject({ troll: 0, verdict: 2, kind: "perfect" });
    expect(first.reactions[0]!.script).toBeGreaterThanOrEqual(8017);
    expect(first.reactions[0]!.script).toBeLessThanOrEqual(8018);
  });

  it("aucun troll content : chacun réagit, le repas coûte un repas toléré, le dernier qui a réagi lance l'assiette (type 4)", () => {
    const state = craft(2, [mask(0), mask(1), mask(2)]);
    const result = serve(state, mask(3, 4));
    expect(result.reactions.map((r) => [r.troll, r.verdict, r.kind])).toEqual([[0, 4, "manyExtra"], [1, 4, "manyExtra"], [2, 4, "manyExtra"]]);
    expect(result.missed).toBe(true);
    expect([result.budgetBefore, result.budgetAfter, state.budget]).toEqual([7, 6, 6]);
    expect(result.thrower).toBe(2);
    expect(result.plate).toMatchObject({ type: 4, mask: mask(3, 4), slot: 0, script: 12025, reuse: false });
    expect(state.history).toEqual([mask(3, 4)]);
    expect(result.delivererReturns).toBe(true);
    expect(result.fury).toBeNull();
  });

  it("le premier troll au verdict « incomplet » détermine l'assiette (types 5 à 7) et le lanceur", () => {
    const state = craft(2, [mask(0, 1), mask(2, 3), mask(4, 5)]);
    // {2} : Arno a un de trop (0), Willa incomplet (1), Shyler un de trop.
    const result = serve(state, mask(2));
    expect(result.reactions.map((r) => r.verdict)).toEqual([0, 1, 0]);
    expect(result.thrower).toBe(1);
    expect(result.plate).toMatchObject({ type: 6, script: 12019, slot: 0 });
    const again = serve(state, mask(4));
    expect(again.reactions.map((r) => r.verdict)).toEqual([0, 0, 1]);
    expect(again.plate).toMatchObject({ type: 7, script: 12022 });
  });

  it("répliques : une différente à chaque réaction, qui boucle (un de trop, plusieurs) ou plafonne (incomplet)", () => {
    const state = craft(0, [mask(0, 1, 2, 3, 4)]);
    const scripts = [mask(0), mask(1), mask(2), mask(3), mask(4), mask(0, 1), mask(0, 2)].map((meal) => serve(state, meal).reactions[0]!.script);
    // Incomplet (Arno) : 8000 à 8005, puis plafonné.
    expect(scripts).toEqual([8000, 8001, 8002, 8003, 8004, 8005, 8005]);
    const extra = craft(0, [mask(0)]);
    // Un de trop : 8006 puis 8007, qui alternent ; plusieurs de trop : 8008 à 8013 qui bouclent.
    expect([mask(0, 1), mask(0, 2), mask(0, 3), mask(0, 4)].map((meal) => serve(extra, meal).reactions[0]!.script)).toEqual([8006, 8007, 8006, 8007]);
    const many = craft(0, [mask(0)]);
    const manyScripts = [mask(1, 2), mask(1, 3), mask(1, 4), mask(2, 3), mask(2, 4), mask(3, 4), mask(1, 2, 3)].map((meal) => serve(many, meal).reactions[0]!.script);
    expect(manyScripts).toEqual([8008, 8009, 8010, 8011, 8012, 8013, 8008]);
    // Willa et Shyler ont leurs banques.
    const lvl = craft(2, [mask(0), mask(1), mask(2)]);
    expect(serve(lvl, mask(3, 4)).reactions.map((r) => r.script)).toEqual([8008, 9005, 10020]);
  });

  it("doublon (ancienne lecture, duplicateCostsBudget faux) : une seule réplique, gratuit, pas de nouvelle assiette", () => {
    const state = craft(2, [mask(0, 1), mask(2, 3), mask(4)], { duplicateCostsBudget: false });
    serve(state, mask(5));
    expect(state.budget).toBe(6);
    const again = serve(state, mask(5));
    expect(again.duplicate).toBe(true);
    expect(again.reactions).toHaveLength(1);
    expect(again.missed).toBe(false);
    expect(state.budget).toBe(6);
    expect(again.plate).toBeNull();
    expect(state.history).toEqual([mask(5)]);
    // Aucun verdict « incomplet » : un troll tiré grogne (8015, 9017 ou 10027 et suivants).
    expect(again.reactions[0]!.kind).toBe("again");
    // Un doublon dont un troll est « incomplet » : celui-là grogne (réplique d'incomplet sans avancer le compteur).
    const second = craft(0, [mask(0, 1)], { duplicateCostsBudget: false });
    serve(second, mask(0));
    const dup = serve(second, mask(0));
    expect(dup.reactions[0]).toMatchObject({ troll: 0, kind: "incompleteAgain", script: 8001 });
  });

  it("doublon (défaut, comme le code) : il coûte comme un repas manqué", () => {
    const state = craft(0, [mask(0, 1)], { duplicateCostsBudget: true });
    serve(state, mask(0));
    const again = serve(state, mask(0));
    expect(again.duplicate).toBe(true);
    expect(again.missed).toBe(true);
    expect(state.budget).toBe(4);
    expect(state.history).toEqual([mask(0), mask(0)]);
  });

  it("budget : 6 repas au niveau 0 (le 6e épuise : fureur 8023, le livreur ne revient plus), 7 aux autres ; ensuite grognon 8022 et le service reste permis", () => {
    const state = craft(0, [mask(0)]);
    const meals = [mask(1), mask(2), mask(3), mask(4), mask(1, 2), mask(1, 3), mask(1, 4)];
    const results = meals.map((meal) => serve(state, meal));
    expect(results.slice(0, 5).map((r) => [r.budgetBefore, r.budgetAfter, r.fury, r.delivererReturns])).toEqual([
      [6, 5, null, true],
      [5, 4, null, true],
      [4, 3, null, true],
      [3, 2, null, true],
      [2, 1, null, true],
    ]);
    expect(results[5]).toMatchObject({ budgetBefore: 1, budgetAfter: 0, fury: { troll: 0, script: 8023 }, delivererReturns: false });
    expect(state.exhausted).toBe(true);
    expect(results[6]).toMatchObject({ budgetBefore: 0, budgetAfter: -1, fury: { troll: 0, script: 8022 }, delivererReturns: false });
    expect(allSatisfied(state)).toBe(false);
    // Un repas parfait est encore servi après l'épuisement.
    const last = serve(state, mask(0));
    expect(last.perfect).toBe(0);
    expect(last.allSatisfied).toBe(true);
    // Niveaux 1 à 3 : 7 repas.
    const l3 = craft(3, [mask(0), mask(1), mask(2)]);
    expect(l3.budget).toBe(7);
  });

  it("fureur : le premier troll présent la joue (Willa après le départ d'Arno : 9028 + 1)", () => {
    const state = craft(1, [mask(0), mask(1)]);
    state.budget = 1;
    serve(state, mask(0));
    const result = serve(state, mask(2, 3));
    expect(result.fury).toEqual({ troll: 1, script: 9029 });
    expect(result.reactions.map((r) => r.troll)).toEqual([1]);
  });

  it("troll à ensemble vide (niveau 1) : content d'un repas vide seulement", () => {
    const state = craft(1, [0, mask(1)]);
    const wrong = serve(state, mask(1));
    expect(wrong.reactions.map((r) => r.verdict)).toEqual([0, 2]);
    const empty = serve(craft(1, [0, mask(1)]), 0);
    expect(empty.perfect).toBe(0);
    expect(empty.reactions).toHaveLength(1);
  });

  it("épreuve gagnée : plus de service ; « go » sauve le groupe entier, la carte le perd entièrement ; jamais de passage partiel", () => {
    const state = craft(0, [mask(0, 1)]);
    expect(canContinue(state)).toBe(false);
    expect(savedAfterExit(state, 16, "go")).toBe(0);
    expect(savedAfterExit(state, 16, "map")).toBe(0);
    const result = serve(state, mask(0, 1));
    expect(result.allSatisfied).toBe(true);
    expect(canContinue(state)).toBe(true);
    expect(serveMeal(state, new MsvcRandom(1))).toBeNull();
    expect(savedAfterExit(state, 16, "go")).toBe(16);
    expect(savedAfterExit(state, 16, "map")).toBe(0);
    expect(presentTrolls(state)).toEqual([]);
  });

  it("scène de départ selon la composition, même tirage pour tous ; réplique d'attente ; ambiance", () => {
    expect(departureScripts(craft(0, [1]), new MsvcRandom(1)).map((d) => d.script)).toEqual([8024 + new MsvcRandom(1).rand(1)]);
    const r = new MsvcRandom(4).rand(1);
    expect(departureScripts(craft(1, [1, 2]), new MsvcRandom(4))).toEqual([{ troll: 0, script: 8026 + r }, { troll: 1, script: 9030 + r }]);
    expect(departureScripts(craft(3, [1, 2, 4]), new MsvcRandom(4))).toEqual([
      { troll: 0, script: 8030 + r },
      { troll: 1, script: 9032 + r },
      { troll: 2, script: 10036 + r },
    ]);
    expect(hintScript(craft(0, [1]), new MsvcRandom(1))).toEqual({ troll: 0, script: 8014 });
    expect(hintScript(craft(1, [1, 2]), new MsvcRandom(1)).troll).toBe(1);
    const hint = hintScript(craft(2, [1, 2, 4]), new MsvcRandom(1));
    expect(hint.troll).toBe(2);
    expect(hint.script).toBeGreaterThanOrEqual(10001);
    expect(hint.script).toBeLessThanOrEqual(10008);
    expect(ambientScript(craft(0, [1]), new MsvcRandom(1))!.script).toBeGreaterThanOrEqual(8034);
    for (const state of [craft(1, [1, 2]), craft(2, [1, 2, 4]), craft(3, [1, 2, 4])]) {
      for (let seed = 1; seed <= 20; seed++) {
        const ambient = ambientScript(state, new MsvcRandom(seed));
        if (ambient) expect(state.trolls[ambient.troll]).toBe("present");
      }
    }
  });
});

describe("règles de la hutte à pizza : robot", () => {
  it.each([0, 1, 2, 3])("niveau %i : le robot satisfait tous les trolls sans entamer le budget (60 graines)", (level) => {
    const params = PIZZA_LEVEL_PARAMS[level]!;
    for (let seed = 1; seed <= 60; seed++) {
      const state = newPizza(new MsvcRandom(seed), level);
      const start = state.history.length;
      expect(pizzaRobot(state)).toEqual(state.liked.slice(0, params.trolls));
      const serves = playRobot(state, new MsvcRandom(seed + 1000));
      expect(allSatisfied(state), `niveau ${level}, graine ${seed}`).toBe(true);
      expect(serves).toHaveLength(params.trolls);
      expect(state.budget).toBe(params.budget);
      expect(state.missedCount).toBe(0);
      expect(state.history).toHaveLength(start);
      expect(serves.every((s) => s.perfect !== null && !s.missed)).toBe(true);
      expect(serves.map((s) => s.perfect)).toEqual(Array.from({ length: params.trolls }, (_, k) => k));
      expect(canContinue(state)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Écran

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;

function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1], i + 1));
}

/** Centre d'un rectangle de région. */
const center = (rect: { left: number; top: number; right: number; bottom: number }) => ({ x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) });

describe.skipIf(!original.has)("hutte à pizza : écran (écran 9, PIZZA.MHK)", () => {
  /** L'épreuve au niveau `level` ; les ensembles aimés peuvent être imposés avant la fin de l'introduction. Le son n'est pas déverrouillé : les voix durent 0 ms. */
  async function start(level: number, options: { size?: number; liked?: number[]; lessAction?: boolean } = {}) {
    const host = new TestHost();
    const engine = createZoombinisEngine(host, { seed: 11 });
    const services = await installServices(engine);
    let scene: Scene | undefined;
    const entered: number[] = [];
    for (const id of Object.values(ScreenId)) {
      if (id === S.pizza) engine.register(id, () => (scene = createPizzaScene()));
      else engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const zoombinis = services.game;
    zoombinis.game.group.members = party(options.size ?? 16);
    zoombinis.game.stageUnbroken = true;
    zoombinis.game.levels = [level, 0, 0, 0];
    zoombinis.game.options.lessAction = options.lessAction ?? false;
    zoombinis.session.screen = S.pizza;
    engine.start(S.pizza);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const state = pizzaStateOf(scene!)!;
    if (options.liked) (state as unknown as { liked: number[] }).liked = options.liked;
    const ticks = (n: number) => runFor(engine, host, n * TICK_MS);
    /** Laisse finir l'introduction (narrateur, présentations, réplique d'attente). */
    const intro = () => ticks(2500);
    /** Compose un repas par des clics sur les boutons d'ingrédients, puis le sert. */
    const clickIngredients = async (meal: number) => {
      for (const k of ingredientsOf(meal)) {
        const rect = PIZZA_INGREDIENT_REGIONS[level]![k]!;
        const c = center(rect);
        host.click(c.x, c.y);
        await ticks(12);
      }
    };
    const serveClick = async () => {
      const c = center(PIZZA_SERVE_REGIONS[1]!);
      host.click(c.x, c.y);
      await ticks(3);
    };
    const features = engine.services.get(FEATURES);
    const scripts = () => features.features.map((f) => f.scriptId);
    return { host, engine, services, zoombinis, entered, state, ticks, intro, clickIngredients, serveClick, features, scripts, scene: scene!, dialog: engine.services.get(DIALOG), sound: engine.services.get(ZOOMBINIS_SOUND) };
  }

  it.each([0, 1, 2, 3])("niveau %i : entrée sur le fond de PIZZA.MHK, trolls, boutons d'ingrédients, assiettes de départ et groupe du kit", async (level) => {
    const { host, state, scripts, features, zoombinis } = await start(level);
    const params = PIZZA_LEVEL_PARAMS[level]!;
    expect(state.level).toBe(level);
    expect(state.trolls.filter((t) => t === "present")).toHaveLength(params.trolls);
    expect(host.frames[host.frames.length - 1]!.pixels.some((p) => p !== 0)).toBe(true);
    const ids = scripts();
    // Les trolls (introductions 8032, 9034, 10038), le four (7000) et les boutons : un par ingrédient du niveau.
    for (let k = 0; k < params.trolls; k++) expect(ids).toContain(TROLL_OBJECT[k]);
    for (let k = params.trolls; k < 3; k++) expect(ids).not.toContain(TROLL_OBJECT[k]);
    expect(ids).toContain(7000);
    expect(ids.filter((id) => id >= 7005 && id <= 7056)).toHaveLength(availableIngredients(level).length);
    // Assiettes de départ du niveau 3 : scripts 12041 à 12044 ; aucune avant.
    expect(ids.filter((id) => id >= 12041 && id <= 12044)).toHaveLength(level === 3 ? 4 : 0);
    expect(zoombinis.session.screen).toBe(S.pizza);
    // Le groupe : un personnage par Zoombini, debout ou entrant.
    expect(features.features.filter((f) => f.hasFlag(1))).toHaveLength(16);
  });

  it("niveau 3 : l'entrée enchaîne les présentations des trois trolls puis la réplique d'attente, et la mémoire de dialogue de l'écran avance", async () => {
    const { zoombinis, intro, state, ticks } = await start(3);
    expect(state.trolls).toEqual(["present", "present", "present"]);
    await intro();
    await ticks(2000);
    expect(zoombinis.game.dialogMemory.some((m) => (m & 0xfff) > 0)).toBe(true);
  });

  it("F1 rejoue la voix d'introduction (20071 au niveau 0, 20072 ensuite) ; la musique de la hutte : aucune", async () => {
    for (const [level, voice] of [[0, 20071], [2, 20072]] as const) {
      const { host, sound, ticks } = await start(level);
      await ticks(400);
      const before = host.audio.waves.length;
      host.press(HELP_KEY, { key: HELP_KEY });
      await ticks(4);
      expect(host.audio.waves.length).toBeGreaterThan(before);
      expect(sound.lastMusicId).toBe(0);
      void voice;
    }
  });

  it("les clics sur les boutons composent le repas (trois ingrédients aimés), le four l'affiche ; recliquer retire l'ingrédient", async () => {
    const { state, clickIngredients, ticks, intro } = await start(2, { liked: [mask(0, 2), mask(1), mask(3)] });
    await intro();
    await clickIngredients(mask(0, 2, 5));
    expect(state.meal).toBe(mask(0, 2, 5));
    await clickIngredients(mask(5));
    expect(state.meal).toBe(mask(0, 2));
    await ticks(10);
  });

  it("repas parfait : le four joue, le livreur monte au comptoir, le troll content part avec sa pizza (8021), son ensemble est parti, les boutons repartent à zéro", async () => {
    const { state, clickIngredients, serveClick, scripts, ticks, intro } = await start(1, { liked: [mask(0, 1), mask(2, 3)] });
    await intro();
    await clickIngredients(mask(2, 3));
    await serveClick();
    expect(state.meal).toBe(0);
    expect(state.served).toBe(mask(2, 3));
    expect(scripts()).toContain(7066);
    // La pizza part du four (12000) puis traverse (12001) ; Arno (un de trop... incomplet : ses ingrédients 0, 1 manquent) puis Willa réagissent.
    await ticks(200);
    expect(scripts().some((id) => id === 12000 || id === 12001)).toBe(true);
    await ticks(700);
    expect(state.trolls).toEqual(["present", "content", "absent"]);
    expect(state.budget).toBe(7);
    expect(state.missedCount).toBe(0);
    expect(scripts()).toContain(TROLL_LEAVE[1]);
  });

  it("repas manqué : les trolls réagissent, l'assiette tombe dans l'historique (12025), le budget baisse, le service reste ouvert", async () => {
    const { state, clickIngredients, serveClick, scripts, ticks, intro } = await start(0, { liked: [mask(0, 1)] });
    await intro();
    await clickIngredients(mask(2));
    await serveClick();
    await ticks(1500);
    expect(state.trolls).toEqual(["present", "absent", "absent"]);
    expect(state.budget).toBe(5);
    expect(state.history).toEqual([mask(2)]);
    expect(scripts()).toContain(12025);
    expect(state.plates[0]).toMatchObject({ type: 4, slot: 0 });
    // Un doublon coûte un repas comme un manqué (`5091` → `4620` → `415d`) : `3aa6` le range aussi dans l'historique, sans dédoublonner.
    await clickIngredients(mask(2));
    await serveClick();
    await ticks(1200);
    expect(state.budget).toBe(4);
    expect(state.history).toHaveLength(2);
    // Un autre repas manqué : l'assiette suivante (12026).
    await clickIngredients(mask(3));
    await serveClick();
    await ticks(1500);
    expect(state.budget).toBe(3);
    expect(scripts()).toContain(12026);
  });

  it("budget épuisé : fureur au dernier repas toléré, la hutte reste jouable, « go » reste grisé ; un repas parfait finit l'épreuve", async () => {
    const { state, clickIngredients, serveClick, ticks, intro, zoombinis, host, engine } = await start(0, { liked: [mask(0)] });
    await intro();
    for (const meal of [mask(1), mask(2), mask(3), mask(4), mask(1, 2), mask(1, 3)]) {
      await clickIngredients(meal);
      await serveClick();
      await ticks(1700);
    }
    expect(state.budget).toBe(0);
    expect(state.exhausted).toBe(true);
    expect(state.missedCount).toBe(6);
    expect(allSatisfied(state)).toBe(false);
    // « go » grisé : un clic ne fait rien.
    host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await ticks(30);
    expect(zoombinis.lastChange).toBeNull();
    // Encore un repas manqué puis un parfait.
    await clickIngredients(mask(1, 4));
    await serveClick();
    await ticks(1700);
    expect(state.budget).toBe(-1);
    await clickIngredients(mask(0));
    await serveClick();
    await ticks(1500);
    expect(allSatisfied(state)).toBe(true);
    expect(engine.error).toBeNull();
  });

  it.each([0, 1, 2, 3])("niveau %i : le robot gagne, « go » sauve tout le groupe (16) et mène à l'écran suivant ; le monument de fin d'étape est posé", async (level) => {
    const { state, clickIngredients, serveClick, ticks, intro, zoombinis, host, engine } = await start(level);
    await intro();
    for (const meal of pizzaRobot(state)) {
      await clickIngredients(meal);
      await serveClick();
      await ticks(1700);
    }
    expect(allSatisfied(state)).toBe(true);
    await ticks(600);
    host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await ticks(400);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.pizza, "success") });
    const { game } = zoombinis;
    expect(game.group.members.filter((z) => z.present)).toHaveLength(16);
    expect(game.successes[S.pizza - 7]! & (1 << level)).toBe(1 << level);
    expect(game.monuments[0]).toMatchObject({ stage: 1, level: level + 1 });
    expect(game.levels[0]).toBe(Math.min(level + 1, 3));
  });

  it("sortie par « go » : les Zoombinis suivent NODE / PATH 1000 de la hutte (1168:2f9f, DS:970c remis à 0) au lieu d'aller tout droit vers (690, 250)", async () => {
    const { state, clickIngredients, serveClick, ticks, intro, host } = await start(0);
    await intro();
    for (const meal of pizzaRobot(state)) {
      await clickIngredients(meal);
      await serveClick();
      await ticks(1700);
    }
    await ticks(600);
    const walkTo = vi.spyOn(Snoid.prototype, "walkTo");
    host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await ticks(100);
    const exits = walkTo.mock.calls.filter(([to]) => to.x === 690 && to.y === 250);
    walkTo.mockRestore();
    expect(exits.length).toBeGreaterThan(0);
    // Le chemin unique de PIZZA.MHK : (303, 316) (358, 288) (429, 263) (615, 290) (690, 290).
    for (const [, map] of exits) {
      expect(map?.paths).toEqual([[1, 2, 3, 4, 5]]);
      expect(map?.nodes.at(-2)).toEqual({ x: 615, y: 290 });
    }
  });

  it("par la carte : avertissement, « Ah non ! » garde l'épreuve, « Tant pis… » abandonne le groupe entier", async () => {
    const { host, dialog, zoombinis, ticks, intro } = await start(1);
    await intro();
    host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
    await ticks(4);
    expect(dialog.isOpen).toBe(true);
    host.press("Escape");
    await ticks(4);
    expect(dialog.isOpen).toBe(false);
    expect(zoombinis.lastChange).toBeNull();
    host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
    await ticks(4);
    host.press("Enter");
    await ticks(6);
    expect(zoombinis.lastChange).toMatchObject({ screen: S.map });
    expect(zoombinis.game.group.members).toHaveLength(0);
    expect(zoombinis.game.successes[S.pizza - 7]).toBe(0);
  });

  it("une partie enregistrée pendant l'épreuve retrouve son groupe entier", async () => {
    const { engine, zoombinis } = await start(0);
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(16);
  });

  it("le livreur (premier du groupe) monte au comptoir (DS:1b6e) dès l'arrivée, prend la pizza (SCRS 13000) puis la porte au troll (13005) pendant que la pizza suit (12001), et revient au comptoir", async () => {
    let delivererSnoid: Snoid | undefined;
    const walkTo = vi.spyOn(Snoid.prototype, "walkTo");
    const playSpy = vi.spyOn(Snoid.prototype, "play");
    const placed = vi.spyOn(Snoid.prototype, "setPosition");
    const { state, clickIngredients, serveClick, ticks, intro, features } = await start(0, { liked: [mask(0, 1)], lessAction: true });
    await intro();
    expect(state.deliverer).toBe(0);
    // Première montée au comptoir, dès que le groupe est posé.
    const firstWalk = walkTo.mock.calls.findIndex(([to]) => to.x === PIZZA_COUNTER.x && to.y === PIZZA_COUNTER.y);
    expect(firstWalk).toBeGreaterThanOrEqual(0);
    delivererSnoid = walkTo.mock.contexts[firstWalk] as Snoid;
    expect(PIZZA_COUNTER).toEqual({ x: 270, y: 334 });
    expect(delivererSnoid.position).toEqual(PIZZA_COUNTER);
    const deliverer = delivererSnoid;
    const feet = deliverer.traits.feet;
    const scriptsOf = () => playSpy.mock.calls.filter((_, i) => playSpy.mock.contexts[i] === deliverer).map(([id]) => id).filter((id) => id >= 13000);
    walkTo.mockClear();
    await clickIngredients(mask(2));
    await serveClick();
    // Le four joue : la pizza sort, le livreur la prend, puis la porte (Arno, le seul troll du niveau 0, est servi : 13005 et 12001).
    for (let i = 0; i < 400 && !scriptsOf().includes(13004 + feet); i++) await ticks(5);
    expect(scriptsOf()).toEqual([12999 + feet, 13004 + feet]);
    expect(features.features.some((f) => f.scriptId === 12001)).toBe(true);
    await ticks(1800);
    // Repas manqué, budget non épuisé : il est revenu au comptoir (pas à sa place d'attente).
    expect(walkTo.mock.calls.some(([to], i) => walkTo.mock.contexts[i] === deliverer && to.x === PIZZA_COUNTER.x && to.y === PIZZA_COUNTER.y)).toBe(true);
    expect(deliverer.position).toEqual(PIZZA_COUNTER);
    // À la fin du geste, il est devant la table d'Arno (dernière case de 13005 + pieds), loin du comptoir.
    const ends = placed.mock.calls.filter((_, i) => placed.mock.contexts[i] === deliverer).map(([at]) => at);
    expect(ends.some((at) => at.x > 350 && at.y < 320)).toBe(true);
    walkTo.mockRestore();
    playSpy.mockRestore();
    placed.mockRestore();
  });

  it("places d'attente lues dans l'exécutable (1478:0a04) : chaque Zoombini du groupe sauf le livreur reste sur la sienne", async () => {
    const { ticks, intro, features } = await start(0, { liked: [mask(0, 1)], lessAction: true });
    await intro();
    await ticks(100);
    const snoids = features.features.filter((f) => f.hasFlag(1));
    expect(snoids.length).toBe(16);
    expect(PIZZA_PLACES).toHaveLength(16);
    expect(PIZZA_PLACES[0]).toEqual({ x: 288, y: 389 });
    expect(PIZZA_PLACES[15]).toEqual({ x: 18, y: 457 });
  });
});

describe("hutte à pizza : tables de l'écran", () => {
  it("13 zones par niveau : cinq pizzas puis trois sundaes, jamais de zone pour l'indice sans bouton", () => {
    for (let level = 0; level < PIZZA_LEVELS; level++) {
      const regions = PIZZA_INGREDIENT_REGIONS[level]!;
      expect(regions).toHaveLength(8);
      for (let k = 0; k < 8; k++) expect(regions[k] !== null, `niveau ${level}, indice ${k}`).toBe(availableIngredients(level).includes(k));
    }
    expect(PIZZA_SERVE_REGIONS).toEqual([
      { left: 33, top: 97, right: 120, bottom: 157 },
      { left: 130, top: 99, right: 174, bottom: 308 },
    ]);
    expect(TROLL_LEAVE).toEqual([8021, 9027, 10031]);
  });
});
