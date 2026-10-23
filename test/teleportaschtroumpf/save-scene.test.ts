import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { saveOptions } from "../../src/games/teleportaschtroumpf/engine/options";
import { createGameScene, resumeGameScene } from "../../src/games/teleportaschtroumpf/scenes/game";
import { forceMinigameStubs } from "../../src/games/teleportaschtroumpf/scenes/minigames";
import { SAVE_KEY, readSave, type GameSave } from "../../src/games/teleportaschtroumpf/scenes/save";
import { TestHost } from "./engine-test-host";
import { Session } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";

// Ces tests traversent un mini-jeu sans le jouer : la souche commune les garde indépendants des vrais mini-jeux.
forceMinigameStubs();

const TWO = [{ character: 0 }, { character: 3 }];

/** Joue le coloriage (S35, écran 2 haut gauche) : le tour du joueur courant se termine. */
async function playColoring(s: Session) {
  s.place({ screen: 2, row: "top", x: 0x20 });
  await s.tap("Space");
  await s.settle("MinigameStub");
}

/** Images jusqu'à ce que la scène soit entrée (`enter` a créé la partie), sans laisser jouer un tour. */
async function untilEntered(engine: Engine, host: TestHost, entered: () => boolean): Promise<void> {
  for (let i = 0; i < 600 && !entered(); i++) {
    host.time += 1000 / 60;
    engine.frame(host.time);
    await engine.whenLoaded;
  }
  expect(entered()).toBe(true);
}

/** Une partie reprise d'une sauvegarde, sur un moteur neuf (autre graine : seule la sauvegarde compte). */
async function resumed(save: GameSave, seed = 12345) {
  const host = new TestHost();
  host.audio.enabled = false;
  host.storage.set(SAVE_KEY, JSON.stringify(save));
  const engine = new Engine(host, { seed });
  let finished = false;
  const scene = resumeGameScene(save, () => (finished = true));
  await engine.start(scene);
  await untilEntered(engine, host, () => scene.game !== undefined);
  return { host, engine, scene, isFinished: () => finished };
}

describe.skipIf(!hasOriginalFiles)("sauvegarde : partie", () => {
  it("écrite au début de chaque tour, pas pendant un mini-jeu", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    const first = readSave(s.host.storage)!;
    expect(first).not.toBeNull();
    expect(first.state.current).toBe(0);
    expect(first.state.round).toBe(1);
    // Écrite avant l'introduction S19 : la reprise du premier tour la rejoue.
    expect(first.introShown).toBe(false);

    await playColoring(s);
    // Mini-jeu en cours : toujours la sauvegarde du début du tour.
    expect(s.game.state.phase).toBe("minigame");
    expect(readSave(s.host.storage)).toEqual(first);

    await s.tap("Space"); // réussi
    await s.ready();
    const second = readSave(s.host.storage)!;
    expect(second.state.current).toBe(1);
    expect(second.state.players[0].points).toBeGreaterThan(0);
    expect(second.state.phase).toBe("turn");
    expect(second.state.pending).toBeNull();
    expect(second.introShown).toBe(true);
  }, 120_000);

  it("reprise : même joueur, même temps, même suite de tirages qu'une partie non interrompue", async () => {
    const a = await Session.start({ players: TWO, seed: 7 });
    await a.ready();
    await playColoring(a);
    await a.tap("Space");
    await a.ready();
    const save = readSave(a.host.storage)!;
    expect(save.state.current).toBe(1);

    const b = await resumed(save);
    // Dès l'entrée : l'état sauvegardé, temps de partie compris, et le générateur reprend là où il était.
    expect(b.scene.game.state.current).toBe(1);
    expect(b.scene.game.state.elapsed).toBe(save.state.elapsed);
    expect(b.engine.ctx.rng.current).toBe(save.rng);

    const end = b.host.time + 60_000;
    while (!b.scene.board?.playing && b.host.time < end) {
      b.host.time += 1000 / 60;
      b.engine.frame(b.host.time);
      await new Promise((resolve) => setImmediate(resolve));
      const loading = b.engine.whenLoaded;
      if (loading) await loading;
    }
    expect(b.scene.board.playing).toBe(true);

    // Annonce du tour rejouée comme dans la partie d'origine : mêmes tirages, même état.
    expect(b.engine.ctx.rng.current).toBe(a.ctx.rng.current);
    expect(b.scene.game.state.current).toBe(a.game.state.current);
    expect(b.scene.game.state.round).toBe(a.game.state.round);
    expect(b.scene.game.state.players).toEqual(a.game.state.players);
    expect(b.scene.game.state.goal).toEqual(a.game.state.goal);
    // Le temps repart du temps sauvegardé : seule l'annonce du tour s'y ajoute (quelques secondes), pas le temps hors du jeu.
    expect(b.scene.game.state.elapsed).toBeGreaterThanOrEqual(save.state.elapsed);
    expect(b.scene.game.state.elapsed - save.state.elapsed).toBeLessThan(20);
  }, 120_000);

  it("effacée quand la partie est jouée (victoire)", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    expect(readSave(s.host.storage)).not.toBeNull();
    const { goal } = s.game.state;
    Object.assign(s.game.player, { ingredients: goal.ingredients, points: goal.points - 1 });
    await playColoring(s);
    await s.tap("Space");
    await s.settle("VideoScene");
    // Effacée dès la fin connue, avant même la vidéo de fin.
    expect(readSave(s.host.storage)).toBeNull();
    await s.run(1500);
    await s.tap("Escape");
    await s.until(() => s.finished);
    expect(readSave(s.host.storage)).toBeNull();
  }, 120_000);

  it("effacée à l'abandon complet", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    expect(readSave(s.host.storage)).not.toBeNull();
    await s.tap("KeyP");
    await s.settle("PauseScene");
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("AbandonScene");
    await s.tap("ArrowDown"); // « tous »
    await s.tap("Space");
    await s.settle("ConfirmScene");
    await s.tap("Space"); // Oui
    await s.until(() => s.finished);
    expect(s.game.state.result).toEqual({ kind: "abandoned" });
    expect(readSave(s.host.storage)).toBeNull();
  }, 120_000);

  it("une nouvelle partie remplace la sauvegarde de la précédente dès son lancement", async () => {
    const old = await Session.start({ players: TWO, seed: 3 });
    await old.ready();
    const stale = old.host.storage.get(SAVE_KEY)!;
    expect(stale).toBeTruthy();

    const host = new TestHost();
    host.audio.enabled = false;
    host.storage.set(SAVE_KEY, stale);
    const engine = new Engine(host, { seed: 9 });
    saveOptions(host.storage, engine.ctx.options);
    const scene = createGameScene({ players: [{ character: 2 }], options: engine.ctx.options }, () => undefined);
    await engine.start(scene);
    await untilEntered(engine, host, () => scene.game !== undefined);
    // Dès l'entrée dans la partie, avant le moindre tour : plus de sauvegarde de l'ancienne partie.
    expect(readSave(host.storage)).toBeNull();
    expect(scene.game.state.players).toHaveLength(1);
  }, 120_000);
});
