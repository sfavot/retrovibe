import { describe, expect, it } from "vitest";
import { createSession } from "../../../src/games/asterix/game/state";
import {
  GAIN,
  MODULE,
  PICTURES,
  TARGET_SHIFT,
  ZONE_END,
  ZONE_FIRST,
  timeLimit,
  viewSeconds,
  type ColoriagesState,
} from "../../../src/games/asterix/scenes/minigames/m35";
import type { Launched } from "../game-helpers";
import { exeTables, hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { isBlank, paintWrong, paintZone, playM35, selectSwatch, swatchColor, swatchFor, swatchPoint, zonePixel, zonesLeft } from "./m35-player";

/**
 * Mini-jeu des Coloriages (`docs/asterix/minigames/m35.md`) : lancé seul par sa case, joué à la souris ou au clavier sur
 * le moteur de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));
const rgb = (run: Launched, color: number): number[] => Array.from(run.rt.ctx.palette.colors.subarray(color * 3, color * 3 + 3));
/** Vrai si toutes les zones montrent leur couleur attendue. */
const solved = (run: Launched): boolean => {
  for (let zone = ZONE_FIRST; zone < ZONE_END; zone++) if (rgb(run, zone).join() !== rgb(run, zone + TARGET_SHIFT).join()) return false;
  return true;
};

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu des Coloriages (M35)", () => {
  it("la flèche du curseur lue dans l'exécutable : 9 × 15, contour et intérieur", () => {
    const arrow = exeTables().arrow;
    expect(arrow).toHaveLength(135);
    expect(Array.from(arrow.subarray(0, 9))).toEqual([0xff, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(arrow.subarray(18, 27))).toEqual([0xff, 0xfe, 0xff, 0, 0, 0, 0, 0, 0]);
    expect(new Set(arrow)).toEqual(new Set([0, 0xfe, 0xff]));
  });

  it("la case 27 lance le mini-jeu inscrit, après son annonce : le modèle, puis les zones blanchies", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 3 });
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(26);
    expect(loaded(run, "K60TE4")).toBe(true);
    expect(loaded(run, "M35M.VOC")).toBe(true);
    const state = minigameState<ColoriagesState>(run);
    expect(loaded(run, PICTURES[state.picture].file)).toBe(true);
    expect(state).toMatchObject({ selected: 0, painted: 0, won: false, lost: false, blank: 235, limit: 65 });
    expect(state.toPaint).toBeGreaterThan(0);
    for (let zone = ZONE_FIRST; zone < ZONE_END; zone++) expect(rgb(run, zone)).toEqual([235, 235, 235]);
    expect(zonesLeft(run, state)).toHaveLength(state.toPaint);
    // Curseur violet au centre, cadre sur la première pastille.
    expect(rgb(run, 0xff)).toEqual([0x80, 0, 0x80]);
    const { work } = run.rt.ctx.surface;
    expect(work[102 * 320 + 161]).toBe(0xff);
    expect(work[1 * 320 + 0x109]).toBe(0x7f);
    expect(work[2 * 320 + 0x10a]).toBe(1);
    run.shot("m35-depart");
  });

  for (const reflexion of [0, 1, 2]) {
    it(`niveau Réflexion ${reflexion} : ${timeLimit(reflexion)} s, tout colorié, ${GAIN} sesterce`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 50 + reflexion });
      const state = minigameState<ColoriagesState>(run);
      expect(viewSeconds(reflexion)).toBe([8, 6, 4][reflexion]);
      expect(state.limit).toBe([85, 65, 45][reflexion]);
      expect(Math.floor(state.picture / 4)).toBe(reflexion);
      // Mémoire neuve : jamais le premier dessin du groupe.
      expect(state.picture % 4).not.toBe(0);
      expect(state.count).toBe(PICTURES[state.picture].colors);
      // Chaque pastille proposée a sa couleur, toutes différentes.
      const swatches = Array.from({ length: state.count }, (_, i) => rgb(run, swatchColor(state, i)).join());
      expect(new Set(swatches).size).toBe(state.count);
      const zones = state.toPaint;
      await playM35(run, true);
      run.shot(`m35-niveau${reflexion}-gagne`);
      expect(state).toMatchObject({ won: true, lost: false, painted: zones });
      expect(solved(run)).toBe(true);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(GAIN);
      expect(loaded(run, "K35TE05")).toBe(true);
      expect(loaded(run, "B24_03A")).toBe(true);
      expect(run.rt.missing).toEqual([]);
    });

    it(`niveau Réflexion ${reflexion} : sans rien colorier, perdu au bout de ${timeLimit(reflexion)} s`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 60 + reflexion });
      const state = minigameState<ColoriagesState>(run);
      const started = run.host.time;
      await run.until(() => run.screen !== "minigame", 100_000);
      const elapsed = (run.host.time - started) / 1000;
      expect(elapsed).toBeGreaterThanOrEqual(timeLimit(reflexion) - 0.5);
      expect(elapsed).toBeLessThan(timeLimit(reflexion) + 0.5);
      expect(state).toMatchObject({ won: false, lost: false, painted: 0 });
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(0);
      expect(loaded(run, "K35TE03") || loaded(run, "K35TE04")).toBe(true);
      expect(loaded(run, "K35TE01") || loaded(run, "K35TE02")).toBe(false);
      // Temps écoulé : les zones restent blanches.
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("les douze dessins se colorient en entier ; jamais deux fois de suite le même à un niveau", async () => {
    const seen = new Set<number>();
    for (const reflexion of [0, 1, 2]) {
      const session = createSession({ duration: 7200, objectsRequired: 9 });
      let last = reflexion * 4;
      for (let seed = 1; seed < 40 && [0, 1, 2, 3].some((n) => !seen.has(reflexion * 4 + n)); seed++) {
        const run = await launchMinigame({ module: MODULE, reflexion }, { seed, session });
        const state = minigameState<ColoriagesState>(run);
        expect(state.picture).not.toBe(last);
        last = state.picture;
        if (seen.has(state.picture)) continue;
        seen.add(state.picture);
        await playM35(run, true);
        expect(state.won).toBe(true);
        expect(solved(run)).toBe(true);
        run.shot(`m35-dessin${String(state.picture).padStart(2, "0")}`);
      }
    }
    expect(seen.size).toBe(PICTURES.length);
  });

  it("mauvaise couleur : la zone clignote, la solution s'affiche, la voix du perdant, aucun sesterce", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 2 }, { seed: 71 });
    const state = minigameState<ColoriagesState>(run);
    minigamePlayer(run).sesterces = 3;
    // Une zone bien coloriée d'abord : elle ne sauve pas la partie.
    const first = zonesLeft(run, state)[0];
    await paintZone(run, state, first);
    expect(isBlank(run, state, first)).toBe(false);
    expect(state.painted).toBe(1);
    await paintWrong(run, state);
    expect(state).toMatchObject({ lost: true, won: false, painted: 1 });
    await run.until(() => run.screen !== "minigame", 5_000);
    expect(solved(run)).toBe(true);
    run.shot("m35-perdu");
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(3);
    expect(loaded(run, "K35TE01") || loaded(run, "K35TE02")).toBe(true);
    expect(loaded(run, "M35B0000")).toBe(true);
    expect(run.rt.missing).toEqual([]);
  });

  it("le robot perd d'une mauvaise couleur", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 0 }, { seed: 72 });
    const state = minigameState<ColoriagesState>(run);
    await playM35(run, false);
    expect(state).toMatchObject({ lost: true, won: false });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
  });

  it("choix de la couleur : clic sur une pastille, clic droit pour la suivante ; hors d'une zone le clic ne fait rien", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 73 });
    const state = minigameState<ColoriagesState>(run);
    const { work } = run.rt.ctx.surface;
    await selectSwatch(run, state, 3);
    await run.run(100);
    expect(work[(3 * 25 + 1) * 320 + 0x109]).toBe(0x7f);
    // Sous la dernière pastille, le clic choisit la dernière.
    await run.click(swatchPoint(0).x, 195);
    await run.until(() => state.selected === state.count - 1, 1_000);
    // Clic droit (Entrée) : couleur suivante, en boucle.
    await run.run(300);
    await run.tap("Enter");
    await run.until(() => state.selected === 0, 1_000);
    await run.run(300);
    await run.tap("Enter");
    await run.until(() => state.selected === 1, 1_000);
    // Un pixel qui n'est pas une zone (le trait noir, le fond) : rien ne se passe.
    const isZone = (color: number): boolean => color >= ZONE_FIRST && color < ZONE_END;
    const around = [-321, -320, -319, -1, 0, 1, 319, 320, 321];
    const outside = state.pixels.findIndex((_, i) => i % 320 > 0 && i % 320 < 240 && around.every((d) => !isZone(state.pixels[i + d] ?? 0)));
    expect(outside).toBeGreaterThan(0);
    await run.run(300);
    await run.click(outside % 320, Math.floor(outside / 320));
    await run.run(500);
    expect(state).toMatchObject({ painted: 0, lost: false, won: false });
  });

  it("au clavier : les flèches déplacent le curseur de 2 pixels par tick, Espace colorie ; le pas d'origine est rendu ensuite", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 0 }, { seed: 74 });
    const state = minigameState<ColoriagesState>(run);
    const { input } = run.host;
    expect([input.mouseX, input.mouseY]).toEqual([160, 100]);
    expect(input.keyPointerShift).toBe(1);
    // La zone dont la couleur est déjà choisie (pastille 0), atteinte aux flèches.
    const zone = zonesLeft(run, state).find((candidate) => swatchFor(run, state, candidate) === 0)!;
    expect(zone).toBeDefined();
    const goal = zonePixel(state, zone);
    const hold = async (code: string, frames: number): Promise<void> => {
      input.keyDown(code);
      for (let i = 0; i < frames; i++) await run.frame();
      input.keyUp(code);
      await run.frame();
    };
    const dx = Math.round((goal.x - 160) / 2);
    const dy = Math.round((goal.y - 100) / 2);
    await hold(dx < 0 ? "ArrowLeft" : "ArrowRight", Math.abs(dx));
    await hold(dy < 0 ? "ArrowUp" : "ArrowDown", Math.abs(dy));
    expect([input.mouseX, input.mouseY]).toEqual([160 + 2 * dx, 100 + 2 * dy]);
    await run.tap("Space");
    await run.until(() => state.painted === 1, 1_000);
    expect(isBlank(run, state, zone)).toBe(false);
    await playM35(run, true);
    expect(input.keyPointerShift).toBe(2);
  });
});
