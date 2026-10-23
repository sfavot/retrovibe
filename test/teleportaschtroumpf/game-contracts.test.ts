import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { BorlandRandom } from "../../src/games/teleportaschtroumpf/engine/rng";
import type { Scene } from "../../src/games/teleportaschtroumpf/engine/scene";
import { Game, newGame, type GameEvent } from "../../src/games/teleportaschtroumpf/game/rules";
import type { MinigameOutcome } from "../../src/games/teleportaschtroumpf/game/state";
import { createBoardEventScene, createWellScene } from "../../src/games/teleportaschtroumpf/scenes/events";
import { s42VideoFile } from "../../src/games/teleportaschtroumpf/scenes/grand-schtroumpf";
import { createFreeModeScene, createMapScene } from "../../src/games/teleportaschtroumpf/scenes/s02-map";
import { TestHost } from "./engine-test-host";
import { advance, advanceUntil } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";

function oneGame(seed = 7): Game {
  return newGame({ players: [{ character: 0 }] }, new BorlandRandom(seed));
}

/** Lance `scene` seule sur un moteur de test, sorties audio coupées. */
async function launch(scene: Scene) {
  const host = new TestHost();
  host.audio.enabled = false;
  const engine = new Engine(host, { seed: 7 });
  await engine.start(scene);
  await advance(engine, host, 600);
  const press = async (code: string) => {
    host.input.keyDown(code);
    await advance(engine, host, 150);
    host.input.keyUp(code);
    await advance(engine, host, 150);
  };
  return { host, engine, press };
}

describe("game/ : compléments pour le plateau", () => {
  it("points d'un mini-jeu : un gain supérieur à 3 (S51 : jusqu'à 11) est appliqué en entier, plafonné à 60", () => {
    const game = oneGame();
    game.player.points = 40;
    game.openMinigame(51);
    expect(game.resolveMinigame({ kind: "points", points: 11 })).toContainEqual({ type: "gain", player: 0, points: 11 });
    expect(game.player.points).toBe(51);
    game.openMinigame(51);
    const events = game.resolveMinigame({ kind: "points", points: 11 });
    expect(game.player.points).toBe(60);
    expect(events).toContainEqual({ type: "gain", player: 0, points: 9 });
  });

  it("l'événement hazard donne la position au déclenchement et celle d'arrivée", () => {
    const game = oneGame();
    const p = game.player;
    Object.assign(p, { screen: 4, row: "bottom", x: 0x90 });
    const events: GameEvent[] = [...game.walk(1), ...game.walk(1)];
    const hazard = events.find((e) => e.type === "hazard");
    expect(hazard).toMatchObject({ kind: "trap", scene: 15, from: { screen: 4, row: "bottom" }, to: { screen: 9, row: "top", x: 0x10 } });
    // `from` est dans la plage de marche du piège (0x95..0xC5).
    expect(hazard && hazard.type === "hazard" && hazard.from.x).toBeGreaterThanOrEqual(0x95);
  });

  it("prison, siphon et puits : l'arrivée est la position du pion après l'effet", () => {
    const jail = oneGame();
    Object.assign(jail.player, { screen: 3, row: "bottom", x: 0xa0 });
    jail.state.turn.elapsed = 16;
    const jailed = jail.tick(1).find((e) => e.type === "hazard");
    expect(jailed).toMatchObject({ kind: "jail", from: { screen: 3, row: "bottom", x: 0xa0 }, to: { screen: 3, row: "bottom", x: 0xac } });

    const well = oneGame();
    well.state.turn.wellOpen = true;
    Object.assign(well.player, { screen: 4, row: "top", x: 0xe0 });
    const opened = well.press("button");
    expect(opened.find((e) => e.type === "hazard")).toMatchObject({ kind: "wellDoor", from: { x: 0xe0 }, to: { x: 0x116 } });
    expect(opened.some((e) => e.type === "minigame" && e.request.scene === 14)).toBe(true);
  });

  it("markActive : plus d'indice vocal ce tour", () => {
    const quiet = oneGame();
    expect(quiet.tick(13).some((e) => e.type === "hint")).toBe(true);
    const active = oneGame();
    active.markActive();
    expect(active.tick(13).some((e) => e.type === "hint")).toBe(false);
    expect(active.tick(12).some((e) => e.type === "hint")).toBe(false);
  });

  it("openMinigame / abortMinigame : la requête du mini-jeu hors tour, sans rien appliquer", () => {
    const game = oneGame();
    game.player.level = 2;
    const request = game.openMinigame(24);
    expect(request).toMatchObject({ scene: 24, player: 0, character: 0, level: 2 });
    expect(game.state.pending).toBe(request);
    expect(game.state.phase).toBe("minigame");
    game.abortMinigame();
    expect(game.state.pending).toBeNull();
    expect(game.state.phase).toBe("turn");
    expect(game.state.current).toBe(0);
    expect(() => game.openMinigame(37)).toThrow();
    game.openMinigame(24);
    expect(() => game.openMinigame(25)).toThrow(); // déjà un mini-jeu en cours
  });
});

