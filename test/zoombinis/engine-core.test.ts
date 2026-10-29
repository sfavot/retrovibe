import { describe, expect, it } from "vitest";
import { COMMON_ARCHIVE, TAG_TBMP } from "../../src/games/zoombinis/data/archives";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { curs, scrb } from "../../src/games/zoombinis/engine/resources";
import { SCREEN_NAMES, ScreenId, type Scene } from "../../src/games/zoombinis/engine/scene";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

const original = originalFiles("zoombinis", "files.json");

function setup(seed?: number) {
  const host = new TestHost();
  const engine = createZoombinisEngine(host, { seed });
  return { host, engine };
}

/** Écran factice qui note ses appels dans `log`. */
function dummy(name: string, log: string[], extra: Partial<Scene> = {}): () => Scene {
  return () => ({
    enter: () => void log.push(`${name}:enter`),
    leave: () => void log.push(`${name}:leave`),
    tick: () => void log.push(`${name}:tick`),
    ...extra,
  });
}

describe("ScreenId", () => {
  it("compte 23 écrans aux identifiants uniques de 0 à 22", () => {
    const ids = Object.values(ScreenId);
    expect(ids).toHaveLength(23);
    expect(new Set(ids).size).toBe(23);
    expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, i) => i));
    expect(SCREEN_NAMES).toHaveLength(23);
    expect(SCREEN_NAMES[ScreenId.baseCamp]).toBe("baseCamp");
  });
});

describe("moteur Zoombinis", () => {
  it("démarre sur le logo (écran 0) au premier tick", async () => {
    const { host, engine } = setup();
    const log: string[] = [];
    engine.register(ScreenId.logo, dummy("logo", log));
    engine.start();
    expect(log).toEqual([]);
    await runFor(engine, host, 40);
    expect(log[0]).toBe("logo:enter");
    expect(engine.scenes.currentId).toBe(ScreenId.logo);
  });

  it("change d'écran de façon différée : leave puis enter, jamais pendant un tick", async () => {
    const { host, engine } = setup();
    const log: string[] = [];
    engine.register(
      ScreenId.logo,
      dummy("logo", log, {
        tick: (ctx) => {
          log.push("logo:tick");
          ctx.scenes.request(ScreenId.picker);
          log.push("logo:requested");
        },
      }),
    );
    engine.register(ScreenId.picker, dummy("picker", log));
    engine.start();
    await runFor(engine, host, 120);
    const requested = log.indexOf("logo:requested");
    expect(requested).toBeGreaterThan(0);
    expect(log.slice(requested + 1, requested + 3)).toEqual(["logo:leave", "picker:enter"]);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
  });

  it("ne quitte pas sur Ctrl+Q et expose les préférences par défaut", async () => {
    const { host, engine } = setup();
    engine.register(ScreenId.logo, dummy("logo", []));
    engine.start();
    await runFor(engine, host, 40);
    host.press("KeyQ", { ctrl: true, key: "q" });
    await runFor(engine, host, 80);
    expect(host.exited).toBe(false);
    expect(engine.ctx.prefs).toEqual({
      music: true,
      effects: true,
      transitions: true,
      magneticMouse: false,
      autoMagnet: false,
      hideCursorWhileCarrying: true,
    });
  });

  it("tire le hasard comme 1080:0028 (engine.md §8) à graine fixe", () => {
    const { engine } = setup(12345);
    let s = 12345;
    for (const n of [9, 3, 100, 65535, 7, 1]) {
      s = (Math.imul(s, 0x343fd) + 0x269ec3) >>> 0;
      expect(engine.ctx.rng.rand(n)).toBe((s >>> 16) % (n + 1));
    }
  });

  it.skipIf(!original.has)("une scène lit CURS 1, un SCRB et une planche tBMP de ZOOMBINI.MHK", async () => {
    const { host, engine } = setup();
    const seen: Record<string, unknown> = {};
    engine.register(ScreenId.logo, () => ({
      load: async (ctx) => {
        await ctx.resources.open(COMMON_ARCHIVE);
      },
      enter: (ctx) => {
        const archive = ctx.resources.require(COMMON_ARCHIVE);
        seen.cursor = curs(archive, 1);
        const [firstScrb] = archive.ids("SCRB");
        seen.script = scrb(archive, firstScrb!);
        seen.sheet = archive.tbmpImages(3000);
        seen.hasTbmp = archive.has(TAG_TBMP, 3000);
      },
      leave: () => {},
      tick: () => {},
    }));
    engine.start();
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    expect((seen.cursor as { width: number }).width).toBe(16);
    expect(seen.script).toBeDefined();
    expect(seen.hasTbmp).toBe(true);
    expect((seen.sheet as unknown[]).length).toBe(890);
    expect(host.loaded).toContain(COMMON_ARCHIVE);
  });
});
