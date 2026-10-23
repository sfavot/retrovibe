import { describe, expect, it } from "vitest";
import type { Hy8 } from "../../../src/games/teleportaschtroumpf/data/hy8";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import { DragonScene, createDragon, dragonClip } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s22-dragon";
import {
  BIRD_START_COUNT,
  DELAY_BASES,
  DRAGON_REST_X,
  DRAGON_STEP,
  DragonRun,
  delayBase,
  dragonHits,
  laneY,
  type DragonContext,
  type SmurfPose,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/s22/run";
import { hasOriginalFiles, listData } from "../helpers";
import { enterFromBoard, enterFromFreeMode, launchMinigame, type LaunchedMinigame, type LaunchOptions } from "./harness";

const INGREDIENT = 3;

const goalWith = (required: boolean) => (game: ReturnType<typeof newGame>) => {
  if (required) game.state.goal.ingredients |= 1 << INGREDIENT;
  else game.state.goal.ingredients &= ~(1 << INGREDIENT);
};

/** Feuilles factices : `[nombre d'images]` par animation. */
function fakeSheet(counts: number[]): Hy8 {
  return {
    images: [],
    sprites: [],
    trailer: new Uint8Array(),
    animations: counts.map((n) => ({ header: 0, frames: Array.from({ length: n }, (_, i) => ({ sprite: i, flags: 0, duration: 1, dx: 0, dy: 0 })) })),
  };
}

/** Dragon (6 images), pose « haut » (9) ; repos (1), pose « bas » (9), brûlure (7) : les nombres d'images des vrais fichiers. */
const sprites = () => ({ dragonSheet: fakeSheet([6, 9]), smurfSheet: fakeSheet([1, 9, 7]) });

/** Contexte scripté : les tirages sont dans l'ordre (délai, voie, voie…) ; `now` avance de 5 ticks = 8 centièmes par itération. */
function script(rolls: number[]) {
  const queue = [...rolls];
  // Une fois la liste épuisée, les tirages continuent (1, 2, 3…) : les voies alternent au lieu de boucler sur la voie refusée.
  let spare = 0;
  const ctx: DragonContext = { centiseconds: 0, soundPlaying: false, roll: (n: number) => (queue.length ? queue.shift()! : ++spare) % n };
  return { ctx, advance: (n = 1) => (ctx.centiseconds += 8 * n) };
}

describe("S22 : règles du dragon (pur, `1c78:0005`)", () => {
  it("voies : ordonnées 0x46, 0x78, 0xAA du dragon", () => {
    expect([0, 1, 2].map(laneY)).toEqual([0x46, 0x78, 0xaa]);
  });

  it("collisions : voie haute touche « haut » ; médiane « haut » et repos ; basse « bas » et repos", () => {
    const poses: SmurfPose[] = ["idle", "up", "down"];
    const table = [0, 1, 2].map((lane) => poses.filter((pose) => dragonHits(lane, pose)));
    expect(table).toEqual([["up"], ["idle", "up"], ["idle", "down"]]);
  });

  it("délai : 190 (niveau 0), 120 (1), 50 (2) centièmes de seconde plus un tirage de 0 à 99 ; l'oiseau compte comme le niveau 0", () => {
    expect([0, 1, 2].map(delayBase)).toEqual([0xbe, 0x78, 0x32]);
    expect(DELAY_BASES).toHaveLength(3);
  });

  it("apparition : un tirage de délai puis des tirages de voie jusqu'à une voie différente de la précédente ; la voie médiane puis la même ne ressort pas", () => {
    const { ctx } = script([10, 100, 4, 5, 3]);
    const run = new DragonRun(sprites(), 2, false, 0);
    run.step({ up: false, down: false }, ctx);
    // roll(100) = 10 → délai 50 + 10 ; roll(300) = 100 % 3 = 1.
    expect(run.delay).toBe(60);
    expect(run.lane).toBe(1);
    expect(run.y).toBe(0x78);
    expect(run.count).toBe(1);
    expect(run.approaching).toBe(true);
    expect(run.returning).toBe(false);
    // Deuxième dragon : même voie tirée d'abord (4 % 3 = 1) → refusée, puis 5 % 3 = 2.
    run.x = DRAGON_REST_X;
    run.approaching = false;
    run.returning = true;
    const second = script([0, 4, 5]);
    run.step({ up: false, down: false }, second.ctx);
    expect(run.lane).toBe(2);
    expect(run.count).toBe(2);
  });

  it("déplacement : immobile pendant le délai, puis 25 px par itération vers la gauche, demi-tour sous 0x15F, retour jusqu'à 0x2A7", () => {
    const { ctx, advance } = script([0, 6]); // voie 0 (haute), délai 50
    const run = new DragonRun(sprites(), 2, false, 0);
    const xs: number[] = [];
    const idle = { up: false, down: false };
    for (let i = 0; i < 80; i++) {
      run.step(idle, ctx);
      xs.push(run.x);
      advance();
    }
    // Délai de 50 cs = 7 itérations de 8 cs (0, 8, ..., 48 : encore en attente).
    expect(xs.slice(0, 6).every((x) => x === DRAGON_REST_X)).toBe(true);
    expect(xs[7]).toBe(DRAGON_REST_X - DRAGON_STEP);
    const turn = xs.indexOf(Math.min(...xs));
    expect(xs[turn]).toBe(DRAGON_REST_X - 14 * DRAGON_STEP);
    expect(xs[turn + 1]).toBe(xs[turn] + DRAGON_STEP);
    expect(xs.includes(DRAGON_REST_X)).toBe(true);
    // Il repart ensuite pour un deuxième dragon (la voie 0 vient d'être servie, tirage nul refusé puis voie 1 : tirage par défaut 0 → boucle ?).
    expect(run.count).toBeGreaterThanOrEqual(1);
  });

  it("pose : 9 itérations puis retour au repos ; une touche pendant une pose est ignorée ; « bas » l'emporte sur « haut »", () => {
    const { ctx } = script([]);
    const run = new DragonRun(sprites(), 0, false, 0);
    const first = run.step({ up: true, down: true }, ctx);
    expect(run.pose).toBe("down");
    expect(first.sounds).toContain("down");
    expect(first.sounds).not.toContain("up");
    for (let i = 0; i < 7; i++) {
      const r = run.step({ up: true, down: true }, ctx);
      expect(r.sounds.filter((s) => s === "up" || s === "down")).toEqual([]);
      expect(run.pose).toBe("down");
    }
    run.step({ up: false, down: false }, ctx);
    expect(run.pose).toBe("idle");
    const next = run.step({ up: true, down: false }, ctx);
    expect(next.sounds).toContain("up");
    expect(run.pose).toBe("up");
  });

  it("brûlure : le dragon touche seulement entre 0x15F et 0x191 et selon la pose", () => {
    for (const pose of ["idle", "up", "down"] as const) {
      for (const lane of [0, 1, 2]) {
        const { ctx, advance } = script([0, lane === 0 ? 0 : lane === 1 ? 1 : 2]);
        const run = new DragonRun(sprites(), 2, false, 0);
        run.pose = pose;
        const keys = { up: false, down: false };
        // Fait avancer le dragon jusqu'à x = 379 en gardant la pose.
        let burned = false;
        let spawned = -1;
        // On s'arrête au demi-tour du premier dragon (x ≤ 0x15F : il ne peut plus toucher).
        for (let i = 0; i < 40 && !burned && run.count < 2; i++) {
          run.pose = pose; // la pose est tenue pendant tout l'approche
          run.step(keys, ctx);
          advance();
          if (spawned < 0) spawned = run.lane;
          burned = run.burned;
        }
        expect(spawned).toBe(lane);
        expect(burned, `${pose} voie ${lane}`).toBe(dragonHits(lane, pose));
      }
    }
  });

  it("rugissement : une fois par dragon, sous x = 0x28B ; retardé tant qu'un bruitage sort", () => {
    const { ctx, advance } = script([0, 0]);
    const run = new DragonRun(sprites(), 2, false, 0);
    const roars: number[] = [];
    for (let i = 0; i < 30; i++) {
      ctx.soundPlaying = i < 12;
      const result = run.step({ up: false, down: false }, ctx);
      if (result.sounds.includes("roar")) roars.push(run.x);
      advance();
    }
    expect(roars).toHaveLength(1);
    expect(roars[0]).toBeLessThan(0x28b);
  });

  it("victoire : le dixième dragon qui apparaît (le cinquième avec l'indice de l'oiseau, qui part de 5)", () => {
    for (const [bird, spawns] of [
      [false, 10],
      [true, 10 - BIRD_START_COUNT],
    ] as const) {
      const { ctx, advance } = script([]);
      const run = new DragonRun(sprites(), 2, bird, 0);
      let seen = 0;
      let lastCount = run.count;
      for (let i = 0; i < 4000 && !run.won; i++) {
        // La pose juste pour chaque voie : le Schtroumpf survit toujours.
        const lane = run.lane;
        const keys = { up: lane === 2 && run.x < 500, down: lane === 1 && run.x < 500 };
        run.step(keys, ctx);
        advance();
        if (run.count !== lastCount) {
          seen++;
          lastCount = run.count;
        }
        expect(run.burned).toBe(false);
      }
      expect(run.won).toBe(true);
      expect(seen).toBe(spawns);
      expect(run.count).toBe(10);
    }
  });
});

describe("S22 : requête", () => {
  it("la requête est exigée : sans Game.openMinigame(22) la scène ne se construit pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    expect(() => createDragon(game, () => undefined)).toThrow(/openMinigame\(22\)/);
  });

  it("vidéo de victoire : s22c1 si l'ingrédient 3 est dans l'objectif, s22c2 sinon (sens inverse de S27)", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(1));
    goalWith(true)(game);
    expect(dragonClip(game)).toBe("s22c1.mux");
    goalWith(false)(game);
    expect(dragonClip(game)).toBe("s22c2.mux");
  });
});

