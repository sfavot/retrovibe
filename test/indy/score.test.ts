import { afterEach, describe, expect, it, vi } from "vitest";
import { Assets, IndyIds, IndySounds } from "../../src/games/indy/engine/assets";
import { Game } from "../../src/games/indy/engine/game";
import { generateStory } from "../../src/games/indy/engine/generation/generator";
import {
  HISTORY_LENGTH,
  MAX_VICTORIES,
  MYSTERY_GOAL,
  addVictory,
  drawHistory,
  isGoalDrawable,
  recordGoal,
} from "../../src/games/indy/engine/history";
import { indyQuotient, paceOf } from "../../src/games/indy/engine/score";
import { WorldSize } from "../../src/games/indy/engine/world";
import { progressStore } from "../../src/games/indy/ui/progress";
import { hasOriginalFiles, loadGameData } from "./helpers";

describe("Indy Quotient (DESKADV.EXE 4:e514)", () => {
  it("vaut 300 au mieux pour le temps : secondes / W égal 10 × W", () => {
    // W = 20 : temps de référence 20 × 200 = 4000 s. Difficulté 50 sur 3 sons : D = 4 × 50.
    expect(indyQuotient(4000, 20, 150, 3)).toBe(300 + 200);
  });

  it("retranche l'écart au temps de référence divisé par 4, dans les deux sens", () => {
    // 0 s : |0 − 200| / 4 = 50 ; 8000 s : |400 − 200| / 4 = 50 ; divisions entières tronquées.
    expect(indyQuotient(0, 20, 50, 1)).toBe(250 + 200);
    expect(indyQuotient(8000, 20, 50, 1)).toBe(250 + 200);
    expect(indyQuotient(4000 + 20 * 3, 20, 50, 1)).toBe(300 - 0 + 200); // 3 / 4 = 0
    expect(indyQuotient(4000 + 20 * 5, 20, 50, 1)).toBe(300 - 1 + 200);
  });

  it("ne descend pas sous 0 pour le temps", () => {
    expect(indyQuotient(10_000_000, 20, 50, 1)).toBe(0 + 200);
  });

  it("calcule D = 4 × moyenne des difficultés, bornée à [1, 400]", () => {
    expect(indyQuotient(4000, 20, 25 + 85, 2)).toBe(300 + 4 * 55);
    expect(indyQuotient(4000, 20, 0, 5)).toBe(300 + 1); // moyenne 0 : minimum 1
    expect(indyQuotient(4000, 20, 300, 2)).toBe(300 + 400); // moyenne 150 plafonnée à 100
  });

  it("vaut D = 4 sans aucun son 0, et 700 au maximum (le manuel annonce 1000)", () => {
    expect(indyQuotient(4000, 20, 0, 0)).toBe(300 + 4);
    expect(indyQuotient(4000, 20, 100, 1)).toBe(700);
  });

  it("calcule W comme 2 × (voyages + barrages) + puzzles + 1", () => {
    expect(paceOf({ travels: 1, blockades: 2, puzzleCount: 7 })).toBe(14);
  });
});

describe("historique des objectifs", () => {
  it("contient MysteryGO quand il est vide, et ne garde que les 10 derniers", () => {
    expect(drawHistory([])).toEqual([MYSTERY_GOAL]);
    const long = Array.from({ length: 11 }, (_, i) => i);
    expect(drawHistory(long)).toEqual(long.slice(1));
    expect(recordGoal(long, 99)).toHaveLength(HISTORY_LENGTH + 1);
    expect(recordGoal([], 15)).toEqual([MYSTERY_GOAL, 15]);
  });

  it("exclut les objectifs récents, et MysteryGO tant qu'il y a moins de 10 victoires", () => {
    expect(isGoalDrawable(15, [15, 16], 0)).toBe(false);
    expect(isGoalDrawable(49, [15, 16], 0)).toBe(true);
    expect(isGoalDrawable(MYSTERY_GOAL, [15], 9)).toBe(false);
    expect(isGoalDrawable(MYSTERY_GOAL, [15], 10)).toBe(true);
    expect(isGoalDrawable(MYSTERY_GOAL, [], 11)).toBe(false); // l'historique vide l'exclut
  });

  it("plafonne les victoires à 11", () => {
    expect(addVictory(10)).toBe(MAX_VICTORIES);
    expect(addVictory(MAX_VICTORIES)).toBe(MAX_VICTORIES);
  });
});

describe("progression locale", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    return data;
  }

  it("enregistre les objectifs et les victoires", () => {
    const data = stubStorage();
    progressStore.recordGoal(15);
    progressStore.recordVictory();
    expect(progressStore.read()).toEqual({ history: [MYSTERY_GOAL, 15], victories: 1 });
    expect(JSON.parse([...data.values()][0])).toEqual({ history: [MYSTERY_GOAL, 15], victories: 1 });
  });

  it("ignore un contenu altéré et garde la copie de la session", () => {
    stubStorage({ "indy-desktop-progress": '{"history":"x","victories":3}' });
    expect(progressStore.read().history).toEqual([MYSTERY_GOAL, 15]);
  });

  it("fonctionne sans stockage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
    });
    progressStore.recordGoal(16);
    expect(progressStore.read().history.at(-1)).toBe(16);
  });
});

describe.skipIf(!hasOriginalFiles)("score d'une partie", () => {
  const assets = hasOriginalFiles ? new Assets(loadGameData()) : (null as unknown as Assets);
  const presenter = {
    speak: async () => {},
    message: async () => {},
    pickup: async () => {},
    transition: async (_: unknown, apply: () => void) => apply(),
    playSound: () => {},
    ended: async () => {},
    chooseTeleport: async () => null,
  };

  afterEach(() => vi.useRealTimers());

  it("utilise le W de l'histoire, le temps de jeu en secondes et la difficulté des sons 0", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const story = generateStory(assets, 7, WorldSize.Medium);
    const game = new Game(assets, story, presenter, { difficulty: 85 });
    await game.start(IndyIds.townZone, { x: 11, y: 5 });
    vi.setSystemTime(10 * story.pace * story.pace * 1000);
    expect(game.score()).toBe(300 + 4); // aucun son 0 : D = 4
    game["playSound"](IndySounds.Eat);
    game["playSound"](IndySounds.Hurt); // seul le son 0 compte
    expect(game.score()).toBe(300 + 4 * 85);
    // Le décompte survit à une sauvegarde.
    const snapshot = JSON.parse(JSON.stringify(game.snapshot()));
    const resumed = new Game(assets, { ...story }, presenter, snapshot.settings);
    await resumed.resume(snapshot);
    expect(resumed.score()).toBe(300 + 4 * 85);
  });
});
