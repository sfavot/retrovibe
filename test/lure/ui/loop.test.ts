import { describe, expect, it } from "vitest";
import type { LureEngine } from "../../../src/games/lure/engine/game";
import type { LureRenderer } from "../../../src/games/lure/render/renderer";
import { LureLoop, MAX_FRAME_MS } from "../../../src/games/lure/ui/loop";

function setup() {
  const log: string[] = [];
  const clock = { now: 1000 };
  const engine = { sequenceScreen: null as object | null, tick: () => log.push("tick") };
  const renderer = {
    fading: false,
    output: new Uint8Array(4),
    palette: new Uint8Array(6),
    render: (_engine: unknown, elapsed: number) => log.push(`render ${elapsed}`),
  };
  const presented: Uint8Array[] = [];
  const loop = new LureLoop({
    engine: engine as unknown as LureEngine,
    renderer: renderer as unknown as LureRenderer,
    present: (pixels) => presented.push(pixels),
    now: () => clock.now,
  });
  return { loop, engine, renderer, log, clock, presented };
}

describe("LureLoop", () => {
  it("le moteur avance, sauf pendant un fondu (ScummVM est bloqué dans les fondus)", () => {
    const { loop, renderer, log } = setup();
    loop.tick();
    renderer.fading = true;
    loop.tick();
    loop.tick();
    renderer.fading = false;
    loop.tick();
    expect(log).toEqual(["tick", "tick"]);
  });

  it("le rendu reçoit le temps écoulé depuis l'image précédente (0 la première fois, borné ensuite) et l'image est présentée", () => {
    const { loop, log, clock, presented, renderer } = setup();
    loop.render();
    clock.now += 16;
    loop.render();
    clock.now += 5000;
    loop.render();
    expect(log).toEqual(["render 0", "render 16", `render ${MAX_FRAME_MS}`]);
    expect(presented).toHaveLength(3);
    expect(presented[0]).toBe(renderer.output);
  });

  it("« Passer » n'est offert que pendant une séquence plein écran", () => {
    const { loop, engine } = setup();
    expect(loop.canSkip).toBe(false);
    engine.sequenceScreen = {};
    expect(loop.canSkip).toBe(true);
  });

  it("step avance de n ticks de 80 ms et repeint à chaque fois", () => {
    const { loop, log } = setup();
    loop.step(2);
    expect(log).toEqual(["tick", "render 80", "tick", "render 80"]);
  });
});