describe.skipIf(!hasOriginalFiles)("S22 : ressources", () => {
  it("fichiers présents", () => {
    const names = new Set(listData(() => true).map((p) => p.split("/").pop()!.toLowerCase()));
    for (const name of ["s22a000s.hy8", "s22a001s.hy8", "s22a001d.mcg", "s22a001b.voc", "s22a002b.voc", "s22a003c.voc", "s22a004c.voc", "s22a005b.voc", "s22c1.mux", "s22c2.mux"]) {
      expect(names.has(name), name).toBe(true);
    }
  });
});

const sceneOf = (run: LaunchedMinigame) => run.scene as DragonScene;

/**
 * Pilote : lit la voie et la position du dragon et prend la pose qui l'esquive (haut pour la voie basse, bas pour la voie médiane, rien pour
 * la haute), dès qu'il passe sous x = 504. `mistake` : une manche dont le pilote se trompe (aucune pose).
 */
function bot(run: LaunchedMinigame, options: { mistake?: boolean } = {}) {
  const scene = sceneOf(run);
  const held = { ArrowUp: false, ArrowDown: false };
  const set = (code: "ArrowUp" | "ArrowDown", on: boolean) => {
    if (held[code] === on) return;
    held[code] = on;
    if (on) run.host.input.keyDown(code);
    else run.host.input.keyUp(code);
  };
  return () => {
    const { course } = scene;
    const want =
      scene.stage === "play" && !options.mistake && course.approaching && course.x < 504 && course.x > 330
        ? course.lane === 2
          ? "ArrowUp"
          : course.lane === 1
            ? "ArrowDown"
            : null
        : null;
    set("ArrowUp", want === "ArrowUp");
    set("ArrowDown", want === "ArrowDown");
  };
}

