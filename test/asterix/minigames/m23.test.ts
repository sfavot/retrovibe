import { describe, expect, it } from "vitest";
import { DURATION, FRAME_TICKS, MODULE, ROUND_TIME, STRINGS, WIN_ROUNDS, gain, stringZones, type BardeState } from "../../../src/games/asterix/scenes/minigames/m23";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { STRING_KEYS, playM23, playNote, playRounds, untilWaiting } from "./m23-player";

/**
 * Mini-jeu du Barde (`docs/asterix/minigames/m23.md`) : lancé seul par sa case, joué au clavier ou au clic sur le moteur
 * de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));
const LOSER_VIDEOS = ["M23AC.MUX", "M23AD.MUX", "M23AE.MUX"];
const lostVideo = (run: Launched): boolean => LOSER_VIDEOS.some((name) => loaded(run, name));
const TICK_MS = 1000 / 60;

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu du Barde (M23)", () => {
  it("la case 3 lance le mini-jeu inscrit, après son annonce et la vidéo de la lyre", async () => {
    const run = await launchMinigame({ module: MODULE });
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(2);
    expect(["K60TE04", "K60TE05", "K60TE06"].some((name) => loaded(run, name))).toBe(true);
    expect(loaded(run, "M23AA.MUX")).toBe(true);
    expect(loaded(run, "M23S.HY8")).toBe(true);
    const state = minigameState<BardeState>(run);
    await run.until(() => state.length === 1);
    expect(state).toMatchObject({ phase: "show", index: 0, failed: false, rounds: -1 });
    expect(state.sequence).toHaveLength(1);
    run.shot("m23-demonstration");
  });

  // Règle du tirage par niveau Réflexion : 0 libre, 1 jamais trois fois la même corde de suite, 2 jamais deux fois.
  const maxRun = (sequence: readonly number[]): number => {
    let best = 0;
    let current = 0;
    sequence.forEach((value, i) => {
      current = i > 0 && value === sequence[i - 1] ? current + 1 : 1;
      best = Math.max(best, current);
    });
    return best;
  };
  for (const reflexion of [0, 1, 2]) {
    it(`niveau Réflexion ${reflexion} : sans faute jusqu'au bout des ${DURATION} s, 3 sesterces, tirage du niveau`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 200 + reflexion });
      const state = minigameState<BardeState>(run);
      const started = run.host.time;
      await playM23(run, true);
      expect(state).toMatchObject({ failed: false, timedOut: false });
      expect(run.host.time - started).toBeGreaterThanOrEqual(DURATION * 1000);
      expect(state.rounds).toBe(state.length);
      expect(state.rounds).toBeGreaterThanOrEqual(7);
      expect(state.sequence).toHaveLength(state.length);
      expect(state.sequence.every((value) => value >= 0 && value < STRINGS)).toBe(true);
      if (reflexion > 0) expect(maxRun(state.sequence)).toBeLessThanOrEqual(3 - reflexion);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(3);
      expect(loaded(run, "M23AB.MUX")).toBe(true);
      expect(lostVideo(run)).toBe(false);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("le tirage du niveau, mesuré sur de longues suites", async () => {
    // Douze graines par niveau : le niveau 0 finit par répéter trois fois une corde, le niveau 1 deux fois, le niveau 2 jamais.
    const longest = [0, 0, 0];
    for (const reflexion of [0, 1, 2]) {
      for (let seed = 1; seed <= 12; seed++) {
        const run = await launchMinigame({ module: MODULE, reflexion }, { seed });
        const state = minigameState<BardeState>(run);
        await playRounds(run, 7);
        longest[reflexion] = Math.max(longest[reflexion], maxRun(state.sequence));
      }
    }
    expect(longest[0]).toBeGreaterThanOrEqual(3);
    expect(longest[1]).toBe(2);
    expect(longest[2]).toBe(1);
  }, 30_000);

  for (const rounds of [5, 6, 7]) {
    it(`${rounds} suites réussies puis plus rien : ${gain(rounds)} sesterce(s)`, async () => {
      const run = await launchMinigame({ module: MODULE }, { seed: 30 + rounds });
      const state = minigameState<BardeState>(run);
      minigamePlayer(run).sesterces = 4;
      await playRounds(run, rounds);
      expect(state).toMatchObject({ failed: false, timedOut: true, rounds, length: rounds + 1 });
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(4 + gain(rounds));
      expect(loaded(run, "M23AB.MUX")).toBe(true);
    });
  }

  it(`moins de ${WIN_ROUNDS} suites : perdu, aucun sesterce, une des trois vidéos du perdant`, async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 5 });
    const state = minigameState<BardeState>(run);
    await playRounds(run, WIN_ROUNDS - 1);
    expect(state).toMatchObject({ failed: false, timedOut: true, rounds: WIN_ROUNDS - 1 });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(lostVideo(run)).toBe(true);
    expect(loaded(run, "M23AB.MUX")).toBe(false);
    expect(run.rt.missing).toEqual([]);
  });

  it("défaite : une fausse note arrête tout, même après six suites réussies", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 9 });
    const state = minigameState<BardeState>(run);
    minigamePlayer(run).sesterces = 2;
    // Six suites entières, puis la première corde de la septième, puis une fausse note.
    while (state.length <= 6) await playNote(run, state);
    expect(state).toMatchObject({ length: 7, index: 1 });
    await playNote(run, state, true);
    await run.until(() => run.screen !== "minigame", 5_000);
    expect(state).toMatchObject({ failed: true, rounds: 0, length: 7, index: 1 });
    run.shot("m23-fausse-note");
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(2);
    expect(lostVideo(run)).toBe(true);
    expect(loaded(run, "M23AB.MUX")).toBe(false);
  });

  it("défaite du robot : fausse note dès la première corde", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 2 });
    const state = minigameState<BardeState>(run);
    await playM23(run, false);
    expect(state).toMatchObject({ failed: true, rounds: 0, length: 1 });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(run.rt.missing).toEqual([]);
  });

  it(`sans réponse, la suite s'éteint au bout de ${ROUND_TIME} s`, async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 4 });
    const state = minigameState<BardeState>(run);
    expect(await untilWaiting(run, state)).toBe(true);
    const started = run.host.time;
    await run.until(() => run.screen !== "minigame", 20_000);
    expect(run.host.time - started).toBeGreaterThan((ROUND_TIME - 1) * 1000);
    expect(run.host.time - started).toBeLessThan((ROUND_TIME + 1) * 1000);
    expect(state).toMatchObject({ failed: false, timedOut: true, rounds: 0 });
  });

  it("la démonstration dure huit images par corde, et la réponse joue l'animation de la corde", async () => {
    const again = await launchMinigame({ module: MODULE }, { seed: 6 });
    const s = minigameState<BardeState>(again);
    await playNote(again, s);
    const first = s.sequence[0];
    // Deuxième démonstration : deux cordes.
    await again.until(() => s.phase === "show" && s.length === 2);
    const started = again.host.time;
    await again.until(() => s.phase === "input");
    expect(Math.round((again.host.time - started) / TICK_MS)).toBe(2 * 8 * FRAME_TICKS);
    expect(s.sequence[0]).toBe(first);
    // Réponse : l'animation de la corde (8 images) retient la note suivante.
    expect(await untilWaiting(again, s)).toBe(true);
    await again.tap(STRING_KEYS[s.sequence[0]]);
    expect(s.index).toBe(1);
    const plucked = again.host.time;
    again.shot("m23-corde-pincee");
    expect(await untilWaiting(again, s)).toBe(true);
    expect(again.host.time - plucked).toBeGreaterThan(7 * FRAME_TICKS * TICK_MS);
  });

  it("deux directions à la fois ne pincent aucune corde", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 8 });
    const state = minigameState<BardeState>(run);
    expect(await untilWaiting(run, state)).toBe(true);
    run.host.input.keyDown("ArrowLeft");
    run.host.input.keyDown("ArrowUp");
    await run.frame();
    await run.frame();
    run.host.input.keyUp("ArrowLeft");
    run.host.input.keyUp("ArrowUp");
    await run.run(500);
    expect(state).toMatchObject({ failed: false, index: 0 });
    await playNote(run, state);
    expect(state.index).toBe(1);
  });

  it("clic ou toucher direct (D11) : une corde ou sa cheville la pince ; Espace et un clic ailleurs ne font rien", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 11 });
    const state = minigameState<BardeState>(run);
    const centre = (string: number, slice: number): [number, number] => {
      const zone = stringZones(string)[slice];
      return [Math.floor((zone.x1 + zone.x2) / 2), Math.floor((zone.y1 + zone.y2) / 2)];
    };
    // Les zones de deux cordes ne se recouvrent jamais.
    for (let a = 0; a < STRINGS; a++)
      for (let b = a + 1; b < STRINGS; b++)
        for (const za of stringZones(a)) for (const zb of stringZones(b)) expect(za.x2 < zb.x1 || zb.x2 < za.x1 || za.y2 < zb.y1 || zb.y2 < za.y1).toBe(true);
    // Première suite : Espace et un clic dans le ciel sont sans effet, puis la corde attendue, au milieu de la lyre.
    expect(await untilWaiting(run, state)).toBe(true);
    await run.tap("Space");
    await run.click(300, 100);
    await run.run(300);
    expect(state).toMatchObject({ failed: false, index: 0, waiting: true });
    await run.click(...centre(state.sequence[0], 2));
    expect(state).toMatchObject({ failed: false, index: 1 });
    // Deuxième suite : la première corde par sa cheville (dernière zone), puis une mauvaise corde.
    await run.until(() => state.length === 2 && state.waiting, 10_000);
    await run.click(...centre(state.sequence[0], stringZones(0).length - 1));
    expect(state).toMatchObject({ failed: false, index: 1 });
    expect(await untilWaiting(run, state)).toBe(true);
    await run.click(...centre((state.sequence[1] + 2) % STRINGS, 0));
    expect(state.failed).toBe(true);
  });
});
