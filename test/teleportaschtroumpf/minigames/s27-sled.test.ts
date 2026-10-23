import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MuxDecoder } from "../../../src/games/teleportaschtroumpf/data/mux";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import {
  LANE_LEFT_LIMIT,
  LANE_RIGHT_LIMIT,
  SLED_MAX_X,
  SLED_MIN_X,
  SLED_START_X,
  SLED_STEP,
  SLED_VIDEOS,
  SledScene,
  createSled,
  frameMarker,
  parseMarker,
  sledHits,
  sledStepSound,
  sledVideo,
  steer,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s27-sled";
import { hasOriginalFiles, listData } from "../helpers";
import type { Scene } from "../../../src/games/teleportaschtroumpf/engine/scene";
import type { TestHost } from "../engine-test-host";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("S27 : règles de la luge (pur, `1f84:0331..03d0`)", () => {
  it("sledStepSound : le bruit s27a002b ne sonne que si le pas n'est pas ramené à une borne", () => {
    expect(sledStepSound(SLED_START_X, false, false)).toBe(false);
    expect(sledStepSound(SLED_START_X, false, true)).toBe(true);
    expect(sledStepSound(SLED_START_X, true, false)).toBe(true);
    expect(sledStepSound(0xfa, false, true)).toBe(false); // 0x118 ramené à 0x100
    expect(sledStepSound(0xdc, false, true)).toBe(true); // 0xFA < 0x100
    expect(sledStepSound(0x46, true, false)).toBe(false); // 0x28 ramené à 0x40
    expect(sledStepSound(0x64, true, false)).toBe(true); // 0x46 > 0x40
    expect(sledStepSound(0xfa, true, true)).toBe(true); // la droite est ramenée, puis la gauche passe
  });

  it("steer : 0x1E par image, bornée à 0x40 et 0x100, la droite puis la gauche", () => {
    expect(steer(SLED_START_X, false, true)).toBe(0xbe);
    expect(steer(SLED_START_X, true, false)).toBe(0x82);
    expect(steer(SLED_START_X, true, true)).toBe(SLED_START_X);
    expect(steer(SLED_START_X, false, false)).toBe(SLED_START_X);
    expect(steer(0xfa, false, true)).toBe(SLED_MAX_X);
    expect(steer(SLED_MAX_X, false, true)).toBe(SLED_MAX_X);
    expect(steer(0x46, true, false)).toBe(SLED_MIN_X);
    expect(steer(SLED_MIN_X, true, false)).toBe(SLED_MIN_X);
    // Les 9 positions atteignables depuis le départ.
    const seen = new Set<number>();
    let x = SLED_START_X;
    for (let i = 0; i < 8; i++) seen.add((x = steer(x, true, false)));
    x = SLED_START_X;
    for (let i = 0; i < 8; i++) seen.add((x = steer(x, false, true)));
    expect([...seen].sort((a, b) => a - b)).toEqual([0x40, 0x46, 0x64, 0x82, 0xbe, 0xdc, 0xfa, 0x100]);
    expect(SLED_STEP).toBe(0x1e);
  });

  it("sledHits : gauche (2) si x < 0x69, centre (4) entre 0x69 et 0xD7 exclus, droite (8) si x > 0xD7", () => {
    for (const x of [0x40, 0x64, 0x68]) {
      expect(sledHits(x, 2)).toBe(true);
      expect(sledHits(x, 4)).toBe(false);
      expect(sledHits(x, 8)).toBe(false);
    }
    for (const x of [0x6a, 0x82, 0xa0, 0xbe, 0xd6]) {
      expect(sledHits(x, 2)).toBe(false);
      expect(sledHits(x, 4)).toBe(true);
      expect(sledHits(x, 8)).toBe(false);
    }
    for (const x of [0xd8, 0xdc, 0xfa, 0x100]) {
      expect(sledHits(x, 2)).toBe(false);
      expect(sledHits(x, 4)).toBe(false);
      expect(sledHits(x, 8)).toBe(true);
    }
    // Les bornes exactes ne touchent rien (comparaisons strictes de l'original).
    for (const marker of [2, 4, 8, 6, 10, 12]) {
      for (const x of [LANE_LEFT_LIMIT, LANE_RIGHT_LIMIT]) expect(sledHits(x, marker)).toBe(false);
    }
    // Combinaisons : un seul couloir reste libre.
    expect(sledHits(0x40, 12)).toBe(false);
    expect(sledHits(0xa0, 12)).toBe(true);
    expect(sledHits(0xfa, 12)).toBe(true);
    expect(sledHits(0xa0, 10)).toBe(false);
    expect(sledHits(0x40, 10)).toBe(true);
    expect(sledHits(0xfa, 10)).toBe(true);
    expect(sledHits(0xfa, 6)).toBe(false);
    expect(sledHits(0xa0, 6)).toBe(true);
    expect(sledHits(0x40, 6)).toBe(true);
    // Pas d'obstacle : 0 ; l'arrivée (1) ne touche rien.
    expect(sledHits(0xa0, 0)).toBe(false);
    expect(sledHits(0xa0, 1)).toBe(false);
  });

  it("marqueur : atoi du texte ASCII (le dernier chunk d'une image l'emporte, 0 sans marqueur)", () => {
    expect(parseMarker(ascii("12"))).toBe(12);
    expect(parseMarker(ascii("6"))).toBe(6);
    expect(parseMarker(Uint8Array.from([0x38, 0]))).toBe(8);
    expect(parseMarker(ascii("x"))).toBe(0);
    expect(frameMarker([])).toBe(0);
    expect(frameMarker([ascii("2"), ascii("10")])).toBe(10);
  });

  it("vidéo par niveau : e/f, h, i/j, et l/i avec l'indice de l'oiseau (niveau 3)", () => {
    expect(SLED_VIDEOS).toEqual([["s27f.mux", "s27e.mux"], ["s27h.mux", "s27h.mux"], ["s27j.mux", "s27i.mux"], ["s27l.mux", "s27i.mux"]]);
    expect(sledVideo(0, 0)).toBe("s27f.mux");
    expect(sledVideo(0, 1)).toBe("s27e.mux");
    expect(sledVideo(1, 0)).toBe("s27h.mux");
    expect(sledVideo(1, 1)).toBe("s27h.mux");
    expect(sledVideo(2, 0)).toBe("s27j.mux");
    expect(sledVideo(3, 0)).toBe("s27l.mux");
    expect(sledVideo(3, 1)).toBe("s27i.mux");
  });

  it("la requête est exigée : Game.openMinigame(27) d'abord", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createSled(game, () => undefined)).toThrow(/openMinigame\(27\)/);
  });
});