describe.skipIf(!hasOriginalFiles)("S22 Le Dragon : déroulé, victoire, échec", () => {
  const launch = async (options: LaunchOptions = {}) => {
    const run = await launchMinigame(22, options);
    await run.until(() => !run.ctx.fade.active);
    return run;
  };

  it("départ : fond et Schtroumpf au repos, la boucle ne démarre qu'après le fondu d'entrée", async () => {
    const run = await launchMinigame(22, { seed: 3, level: 1 });
    const scene = sceneOf(run);
    expect(scene.stage).toBe("intro");
    expect(run.ctx.fade.active).toBe(true);
    await run.until(() => scene.stage === "play");
    run.shot("s22-debut");
    expect(scene.course.count).toBe(0);
    expect(scene.internalLevel).toBe(1);
    await run.run(300);
    expect(scene.course.count).toBe(1);
  }, 60_000);

  it("dragon : un tirage de voie par apparition, jamais deux fois la même voie de suite ; graine fixe = mêmes voies", async () => {
    const lanes: number[][] = [];
    for (let i = 0; i < 2; i++) {
      const run = await launch({ seed: 14, level: 2 });
      const scene = sceneOf(run);
      const act = bot(run);
      const seen: number[] = [];
      let last = 0;
      let shot = i > 0;
      await run.until(() => {
        act();
        if (!shot && scene.course.approaching && scene.course.x < 420 && scene.course.lane === 1) {
          shot = true;
          run.shot("s22-dragon-approche");
        }
        if (scene.course.count !== last) {
          last = scene.course.count;
          seen.push(scene.course.lane);
        }
        return seen.length >= 6;
      }, 120_000);
      lanes.push(seen);
      for (let k = 1; k < seen.length; k++) expect(seen[k]).not.toBe(seen[k - 1]);
    }
    expect(lanes[0]).toEqual(lanes[1]);
  }, 120_000);

  it("victoire : esquiver chaque dragon donne l'ingrédient, vidéo s22c2 hors objectif, issue ingrédient réussi", async () => {
    const run = await launch({ seed: 5, level: 2, setup: goalWith(false) });
    const scene = sceneOf(run);
    const act = bot(run);
    await run.until(() => {
      act();
      return scene.stage === "pause";
    }, 180_000);
    expect(scene.course.count).toBe(10);
    expect(scene.course.burned).toBe(false);
    run.shot("s22-victoire-pause");
    await run.until(() => scene.stage === "video", 60_000);
    expect(scene.endVideo).toBe("s22c2.mux");
    await run.run(1500);
    run.shot("s22-victoire-video");
    const outcome = await run.finish(300_000);
    expect(outcome).toEqual({ kind: "ingredient", success: true });
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients & (1 << INGREDIENT)).not.toBe(0);
  }, 300_000);

  it("victoire avec l'ingrédient dans l'objectif : s22c1", async () => {
    const run = await launch({ seed: 5, level: 2, setup: goalWith(true) });
    const scene = sceneOf(run);
    const act = bot(run);
    await run.until(() => {
      act();
      return scene.stage === "video";
    }, 240_000);
    expect(scene.endVideo).toBe("s22c1.mux");
  }, 300_000);

  it("la vidéo de victoire se passe (Espace) et rend l'issue une seule fois", async () => {
    const run = await launch({ seed: 5, level: 2 });
    const scene = sceneOf(run);
    const act = bot(run);
    await run.until(() => {
      act();
      return scene.stage === "video";
    }, 240_000);
    await run.run(500);
    await run.tap("Space", 60);
    expect(await run.finish(60_000)).toEqual({ kind: "ingredient", success: true });
  }, 300_000);

  it("échec : sans pose, un dragon bas ou médian brûle le Schtroumpf ; pas de vidéo, issue ingrédient manqué", async () => {
    const run = await launch({ seed: 5, level: 2 });
    const scene = sceneOf(run);
    const act = bot(run, { mistake: true });
    await run.until(() => {
      act();
      return scene.stage === "death";
    }, 120_000);
    expect(scene.course.burned).toBe(true);
    expect(scene.course.lane).not.toBe(0);
    run.shot("s22-brulure");
    await run.until(() => scene.stage === "fadeOut", 60_000);
    run.shot("s22-echec-fond");
    const outcome = await run.finish(60_000);
    expect(outcome).toEqual({ kind: "ingredient", success: false });
    expect(scene.hasWon).toBe(false);
    run.game.resolveMinigame(outcome);
    expect(run.game.player.ingredients & (1 << INGREDIENT)).toBe(0);
  }, 180_000);

  it("niveau : le délai entre deux dragons est 190, 120 ou 50 centièmes plus un tirage de 0 à 99 ; l'oiseau force le niveau 0 et compte déjà 5", async () => {
    const ranges: Record<string, number[]> = {};
    for (const [name, options] of [
      ["0", { level: 0 }],
      ["1", { level: 1 }],
      ["2", { level: 2 }],
      ["oiseau", { level: 2, bonus: true }],
    ] as const) {
      const run = await launch({ seed: 9, ...options });
      const scene = sceneOf(run);
      expect(scene.internalLevel).toBe(name === "oiseau" ? 0 : Number(name));
      const act = bot(run);
      const delays: number[] = [];
      let last = scene.course.count;
      await run.until(() => {
        act();
        if (scene.course.count !== last) {
          last = scene.course.count;
          delays.push(scene.course.delay);
        }
        return delays.length >= 4 || scene.stage !== "play";
      }, 120_000);
      ranges[name] = delays;
      if (name === "oiseau") expect(scene.hasBonus).toBe(true);
      if (name === "oiseau") expect(run.game.state.bonusTag).toBe(0);
    }
    const within = (name: string, base: number) => ranges[name].every((d) => d >= base && d < base + 100);
    expect(within("0", 190)).toBe(true);
    expect(within("1", 120)).toBe(true);
    expect(within("2", 50)).toBe(true);
    expect(within("oiseau", 190)).toBe(true);
  }, 300_000);

  it("indice de l'oiseau : cinq dragons suffisent (la partie compte déjà 5)", async () => {
    const run = await launch({ seed: 5, level: 2, bonus: true });
    const scene = sceneOf(run);
    expect(scene.course.count).toBe(5);
    const act = bot(run);
    let spawns = 0;
    let last = scene.course.count;
    await run.until(() => {
      act();
      if (scene.course.count !== last) {
        last = scene.course.count;
        spawns++;
      }
      return scene.stage === "pause";
    }, 240_000);
    expect(spawns).toBe(5);
  }, 300_000);

  it("commandes : haut et bas déclenchent chacun une pose de 9 itérations (0,75 s) et un son ; Entrée ne fait rien", async () => {
    const run = await launch({ seed: 5, level: 2, audio: true });
    const scene = sceneOf(run);
    await run.until(() => scene.stage === "play");
    await run.tap("Enter", 60);
    expect(scene.course.pose).toBe("idle");
    const before = run.host.audio.effects.length;
    run.host.input.keyDown("ArrowUp");
    await run.run(120);
    run.host.input.keyUp("ArrowUp");
    expect(scene.course.pose).toBe("up");
    expect(run.host.audio.effects.length).toBeGreaterThan(before);
    await run.run(1000);
    expect(scene.course.pose).toBe("idle");
    run.host.input.keyDown("ArrowDown");
    await run.run(120);
    run.host.input.keyUp("ArrowDown");
    expect(scene.course.pose).toBe("down");
    run.shot("s22-pose-bas");
  }, 60_000);

  it("plateau : victoire = l'ingrédient 3 est donné, vidéo, le plateau reprend la main", async () => {
    const s = await enterFromBoard(22, "DragonScene", { seed: 11 });
    const scene = s.ctx.scenes.top as DragonScene;
    expect(scene).toBeInstanceOf(DragonScene);
    expect(s.game.state.pending).toMatchObject({ scene: 22, player: 0 });
    const act = botSession(s, scene);
    await s.until(() => {
      act();
      return scene.stage === "video";
    }, 300_000);
    await s.run(500);
    await s.tap("Space", 60);
    await s.until(() => scene.stage === "done", 120_000);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(scene.hasWon).toBe(true);
    expect(s.game.player.ingredients & (1 << INGREDIENT)).not.toBe(0);
    expect(s.history).toContain("DragonScene");
  }, 400_000);

  it("plateau : échec = pas d'ingrédient", async () => {
    const s = await enterFromBoard(22, "DragonScene", { seed: 11 });
    const scene = s.ctx.scenes.top as DragonScene;
    await s.until(() => scene.stage === "done", 240_000);
    await s.ready();
    expect(s.game.state.pending).toBeNull();
    expect(scene.hasWon).toBe(false);
    expect(s.game.player.ingredients & (1 << INGREDIENT)).toBe(0);
  }, 400_000);

  it("mode libre : la partie se joue, puis la carte revient sans rien appliquer", async () => {
    const run = await enterFromFreeMode(22, { seed: 5 });
    const scene = run.scene as DragonScene;
    expect(scene).toBeInstanceOf(DragonScene);
    expect(run.game.state.pending).toMatchObject({ scene: 22 });
    await run.until(() => scene.stage === "done" || run.free.stage === "map", 240_000);
    await run.until(() => run.free.stage === "map" && !run.ctx.scenes.transitioning, 120_000);
    expect(run.free.currentGame).toBeNull();
  }, 400_000);
});

/** Même pilote pour une session du plateau (`Session` : `host` pilote le clavier). */
function botSession(s: { host: { input: { keyDown(code: string): void; keyUp(code: string): void } } }, scene: DragonScene) {
  const held = { ArrowUp: false, ArrowDown: false };
  const set = (code: "ArrowUp" | "ArrowDown", on: boolean) => {
    if (held[code] === on) return;
    held[code] = on;
    if (on) s.host.input.keyDown(code);
    else s.host.input.keyUp(code);
  };
  return () => {
    const { course } = scene;
    const want = scene.stage === "play" && course.approaching && course.x < 504 && course.x > 330 ? (course.lane === 2 ? "ArrowUp" : course.lane === 1 ? "ArrowDown" : null) : null;
    set("ArrowUp", want === "ArrowUp");
    set("ArrowDown", want === "ArrowDown");
  };
}
