import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import type { Scene } from "../../src/games/teleportaschtroumpf/engine/scene";
import { TestHost, runFor } from "./engine-test-host";

/** Scène vide qui compte ses pas. */
function counting(): Scene & { updates: number } {
  return {
    updates: 0,
    enter() {},
    update() {
      this.updates++;
    },
    render() {},
  };
}

async function setup() {
  const host = new TestHost();
  const engine = new Engine(host);
  const scene = counting();
  await engine.start(scene);
  await runFor(engine, host, 100);
  return { host, engine, scene };
}

describe("pause de l'onglet masqué", () => {
  it("l'horloge s'arrête et reprend sans rattraper l'absence", async () => {
    const { host, engine, scene } = await setup();
    const before = scene.updates;
    engine.setPaused(true);
    expect(engine.isPaused).toBe(true);
    host.time += 60_000;
    engine.frame(host.time);
    await runFor(engine, host, 1000);
    expect(scene.updates).toBe(before);
    const ticks = engine.ctx.clock.ticks;

    engine.setPaused(false);
    host.time += 16.7;
    engine.frame(host.time);
    expect(engine.ctx.clock.ticks).toBe(ticks); // la première image fixe seulement la nouvelle origine
    await runFor(engine, host, 1000);
    expect(engine.ctx.clock.ticks - ticks).toBeGreaterThanOrEqual(58);
    expect(engine.ctx.clock.ticks - ticks).toBeLessThanOrEqual(61);
  });

  it("le son est figé pendant la pause et la position reprend au même point", async () => {
    const { host, engine } = await setup();
    const { voice } = engine.ctx;
    voice.play({ samples: new Uint8Array(10_000).fill(128), sampleRate: 1000 });
    await runFor(engine, host, 2000);
    expect(voice.position).toBeCloseTo(2, 1);

    engine.setPaused(true);
    expect(host.audio.suspended).toBe(true);
    host.time += 30_000;
    expect(voice.position).toBeCloseTo(2, 1);
    expect(voice.voicePlaying).toBe(true);

    engine.setPaused(false);
    expect(host.audio.suspended).toBe(false);
    expect(voice.position).toBeCloseTo(2, 1);
    await runFor(engine, host, 1000);
    expect(voice.position).toBeCloseTo(3, 1);
  });

  it("setPaused est idempotent", async () => {
    const { host, engine } = await setup();
    engine.setPaused(true);
    engine.setPaused(true);
    engine.setPaused(false);
    engine.setPaused(false);
    expect(host.audio.suspended).toBe(false);
  });
});

describe("focus du canvas", () => {
  it("n'est repris que depuis le body ou le canvas, jamais à un autre contrôle", async () => {
    const { canvasMayTakeFocus } = await import("../../src/games/teleportaschtroumpf/ui/app");
    const body = {} as Element;
    const canvas = {} as Element;
    const button = {} as Element;
    expect(canvasMayTakeFocus(null, body, canvas)).toBe(true);
    expect(canvasMayTakeFocus(body, body, canvas)).toBe(true);
    expect(canvasMayTakeFocus(canvas, body, canvas)).toBe(true);
    expect(canvasMayTakeFocus(button, body, canvas)).toBe(false);
  });
});
