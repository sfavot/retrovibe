import { describe, expect, it } from "vitest";
import { createSession } from "../../../src/games/asterix/game/state";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import {
  GAIN,
  MODULE,
  PICTURES,
  TIME_LIMIT,
  TIME_PER_LEVEL,
  anachronismes,
  hitZone,
  pictureFile,
  readAnachronisms,
  type AnachronismesState,
} from "../../../src/games/asterix/scenes/minigames/m25";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { steerPointer } from "./m24-player";
import { playM25, zoneCentre } from "./m25-player";

/**
 * Mini-jeu des Anachronismes (`docs/asterix/minigames/m25.md`) : lancé seul par sa case, joué au clic ou au clavier sur
 * le moteur de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */
registerMinigame(MODULE, anachronismes);

const SCREEN_WIDTH = 320;
const DARK = 0x7e;
const LIGHT = 0x7f;

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));
const voices = (run: Launched): string[] => run.host.loaded.map((path) => /K25TE(\d\d)/i.exec(path)).flatMap((match) => (match ? [match[1]] : []));
const pixel = (run: Launched, x: number, y: number): number => run.rt.ctx.surface.work[y * SCREEN_WIDTH + x];

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu des Anachronismes (M25)", () => {
  it("table DS:22a2 : 44 images, chacune d'un niveau, zone dans l'écran", () => {
    const table = readAnachronisms(readOriginal("ASTERIX.EXE"));
    expect(table).toHaveLength(PICTURES);
    expect([0, 1, 2].map((level) => table.filter((item) => item.level === level).length)).toEqual([17, 13, 14]);
    for (const item of table) {
      const zone = hitZone(item);
      expect(zone.x1).toBeGreaterThanOrEqual(0);
      expect(zone.y1).toBeGreaterThanOrEqual(0);
      expect(zone.x2).toBeGreaterThan(zone.x1);
      expect(zone.y2).toBeGreaterThan(zone.y1);
      expect(zone.x2).toBeLessThanOrEqual(300);
      expect(zone.y2).toBeLessThan(200);
    }
    expect(hitZone(table[5])).toEqual({ x1: 8, y1: 14, x2: 20, y2: 58 });
    expect([pictureFile(0), pictureFile(9), pictureFile(10), pictureFile(43)]).toEqual(["M25DA000.mcg", "M25DA009.mcg", "M25DA010.mcg", "M25DA043.mcg"]);
  });

  it("la case 40 lance le mini-jeu inscrit, après son annonce", async () => {
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<AnachronismesState>(run);
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(39);
    expect(loaded(run, "K60TE")).toBe(true);
    expect(loaded(run, pictureFile(state.picture).toUpperCase())).toBe(true);
    expect(loaded(run, "M25M.VOC")).toBe(true);
    expect(state).toMatchObject({ found: false, missed: false });
    // Le curseur de bibliothèque (contour 0, corps 255) est au centre.
    await run.frame();
    expect([run.host.input.mouseX, run.host.input.mouseY]).toEqual([160, 100]);
    expect(pixel(run, 160, 100)).toBe(0);
    expect(pixel(run, 161, 101)).toBe(0xff);
    expect(Array.from(run.rt.ctx.palette.colors.subarray(765, 768))).toEqual([255, 255, 255]);
    run.shot("m25-debut");
  });

  for (const reflexion of [0, 1, 2]) {
    it(`niveau Réflexion ${reflexion} : une image du niveau, ${TIME_LIMIT - TIME_PER_LEVEL * reflexion} s, victoire et ${GAIN} sesterce`, async () => {
      const table = readAnachronisms(readOriginal("ASTERIX.EXE"));
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 60 + reflexion });
      const state = minigameState<AnachronismesState>(run);
      expect(table[state.picture].level).toBe(reflexion);
      expect(state.zone).toEqual(hitZone(table[state.picture]));
      expect(state.limit).toBe(TIME_LIMIT - TIME_PER_LEVEL * reflexion);
      await run.run(1000);
      await playM25(run, true);
      expect(state).toMatchObject({ found: true, missed: false });
      // La zone est encadrée deux fois et le curseur a disparu.
      const { zone } = state;
      expect(pixel(run, zone.x1 - 1, zone.y1 - 1)).toBe(DARK);
      expect(pixel(run, zone.x2 + 3, zone.y2 + 3)).toBe(DARK);
      expect(pixel(run, zone.x1 - 2, zone.y1 - 2)).toBe(LIGHT);
      expect(pixel(run, zone.x2 + 2, zone.y2 + 2)).toBe(LIGHT);
      const centre = zoneCentre(state);
      expect(pixel(run, centre.x, centre.y)).toBe(run.rt.ctx.surface.background[centre.y * SCREEN_WIDTH + centre.x]);
      await run.frame();
      run.shot(`m25-niveau${reflexion}-trouve`);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(GAIN);
      // Astérix (personnage 0) : `K25TE01` ou `K25TE07`.
      expect(voices(run)).toHaveLength(1);
      expect(["01", "07"]).toContain(voices(run)[0]);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("les bords de la zone : le dernier pixel compte, le suivant non", async () => {
    for (const [inside, seed] of [[true, 70], [false, 71]] as const) {
      const run = await launchMinigame({ module: MODULE }, { seed });
      const state = minigameState<AnachronismesState>(run);
      await run.click(state.zone.x2 + (inside ? 0 : 1), state.zone.y2);
      await run.until(() => run.screen !== "minigame", 1_000);
      expect(state).toMatchObject({ found: inside, missed: !inside });
    }
  });

  it("défaite : un clic à côté ; aucun sesterce, la voix du perdant, la réponse n'est pas montrée", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 7 });
    const state = minigameState<AnachronismesState>(run);
    const started = run.host.time;
    await playM25(run, false);
    expect(state).toMatchObject({ found: false, missed: true });
    expect(run.host.time - started).toBeLessThan(1000);
    expect(Array.from(run.rt.ctx.surface.work)).toEqual(Array.from(run.rt.ctx.surface.background));
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(voices(run)).toEqual(["19"]);
    expect(run.rt.missing).toEqual([]);
  });

  for (const reflexion of [0, 1, 2]) {
    it(`temps écoulé au niveau ${reflexion} : ${TIME_LIMIT - TIME_PER_LEVEL * reflexion} s sans clic, aucun sesterce`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 80 + reflexion });
      const state = minigameState<AnachronismesState>(run);
      const started = run.host.time;
      await run.until(() => run.screen !== "minigame", 60_000);
      const elapsed = run.host.time - started;
      expect(elapsed).toBeGreaterThanOrEqual(state.limit * 1000 - 20);
      expect(elapsed).toBeLessThan(state.limit * 1000 + 100);
      expect(state).toMatchObject({ found: false, missed: false });
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(0);
      expect(voices(run)).toEqual(["13"]);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("la voix dépend du personnage, et le sesterce s'ajoute à ceux du joueur", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 3 });
    const player = minigamePlayer(run);
    player.character = 5;
    player.sesterces = 7;
    await playM25(run, true);
    await untilMinigameOver(run);
    expect(player.sesterces).toBe(7 + GAIN);
    expect(["06", "12"]).toContain(voices(run)[0]);
  });

  it("au clavier : les flèches mènent le curseur depuis le centre, Espace valide", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 14 });
    const state = minigameState<AnachronismesState>(run);
    const { x, y } = zoneCentre(state);
    await steerPointer(run, x, y);
    const { mouseX, mouseY } = run.host.input;
    expect(Math.abs(mouseX - x)).toBeLessThanOrEqual(2);
    expect(Math.abs(mouseY - y)).toBeLessThanOrEqual(2);
    // Le curseur a suivi, sans laisser de trace au centre.
    expect(pixel(run, mouseX + 1, mouseY + 1)).toBe(0xff);
    expect(pixel(run, 161, 101)).toBe(run.rt.ctx.surface.background[101 * SCREEN_WIDTH + 161]);
    run.shot("m25-clavier");
    await run.tap("Space");
    await run.until(() => run.screen !== "minigame", 1_000);
    expect(state.found).toBe(true);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(GAIN);
  });

  it("un clic droit ne répond pas", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 15 });
    await run.tap("Enter");
    await run.run(300);
    expect(run.screen).toBe("minigame");
  });

  it("jamais deux fois de suite la même image dans une séance", async () => {
    const session = createSession({ duration: 7200, objectsRequired: 9 });
    const pictures: number[] = [];
    for (let game = 0; game < 12; game++) {
      const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 200 + game, session });
      pictures.push(minigameState<AnachronismesState>(run).picture);
    }
    expect(pictures.every((picture, i) => i === 0 || picture !== pictures[i - 1])).toBe(true);
    expect(new Set(pictures).size).toBeGreaterThan(3);
  });
});
