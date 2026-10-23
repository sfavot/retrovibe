import { describe, expect, it } from "vitest";
import { Engine } from "../../../src/games/teleportaschtroumpf/engine/engine";
import type { Scene } from "../../../src/games/teleportaschtroumpf/engine/scene";
import { newGame, type GameEvent } from "../../../src/games/teleportaschtroumpf/game/rules";
import { BESPECTACLED_DESTINATIONS } from "../../../src/games/teleportaschtroumpf/game/tables";
import { createGlasses, createGlassesAftermath, GlassesScene, transferOf } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s38-glasses";
import { POINT_ITEM, rowLayout, stateBefore, TransferScene } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s38/transfer";
import { WALK_CUT, WALK_MAPS, WALK_PAWNS, WalkScene } from "../../../src/games/teleportaschtroumpf/scenes/minigames/s38/walk";
import { TestHost, runFor, runUntil } from "../engine-test-host";
import { Session } from "../game-helpers";
import { hasOriginalFiles } from "../helpers";
import { doorPosition, encodePng, launchMinigame } from "./harness";

type Bespectacled = Extract<GameEvent, { type: "bespectacled" }>;
interface PlayerSpec {
  character?: number;
  ingredients?: number[];
  points?: number;
}

/** Lance l'aftermath de S38 sur la première graine (1, 2, …) dont l'événement vérifie `want`. */
async function play38(players: PlayerSpec[], want: (e: Bespectacled) => boolean, shotName?: string) {
  for (let seed = 1; seed < 400; seed++) {
    const host = new TestHost();
    host.audio.enabled = false;
    const engine = new Engine(host, { seed });
    const game = newGame({ players: players.map((p, i) => ({ character: p.character ?? i, level: 0 })) }, engine.ctx.rng);
    players.forEach((spec, i) => {
      for (const k of spec.ingredients ?? []) {
        game.state.players[i].ingredients |= 1 << k;
        game.state.players[i].ingredientCount++;
      }
      game.state.players[i].points = spec.points ?? 0;
    });
    game.openMinigame(38);
    const events = game.resolveMinigame({ kind: "none" });
    const event = events.find((e): e is Bespectacled => e.type === "bespectacled");
    if (!event || !want(event)) continue;
    let finished = false;
    const scene = createGlassesAftermath(game, events, () => (finished = true))!;
    const base: Scene = { step: 1, enter: () => undefined, update: () => undefined, render: () => undefined };
    await engine.start(base);
    await runUntil(engine, host, () => !engine.ctx.scenes.transitioning);
    engine.ctx.scenes.push(scene, { fade: true });
    await runFor(engine, host, 40);
    const shot = (name: string) => {
      const dir = process.env.TELEPORTA_SHOTS;
      const p = host.presentations.at(-1);
      if (!dir || !p) return;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/${shotName ?? "s38"}-${name}.png`, encodePng(320, 200, p.surface, p.palette));
    };
    return { host, engine, game, event, events, scene, shot, finished: () => finished, seed };
  }
  throw new Error("aucune graine ne donne ce résultat");
}

describe("S38 : fonctions pures", () => {
  it("tables de la promenade : 16 destinations, cartes 4 à 6", () => {
    expect(WALK_MAPS).toHaveLength(BESPECTACLED_DESTINATIONS.length);
    expect(WALK_PAWNS).toHaveLength(16);
    expect(new Set(WALK_MAPS)).toEqual(new Set([4, 5, 6]));
    expect(WALK_CUT).toEqual({ a: 0xb5, b: 0x6f });
  });

  it("transferOf : promenade, ingrédient ou point", () => {
    const base = { type: "bespectacled", player: 1 } as const;
    expect(transferOf({ ...base, result: "nothing", video: 9 })).toBeNull();
    expect(transferOf({ ...base, result: "ingredientLost", ingredient: 3 })).toEqual({ item: 3, from: 1, to: -1 });
    expect(transferOf({ ...base, result: "pointLost" })).toEqual({ item: POINT_ITEM, from: 1, to: -1 });
    expect(transferOf({ ...base, result: "pointsMoved", from: 0, to: 2 })).toEqual({ item: POINT_ITEM, from: 0, to: 2 });
    expect(transferOf({ ...base, result: "ingredientMoved", from: 2, to: 0, ingredient: 5 })).toEqual({ item: 5, from: 2, to: 0 });
  });

  it("stateBefore défait le vol sans toucher la partie", () => {
    const game = newGame({ players: [{ character: 0, level: 0 }, { character: 1, level: 0 }] }, new (class { below() { return 0; } })() as never);
    game.state.players[1].ingredients = 1 << 2;
    game.state.players[1].ingredientCount = 1;
    game.state.players[0].points = 4;
    const before = stateBefore(game, { item: 2, from: 0, to: 1 });
    expect(before.state.players[0].ingredientCount).toBe(1);
    expect(before.state.players[1].ingredientCount).toBe(0);
    expect(game.state.players[0].ingredientCount).toBe(0);
    const pts = stateBefore(game, { item: POINT_ITEM, from: 0, to: 1 });
    expect(pts.state.players[0].points).toBe(5);
    expect(pts.state.players[1].points).toBe(-1);
  });

  it("rowLayout : l'ingrédient volé de l'objectif est grisé, hors objectif il n'est pas redessiné", () => {
    const game = newGame({ players: [{ character: 0, level: 0 }] }, new (class { below() { return 0; } })() as never);
    const p = game.state.players[0];
    game.state.goal.ingredients = 0b011;
    p.ingredients = 0b111;
    const stolen = rowLayout(game, 0, 1, 0);
    expect(stolen.icons.map((i) => i.sprite)).toEqual([6, 0xf + 1, 6 + 2]);
    expect(stolen.slots).toBe(3);
    const outside = rowLayout(game, 0, 2, 0);
    expect(outside.icons.map((i) => i.sprite)).toEqual([6, 7]);
    expect(outside.slots).toBe(3);
  });

  it("aftermath : null sans événement", () => {
    const game = newGame({ players: [{ character: 0, level: 0 }] }, new (class { below() { return 0; } })() as never);
    expect(createGlassesAftermath(game, [], () => undefined)).toBeNull();
  });
});

describe.skipIf(!hasOriginalFiles)("S38 : la scène du mini-jeu", () => {
  it("rend l'issue « aucune » aussitôt (la présentation est l'aftermath)", async () => {
    const run = await launchMinigame(38);
    expect(run.scene).toBeInstanceOf(GlassesScene);
    expect(await run.finish()).toEqual({ kind: "none" });
    expect(createGlasses).toBeTypeOf("function");
  }, 30_000);
});

describe.skipIf(!hasOriginalFiles)("S38 : promenade, vol seul, vol à plusieurs", () => {
  it("seul sans rien : promenade (vidéo a ou b, bascule sur la carte, pion posé), le joueur est déplacé", async () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = (await play38([{ character: seed - 1 }], (e) => e.result === "nothing"))!;
      const scene = r.scene as WalkScene;
      expect(scene).toBeInstanceOf(WalkScene);
      expect(r.event.video).toBeGreaterThanOrEqual(9);
      await runUntil(r.engine, r.host, () => scene.stage === "video", 60_000);
      seen.add(scene.clip);
      await runUntil(r.engine, r.host, () => scene.hasCut, 60_000);
      if (seed === 1) r.shot("carte");
      await runUntil(r.engine, r.host, () => r.finished(), 60_000);
      expect(r.game.player.screen).toBeGreaterThan(0);
    }
    expect(seen.size).toBeGreaterThanOrEqual(1);
  }, 240_000);

  it("captures de la promenade", async () => {
    const r = (await play38([{}], (e) => e.result === "nothing", "s38-walk"))!;
    const scene = r.scene as WalkScene;
    r.shot("decor");
    await runUntil(r.engine, r.host, () => scene.stage === "video", 60_000);
    await runFor(r.engine, r.host, 6000);
    r.shot("video");
    await runUntil(r.engine, r.host, () => scene.stage === "hold", 60_000);
    await runFor(r.engine, r.host, 300);
    r.shot("carte");
    await runUntil(r.engine, r.host, () => r.finished(), 60_000);
  }, 240_000);

  it("seul avec un ingrédient : l'ingrédient est perdu, la réplique s38e002t, la scène se termine", async () => {
    const r = (await play38([{ ingredients: [3], points: 2 }], (e) => e.result === "ingredientLost", "s38-ing"))!;
    const scene = r.scene as TransferScene;
    expect(scene).toBeInstanceOf(TransferScene);
    expect(r.game.player.ingredientCount).toBe(0);
    await runUntil(r.engine, r.host, () => scene.stage === "video", 60_000);
    r.shot("avant");
    await runFor(r.engine, r.host, 3000);
    r.shot("video");
    await runUntil(r.engine, r.host, () => scene.stage === "announce", 60_000);
    r.shot("grise");
    expect(scene.voice).toBe("s38e002t.voc");
    await runUntil(r.engine, r.host, () => r.finished(), 60_000);
  }, 240_000);

  it("seul avec des points mais sans ingrédient : un point perdu, clignotement, s38c003t", async () => {
    const r = (await play38([{ points: 3 }], (e) => e.result === "pointLost", "s38-pt"))!;
    const scene = r.scene as TransferScene;
    expect(r.game.player.points).toBe(2);
    await runUntil(r.engine, r.host, () => scene.stage === "blink", 60_000);
    expect(scene.voice).toBe("s38c003t.voc");
    await runFor(r.engine, r.host, 700);
    r.shot("eteint");
    await runFor(r.engine, r.host, 500);
    r.shot("allume");
    await runUntil(r.engine, r.host, () => r.finished(), 60_000);
    r.shot("fin");
  }, 240_000);

  it("à plusieurs : un point passe du plus riche au plus pauvre", async () => {
    const r = (await play38([{ points: 5 }, { points: 1 }], (e) => e.result === "pointsMoved", "s38-move"))!;
    const scene = r.scene as TransferScene;
    expect(r.game.state.players.map((p) => p.points)).toEqual([4, 2]);
    await runUntil(r.engine, r.host, () => scene.stage === "blink", 60_000);
    expect(["s38c002t.voc", "s38d002t.voc"]).toContain(scene.voice);
    await runUntil(r.engine, r.host, () => r.finished(), 60_000);
    r.shot("fin");
  }, 240_000);

  it("à plusieurs : un ingrédient passe de l'un à l'autre, icône du bénéficiaire", async () => {
    const r = (await play38([{ ingredients: [1, 4] }, { character: 2 }], (e) => e.result === "ingredientMoved", "s38-gift"))!;
    const scene = r.scene as TransferScene;
    expect(r.game.state.players.map((p) => p.ingredientCount)).toEqual([1, 1]);
    await runUntil(r.engine, r.host, () => scene.stage === "announce", 60_000);
    r.shot("grise");
    await runUntil(r.engine, r.host, () => scene.stage === "gift" || r.finished(), 60_000);
    await runUntil(r.engine, r.host, () => r.finished(), 60_000);
  }, 240_000);

  it("graine fixe : même événement et même voix", async () => {
    const a = (await play38([{ points: 5 }, { points: 1 }], (e) => e.result === "pointsMoved"))!;
    const b = (await play38([{ points: 5 }, { points: 1 }], (e) => e.result === "pointsMoved"))!;
    expect(a.seed).toBe(b.seed);
    await runUntil(a.engine, a.host, () => (a.scene as TransferScene).stage === "blink", 60_000);
    await runUntil(b.engine, b.host, () => (b.scene as TransferScene).stage === "blink", 60_000);
    expect((a.scene as TransferScene).voice).toBe((b.scene as TransferScene).voice);
  }, 240_000);

  it("plateau : porte de S38, l'effet est appliqué puis le plateau reprend", async () => {
    const s = await Session.start({ seed: 3 });
    await s.ready();
    s.place(doorPosition(38));
    await s.tap("Space");
    await s.until(() => ["WalkScene", "TransferScene"].includes(s.top() ?? ""), 120_000);
    expect(s.game.state.pending).toBeNull();
    await s.until(() => s.top() === "GameScene" && !s.ctx.scenes.transitioning, 240_000);
    await s.ready();
  }, 400_000);
});
