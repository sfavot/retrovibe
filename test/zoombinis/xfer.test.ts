import { describe, expect, it, vi } from "vitest";
import { createZoombinisEngine, type ZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag } from "../../src/games/zoombinis/engine/features";
import { ZOOMBINIS_GAME } from "../../src/games/zoombinis/engine/game";
import { ScreenId, type Scene } from "../../src/games/zoombinis/engine/scene";
import { GRAPHICS, installServices } from "../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../src/games/zoombinis/engine/sound";
import { TRANSFER_REGION, TRANSFER_ROUTES } from "../../src/games/zoombinis/game/route";
import { makeZoombini, newGame, type Zoombini } from "../../src/games/zoombinis/game/state";
import {
  createXferScene,
  dialogChoice,
  MIN_TICKS,
  narratorSound,
  regionOf,
  stageLevels,
  stageState,
  translateSlots,
  XFER_BACKGROUNDS,
} from "../../src/games/zoombinis/scenes/xfer";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

const TICK_MS = 17;

/** Cinq Zoombinis variés (cheveux, yeux, nez, pieds). */
function group(count = 5): Zoombini[] {
  const attrs = [
    [1, 1, 1, 1],
    [2, 3, 4, 2],
    [3, 5, 2, 3],
    [4, 2, 5, 4],
    [5, 4, 3, 5],
  ];
  return Array.from({ length: count }, (_, i) => makeZoombini(attrs[i % attrs.length]!, i + 1));
}

