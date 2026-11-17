import { describe, expect, it } from "vitest";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import {
  BASE_PIECES,
  GAIN,
  MODULE,
  PICTURES,
  PIECE_HEIGHT,
  PIECE_WIDTH,
  SHOW_SECONDS,
  TIME_LIMIT,
  TIME_PER_LEVEL,
  holeZone,
  loupe,
  slotZone,
  type LoupePiece,
  type LoupeState,
} from "../../../src/games/asterix/scenes/minigames/m24";
import { launch, type Launched } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { holeCentre, playM24, steerPointer, wrongPiece } from "./m24-player";

/**
 * Mini-jeu de la Loupe (`docs/asterix/minigames/m24.md`) : lancé seul par sa case, joué au clic ou au clavier sur le
 * moteur de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */
registerMinigame(MODULE, loupe);

const SCREEN_WIDTH = 320;
const DARK = 0x7e;
const LIGHT = 0x7f;

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));
const voices = (run: Launched, folder: string): string[] =>
  run.host.loaded.map((path) => /K(\d\d)TE(\d\d)/i.exec(path)).flatMap((match) => (match && match[1] === folder ? [match[2]] : []));
const pixel = (run: Launched, x: number, y: number): number => run.rt.ctx.surface.work[y * SCREEN_WIDTH + x];
const target = (state: LoupeState): LoupePiece => state.pieces[state.target];

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu de la Loupe (M24)", () => {
  it("la case 4 lance le mini-jeu inscrit, après son annonce", async () => {
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<LoupeState>(run);
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(3);
    expect(loaded(run, "K60TE")).toBe(true);
    expect(state.picture).toBeLessThan(PICTURES);
    expect(loaded(run, `M24DA00${state.picture}.MCG`)).toBe(true);
    expect(loaded(run, "M24M.VOC")).toBe(true);
    expect(state).toMatchObject({ found: 0, wrong: false });
    run.shot("m24-debut");
  });

  for (const reflexion of [0, 1, 2]) {
    it(`niveau Réflexion ${reflexion} : ${BASE_PIECES + reflexion} morceaux, ${SHOW_SECONDS - reflexion} s d'image entière, victoire et ${GAIN} sesterce`, async () => {
      const run = await launch({ minigame: { module: MODULE, reflexion }, seed: 20 + reflexion });
      // L'image entière reste affichée de la musique au début du jeu.
      await run.until(() => loaded(run, "M24M.VOC"));
      const shown = run.host.time;
      run.shot(`m24-niveau${reflexion}-image`);
      await run.untilScreen("minigame");
      const waited = run.host.time - shown;
      expect(waited).toBeGreaterThanOrEqual((SHOW_SECONDS - reflexion) * 1000);
      expect(waited).toBeLessThan((SHOW_SECONDS - reflexion) * 1000 + 300);

      const state = minigameState<LoupeState>(run);
      const count = BASE_PIECES + reflexion;
      expect(state.pieces).toHaveLength(count);
      expect(state).toMatchObject({ showSeconds: SHOW_SECONDS - reflexion, limit: TIME_LIMIT - TIME_PER_LEVEL * reflexion });
      // Les cases de la colonne sont une permutation ; les trous tiennent dans l'image et ne se chevauchent pas.
      expect(state.pieces.map((piece) => piece.slot).sort()).toEqual(Array.from({ length: count }, (_, i) => i));
      const zones = state.pieces.map(holeZone);
      zones.forEach((zone, i) => {
        expect(zone.x1).toBeGreaterThanOrEqual(0);
        expect(zone.y1).toBeGreaterThanOrEqual(0);
        expect(zone.x2).toBeLessThan(0x113);
        expect(zone.y2).toBeLessThan(200);
        for (const other of zones.slice(0, i)) expect(zone.x1 > other.x2 || zone.x2 < other.x1 || zone.y1 > other.y2 || zone.y2 < other.y1).toBe(true);
      });
      await run.frame();
      run.shot(`m24-niveau${reflexion}-jeu`);

      // Les morceaux sont demandés dans l'ordre de la colonne, de haut en bas ; le dernier n'est pas à replacer.
      const asked: number[] = [];
      while (run.screen === "minigame") {
        asked.push(target(state).slot);
        const { x, y } = holeCentre(target(state));
        await run.click(x, y);
      }
      expect(asked).toEqual(Array.from({ length: count - 1 }, (_, i) => i));
      expect(state).toMatchObject({ found: count - 1, wrong: false });
      await run.run(400);
      run.shot(`m24-niveau${reflexion}-gagne`);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(GAIN);
      // Astérix (personnage 0) : `K24TE19` ou `K24TE25`.
      expect(voices(run, "24")).toHaveLength(1);
      expect(["19", "25"]).toContain(voices(run, "24")[0]);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("un clic abrège l'image entière", async () => {
    const run = await launch({ minigame: { module: MODULE } });
    await run.until(() => loaded(run, "M24M.VOC"));
    await run.run(500);
    const clicked = run.host.time;
    await run.click(100, 100);
    await run.untilScreen("minigame");
    expect(run.host.time - clicked).toBeLessThan(500);
    expect(minigameState<LoupeState>(run).found).toBe(0);
  });

  it("affichage : aplat dans les trous, morceaux dans la colonne, cadre clignotant, trou survolé encadré", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 2 }, { seed: 5 });
    const state = minigameState<LoupeState>(run);
    const { background } = run.rt.ctx.surface;
    await run.click(300, 190);
    for (const piece of state.pieces) {
      const hole = holeZone(piece);
      const shown = slotZone(piece);
      for (const [dx, dy] of [[0, 0], [PIECE_WIDTH - 1, 0], [0, PIECE_HEIGHT - 1], [PIECE_WIDTH - 1, PIECE_HEIGHT - 1], [20, 15]]) {
        expect(pixel(run, hole.x1 + dx, hole.y1 + dy)).toBe(LIGHT);
        expect(pixel(run, shown.x1 + dx, shown.y1 + dy)).toBe(background[(hole.y1 + dy) * SCREEN_WIDTH + hole.x1 + dx]);
      }
    }
    // Le cadre du morceau demandé clignote : 16 centièmes tracé, 16 effacé.
    const corner = (): boolean => pixel(run, 0x113, target(state).slot * 0x21 + 1) === DARK;
    let changes = 0;
    let on = 0;
    let last = corner();
    for (let frame = 0; frame < 192; frame++) {
      await run.frame();
      if (corner() !== last) changes++;
      if (corner()) on++;
      last = corner();
    }
    expect(changes).toBe(20);
    expect(on).toBeGreaterThan(90);
    expect(on).toBeLessThan(102);
    // Le trou sous le pointeur est encadré deux fois, et la flèche (couleur 255, contour 0) y est dessinée.
    const piece = wrongPiece(state);
    const { x, y } = holeCentre(piece);
    run.host.input.mouseMove(x, y);
    await run.frame();
    expect(state.hover).toBe(state.pieces.indexOf(piece));
    expect(pixel(run, piece.x - 0x21, piece.y - 0x29)).toBe(DARK);
    expect(pixel(run, piece.x - 0x22, piece.y - 0x2a)).toBe(LIGHT);
    expect(pixel(run, x, y)).toBe(0);
    expect(pixel(run, x + 1, y + 2)).toBe(0xff);
    expect(Array.from(run.rt.ctx.palette.colors.subarray(765, 768))).toEqual([0x80, 0, 0x80]);
    run.shot("m24-survol");
    run.host.input.mouseMove(300, 190);
    await run.frame();
    expect(state.hover).toBe(-1);
    expect(pixel(run, piece.x - 0x21, piece.y - 0x29)).not.toBe(DARK);
  });

  it("un morceau replacé quitte la colonne et son trou se referme ; un clic hors des trous ne fait rien", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 9 });
    const state = minigameState<LoupeState>(run);
    const { background } = run.rt.ctx.surface;
    const first = target(state);
    const shown = slotZone(first);
    // Cliquer le morceau lui-même dans la colonne, ou le décor, n'est ni juste ni faux.
    await run.click(shown.x1 + 20, shown.y1 + 15);
    await run.click(300, 195);
    expect(state).toMatchObject({ found: 0, wrong: false });
    const { x, y } = holeCentre(first);
    await run.click(x, y);
    expect(first.found).toBe(true);
    expect(state.found).toBe(1);
    expect(target(state).slot).toBe(1);
    run.host.input.mouseMove(300, 195);
    await run.frame();
    expect(pixel(run, x, y)).toBe(background[y * SCREEN_WIDTH + x]);
    expect(pixel(run, shown.x1 + 20, shown.y1 + 15)).toBe(background[(shown.y1 + 15) * SCREEN_WIDTH + shown.x1 + 20]);
    // Recliquer un trou déjà refermé ne compte pas.
    await run.click(x, y);
    expect(state).toMatchObject({ found: 1, wrong: false });
    expect(run.screen).toBe("minigame");
  });

  it("défaite : un mauvais trou arrête le jeu ; aucun sesterce, une des trois voix du perdant", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 1 }, { seed: 31 });
    const state = minigameState<LoupeState>(run);
    const { x, y } = holeCentre(target(state));
    await run.click(x, y);
    await playM24(run, false);
    expect(state).toMatchObject({ found: 1, wrong: true });
    await run.frame();
    // Les trous restants sont rendus à l'image et encadrés.
    for (const piece of state.pieces.filter((other) => !other.found)) {
      expect(pixel(run, piece.x - 0x21, piece.y - 0x29)).toBe(DARK);
      const centre = holeCentre(piece);
      expect(pixel(run, centre.x, centre.y)).toBe(run.rt.ctx.surface.background[centre.y * SCREEN_WIDTH + centre.x]);
    }
    run.shot("m24-perdu");
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(0);
    expect(voices(run, "24")).toHaveLength(1);
    expect(["01", "07", "13"]).toContain(voices(run, "24")[0]);
    expect(run.rt.missing).toEqual([]);
  });

  for (const reflexion of [0, 2]) {
    it(`temps écoulé au niveau ${reflexion} : ${TIME_LIMIT - TIME_PER_LEVEL * reflexion} s, la voix de Panoramix, aucun sesterce`, async () => {
      const run = await launchMinigame({ module: MODULE, reflexion }, { seed: 50 + reflexion });
      const state = minigameState<LoupeState>(run);
      const started = run.host.time;
      const { x, y } = holeCentre(target(state));
      await run.click(x, y);
      await run.until(() => run.screen !== "minigame", 60_000);
      const elapsed = run.host.time - started;
      expect(elapsed).toBeGreaterThanOrEqual(state.limit * 1000 - 20);
      expect(elapsed).toBeLessThan(state.limit * 1000 + 100);
      expect(state).toMatchObject({ found: 1, wrong: false });
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(0);
      expect(voices(run, "24")).toEqual([]);
      expect(loaded(run, "K63TE02")).toBe(true);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("la voix dépend du personnage, et le sesterce s'ajoute à ceux du joueur", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 3 });
    const player = minigamePlayer(run);
    player.character = 4;
    player.sesterces = 7;
    await playM24(run, true);
    await untilMinigameOver(run);
    expect(player.sesterces).toBe(7 + GAIN);
    expect(["23", "29"]).toContain(voices(run, "24")[0]);
  });

  it("au clavier : les flèches mènent le pointeur depuis le centre, Espace valide", async () => {
    const run = await launchMinigame({ module: MODULE, reflexion: 0 }, { seed: 14 });
    const state = minigameState<LoupeState>(run);
    expect([run.host.input.mouseX, run.host.input.mouseY]).toEqual([160, 100]);
    while (run.screen === "minigame") {
      const { x, y } = holeCentre(target(state));
      await steerPointer(run, x, y);
      expect(state.hover).toBe(state.target);
      await run.tap("Space");
    }
    expect(state).toMatchObject({ found: BASE_PIECES - 1, wrong: false });
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(GAIN);
  });
});