/** Marqueur de chaque image d'une vidéo (comme `179a:016e` : le dernier chunk 08 de l'image) : `frame → valeur`. */
function markersOf(file: string): Map<number, number> {
  const [path] = listData((name) => name.toUpperCase() === file.toUpperCase());
  const decoder = new MuxDecoder(new Uint8Array(readFileSync(`original/teleportaschtroumpf/DATA/${path}`)));
  const out = new Map<number, number>();
  for (let frame = 0; ; frame++) {
    const decoded = decoder.nextFrame();
    if (!decoded) break;
    const marker = frameMarker(decoded.markers);
    if (marker !== 0) out.set(frame, marker);
  }
  return out;
}

const POSITIONS = [0x40, 0x46, 0x64, 0x82, 0xa0, 0xbe, 0xdc, 0xfa, 0x100];

/**
 * Pilote : regarde les marqueurs des prochaines images et pousse la luge vers un couloir libre. Les touches sont tenues tant que la
 * luge n'est pas arrivée (à une demi-foulée près), comme un joueur qui regarde la descente.
 */
function bot(run: { scene: Scene; host: TestHost }, markers: Map<number, number>) {
  const scene = run.scene as SledScene;
  const held = { left: false, right: false };
  const set = (left: boolean, right: boolean) => {
    for (const [name, code, on] of [["left", "ArrowLeft", left], ["right", "ArrowRight", right]] as const) {
      if (held[name] === on) continue;
      held[name] = on;
      if (on) run.host.input.keyDown(code);
      else run.host.input.keyUp(code);
    }
  };
  return () => {
    if (scene.stage !== "ride") return set(false, false);
    let target: number | null = null;
    for (let frame = scene.currentFrame + 1; frame <= scene.currentFrame + 10 && target === null; frame++) {
      const marker = markers.get(frame) ?? 0;
      if (marker > 1) {
        const safe = POSITIONS.filter((x) => !sledHits(x, marker));
        target = safe.reduce((best, x) => (Math.abs(x - scene.position) < Math.abs(best - scene.position) ? x : best));
      }
    }
    if (target === null || Math.abs(target - scene.position) < SLED_STEP / 2) return set(false, false);
    set(target < scene.position, target > scene.position);
  };
}

