import { describe, expect, it } from "vitest";
import {
  GAIN,
  MODULE,
  PHASE_REVEAL,
  PHASE_SEARCH,
  SCENE_COUNT,
  endMarker,
  viewSeconds,
  zoneCount,
  type BrouillardState,
} from "../../../src/games/asterix/scenes/minigames/m26";
import type { Launched } from "../game-helpers";
import { exeTables, hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { inZone, outsideZone, playM26, zoneCentre } from "./m26-player";

/**
 * Mini-jeu du Brouillard (`docs/asterix/minigames/m26.md`) : lancé seul par sa case, joué à la souris ou au clavier sur
 * le moteur de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));
const letter = (state: BrouillardState): string => String.fromCharCode(0x41 + state.scene);
/** Secondes de recherche avant l'arrêt de `m26aa.mux` : marqueurs 1, 2 et 3 aux images 144, 192 et 240, à 6 images par seconde. */
const SEARCH_SECONDS = [40, 32, 24];

async function untilSearch(run: Launched): Promise<BrouillardState> {
  const state = minigameState<BrouillardState>(run);
  await run.until(() => state.phase === PHASE_SEARCH, 2_000);
  return state;
}

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu du Brouillard (M26)", () => {
  it("les tables de l'exécutable : cinq scènes de dix zones, chacune avec son cri, et la flèche", () => {
    const tables = { ...exeTables().fog, cursor: exeTables().libraryCursor };
    expect(tables.sounds).toHaveLength(35);
    expect(tables.sounds[0]).toBe("b26-01a.voc");
    expect(tables.sounds[34]).toBe("b26-35a.voc");
    expect(tables.zones).toHaveLength(SCENE_COUNT);
    expect(tables.zones[0][0]).toEqual({ x1: -21, y1: 35, x2: 142, y2: 169, sound: 28 });
    expect(tables.zones[4][9]).toEqual({ x1: 118, y1: 73, x2: 168, y2: 150, sound: 34 });
    for (const zones of tables.zones) {
      expect(zones).toHaveLength(10);
      for (const zone of zones) {
        expect(zone.sound).toBeGreaterThan(0);
        expect(zone.sound).toBeLessThan(35);
        // Chaque zone a une partie visible, que son centre désigne.
        const { x, y } = zoneCentre(zone);
        expect(inZone(zone, x, y) && x >= 0 && x < 320 && y >= 0 && y < 200).toBe(true);
      }
    }
    // Flèche 16 × 16 : pointe en haut à gauche, contour noir, intérieur blanc.
    expect(tables.cursor).toHaveLength(97);
    expect(tables.cursor[0]).toEqual({ x: 0, y: 0, color: 0 });
    expect(new Set(tables.cursor.map((pixel) => pixel.color))).toEqual(new Set([0, 0xff]));
    expect(tables.cursor.every((pixel) => pixel.x < 16 && pixel.y < 16)).toBe(true);
  });

  it("la case 8 lance le mini-jeu inscrit, après son annonce : la scène, le brouillard, puis la flèche", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 5 });
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(7);
    expect(loaded(run, "K60TE1")).toBe(true);
    const state = await untilSearch(run);
    expect(state.level).toBe(1);
    expect(loaded(run, `M26D${letter(state)}001.MCG`)).toBe(true);
    expect(loaded(run, `M26D${letter(state)}001.MUK`)).toBe(true);
    expect(loaded(run, "M26AA.MUX")).toBe(true);
    expect(state).toMatchObject({ button: 0, won: false, lost: false });
    // Le brouillard : couleurs 1 à 4 des volutes, flèche blanche au centre de l'écran.
    const { colors } = run.rt.ctx.palette;
    expect(Array.from(colors.subarray(0, 15))).toEqual([0, 0, 0, 0x63, 0xa0, 0xa0, 0x7a, 0xa0, 0xa0, 0x6b, 0xa0, 0xa0, 0x8c, 0xa0, 0xa0]);
    expect(run.rt.ctx.surface.work[101 * 320 + 161]).toBe(0xff);
    run.shot("m26-recherche");
  });

  for (const reflexion of [0, 1, 2]) {
    it(`niveau Réflexion ${reflexion} : ${zoneCount(reflexion)} animaux possibles, clic direct sur le bon, ${GAIN} sesterce`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 20 + reflexion });
      const state = await untilSearch(run);
      expect(state.zones).toHaveLength(zoneCount(reflexion));
      expect(state.target).toBeLessThan(state.zones.length);
      const tables = exeTables().fog;
      expect(state.zones).toEqual(tables.zones[state.scene].slice(reflexion * 3, reflexion * 3 + zoneCount(reflexion)));
      const zone = state.zones[state.target];
      expect(loaded(run, tables.sounds[zone.sound].replace("-", "_").toUpperCase())).toBe(true);
      await playM26(run, true);
      expect(state).toMatchObject({ phase: PHASE_REVEAL, button: 1, won: true, lost: false, ...{ clickX: zoneCentre(zone).x, clickY: zoneCentre(zone).y } });
      // Le brouillard se lève sur l'animal encadré de blanc.
      await run.run(1_200);
      const { work } = run.rt.ctx.surface;
      const x = Math.max(0, zone.x1 - 2) + 3;
      const y = Math.min(199, zone.y2 + 1);
      if (zone.y2 + 1 < 200) expect(work[y * 320 + x]).toBe(0xff);
      run.shot(`m26-niveau${reflexion}-gagne`);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(GAIN);
      expect(loaded(run, `M26D${letter(state)}10${reflexion}.MUK`)).toBe(true);
      expect(loaded(run, "K26TE07")).toBe(true);
      expect(run.rt.missing).toEqual([]);
    });

    it(`niveau Réflexion ${reflexion} : sans réponse, la recherche s'arrête au marqueur ${endMarker(reflexion)} (${SEARCH_SECONDS[reflexion]} s), Panoramix, aucun sesterce`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 30 + reflexion });
      const state = await untilSearch(run);
      const started = run.host.time;
      await run.until(() => run.screen !== "minigame", 60_000);
      const elapsed = (run.host.time - started) / 1000;
      expect(elapsed).toBeGreaterThanOrEqual(SEARCH_SECONDS[reflexion] - 0.2);
      expect(elapsed).toBeLessThan(SEARCH_SECONDS[reflexion] + 0.5);
      expect(state).toMatchObject({ button: 0, won: false, lost: false });
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(0);
      expect(loaded(run, "K63TE01")).toBe(true);
      expect(loaded(run, "K26TE")).toBe(false);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("la scène reste visible 8, 6 ou 4 secondes selon le niveau", async () => {
    const waits: number[] = [];
    for (const reflexion of [0, 1, 2]) {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 9 });
      const fogStarted = run.host.loaded.findIndex((path) => path.toUpperCase().includes(".MUK"));
      expect(fogStarted).toBeGreaterThan(0);
      waits.push(run.host.time);
      expect(viewSeconds(reflexion)).toBe([8, 6, 4][reflexion]);
    }
    // Même graine, mêmes chargements : seul le temps d'observation change, de 2 secondes par niveau.
    expect(Math.round((waits[0] - waits[1]) / 100) / 10).toBe(2);
    expect(Math.round((waits[1] - waits[2]) / 100) / 10).toBe(2);
  });

  it("défaite : un clic hors de l'animal, la voix du perdant, aucun sesterce", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 2 }, { seed: 41 });
    const state = await untilSearch(run);
    minigamePlayer(run).sesterces = 4;
    await playM26(run, false);
    expect(state).toMatchObject({ button: 1, won: false, lost: true });
    expect(inZone(state.zones[state.target], state.clickX, state.clickY)).toBe(false);
    await run.run(1_200);
    run.shot("m26-perdu");
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(4);
    expect(loaded(run, "K26TE01")).toBe(true);
    expect(loaded(run, "B26_01A")).toBe(true);
    expect(run.rt.missing).toEqual([]);
  });

  it("cliquer un autre animal de la scène fait perdre aussi", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 2 }, { seed: 42 });
    const state = await untilSearch(run);
    const target = state.zones[state.target];
    const other = state.zones.map(zoneCentre).find(({ x, y }) => !inZone(target, x, y));
    expect(other).toBeDefined();
    await run.click(other!.x, other!.y);
    await run.until(() => run.screen !== "minigame", 2_000);
    expect(state).toMatchObject({ won: false, lost: true });
  });

  it("un clic droit arrête la recherche sans réponse : ni gagné ni perdu", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 43 });
    const state = await untilSearch(run);
    await run.tap("Enter");
    await run.until(() => run.screen !== "minigame", 2_000);
    expect(state).toMatchObject({ button: 2, won: false, lost: false });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(loaded(run, "K63TE01")).toBe(true);
  });

  it("au clavier : les flèches déplacent la flèche de 4 pixels par tick depuis le centre, Espace valide", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 0 }, { seed: 44 });
    const state = await untilSearch(run);
    const { input } = run.host;
    expect([input.mouseX, input.mouseY]).toEqual([160, 100]);
    const goal = zoneCentre(state.zones[state.target]);
    const hold = async (code: string, frames: number): Promise<void> => {
      input.keyDown(code);
      for (let i = 0; i < frames; i++) await run.frame();
      input.keyUp(code);
      await run.frame();
    };
    const dx = Math.round((goal.x - 160) / 4);
    const dy = Math.round((goal.y - 100) / 4);
    await hold(dx < 0 ? "ArrowLeft" : "ArrowRight", Math.abs(dx));
    await hold(dy < 0 ? "ArrowUp" : "ArrowDown", Math.abs(dy));
    expect([input.mouseX, input.mouseY]).toEqual([160 + 4 * dx, 100 + 4 * dy]);
    await run.tap("Space");
    await run.until(() => run.screen !== "minigame", 2_000);
    expect(state).toMatchObject({ button: 1, clickX: 160 + 4 * dx, clickY: 100 + 4 * dy, won: true });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(GAIN);
  });

  it("le robot gagne et perd dans les cinq scènes", async () => {
    const scenes = new Set<number>();
    for (let seed = 1; scenes.size < SCENE_COUNT && seed < 40; seed++) {
      const run = await launchMinigame({ module: MODULE, reflexion: seed % 3 }, { seed });
      const state = minigameState<BrouillardState>(run);
      const win = seed % 2 === 0 || !scenes.has(state.scene);
      scenes.add(state.scene);
      await playM26(run, win);
      expect(state.won).toBe(win);
      expect(state.lost).toBe(!win);
      expect(outsideZone(state.zones[state.target])).toBeDefined();
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(win ? GAIN : 0);
      expect(run.rt.missing).toEqual([]);
    }
    expect(scenes.size).toBe(SCENE_COUNT);
  });
});
