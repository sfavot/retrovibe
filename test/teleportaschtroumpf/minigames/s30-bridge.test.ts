import { describe, expect, it } from "vitest";
import { BridgeScene, landingAt } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s30-bridge";
import { hasOriginalFiles } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame } from "./harness";

describe("S30 : fenêtre de clic (pur)", () => {
  it("images 0x36..0x3E : chute, 1, 2 puis 3 points ; ailleurs rien", () => {
    expect(landingAt(0x35, false)).toBeNull();
    expect(landingAt(0x3f, false)).toBeNull();
    for (const f of [0x36, 0x37, 0x38]) expect(landingAt(f, false)).toEqual({ kind: "fall" });
    for (const f of [0x39, 0x3a, 0x3b]) expect(landingAt(f, false)).toMatchObject({ points: 1, x: 0x80 });
    for (const f of [0x3c, 0x3d]) expect(landingAt(f, false)).toMatchObject({ points: 2, x: 0xb5 });
    expect(landingAt(0x3e, false)).toMatchObject({ points: 3, x: 0xf2 });
  });

  it("l'indice de l'oiseau donne 3 points aux deux premières zones", () => {
    expect(landingAt(0x39, true)).toMatchObject({ points: 3 });
    expect(landingAt(0x3c, true)).toMatchObject({ points: 3 });
    expect(landingAt(0x37, true)).toEqual({ kind: "fall" });
  });
});

/** Clique à l'image `frame` de la vidéo (`null` : ne clique jamais). */
async function play(run: LaunchedMinigame, frame: number | null) {
  const scene = run.scene as BridgeScene;
  if (frame !== null) {
    await run.until(() => scene.currentFrame >= frame - 1, 60_000);
    run.host.input.keyDown("Space");
    await run.until(() => scene.stage !== "video", 60_000);
    run.host.input.keyUp("Space");
  }
  return run.finish(120_000);
}

describe.skipIf(!hasOriginalFiles)("S30 Pont de la rivière", () => {
  it.each([
    [0x39, 1],
    [0x3c, 2],
    [0x3e, 3],
  ])("clic à l'image %i : %i point(s)", async (frame, points) => {
    const run = await launchMinigame(30, { seed: 5, level: 1 });
    const outcome = await play(run, frame);
    expect(outcome).toEqual({ kind: "points", points });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.points).toBe(points);
  }, 120_000);

  it("clic trop tôt : chute à l'eau, 0 point", async () => {
    const run = await launchMinigame(30, { seed: 5 });
    await play(run, 0x37);
    expect((run.scene as BridgeScene).landing).toEqual({ kind: "fall" });
    expect(run.outcome).toEqual({ kind: "points", points: 0 });
  }, 120_000);

  it("pas de clic, ou clic hors fenêtre (0x34, 0x3f) : 0 point", async () => {
    for (const frame of [null, 0x34, 0x3f]) {
      const run = await launchMinigame(30, { seed: 5 });
      expect(await play(run, frame)).toEqual({ kind: "points", points: 0 });
    }
  }, 240_000);

  it("le niveau est sans effet, l'oiseau donne 3 points", async () => {
    for (const level of [0, 1, 2]) {
      const run = await launchMinigame(30, { seed: 5, level, bonus: true });
      expect(await play(run, 0x39)).toEqual({ kind: "points", points: 3 });
      expect(run.game.state.bonusTag).toBe(0);
    }
  }, 240_000);

  it("graine fixe : même voix sans gain", async () => {
    const a = await launchMinigame(30, { seed: 9, audio: true });
    const b = await launchMinigame(30, { seed: 9, audio: true });
    await play(a, null);
    await play(b, null);
    expect(a.host.audio.plays.at(-1)!.sound.samples.length).toBe(b.host.audio.plays.at(-1)!.sound.samples.length);
  }, 240_000);

  it("captures", async () => {
    const run = await launchMinigame(30, { seed: 5 });
    await run.run(2000);
    run.shot("s30-video");
    const scene = run.scene as BridgeScene;
    await run.until(() => scene.currentFrame >= 0x3a, 60_000);
    run.host.input.keyDown("Space");
    await run.until(() => scene.stage === "jump");
    await run.run(150);
    run.shot("s30-saut");
    run.host.input.keyUp("Space");
    await run.until(() => scene.stage === "land");
    await run.run(600);
    run.shot("s30-atterrissage");
    await run.finish();
  }, 120_000);

  it("plateau (porte de S30) : les points sont appliqués", async () => {
    const s = await enterFromBoard(30, "BridgeScene", { seed: 3 });
    const scene = s.ctx.scenes.top as BridgeScene;
    await s.until(() => scene.currentFrame >= 0x3b);
    s.host.input.keyDown("Space");
    await s.until(() => scene.stage !== "video");
    s.host.input.keyUp("Space");
    await s.ready();
    expect(s.game.player.points).toBe(2);
    expect(s.game.state.pending).toBeNull();
  }, 240_000);

  it("mode libre : lancement puis retour à la carte", async () => {
    const run = await enterFromFreeMode(30);
    expect(run.scene).toBeInstanceOf(BridgeScene);
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 120_000);
    expect(run.free.currentGame).toBeNull();
  }, 240_000);
});