describe.skipIf(!hasOriginalFiles)("contrats des écrans de la partie", () => {
  it("carte S02 : la consultation rend k = 1 à la validation ; le mode libre rend la main sur « retour »", async () => {
    const results: number[] = [];
    const first = await launch(createMapScene({ mode: "consult", zone: 5 }, (_ctx, k) => results.push(k)));
    await first.press("Space");
    expect(results).toEqual([1]);
    // Échap ne fait rien en mode libre (il joue la voix d'aide du lieu) : seule la validation sur « retour » sort.
    let done = false;
    const free = await launch(createFreeModeScene(() => (done = true)));
    await free.press("Escape");
    expect(done).toBe(false);
    await free.press("Space");
    expect(done).toBe(true);
  }, 60_000);

  it("événements du plateau : la vidéo de libération est chargée, puis la scène rend la main", async () => {
    const game = oneGame();
    const event = { type: "release", player: 0, from: "jail" } as const;
    const at = { screen: 3, row: "bottom", x: 0xac } as const;
    let done = false;
    const scene = createBoardEventScene({ game, event, before: at, after: at }, () => (done = true));
    const { host, engine } = await launch(scene);
    expect(host.loaded.some((f) => /S20[A-O]\.MUX/i.test(f))).toBe(true);
    await advanceUntil(engine, host, () => done, 120_000);
    expect(done).toBe(true);
  }, 120_000);

  it("puits interactif (mode voyage) : carte des vœux quittée sans choix, rien n'est appliqué", async () => {
    const game = oneGame();
    game.player.ingredients = 0xff; // tous les ingrédients : mode voyage, sans tirage
    game.state.turn.wellOpen = true;
    Object.assign(game.player, { screen: 4, row: "top", x: 0xe0 });
    game.press("button");
    expect(game.state.pending).toMatchObject({ scene: 14, wellMode: "travel" });
    let outcome: MinigameOutcome | undefined;
    const { host, engine, press } = await launch(createWellScene(game, (_ctx, o) => (outcome = o)));
    await advanceUntil(engine, host, () => host.loaded.some((f) => /S02A/i.test(f)), 60_000); // voix d'accroche, puis la carte
    await advance(engine, host, 1500);
    await press("Space");
    expect(outcome).toMatchObject({ kind: "well", ingredient: null });
    game.resolveMinigame(outcome!);
    expect(game.state.pending).toBeNull();
  }, 60_000);

  it("Grand Schtroumpf : les vidéos S42 portent le bon nom (le reste : grand-schtroumpf.test.ts)", () => {
    expect(s42VideoFile(31)).toBe("s42a031.mux");
    expect(s42VideoFile(76)).toBe("s42a076.mux");
    expect(s42VideoFile(131)).toBe("s42a131.mux");
  });
});