/** Graine dont la descente est `file` au niveau voulu. */
async function seedFor(file: string, options: LaunchOptions): Promise<LaunchedMinigame> {
  for (let seed = 1; seed < 100; seed++) {
    const run = await launchMinigame(27, { ...options, seed });
    if ((run.scene as SledScene).video === file) return run;
  }
  throw new Error(`aucune graine ne donne ${file}`);
}

describe.skipIf(!hasOriginalFiles)("S27 La Luge : descente en vidéo, obstacles, issue", () => {
  it("le niveau choisit la vidéo : 0 → e ou f, 1 → h, 2 → i ou j, indice de l'oiseau → l ou i ; chaque variante sort", async () => {
    const seen: Record<string, Set<string>> = { "0": new Set(), "1": new Set(), "2": new Set(), bonus: new Set() };
    for (let seed = 1; seed <= 24; seed++) {
      for (const level of [0, 1, 2]) seen[level].add(((await launchMinigame(27, { seed, level })).scene as SledScene).video);
      const run = await launchMinigame(27, { seed, bonus: true });
      seen.bonus.add((run.scene as SledScene).video);
      expect(run.game.state.pending?.bonus).toBe(true);
      expect(run.game.state.bonusTag).toBe(0);
    }
    expect([...seen["0"]].sort()).toEqual(["s27e.mux", "s27f.mux"]);
    expect([...seen["1"]]).toEqual(["s27h.mux"]);
    expect([...seen["2"]].sort()).toEqual(["s27i.mux", "s27j.mux"]);
    expect([...seen.bonus].sort()).toEqual(["s27i.mux", "s27l.mux"]);
  }, 120_000);

  it("l'indice « mine » (36) n'est pas consommé par la luge, l'indice « luge » (27) l'est (S36 a son propre indice)", async () => {
    const mine = await launchMinigame(27, { level: 1, setup: (game) => (game.state.bonusTag = 36) });
    expect(mine.game.state.pending?.bonus).toBe(false);
    expect(mine.game.state.bonusTag).toBe(36);
    expect((mine.scene as SledScene).video).toBe("s27h.mux");
    const sled = await launchMinigame(27, { level: 1, setup: (game) => (game.state.bonusTag = 27) });
    expect(sled.game.state.pending?.bonus).toBe(true);
    expect(sled.game.state.bonusTag).toBe(0);
  }, 30_000);

  it("graine fixe : même vidéo", async () => {
    const a = await launchMinigame(27, { seed: 9, level: 2 });
    const b = await launchMinigame(27, { seed: 9, level: 2 });
    expect((a.scene as SledScene).video).toBe((b.scene as SledScene).video);
  }, 30_000);

  it("sans rien toucher, la luge reste au centre et heurte le premier obstacle qui le barre (s27e : image 42, marqueur 12)", async () => {
    const run = await seedFor("s27e.mux", { level: 0 });
    const scene = run.scene as SledScene;
    expect(scene.stage).toBe("ride");
    await run.until(() => scene.stage !== "ride", 30_000);
    expect(scene.hasCrashed).toBe(true);
    expect(scene.currentFrame).toBe(42);
    expect(scene.position).toBe(SLED_START_X);
    expect(run.outcome).toBeUndefined();
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "ingredient", success: false });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients).toBe(0);
  }, 60_000);

  it("la chute : animation de 2 images au quart de seconde, son s27a003b, fondu, puis la vidéo d'échec s27b", async () => {
    const run = await seedFor("s27e.mux", { level: 0, audio: true });
    const scene = run.scene as SledScene;
    const crash = await run.ctx.resources.voc("s27a003b.voc");
    await run.until(() => scene.stage === "crash", 30_000);
    run.shot("s27-chute-0");
    await run.run(300);
    run.shot("s27-chute-1");
    await run.run(300);
    run.shot("s27-chute-2");
    expect(run.host.audio.plays.at(-1)?.sound.samples).toEqual(crash.samples);
    const stages = new Set<string>();
    await run.until(() => {
      stages.add(scene.stage);
      return scene.stage === "result";
    }, 30_000);
    expect([...stages]).toEqual(expect.arrayContaining(["crash", "fadeOut", "result"]));
    await run.run(1000);
    run.shot("s27-echec-video");
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: false });
  }, 90_000);

  it("pilote qui évite tout : la descente va au bout, vidéo s27c1 (hors objectif), ingrédient 2 donné", async () => {
    const run = await seedFor("s27e.mux", { level: 0, setup: (game) => (game.state.goal.ingredients &= ~(1 << 2)) });
    const scene = run.scene as SledScene;
    const markers = markersOf("S27E.MUX");
    const act = bot(run, markers);
    await run.until(() => {
      act();
      return scene.stage !== "ride";
    }, 60_000);
    expect(scene.hasCrashed).toBe(false);
    expect(scene.reachedFinish).toBe(false);
    expect(scene.currentFrame).toBeGreaterThan(420);
    expect(scene.stage).toBe("result");
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "ingredient", success: true });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients & (1 << 2)).not.toBe(0);
  }, 120_000);

  it("réussite : s27c2 quand l'ingrédient 2 fait partie de l'objectif", async () => {
    const run = await seedFor("s27h.mux", { level: 1, setup: (game) => (game.state.goal.ingredients |= 1 << 2) });
    const markers = markersOf("S27H.MUX");
    const act = bot(run, markers);
    const scene = run.scene as SledScene;
    await run.until(() => {
      act();
      return scene.stage !== "ride";
    }, 60_000);
    expect(scene.hasCrashed).toBe(false);
    const files: string[] = [];
    run.host.loaded.forEach((f) => files.push(f));
    expect(files.some((f) => /S27C2\.MUX/i.test(f))).toBe(true);
    expect(files.some((f) => /S27C1\.MUX/i.test(f))).toBe(false);
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: true });
  }, 120_000);

  it("l'arrivée peut être un marqueur (s27i, image 318 sur 364) : la descente s'arrête là, réussie", async () => {
    const run = await seedFor("s27i.mux", { level: 2 });
    const scene = run.scene as SledScene;
    const markers = markersOf("S27I.MUX");
    expect(markers.get(318)).toBe(1);
    const act = bot(run, markers);
    await run.until(() => {
      act();
      return scene.stage !== "ride";
    }, 60_000);
    expect(scene.reachedFinish).toBe(true);
    expect(scene.hasCrashed).toBe(false);
    expect(scene.currentFrame).toBe(318);
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: true });
  }, 120_000);

  it("indice de l'oiseau : s27l, la plus courte (216 images, 4 obstacles), faisable", async () => {
    const run = await seedFor("s27l.mux", { bonus: true });
    const scene = run.scene as SledScene;
    const markers = markersOf("S27L.MUX");
    expect([...markers.keys()].length).toBeLessThan(12);
    const act = bot(run, markers);
    await run.until(() => {
      act();
      return scene.stage !== "ride";
    }, 60_000);
    expect(scene.hasCrashed).toBe(false);
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: true });
  }, 120_000);

  it("clavier : droite tenue = 0x1E par image jusqu'à 0x100 ; gauche tenue jusqu'à 0x40 ; un appui plus court qu'une image compte", async () => {
    const run = await seedFor("s27h.mux", { level: 1 });
    const scene = run.scene as SledScene;
    run.host.input.keyDown("ArrowRight");
    await run.until(() => scene.currentFrame >= 1, 5000);
    expect(scene.position).toBe(0xbe);
    await run.until(() => scene.position === SLED_MAX_X, 5000);
    run.host.input.keyUp("ArrowRight");
    run.host.input.keyDown("KeyZ"); // Z = gauche (clavier d'origine)
    await run.until(() => scene.position === SLED_MAX_X - SLED_STEP, 5000);
    run.host.input.keyUp("KeyZ");
    const before = scene.currentFrame;
    const x = scene.position;
    // Appui de 2 ticks, entre deux images : l'image suivante en tient compte.
    run.host.input.keyDown("ArrowLeft");
    await run.run(2 * (1000 / 60));
    run.host.input.keyUp("ArrowLeft");
    await run.until(() => scene.currentFrame > before, 2000);
    expect(scene.position).toBe(x - SLED_STEP);
  }, 60_000);

  it("la descente ne se passe pas (Échap, Espace sans effet) ; les vidéos de fin se passent", async () => {
    const run = await seedFor("s27e.mux", { level: 0 });
    const scene = run.scene as SledScene;
    await run.run(1000);
    await run.tap("Escape");
    await run.tap("Space");
    expect(scene.stage).toBe("ride");
    await run.until(() => scene.stage === "result", 60_000);
    await run.run(500);
    await run.tap("Escape");
    expect(await run.finish(5000)).toEqual({ kind: "ingredient", success: false });
  }, 120_000);

  it("captures : la luge sur la descente (niveau 1)", async () => {
    const run = await seedFor("s27h.mux", { level: 1 });
    await run.run(1200);
    run.shot("s27-descente-centre");
    run.host.input.keyDown("ArrowRight");
    await run.run(900);
    run.host.input.keyUp("ArrowRight");
    run.shot("s27-descente-droite");
    expect((run.scene as SledScene).position).toBeGreaterThan(SLED_START_X);
    expect((run.scene as SledScene).stage).toBe("ride");
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("S27 La Luge : parcours depuis le plateau et depuis le mode libre", () => {
  /** La descente jouée par le pilote, jusqu'à la vidéo de fin. */
  const drive = async (scene: SledScene, host: TestHost, step: () => Promise<void>) => {
    const act = bot({ scene, host }, markersOf(scene.video.toUpperCase()));
    while (scene.stage === "ride") {
      act();
      await step();
    }
    expect(scene.hasCrashed).toBe(false);
  };

  it("plateau, porte de l'écran 5 : obstacle heurté → rien n'est gagné, le tour est fini", async () => {
    const s = await enterFromBoard(27, "SledScene", { seed: 11 });
    const scene = s.ctx.scenes.top as SledScene;
    expect(s.game.state.pending).toMatchObject({ scene: 27, player: 0 });
    expect(s.game.state.phase).toBe("minigame");
    await s.until(() => scene.stage === "result", 90_000);
    expect(scene.hasCrashed).toBe(true);
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.player.ingredients).toBe(0);
    expect(s.history).toContain("SledScene");
  }, 180_000);

  it("plateau : descente réussie → l'ingrédient 2 est donné, objectif ou non", async () => {
    const s = await enterFromBoard(27, "SledScene", { seed: 11 });
    const scene = s.ctx.scenes.top as SledScene;
    await drive(scene, s.host, () => s.run(32));
    await s.run(800);
    await s.tap("Escape");
    await s.ready();
    expect(s.game.player.ingredients & (1 << 2)).not.toBe(0);
    expect(s.game.player.ingredientCount).toBe(1);
    expect(s.game.state.pending).toBeNull();
  }, 180_000);

  it("mode libre, lieu 13 : la descente se joue, puis la carte revient sur le même lieu sans rien appliquer", async () => {
    const run = await enterFromFreeMode(27);
    const scene = run.scene as SledScene;
    expect(scene).toBeInstanceOf(SledScene);
    expect(run.game.state.pending).toMatchObject({ scene: 27 });
    const level = run.game.state.pending!.level;
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(2);
    await run.until(() => scene.stage === "result", 90_000);
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.shown.selection).toBe(13);
    expect(run.free.currentGame).toBeNull();
  }, 180_000);

  it("mode libre : descente réussie, même retour à la carte", async () => {
    const run = await enterFromFreeMode(27, { seed: 5 });
    const scene = run.scene as SledScene;
    await drive(scene, run.host, () => run.run(32));
    await run.run(800);
    await run.tap("Escape");
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 30_000);
    expect(run.free.shown.selection).toBe(13);
  }, 180_000);
});
