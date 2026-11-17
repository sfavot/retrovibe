import { describe, expect, it } from "vitest";
import {
  ABSENT,
  COLUMNS,
  MAX_TRIES,
  MISPLACED,
  MODULE,
  PLACED,
  answer,
  arrowZone,
  columnZone,
  gainFor,
  paletteZone,
  symbolCount,
  timeLimit,
  type HieroglyphesState,
} from "../../../src/games/asterix/scenes/minigames/m33";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { compose, playM33, validate } from "./m33-player";

/**
 * Mini-jeu des Hiéroglyphes (`docs/asterix/minigames/m33.md`) : lancé seul par sa case, joué au clavier ou au clic sur le
 * moteur de test. L'inscription définitive est dans `scenes/minigames/index.ts` ; elle est refaite ici pour que le test
 * ne dépende pas de l'ordre des portages.
 */

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));

/** Une combinaison fausse à toutes les colonnes. */
const wrongFor = (state: HieroglyphesState): number[] => state.secret.map((symbol) => (symbol + 1) % state.symbols);

describe("Hiéroglyphes, réponse d'un essai (2353:03b1)", () => {
  it("bien placé, mal placé, absent", () => {
    expect(answer([1, 2, 3], [1, 2, 3])).toEqual([PLACED, PLACED, PLACED]);
    expect(answer([1, 2, 3], [4, 5, 0])).toEqual([ABSENT, ABSENT, ABSENT]);
    expect(answer([1, 2, 3], [2, 3, 1])).toEqual([MISPLACED, MISPLACED, MISPLACED]);
    expect(answer([1, 2, 3], [1, 3, 5])).toEqual([PLACED, MISPLACED, ABSENT]);
  });

  it("un hiéroglyphe de la solution ne répond qu'à une seule colonne", () => {
    // Un seul 1 dans la solution, déjà bien placé : le second 1 proposé est absent.
    expect(answer([1, 2, 3], [1, 1, 0])).toEqual([PLACED, ABSENT, ABSENT]);
    // Un seul 2, mal placé pour la première colonne qui le propose seulement.
    expect(answer([1, 2, 3], [2, 0, 2])).toEqual([MISPLACED, ABSENT, ABSENT]);
    // Deux 4 dans la solution : les deux propositions mal placées répondent.
    expect(answer([4, 4, 0], [1, 0, 4])).toEqual([ABSENT, MISPLACED, MISPLACED]);
    expect(answer([4, 4, 0], [0, 4, 4])).toEqual([MISPLACED, PLACED, MISPLACED]);
  });

  it("barème : 3 sesterces en un ou deux essais, 2 en trois ou quatre, 1 ensuite", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(gainFor)).toEqual([3, 3, 2, 2, 1, 1, 1]);
  });
});

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu des Hiéroglyphes (M33)", () => {
  it("la case 44 lance le mini-jeu inscrit, après son annonce", async () => {
    const run = await launchMinigame({ module: MODULE });
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(43);
    expect(loaded(run, "K60TE3")).toBe(true);
    expect(loaded(run, "M33DA000.MCC")).toBe(true);
    expect(loaded(run, "M33M.VOC")).toBe(true);
    expect(minigameState<HieroglyphesState>(run)).toMatchObject({ guess: [0, 0, 0], column: 0, cursor: 0, tries: 0, won: false, lost: false });
    run.shot("m33-debut");
  });

  for (const reflexion of [0, 1, 2]) {
    it(`niveau Réflexion ${reflexion} : ${symbolCount(reflexion)} hiéroglyphes, ${timeLimit(reflexion)} s, trouvé au premier essai, 3 sesterces`, async () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const probe = await launchMinigame({ module: MODULE, reflexion }, { seed });
        const { secret, symbols } = minigameState<HieroglyphesState>(probe);
        expect(symbols).toBe(symbolCount(reflexion));
        expect(secret).toHaveLength(COLUMNS);
        expect(secret.every((symbol) => symbol >= 0 && symbol < symbols)).toBe(true);
        // Au niveau 0, la combinaison ne répète aucun hiéroglyphe.
        if (reflexion === 0) expect(new Set(secret).size).toBe(COLUMNS);
      }
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 10 + reflexion });
      const state = minigameState<HieroglyphesState>(run);
      expect(state.limit).toBe(timeLimit(reflexion));
      await playM33(run, true);
      expect(state).toMatchObject({ won: true, lost: false, tries: 1, answers: [PLACED, PLACED, PLACED] });
      run.shot(`m33-niveau${reflexion}-gagne`);
      await run.run(1_500);
      run.shot(`m33-niveau${reflexion}-video`);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(3);
      expect(loaded(run, "M33AC.MUX")).toBe(true);
      expect(loaded(run, "M33AB.MUX")).toBe(false);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("la répétition est possible aux niveaux 1 et 2", async () => {
    let repeated = false;
    for (let seed = 1; seed <= 40 && !repeated; seed++) {
      const run = await launchMinigame({ module: MODULE, reflexion: 2 }, { seed });
      repeated = new Set(minigameState<HieroglyphesState>(run).secret).size < COLUMNS;
    }
    expect(repeated).toBe(true);
  });

  for (const [wrongs, gain] of [
    [1, 3],
    [2, 2],
    [3, 2],
    [4, 1],
    [6, 1],
  ] as const) {
    it(`trouvé au ${wrongs + 1}e essai : ${gain} sesterce(s), ajoutés à ceux du joueur`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 20 + wrongs });
      const state = minigameState<HieroglyphesState>(run);
      minigamePlayer(run).sesterces = 5;
      await compose(run, wrongFor(state));
      for (let n = 0; n < wrongs; n++) {
        await validate(run);
        expect(state.tries).toBe(n + 1);
        expect(state.answers).toEqual(answer(state.secret, state.guess));
      }
      expect(state).toMatchObject({ won: false, lost: false });
      await playM33(run, true);
      expect(state).toMatchObject({ won: true, tries: wrongs + 1 });
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(5 + gain);
    });
  }

  it(`défaite au ${MAX_TRIES}e essai faux : la solution clignote, vidéo M33AB, aucun sesterce perdu`, async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 0 }, { seed: 31 });
    const state = minigameState<HieroglyphesState>(run);
    minigamePlayer(run).sesterces = 4;
    const started = run.host.time;
    await compose(run, wrongFor(state));
    for (let n = 0; n < MAX_TRIES && run.screen === "minigame"; n++) await validate(run);
    run.shot("m33-sept-essais");
    await run.until(() => run.screen !== "minigame", 5_000);
    expect(state).toMatchObject({ won: false, lost: true, tries: MAX_TRIES });
    expect(run.host.time - started).toBeLessThan(timeLimit(0) * 1000);
    await run.run(700);
    run.shot("m33-solution");
    await run.run(4_000);
    run.shot("m33-perdu-video");
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(4);
    expect(loaded(run, "M33AB.MUX")).toBe(true);
    expect(loaded(run, "M33AC.MUX")).toBe(false);
    expect(run.rt.missing).toEqual([]);
  });

  for (const reflexion of [0, 2]) {
    it(`défaite au temps, niveau ${reflexion} : ${timeLimit(reflexion)} s sans trouver`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 41 });
      const state = minigameState<HieroglyphesState>(run);
      const started = run.host.time;
      await playM33(run, false);
      const elapsed = run.host.time - started;
      // À un tick près (le chrono compte en centièmes).
      expect(elapsed).toBeGreaterThan(timeLimit(reflexion) * 1000 - 20);
      expect(elapsed).toBeLessThan((timeLimit(reflexion) + 1) * 1000);
      expect(state).toMatchObject({ won: false, lost: false, tries: 0 });
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(0);
      expect(loaded(run, "M33AB.MUX")).toBe(true);
    });
  }

  it("clavier : haut et bas font défiler les hiéroglyphes en boucle, gauche et droite changent de colonne", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 0 });
    const state = minigameState<HieroglyphesState>(run);
    const press = async (code: string): Promise<void> => {
      await run.tap(code);
      await run.run(400);
    };
    await press("ArrowUp");
    expect(state).toMatchObject({ cursor: 5, guess: [5, 0, 0], column: 0 });
    await press("ArrowDown");
    await press("ArrowDown");
    expect(state).toMatchObject({ cursor: 1, guess: [1, 0, 0] });
    // À gauche de la première colonne, rien ne bouge.
    await press("ArrowLeft");
    expect(state.column).toBe(0);
    await press("ArrowRight");
    expect(state).toMatchObject({ column: 1, cursor: 0 });
    await press("ArrowDown");
    await press("ArrowRight");
    await press("ArrowRight");
    expect(state).toMatchObject({ column: 2, cursor: 0, guess: [1, 1, 0] });
    await press("ArrowLeft");
    expect(state).toMatchObject({ column: 1, cursor: 1 });
    // Une flèche tenue se répète toutes les 30 cs.
    run.host.input.keyDown("ArrowDown");
    await run.run(1_000);
    run.host.input.keyUp("ArrowDown");
    await run.run(400);
    expect(state.guess[1]).toBeGreaterThanOrEqual(4);
    expect(state.tries).toBe(0);
  });

  it("clic ou toucher direct (D11) : hiéroglyphe, colonne, flèches, et un clic ailleurs valide", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 8 });
    const state = minigameState<HieroglyphesState>(run);
    const click = async (zone: { x1: number; y1: number; x2: number; y2: number }): Promise<void> => {
      await run.click((zone.x1 + zone.x2) >> 1, (zone.y1 + zone.y2) >> 1);
      await run.run(400);
    };
    await click(paletteZone(4));
    expect(state).toMatchObject({ column: 0, cursor: 4, guess: [4, 0, 0] });
    await click(columnZone(2));
    expect(state).toMatchObject({ column: 2, cursor: 0 });
    await click(paletteZone(7));
    expect(state.guess).toEqual([4, 0, 7]);
    // La flèche d'une colonne : y aller, puis un cran.
    await click(arrowZone(1, false));
    expect(state).toMatchObject({ column: 1, cursor: 1, guess: [4, 1, 7] });
    await click(arrowZone(0, true));
    expect(state).toMatchObject({ column: 0, cursor: 3, guess: [3, 1, 7] });
    run.shot("m33-clic");
    expect(state.tries).toBe(0);
    // Un clic sur le décor valide, comme le clic gauche de l'original.
    await run.click(40, 60);
    await run.until(() => state.tries === 1, 1_000);
    expect(state.answers).toEqual(answer(state.secret, [3, 1, 7]));
    await run.run(1_600);
    run.shot("m33-reponse");
  });
});
