import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import { BIRD_HINT_SCENES } from "../../../src/games/teleportaschtroumpf/game/tables";
import {
  BIRD_PLACES,
  BIRD_STORIES,
  BirdAftermathScene,
  BirdScene,
  WAIT_CLIP,
  createBird,
  createBirdAftermath,
  pickStory,
  storyFile,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s39-bird";
import { hasOriginalFiles, listData } from "../helpers";
import { enterFromBoard, launchMinigame } from "./harness";

describe("S39 : tirage de l'histoire et tables (pur, `265b:000d`)", () => {
  it("seul : histoires 0 à 4 (a à e) ; à plusieurs : 5 à 7 (avec les vidéos k)", () => {
    for (const roll of [0, 1, 4, 5, 31999, 12345]) {
      expect(pickStory(roll, 1)).toBeLessThan(5);
      expect(pickStory(roll, 1)).toBe(roll % 5);
      expect(pickStory(roll, 2)).toBeGreaterThanOrEqual(5);
      expect(pickStory(roll, 4)).toBe((roll % 3) + 5);
    }
    expect(BIRD_STORIES).toHaveLength(8);
    expect(BIRD_STORIES.slice(0, 5).some((s) => s.includes(WAIT_CLIP))).toBe(false);
    expect(BIRD_STORIES.slice(5).every((s) => s.includes(WAIT_CLIP))).toBe(true);
    expect(storyFile("a1")).toBe("s39a1.mux");
  });

  it("17 lieux, dans l'ordre de BIRD_HINT_SCENES, sur les trois cartes s02a004d à s02a006d", () => {
    expect(BIRD_PLACES).toHaveLength(BIRD_HINT_SCENES.length);
    expect([0, 1, 2].map((r) => BIRD_PLACES.filter((p) => p.region === r).length)).toEqual([5, 6, 6]);
    expect(BIRD_PLACES.map((p) => p.voice).sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, i) => i));
  });

  it("la requête est exigée ; l'après-coup sans événement `bird` ne montre rien", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createBird(game, () => undefined)).toThrow(/openMinigame\(39\)/);
    expect(createBirdAftermath(game, [], () => undefined)).toBeNull();
    expect(createBirdAftermath(game, [{ type: "bird", scene: 33 }], () => undefined)).toBeInstanceOf(BirdAftermathScene);
  });
});

describe.skipIf(!hasOriginalFiles)("S39 L'Oiseau : fichiers", () => {
  it("toutes les vidéos des histoires existent", () => {
    const names = new Set(listData((n) => /^S39.*\.MUX$/i.test(n)).map((p) => p.split("/").pop()!.toLowerCase()));
    for (const story of BIRD_STORIES) for (const clip of story) expect(names.has(storyFile(clip))).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("S39 L'Oiseau : l'histoire", () => {
  it("un joueur : une histoire courte, vidéos non passables, issue `none`, puis le tirage de la scène désignée", async () => {
    const run = await launchMinigame(39, { seed: 5 });
    const scene = run.scene as BirdScene;
    expect(scene.storyIndex).toBeLessThan(5);
    expect(scene.files).toEqual(BIRD_STORIES[scene.storyIndex].map(storyFile));
    await run.run(1500);
    run.shot("s39-histoire");
    await run.run(2000);
    run.shot("s39-histoire-2");
    await run.run(2500);
    run.shot("s39-histoire-3");
    await run.tap("Escape");
    await run.tap("Space");
    expect(run.outcome).toBeUndefined();
    expect(scene.clipIndex).toBe(0);
    const outcome = await run.finish();
    expect(outcome).toEqual({ kind: "none" });
    const events = run.game.resolveMinigame(outcome);
    const bird = events.find((e) => e.type === "bird");
    expect(bird).toBeDefined();
    expect(run.game.state.bonusTag).toBe(bird!.type === "bird" ? bird!.scene : -1);
    expect(BIRD_HINT_SCENES).toContain(run.game.state.bonusTag);
  }, 120_000);

  it("graine fixe : même histoire ; toutes les histoires courtes sortent", async () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 25; seed++) seen.add(((await launchMinigame(39, { seed })).scene as BirdScene).storyIndex);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    const a = (await launchMinigame(39, { seed: 8 })).scene as BirdScene;
    const b = (await launchMinigame(39, { seed: 8 })).scene as BirdScene;
    expect(a.storyIndex).toBe(b.storyIndex);
  }, 120_000);

  it("l'après-coup : carte de la région, main sur le lieu, voix, pause, puis une seule fin", async () => {
    for (const hint of [22, 33, 27]) {
      let ended = 0;
      const run = await launchMinigame(39, {
        factory: (_id, game) => createBirdAftermath(game, [{ type: "bird", scene: hint }], () => ended++)!,
      });
      const scene = run.scene as BirdAftermathScene;
      expect(scene.place).toBe(BIRD_PLACES[BIRD_HINT_SCENES.indexOf(hint)]);
      await run.until(() => scene.phase === "pause", 30_000);
      run.shot(`s39-main-${hint}`);
      await run.until(() => scene.phase === "done", 30_000);
      await run.run(500);
      expect(ended).toBe(1);
    }
  }, 120_000);

  it("l'après-coup attend la fin de la voix puis une demi-seconde", async () => {
    const run = await launchMinigame(39, { audio: true, factory: (_id, game) => createBirdAftermath(game, [{ type: "bird", scene: 40 }], () => undefined)! });
    const scene = run.scene as BirdAftermathScene;
    await run.until(() => scene.phase === "voice", 10_000);
    await run.run(300);
    expect(scene.phase).toBe("voice");
    await run.until(() => scene.phase === "pause", 60_000);
    expect(run.ctx.voice.voicePlaying).toBe(false);
  }, 120_000);
});

describe.skipIf(!hasOriginalFiles)("S39 L'Oiseau : parcours depuis le plateau", () => {
  it("un joueur : histoire, puis la carte avec la main, l'indice est posé pour la partie suivante", async () => {
    const s = await enterFromBoard(39, "BirdScene", { seed: 4 });
    expect(s.game.state.pending).toMatchObject({ scene: 39, player: 0 });
    await s.until(() => s.top() === "BirdAftermathScene", 180_000);
    expect(BIRD_HINT_SCENES).toContain(s.game.state.bonusTag);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.history).toContain("BirdAftermathScene");
  }, 300_000);

  it("deux joueurs : une longue histoire, l'attente après k2 se lève par Espace", async () => {
    const s = await enterFromBoard(39, "BirdScene", { seed: 4, players: [{ character: 0 }, { character: 1 }] });
    const scene = s.ctx.scenes.top as BirdScene;
    expect(scene.storyIndex).toBeGreaterThanOrEqual(5);
    await s.until(() => scene.phase === "wait", 120_000);
    await s.run(2000);
    expect(scene.phase).toBe("wait");
    await s.tap("Space");
    await s.until(() => s.top() === "BirdAftermathScene", 120_000);
    await s.ready();
  }, 300_000);
});