describe("règles de la transition", () => {
  it("la région vient de la destination (et de l'écran quitté pour le camp 2), comme les 16 trajets", () => {
    TRANSFER_ROUTES.forEach(([from, to], i) => {
      expect(regionOf(from, to), `trajet ${i + 1}`).toBe(TRANSFER_REGION[i]);
    });
    expect(regionOf(ScreenId.map, ScreenId.picker)).toBeUndefined();
    expect(XFER_BACKGROUNDS).toEqual([5000, 1000, 2000, 3000, 4000, 6000]);
  });

  it("mémoire de dialogue (1168:5c57) : visite comptée, niveau 0, puis deux phrases au niveau 1, entraînement", () => {
    expect(dialogChoice(0, 0, false)).toEqual({ choice: 1, memory: 1 });
    expect(dialogChoice(0, 1, false)).toEqual({ choice: 2, memory: 0x1001 });
    expect(dialogChoice(0x1001, 1, false)).toEqual({ choice: 0xc, memory: 0x3002 });
    expect(dialogChoice(0x3002, 1, false)).toEqual({ choice: 0, memory: 0x3003 });
    expect(dialogChoice(0, 2, false)).toEqual({ choice: 0, memory: 1 });
    expect(dialogChoice(0xfff, 0, false).memory).toBe(0xfff);
    expect(dialogChoice(7, 3, true)).toEqual({ choice: 5, memory: 7 });
  });

  it("narrateur : ids fixes, tirages bornés 1 à n, ville toujours 20100", () => {
    const never = () => {
      throw new Error("aucun tirage attendu");
    };
    expect(narratorSound(0, ScreenId.bridge, 1, 1, never)).toBe(0x4e7e);
    expect(narratorSound(0, ScreenId.bridge, 5, 2, never)).toBe(0x4e82);
    expect(narratorSound(0, ScreenId.bridge, 5, 1, never)).toBe(0x4e7e);
    expect(narratorSound(1, ScreenId.tunnels, 2, 1, never)).toBe(0x4e28);
    expect(narratorSound(3, ScreenId.hotel, 0xc, 1, never)).toBe(0x4e3e);
    const draws: number[] = [];
    const pick = (max: number) => {
      draws.push(max);
      return max;
    };
    expect(narratorSound(0, ScreenId.bridge, 0, 1, pick)).toBe(0x4e83);
    expect(narratorSound(0, ScreenId.bridge, 0, 2, pick)).toBe(0x4e83);
    expect(narratorSound(4, ScreenId.smoke, 0, 1, pick)).toBe(0x4e23);
    expect(narratorSound(4, ScreenId.smoke, 0, 3, pick)).toBe(0x4e23);
    expect(draws).toEqual([5, 6, 3, 4]);
    // Ville : le tirage 1 à 4 a lieu sauf choix 1 et 5, et son résultat est écrasé.
    draws.length = 0;
    expect(narratorSound(5, ScreenId.town, 0, 1, pick)).toBe(0x4e84);
    expect(narratorSound(5, ScreenId.town, 1, 1, never)).toBe(0x4e84);
    expect(draws).toEqual([4]);
    // Chaque tirage possible reste dans 20000…20100.
    for (let region = 0; region <= 5; region++) {
      for (const [, to] of TRANSFER_ROUTES) {
        if (regionOf(ScreenId.baseCamp, to) !== region) continue;
        for (const choice of [0, 1, 2, 5, 0xc]) {
          for (const level of [1, 2, 3, 4]) {
            for (const roll of [1, 2, 3, 4, 5, 6]) {
              const id = narratorSound(region, to, choice, level, (max) => Math.min(roll, max));
              expect(id === 0 || (id >= 20000 && id <= 0x4e84)).toBe(true);
            }
          }
        }
      }
    }
  });

  it("niveaux des étapes (11b0:175c) : bits des épreuves et des camps, entraînement", () => {
    const game = newGame();
    expect(stageLevels(game, 0)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    game.successes[0] = 0b0111;
    game.successes[3] = 0b1000;
    game.successes[8] = 0x31;
    game.masks.stage1 = 0b0011;
    game.masks.stage2 = 0b0100;
    game.masks.stage3 = 0b0010;
    game.masks.stage4 = 0b1000;
    const levels = stageLevels(game, 0);
    expect(levels[1]).toBe(3);
    expect(levels[5]).toBe(4);
    expect(levels[10]).toBe(1);
    expect(levels[4]).toBe(2);
    expect(levels[11]).toBe(3);
    expect(levels[16]).toBe(2);
    expect(levels[15]).toBe(4);
    expect(stageLevels(game, 3).every((level) => level === 3)).toBe(true);
  });

  it("étape atteinte : niveau précédent, ou repli à −1 ; numéros d'emplacement traduits en images de la planche", () => {
    const levels = new Array<number>(17).fill(0);
    levels[0] = 1;
    levels[1] = 1;
    const state = stageState(levels, ScreenId.bridge, ScreenId.tunnels, 1);
    expect(state.arrived).toBe(2);
    expect(state.levels[2]).toBe(-1);
    expect(state.fallback).toBe(0);
    const translation = translateSlots(1, state);
    expect(translation.map).toEqual([0, 1, 2, 0, 0, 9, 6, 0, 0]);
    expect(translation.keep).toBe(2);
    expect(translation.arrived).toBe(0);
    // Un niveau déjà joué : image de niveau × 4 + emplacement.
    levels[1] = 3;
    const again = translateSlots(1, stageState(levels, ScreenId.bridge, ScreenId.tunnels, 1));
    expect(again.map[5]).toBe(3 * 4 + 5);
    expect(again.map[6]).toBe(2 * 4 + 6);
    // Camp 2 : atteint par l'un ou l'autre chemin, les deux bornes s'allument.
    const camp = new Array<number>(17).fill(0);
    camp[0x10] = 1;
    expect(translateSlots(2, stageState(camp, ScreenId.slides, ScreenId.lilly, 1)).map[5]).toBe(5);
  });
});

describe.skipIf(!original.has)("transition XFER", () => {
  interface Setup {
    from: number;
    to: number;
    members?: Zoombini[];
    seed?: number;
    prepare?: (game: ReturnType<typeof newGame>, session: { training: number }) => void;
  }

  /** Lance le trajet comme `goTo` depuis l'écran de départ ; les écrans d'arrivée sont factices (ils notent leur entrée). */
  async function begin({ from, to, members, seed = 1, prepare }: Setup) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed });
    await installServices(engine);
    const entered: number[] = [];
    const dummy = (id: number): Scene => ({
      enter: () => void entered.push(id),
      leave() {},
      tick() {},
    });
    for (const id of Object.values(ScreenId)) {
      if (id === ScreenId.xfer) engine.register(id, createXferScene);
      else engine.register(id, () => dummy(id));
    }
    engine.start();
    await runFor(engine, host, 100);
    const zoombinis = engine.services.get(ZOOMBINIS_GAME);
    zoombinis.session.screen = from;
    zoombinis.game.group.members = members ?? group();
    prepare?.(zoombinis.game, zoombinis.session);
    const change = zoombinis.goTo(engine.ctx, to);
    return { host, engine, zoombinis, change, entered };
  }

  /** Joue jusqu'à la sortie de XFER (au plus `limit` ticks) ; rend le nombre de ticks écoulés dans l'écran. */
  async function playOut(engine: ZoombinisEngine, host: TestHost, limit = 2000): Promise<number> {
    await runFor(engine, host, TICK_MS * 3);
    expect(engine.scenes.currentId).toBe(ScreenId.xfer);
    const start = engine.ctx.clock.ticks;
    while (engine.scenes.currentId === ScreenId.xfer && engine.ctx.clock.ticks - start < limit) await runFor(engine, host, TICK_MS * 5);
    return engine.ctx.clock.ticks - start;
  }

  it("chacun des 16 trajets se joue jusqu'au bout, avec le décor de sa région, et envoie à l'écran d'arrivée", async () => {
    for (const [i, [from, to]] of TRANSFER_ROUTES.entries()) {
      const { host, engine, change } = await begin({ from, to });
      expect(change).toMatchObject({ screen: ScreenId.xfer, target: to, transfer: i + 1 });
      await runFor(engine, host, TICK_MS * 4);
      expect(engine.error, `trajet ${i + 1}`).toBeNull();
      expect(engine.scenes.currentId).toBe(ScreenId.xfer);
      const features = engine.services.get(FEATURES);
      const region = TRANSFER_REGION[i]!;
      // Un Zoombini par membre du groupe, plus le décor ; le fond est le jeu de décors de la région.
      expect(features.features.filter((f) => f.hasFlag(FeatureFlag.snoid))).toHaveLength(5);
      expect(features.group(0)).toBeDefined();
      expect(features.group(1) !== undefined).toBe(region >= 1 && region <= 4);
      const elapsed = await playOut(engine, host);
      expect(engine.error, `trajet ${i + 1}`).toBeNull();
      expect(elapsed, `trajet ${i + 1}`).toBeGreaterThan(MIN_TICKS);
      expect(engine.scenes.currentId, `trajet ${i + 1}`).toBe(to);
      expect(engine.services.get(FEATURES).features).toHaveLength(0);
      const frame = host.frames[host.frames.length - 1]!;
      expect(frame.pixels.some((p) => p !== 0)).toBe(true);
    }
  }, 120_000);

  it("les Zoombinis marchent : région 0 sur la falaise en petit, régions 1 à 4 de gauche à droite en bas de l'écran, ville depuis la gauche", async () => {
    const positions = async (from: number, to: number, ticks: number) => {
      const { host, engine } = await begin({ from, to });
      await runFor(engine, host, TICK_MS * ticks);
      expect(engine.scenes.currentId).toBe(ScreenId.xfer);
      return engine.services.get(FEATURES).features.filter((f) => f.hasFlag(FeatureFlag.snoid));
    };
    // Falaise : le premier part tout de suite (SCRS 5199 + pieds) ; les autres attendent.
    const cliff = await positions(ScreenId.picker, ScreenId.bridge, 20);
    expect(cliff.some((f) => f.scriptId >= 5200 && f.scriptId <= 5204)).toBe(true);
    expect(cliff.filter((f) => f.scriptId >= 5200).length).toBeLessThan(cliff.length);
    // Route : le dernier du groupe part le premier, les autres 90 ticks plus tard chacun.
    const road = await positions(ScreenId.pizza, ScreenId.baseCamp, 100);
    const walking = road.filter((f) => f.scriptId >= 105 && f.scriptId <= 129);
    expect(walking).toHaveLength(2);
    // Ville : SCRS 6200 + pieds.
    const town = await positions(ScreenId.maze2, ScreenId.town, 20);
    expect(town.some((f) => f.scriptId >= 6200 && f.scriptId <= 6204)).toBe(true);
  });

  it("falaise (région 0) : ceux qui attendent restent cachés derrière le pan 5100 ; au 2e évènement 0, le Zoombini qui descend passe juste devant lui (11a8:2a0a)", async () => {
    const { host, engine } = await begin({ from: ScreenId.picker, to: ScreenId.bridge });
    const features = engine.services.get(FEATURES);
    const order = () => features.features;
    let passed = 0;
    await runFor(engine, host, TICK_MS * 3);
    expect(engine.scenes.currentId).toBe(ScreenId.xfer);
    for (let t = 0; t < 1400 && engine.scenes.currentId === ScreenId.xfer; t += 5) {
      await runFor(engine, host, TICK_MS * 5);
      const list = order();
      const cliff = list.findIndex((f) => f.scriptId === 5100);
      const front = list.findIndex((f) => f.scriptId === 5101);
      if (cliff < 0) break;
      const snoids = list.filter((f) => f.hasFlag(FeatureFlag.snoid));
      // Ceux qui attendent à (200, 235), en pose 100 : jamais devant le pan de falaise (avant le correctif, tous passaient devant au premier départ).
      for (const f of snoids.filter((f) => f.scriptId < 5200)) expect(list.indexOf(f), `t=${t}`).toBeLessThan(cliff);
      // Ceux qui sont passés devant restent derrière 5101, le dernier passé contre 5100.
      const ahead = snoids.filter((f) => list.indexOf(f) > cliff);
      for (const f of ahead) expect(list.indexOf(f)).toBeLessThan(front);
      passed = Math.max(passed, ahead.length);
    }
    expect(passed).toBeGreaterThanOrEqual(2);
    expect(engine.error).toBeNull();
  });

  it("un clic gauche écourte la transition, une touche ne fait rien", async () => {
    const { host, engine } = await begin({ from: ScreenId.pizza, to: ScreenId.baseCamp });
    await runFor(engine, host, TICK_MS * 30);
    host.press("Space");
    host.press("Enter", { key: "Enter" });
    await runFor(engine, host, TICK_MS * 10);
    expect(engine.scenes.currentId).toBe(ScreenId.xfer);
    host.click(320, 240, "right");
    await runFor(engine, host, TICK_MS * 10);
    expect(engine.scenes.currentId).toBe(ScreenId.xfer);
    host.click(320, 240);
    await runFor(engine, host, TICK_MS * 6);
    expect(engine.error).toBeNull();
    expect(engine.scenes.currentId).toBe(ScreenId.baseCamp);
  });

  it("le narrateur est mis en file selon le niveau et la mémoire de dialogue, sans écrire la mémoire", async () => {
    // Niveau 0 vers Bridge : mémoire 0 → choix 1 → 20094 (région 0).
    const first = await begin({ from: ScreenId.picker, to: ScreenId.bridge });
    const queue = vi.spyOn(first.engine.services.get(ZOOMBINIS_SOUND), "queue");
    await runFor(first.engine, first.host, TICK_MS * 4);
    expect(queue).toHaveBeenCalledWith(0x4e7e);
    expect(first.zoombinis.game.dialogMemory.every((word) => word === 0)).toBe(true);

    // Niveau 1 vers Tunnels : première visite → 20008 ; deuxième visite (bit 0x1000 posé par l'écran d'arrivée) → l'un des trois autres.
    const prepare = (memory: number) => (game: ReturnType<typeof newGame>) => {
      game.levels[0] = 1;
      game.dialogMemory[1] = memory;
    };
    const second = await begin({ from: ScreenId.bridge, to: ScreenId.tunnels, prepare: prepare(0) });
    const spy = vi.spyOn(second.engine.services.get(ZOOMBINIS_SOUND), "queue");
    await runFor(second.engine, second.host, TICK_MS * 4);
    expect(spy).toHaveBeenCalledWith(0x4e28);
    expect(second.zoombinis.game.dialogMemory[1]).toBe(0);
    const third = await begin({ from: ScreenId.bridge, to: ScreenId.tunnels, prepare: prepare(0x1001) });
    const spy3 = vi.spyOn(third.engine.services.get(ZOOMBINIS_SOUND), "queue");
    await runFor(third.engine, third.host, TICK_MS * 4);
    expect([0x4e27, 0x4e28, 0x4e29].some((id) => spy3.mock.calls.some(([called]) => called === id))).toBe(true);
    expect(third.zoombinis.game.dialogMemory[1]).toBe(0x1001);
  });

  it("voix coupées : la transition finit à 300 ticks ; groupe vide : elle joue quand même", async () => {
    const { host, engine, zoombinis } = await begin({ from: ScreenId.tunnels, to: ScreenId.pizza, members: [] });
    zoombinis.game.options.effects = false;
    const elapsed = await playOut(engine, host);
    expect(elapsed).toBeGreaterThanOrEqual(MIN_TICKS - 10);
    expect(elapsed).toBeLessThan(MIN_TICKS + 20);
    expect(engine.scenes.currentId).toBe(ScreenId.pizza);
  });

  it("à graine fixe, deux lancements donnent les mêmes images", async () => {
    const run = async () => {
      const { host, engine } = await begin({ from: ScreenId.picker, to: ScreenId.bridge, seed: 42 });
      await runFor(engine, host, TICK_MS * 150);
      const frame = host.frames[host.frames.length - 1]!;
      return Buffer.from(frame.pixels).toString("base64");
    };
    expect(await run()).toBe(await run());
  });

  it("palette et fond du jeu de décors de la région", async () => {
    for (const [from, to, bg] of [
      [ScreenId.picker, ScreenId.bridge, 5000],
      [ScreenId.pizza, ScreenId.baseCamp, 1000],
      [ScreenId.slides, ScreenId.bcTwo, 2000],
      [ScreenId.hotel, ScreenId.net, 3000],
      [ScreenId.smoke, ScreenId.maze2, 4000],
      [ScreenId.maze2, ScreenId.town, 6000],
    ] as const) {
      const { host, engine } = await begin({ from, to });
      await runFor(engine, host, TICK_MS * 3);
      const archive = engine.ctx.resources.require("XFER.MHK");
      expect(engine.services.get(FEATURES).group(0)?.images).toHaveLength(archive.tbmpImages(bg + 100).length);
      const { palette } = engine.services.get(GRAPHICS);
      expect(palette.colors.slice(10 * 3, 246 * 3).some((v) => v !== 0)).toBe(true);
    }
  });
});
