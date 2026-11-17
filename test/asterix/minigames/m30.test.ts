import { describe, expect, it } from "vitest";
import { parseHy8 } from "../../../src/engine/infogrames/data/hy8";
import { registerMinigame } from "../../../src/games/asterix/scenes/minigame";
import { GAUGE_VALUES, MODULE, TOO_LATE, gainFor, olympiques, type OlympiquesState } from "../../../src/games/asterix/scenes/minigames/m30";
import type { Launched } from "../game-helpers";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { launchMinigame, minigamePlayer, minigameState, untilMinigameOver } from "./harness";
import { BEST_LEVEL, playM30, throwAt } from "./m30-player";

/**
 * Mini-jeu des Jeux olympiques (`docs/asterix/minigames/m30.md`) : lancé seul par sa case, joué au clic ou au clavier sur
 * le moteur de test. L'état lu est celui que le mini-jeu expose aux robots (`rt.hint.state`).
 */
registerMinigame(MODULE, olympiques);

const loaded = (run: Launched, name: string): boolean => run.host.loaded.some((path) => path.toUpperCase().includes(name));
/** Couleur d'un pixel de la dernière image présentée. */
const pixel = (run: Launched, x: number, y: number): number => run.host.lastPresentation.surface[y * 320 + x];

/** Joue un lancer à `level` cases et rend l'état final, la partie finie. */
async function throwAndFinish(level: number, seed = 1): Promise<{ run: Launched; state: OlympiquesState }> {
  const run = await launchMinigame({ module: MODULE }, { seed });
  const state = minigameState<OlympiquesState>(run);
  await throwAt(run, state, level);
  await run.until(() => run.screen !== "minigame", 20_000);
  run.shot(`m30-lancer-${level}`);
  await run.run(250);
  run.shot(`m30-envol-${level}`);
  await run.run(1_250);
  run.shot(`m30-chute-${level}`);
  await untilMinigameOver(run);
  return { run, state };
}

