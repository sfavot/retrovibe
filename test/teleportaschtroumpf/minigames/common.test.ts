import { describe, expect, it } from "vitest";
import { Engine } from "../../../src/games/teleportaschtroumpf/engine/engine";
import type { Scene, SceneContext } from "../../../src/games/teleportaschtroumpf/engine/scene";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import type { Hy8 } from "../../../src/games/teleportaschtroumpf/data/hy8";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../src/games/teleportaschtroumpf/data/mcg";
import { Surface } from "../../../src/games/teleportaschtroumpf/engine/surface";
import { newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import { MINIGAMES } from "../../../src/games/teleportaschtroumpf/game/tables";
import {
  Clip,
  POINTER_KEY_SPEED,
  HUSH_STEP_TICKS,
  OBJECT_ORIGIN_X,
  OBJECT_ORIGIN_Y,
  Pointer,
  STUB_POINTS,
  SoundHush,
  copyRect,
  drawFrame,
  fillRect,
  isObjectHit,
  ingredientInGoal,
  ingredientOutcome,
  levelTimeLimit,
  minigameLevel,
  minigameRequest,
  pointsForTime,
  pointsOutcome,
  sceneIngredient,
  stubOutcome,
} from "../../../src/games/teleportaschtroumpf/scenes/minigames/common";
import { TestHost, runFor, runUntil } from "../engine-test-host";
import { hasOriginalFiles } from "../helpers";

const oneGame = (level = 0) => newGame({ players: [{ character: 0, level }] }, new BorlandRandom(7));

describe("requête, niveau, issue", () => {
  it("minigameRequest : la requête ouverte pour cette scène, sinon une erreur qui dit quoi faire", () => {
    const game = oneGame();
    expect(() => minigameRequest(game, 27)).toThrow(/openMinigame\(27\)/);
    const opened = game.openMinigame(27);
    expect(minigameRequest(game, 27)).toBe(opened);
    expect(() => minigameRequest(game, 32)).toThrow(/openMinigame\(32\)/);
  });

  it("minigameLevel : le niveau du joueur, ou la valeur de l'indice de l'oiseau si la requête est « bonus »", () => {
    for (const level of [0, 1, 2]) {
      const game = oneGame(level);
      const request = game.openMinigame(27);
      expect(request.bonus).toBe(false);
      expect(minigameLevel(request, 3)).toBe(level);
    }
    const game = oneGame(2);
    game.state.bonusTag = 0x1b; // l'oiseau désigne la luge
    const request = game.openMinigame(27);
    expect(request.bonus).toBe(true);
    expect(game.state.bonusTag).toBe(0); // consommé par Game
    expect(minigameLevel(request, 3)).toBe(3);
    expect(minigameLevel(request, 0)).toBe(0);
  });

  it("issues : ingrédient, points", () => {
    expect(ingredientOutcome(true)).toEqual({ kind: "ingredient", success: true });
    expect(ingredientOutcome(false)).toEqual({ kind: "ingredient", success: false });
    expect(pointsOutcome(0)).toEqual({ kind: "points", points: 0 });
    expect(pointsOutcome(3)).toEqual({ kind: "points", points: 3 });
  });

  it("l'ingrédient de la scène vient de MINIGAMES ; « dans l'objectif » lit le masque de la partie", () => {
    for (const info of MINIGAMES.filter((m) => m.kind === "ingredient")) expect(sceneIngredient(info.scene)).toBe(info.ingredient);
    expect(sceneIngredient(23)).toBeUndefined();
    const game = oneGame();
    game.state.goal.ingredients = 0b00010100;
    expect(ingredientInGoal(game, 2)).toBe(true);
    expect(ingredientInGoal(game, 4)).toBe(true);
    expect(ingredientInGoal(game, 3)).toBe(false);
  });

  it("stubOutcome : réussi / raté du type attendu par chaque scène", () => {
    for (const info of MINIGAMES.filter((m) => m.scene !== 14)) {
      const game = oneGame();
      game.player.points = 5;
      game.openMinigame(info.scene);
      for (const success of [true, false]) {
        const outcome = stubOutcome(info.scene, game, success);
        expect({ ingredient: "ingredient", points: "points", trade: "magician", steal: "none", bird: "none" }[info.kind as string]).toBe(outcome.kind);
        if (outcome.kind === "points") expect(outcome.points).toBe(success ? STUB_POINTS : 0);
      }
      game.abortMinigame();
    }
    expect(() => stubOutcome(37, oneGame(), true)).toThrow(RangeError);
  });
});

/** Scène d'essai : lance ce que le test lui donne dans `enter` / `update` / `render`. */
class Probe implements Scene {
  readonly step = 1;
  constructor(
    private readonly hooks: { load?(ctx: SceneContext): Promise<void>; enter?(ctx: SceneContext): void; update?(ctx: SceneContext): void; render?(ctx: SceneContext): void; exit?(ctx: SceneContext): void },
  ) {}
  load(ctx: SceneContext) {
    return this.hooks.load?.(ctx) ?? Promise.resolve();
  }
  enter(ctx: SceneContext) {
    this.hooks.enter?.(ctx);
  }
  update(ctx: SceneContext) {
    this.hooks.update?.(ctx);
  }
  render(ctx: SceneContext) {
    this.hooks.render?.(ctx);
  }
  exit(ctx: SceneContext) {
    this.hooks.exit?.(ctx);
  }
}

async function launch(scene: Scene, audio = false) {
  const host = new TestHost();
  host.audio.enabled = audio;
  const engine = new Engine(host, { seed: 7 });
  await engine.start(scene);
  await runUntil(engine, host, () => !engine.ctx.scenes.transitioning);
  return { host, engine };
}

describe.skipIf(!hasOriginalFiles)("Clip : une vidéo MUX à l'intérieur d'une scène", () => {
  it("joue jusqu'au bout, rend la main une fois, garde la dernière image et coupe le son", async () => {
    const ends: number[] = [];
    const clip = new Clip("s32b.mux", () => ends.push(1));
    const probe = new Probe({ load: (ctx) => clip.load(ctx), enter: (ctx) => clip.start(ctx), update: (ctx) => clip.update(ctx), render: (ctx) => clip.render(ctx) });
    const { host, engine } = await launch(probe, true);
    expect(clip.playing).toBe(true);
    expect(clip.finished).toBe(false);
    await runFor(engine, host, 1000);
    expect(host.audio.plays.length).toBeGreaterThan(0);
    expect(ends).toEqual([]);
    await runUntil(engine, host, () => clip.finished, 30_000);
    await runFor(engine, host, 500);
    expect(ends).toEqual([1]);
    expect(clip.playing).toBe(false);
    expect(engine.ctx.voice.voicePlaying).toBe(false);
    // La dernière image reste à l'écran : elle n'est pas noire.
    expect(host.lastPresentation.surface.some((p) => p !== 0)).toBe(true);
  }, 60_000);

  it("skippable par défaut (Échap), pas avec skippable: false", async () => {
    for (const skippable of [true, false]) {
      let ended = false;
      const clip = new Clip("s32b.mux", () => (ended = true), { skippable });
      const probe = new Probe({ load: (ctx) => clip.load(ctx), enter: (ctx) => clip.start(ctx), update: (ctx) => clip.update(ctx), render: (ctx) => clip.render(ctx) });
      const { host, engine } = await launch(probe);
      await runFor(engine, host, 500);
      host.input.keyDown("Escape");
      await runFor(engine, host, 200);
      host.input.keyUp("Escape");
      await runFor(engine, host, 200);
      expect(ended).toBe(skippable);
    }
  }, 60_000);

  it("onFrame : une fois par image décodée, dans l'ordre, avec les marqueurs ; « stop » interrompt la vidéo et rend la main", async () => {
    const frames: number[] = [];
    const markers = new Map<number, string>();
    let ended = false;
    const clip = new Clip("s27e.mux", () => (ended = true), {
      skippable: false,
      onFrame: (_ctx, frame, found) => {
        frames.push(frame);
        for (const m of found) markers.set(frame, String.fromCharCode(...m));
        if (frame === 43) return "stop";
      },
    });
    const probe = new Probe({ load: (ctx) => clip.load(ctx), enter: (ctx) => clip.start(ctx), update: (ctx) => clip.update(ctx), render: (ctx) => clip.render(ctx) });
    const { host, engine } = await launch(probe);
    await runUntil(engine, host, () => ended, 30_000);
    expect(frames).toEqual(Array.from({ length: 44 }, (_, i) => i));
    expect(markers.get(42)).toBe("12");
    expect(markers.get(43)).toBe("12");
    expect(markers.get(41)).toBeUndefined();
    expect(clip.finished).toBe(true);
  }, 60_000);

  it("overlay : dessiné par-dessus chaque image affichée, y compris la dernière après la fin", async () => {
    const clip = new Clip("s32b.mux", () => undefined, {
      overlay: (ctx) => {
        ctx.surface.work[0] = 255;
      },
    });
    const probe = new Probe({ load: (ctx) => clip.load(ctx), enter: (ctx) => clip.start(ctx), update: (ctx) => clip.update(ctx), render: (ctx) => clip.render(ctx) });
    const { host, engine } = await launch(probe);
    await runFor(engine, host, 800);
    expect(host.lastPresentation.surface[0]).toBe(255);
    await runUntil(engine, host, () => clip.finished, 30_000);
    await runFor(engine, host, 300);
    expect(host.lastPresentation.surface[0]).toBe(255);
  }, 60_000);

  it("stop : coupe sans appeler onEnd", async () => {
    let ended = false;
    const clip = new Clip("s32b.mux", () => (ended = true));
    const probe = new Probe({
      load: (ctx) => clip.load(ctx),
      enter: (ctx) => clip.start(ctx),
      update: (ctx) => clip.update(ctx),
      render: (ctx) => clip.render(ctx),
    });
    const { host, engine } = await launch(probe, true);
    await runFor(engine, host, 300);
    clip.stop(engine.ctx);
    expect(clip.playing).toBe(false);
    await runFor(engine, host, 500);
    expect(ended).toBe(false);
    expect(engine.ctx.voice.voicePlaying).toBe(false);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("Pointer : curseur HY8, souris et flèches", () => {
  const bounds = { minX: 8, maxX: 0x134, minY: 0x0f, maxY: 0xbe };

  async function pointerScene() {
    let sprites!: Hy8;
    let pointer!: Pointer;
    const probe = new Probe({
      load: async (ctx) => {
        sprites = await ctx.resources.hy8("s13a000s.hy8");
      },
      enter: (ctx) => {
        pointer = new Pointer({ sprites, sprite: 0, bounds });
        ctx.surface.clear(0);
      },
      update: (ctx) => pointer.update(ctx),
      render: (ctx) => {
        ctx.surface.clear(0);
        pointer.draw(ctx);
      },
    });
    const { host, engine } = await launch(probe);
    return { host, engine, pointer: () => pointer };
  }

  it("la souris pose le curseur, borné ; les flèches le déplacent de 2 px par tick", async () => {
    const { host, engine, pointer } = await pointerScene();
    const { ctx } = engine;
    host.input.mouseMove(0xa0, 100);
    expect(pointer().position(ctx)).toEqual({ x: 0xa0, y: 100 });
    host.input.mouseMove(2, 2);
    expect(pointer().position(ctx)).toEqual({ x: 8, y: 0x0f });
    host.input.mouseMove(319, 199);
    expect(pointer().position(ctx)).toEqual({ x: 0x134, y: 0xbe });
    host.input.mouseMove(100, 100);
    host.input.keyDown("ArrowRight");
    await runFor(engine, host, 10 * (1000 / 60));
    host.input.keyUp("ArrowRight");
    const moved = ctx.input.mouseX - 100;
    expect(moved).toBeGreaterThanOrEqual(8 * POINTER_KEY_SPEED);
    expect(moved).toBeLessThanOrEqual(11 * POINTER_KEY_SPEED);
    expect(ctx.input.mouseY).toBe(100);
    host.input.keyDown("KeyQ"); // Q = haut
    await runFor(engine, host, 5 * (1000 / 60));
    host.input.keyUp("KeyQ");
    expect(ctx.input.mouseY).toBeLessThan(100);
  }, 30_000);

  it("le sprite est dessiné à la position du curseur (ancre du sprite) et suit la souris", async () => {
    const { host, engine } = await pointerScene();
    host.input.mouseMove(150, 80);
    await runFor(engine, host, 100);
    const first = host.lastPresentation.surface.slice();
    expect(first.some((p) => p !== 0)).toBe(true);
    host.input.mouseMove(250, 150);
    await runFor(engine, host, 100);
    const second = host.lastPresentation.surface;
    const centroid = (pixels: Uint8Array) => {
      let n = 0;
      let sx = 0;
      let sy = 0;
      pixels.forEach((p, i) => {
        if (p) {
          n++;
          sx += i % 320;
          sy += Math.floor(i / 320);
        }
      });
      return { x: sx / n, y: sy / n };
    };
    const a = centroid(first);
    const b = centroid(second);
    expect(b.x - a.x).toBeCloseTo(100, 0);
    expect(b.y - a.y).toBeCloseTo(70, 0);
  }, 30_000);
});

describe("fondu sonore de fin (`1343:0037`) : SoundHush", () => {
  function fake(volume: number) {
    const log: string[] = [];
    const ctx = {
      clock: { ticks: 100 },
      voice: {
        volume,
        setVolume: (v: number) => {
          ctx.voice.volume = v;
          log.push(`vol ${v}`);
        },
        stop: () => log.push("stop"),
      },
    };
    return { ctx: ctx as unknown as SceneContext & typeof ctx, log };
  }

  it("un cran toutes les 20 centièmes (12 ticks) du volume de départ à 1, puis son coupé et volume rendu", () => {
    const { ctx, log } = fake(3);
    const hush = new SoundHush();
    expect(hush.active).toBe(false);
    hush.start(ctx);
    expect(hush.active).toBe(true);
    const seen: number[] = [];
    let done = false;
    while (!done) {
      done = hush.update(ctx);
      if (!done) seen.push(ctx.voice.volume);
      ctx.clock.ticks++;
    }
    expect(HUSH_STEP_TICKS).toBe(12);
    expect(seen).toEqual([...Array(12).fill(3), ...Array(12).fill(2), ...Array(12).fill(1)]);
    expect(ctx.clock.ticks - 100).toBe(3 * HUSH_STEP_TICKS + 1);
    expect(log.at(-2)).toBe("stop");
    expect(log.at(-1)).toBe("vol 3");
    expect(hush.active).toBe(false);
    expect(hush.update(ctx)).toBe(false);
  });

  it("restore : sortie en plein fondu, le volume de départ est rendu sans couper ; sans effet hors fondu", () => {
    const { ctx, log } = fake(15);
    const hush = new SoundHush();
    hush.restore(ctx);
    expect(log).toEqual([]);
    hush.start(ctx);
    ctx.clock.ticks += 30;
    hush.update(ctx);
    expect(ctx.voice.volume).toBe(13);
    hush.restore(ctx);
    expect(ctx.voice.volume).toBe(15);
    expect(log).not.toContain("stop");
    expect(hush.active).toBe(false);
  });

  it("le volume de départ peut être imposé (capté avant le fondu)", () => {
    const { ctx } = fake(5);
    const hush = new SoundHush();
    hush.start(ctx, 9);
    hush.update(ctx);
    expect(ctx.voice.volume).toBe(9);
  });
});

describe("drawFrame (`32af:0006`)", () => {
  it("contour d'un pixel, bords compris, clippé à l'écran", () => {
    const surface = new Surface();
    drawFrame(surface, 10, 20, 12, 22, 9);
    expect([...surface.work.keys()].filter((i) => surface.work[i] === 9)).toHaveLength(8);
    expect(surface.work[21 * 320 + 11]).toBe(0);
    drawFrame(surface, -5, -5, 2, 2, 7);
    expect(surface.work[2 * 320 + 0]).toBe(7);
  });
});

describe("chrono et zones des mini-jeux de recherche", () => {
  it("levelTimeLimit : base − pas × niveau", () => {
    expect([0, 1, 2].map((level) => levelTimeLimit(40, 5, level))).toEqual([40, 35, 30]);
    expect([0, 1, 2].map((level) => levelTimeLimit(35, 7, level))).toEqual([35, 28, 21]);
  });

  it("pointsForTime : 3 sous le tiers du temps, 2 sous les deux tiers, sinon 1 (divisions entières)", () => {
    expect([0, 12, 13, 25, 26, 39].map((s) => pointsForTime(s, 40))).toEqual([3, 3, 2, 2, 1, 1]);
    expect([0, 10, 11, 22, 23, 34].map((s) => pointsForTime(s, 35))).toEqual([3, 3, 2, 2, 1, 1]);
    expect([0, 9, 10, 19, 20, 29].map((s) => pointsForTime(s, 30))).toEqual([3, 3, 2, 2, 1, 1]);
    expect([0, 7, 8, 15, 16, 24].map((s) => pointsForTime(s, 25))).toEqual([3, 3, 2, 2, 1, 1]);
    expect([0, 5, 6, 12, 13, 19].map((s) => pointsForTime(s, 20))).toEqual([3, 3, 2, 2, 1, 1]);
    expect([0, 4, 5, 9, 10, 14, 15].map((s) => pointsForTime(s, 15))).toEqual([3, 3, 2, 2, 1, 1, 1]);
    expect([0, 5, 6, 11, 12, 18].map((s) => pointsForTime(s, 19))).toEqual([3, 3, 2, 2, 1, 1]);
  });

  it("isObjectHit sans marge (S25) : zone décalée de (32, 40), bord droit et bas exclus", () => {
    const rect = [201, 87, 239, 116] as const;
    const [x1, y1, x2, y2] = rect;
    const left = x1 - OBJECT_ORIGIN_X;
    const top = y1 - OBJECT_ORIGIN_Y;
    const right = x2 - OBJECT_ORIGIN_X;
    const bottom = y2 - OBJECT_ORIGIN_Y;
    expect(isObjectHit(rect, 0, left, top)).toBe(true);
    expect(isObjectHit(rect, 0, right - 1, bottom - 1)).toBe(true);
    expect(isObjectHit(rect, 0, left - 1, top)).toBe(false);
    expect(isObjectHit(rect, 0, left, top - 1)).toBe(false);
    expect(isObjectHit(rect, 0, right, top)).toBe(false);
    expect(isObjectHit(rect, 0, left, bottom)).toBe(false);
  });

  it("isObjectHit avec marge (S26) : zone élargie de `margin` de chaque côté", () => {
    const rect = [201, 87, 239, 116] as const;
    const [x1, y1, x2, y2] = rect;
    const left = x1 - OBJECT_ORIGIN_X;
    const top = y1 - OBJECT_ORIGIN_Y;
    const right = x2 - OBJECT_ORIGIN_X;
    const bottom = y2 - OBJECT_ORIGIN_Y;
    const m = 6;
    expect(isObjectHit(rect, m, left - m, top - m)).toBe(true);
    expect(isObjectHit(rect, m, left - m - 1, top)).toBe(false);
    expect(isObjectHit(rect, m, left, top - m - 1)).toBe(false);
    expect(isObjectHit(rect, m, right + m - 1, bottom + m - 1)).toBe(true);
    expect(isObjectHit(rect, m, right + m, bottom)).toBe(false);
    expect(isObjectHit(rect, m, left, bottom + m)).toBe(false);
    expect(isObjectHit(rect, 10, left - 8, top)).toBe(true);
    expect(isObjectHit(rect, m, left - 8, top)).toBe(false);
  });
});

describe("copyRect et fillRect (`13fc:0427`, `328a:0022`)", () => {
  const size = SCREEN_WIDTH * SCREEN_HEIGHT;

  it("fillRect : remplit bords compris et se rogne à l'écran", () => {
    const work = new Uint8Array(size);
    fillRect(work, 2, 3, 4, 5, 9);
    expect(work[3 * SCREEN_WIDTH + 2]).toBe(9);
    expect(work[5 * SCREEN_WIDTH + 4]).toBe(9);
    expect(work[3 * SCREEN_WIDTH + 5]).toBe(0);
    expect(work[6 * SCREEN_WIDTH + 4]).toBe(0);
    fillRect(work, -5, SCREEN_HEIGHT - 1, 2, SCREEN_HEIGHT + 4, 7);
    expect(work[(SCREEN_HEIGHT - 1) * SCREEN_WIDTH]).toBe(7);
    expect(work[(SCREEN_HEIGHT - 1) * SCREEN_WIDTH + 3]).toBe(0);
  });

  it("copyRect : copie opaque d'un rectangle, rognée à l'écran", () => {
    const source = new Uint8Array(size).map((_, i) => (i % 251) + 1);
    const work = new Uint8Array(size);
    copyRect(source, work, 10, 20, 100, 50, 3, 2);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) expect(work[(50 + row) * SCREEN_WIDTH + 100 + col]).toBe(source[(20 + row) * SCREEN_WIDTH + 10 + col]);
    }
    expect(work[50 * SCREEN_WIDTH + 103]).toBe(0);
    copyRect(source, work, 0, 0, SCREEN_WIDTH - 1, 0, 3, 1);
    expect(work[SCREEN_WIDTH - 1]).toBe(source[0]);
    expect(work[0]).toBe(0);
  });
});