describe.skipIf(!hasOriginalFiles)("Astérix, mini-jeu des Jeux olympiques (M30)", () => {
  it("la table de la jauge est celle de l'exécutable (DS:310e)", () => {
    const exe = readOriginal("ASTERIX.EXE");
    const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
    const at = view.getUint16(8, true) * 16 + (0x2de2 - 0x1000) * 16 + 0x310e;
    expect(GAUGE_VALUES.map((_, i) => view.getInt16(at + 2 * i, true))).toEqual([...GAUGE_VALUES]);
    expect(BEST_LEVEL).toBe(8);
    expect([1, 4, 5, 6, 7, 8, 9, 10].map(gainFor)).toEqual([0, 0, 1, 1, 2, 3, 0, 0]);
  });

  it("la case 33 lance le mini-jeu inscrit, après son annonce : la vidéo de l'élan, jauge vide", async () => {
    const run = await launchMinigame({ module: MODULE });
    expect(run.rt.hint.module).toBe(MODULE);
    expect(minigamePlayer(run).pos).toBe(32);
    expect(loaded(run, "K60TE2")).toBe(true);
    expect(loaded(run, "M30DA001.MCC")).toBe(true);
    expect(loaded(run, "M30DA002.MCC")).toBe(true);
    expect(loaded(run, "M30A.MUX")).toBe(true);
    expect(minigameState<OlympiquesState>(run)).toMatchObject({ level: 0, clicked: false, stopped: false });
    await run.run(1_000);
    run.shot("m30-elan");
  });

  it("la jauge se remplit d'une case par image de la course, dessinée derrière l'athlète", async () => {
    const run = await launchMinigame({ module: MODULE });
    const state = minigameState<OlympiquesState>(run);
    const sheet = parseHy8(readOriginal("MDF/30/M30S.HY8"));
    const started = run.host.time;
    await run.until(() => state.level === 1, 5_000);
    // Première case à l'image 31 d'une vidéo à 12 images par seconde.
    expect(state.frame).toBe(31);
    expect(run.host.time - started).toBeGreaterThan(2_500);
    expect(run.host.time - started).toBeLessThan(2_700);
    const levels: number[] = [];
    while (run.screen === "minigame" && state.frame < 40) {
      if (levels.at(-1) !== state.level) levels.push(state.level);
      await run.frame();
    }
    run.shot("m30-jauge-pleine");
    expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(state.level).toBe(10);
    // Chaque case est le sprite brut de sa valeur, porté dans les couleurs 128..255 ; l'athlète et son javelot (couleurs
    // 0..127 de la vidéo) passent devant.
    let behind = 0;
    for (let i = 1; i <= 10; i++) {
      const image = sheet.images[GAUGE_VALUES[i] + 16];
      expect([image.width, image.height]).toEqual([16, 11]);
      for (let row = 0; row < 11; row++) {
        for (let col = 0; col < 16; col++) {
          const shown = pixel(run, i * 16 + 0x3d + col, 0x3a + row);
          if (shown < 0x80) behind++;
          else expect(shown).toBe(image.pixels[row * 16 + col] + 0x80);
        }
      }
    }
    expect(behind).toBeGreaterThan(0);
    expect(behind).toBeLessThan(440);
  });

  for (const level of [5, 6, 7, 8]) {
    it(`clic à ${level} cases : le javelot part et retombe, ${gainFor(level)} sesterce(s)`, async () => {
      const { run, state } = await throwAndFinish(level, 10 + level);
      expect(state).toMatchObject({ level, clicked: true, stopped: true, frame: 40 });
      expect(minigamePlayer(run).sesterces).toBe(GAUGE_VALUES[level]);
      expect(run.rt.missing).toEqual([]);
    });
  }

  for (const level of [1, 4]) {
    it(`clic trop tôt (${level} case(s)) : lancer trop court, aucun sesterce`, async () => {
      const { run, state } = await throwAndFinish(level);
      expect(state).toMatchObject({ level, clicked: true, stopped: true });
      expect(minigamePlayer(run).sesterces).toBe(0);
      expect(run.rt.missing).toEqual([]);
    });
  }

  it("clic trop tard (9 cases) ou pas de clic : pas de lancer, la vidéo va à son terme, aucun sesterce", async () => {
    for (const late of [true, false]) {
      const run = await launchMinigame({ module: MODULE });
      const state = minigameState<OlympiquesState>(run);
      const started = run.host.time;
      if (late) {
        expect(GAUGE_VALUES[9]).toBe(TOO_LATE);
        await throwAt(run, state, 9);
      }
      await run.until(() => state.frame >= 60, 20_000);
      run.shot("m30-rate");
      await playM30(run, false);
      expect(state).toMatchObject({ level: 10, clicked: false, stopped: false, frame: 77 });
      // 78 images à 12 images par seconde.
      expect(run.host.time - started).toBeGreaterThan(6_400);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(0);
      expect(run.rt.missing).toEqual([]);
    }
  });

  it("le niveau du joueur ne change rien : même jauge et même gain aux trois niveaux", async () => {
    for (const level of [0, 1, 2]) {
      const run = await launchMinigame({ module: MODULE, action: level, reflexion: level }, { seed: 5 });
      const state = minigameState<OlympiquesState>(run);
      const started = run.host.time;
      await run.until(() => state.level === BEST_LEVEL, 5_000);
      // Image 38 de la vidéo : 3,17 s après son début.
      expect(Math.floor((run.host.time - started) / 100)).toBe(31);
      await playM30(run, true);
      await untilMinigameOver(run);
      expect(minigamePlayer(run).sesterces).toBe(3);
    }
  });

  it("le robot gagne 3 sesterces, qui s'ajoutent à ceux du joueur ; sans lancer il ne gagne rien", async () => {
    const run = await launchMinigame({ module: MODULE }, { seed: 3 });
    minigamePlayer(run).sesterces = 5;
    await playM30(run, true);
    await untilMinigameOver(run);
    expect(minigamePlayer(run).sesterces).toBe(8);
  });

  it("Espace lance comme le clic ; un bouton tenu depuis l'élan lance dès la première case", async () => {
    const space = await launchMinigame({ module: MODULE });
    const state = minigameState<OlympiquesState>(space);
    await space.until(() => state.level === 7, 5_000);
    await space.tap("Space");
    await untilMinigameOver(space);
    expect(state).toMatchObject({ level: 7, stopped: true });
    expect(minigamePlayer(space).sesterces).toBe(2);

    const held = await launchMinigame({ module: MODULE });
    const heldState = minigameState<OlympiquesState>(held);
    held.host.input.pointerHovering = true;
    held.host.input.mouseMove(10, 190);
    held.host.input.mouseDown(0);
    await held.until(() => heldState.clicked, 5_000);
    held.host.input.mouseUp(0);
    expect(heldState.level).toBe(1);
    await untilMinigameOver(held);
    expect(minigamePlayer(held).sesterces).toBe(0);
  });
});
