import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import type { Scene, SceneContext } from "../../src/games/teleportaschtroumpf/engine/scene";
import { TestHost, runFor } from "./engine-test-host";

/** Scène qui note ses appels dans `log`. */
class Probe implements Scene {
  updates = 0;
  /** L'écran était-il noir (fondu) quand la scène est entrée ? */
  blackAtEnter = false;
  constructor(
    readonly name: string,
    readonly log: string[],
    readonly step?: number,
    private readonly loadWait?: Promise<void>,
  ) {}
  async load(): Promise<void> {
    this.log.push(`${this.name}.load`);
    await this.loadWait;
    this.log.push(`${this.name}.loaded`);
  }
  enter(ctx: SceneContext): void {
    this.log.push(`${this.name}.enter`);
    this.blackAtEnter = ctx.palette.black;
    ctx.surface.clear(1);
    ctx.palette.setColor(1, 200, 100, 50);
  }
  update(): void {
    this.updates++;
  }
  render(ctx: SceneContext): void {
    ctx.surface.clear(1 + this.updates);
  }
  resume(): void {
    this.log.push(`${this.name}.resume`);
  }
  exit(): void {
    this.log.push(`${this.name}.exit`);
  }
}

function setup() {
  const host = new TestHost();
  const engine = new Engine(host, { seed: 1 });
  return { host, engine, scenes: engine.ctx.scenes, ctx: engine.ctx, log: [] as string[] };
}

describe("SceneManager", () => {
  it("remplace : load, puis exit de l'ancienne et enter de la nouvelle", async () => {
    const { host, engine, scenes, log } = setup();
    scenes.replace(new Probe("a", log));
    await runFor(engine, host, 100);
    scenes.replace(new Probe("b", log));
    await runFor(engine, host, 100);
    expect(log).toEqual(["a.load", "a.loaded", "a.enter", "b.load", "b.loaded", "a.exit", "b.enter"]);
    expect(scenes.depth).toBe(1);
  });

  it("appelle update tous les `step` ticks, propre à chaque scène (5 par défaut)", async () => {
    const { host, engine, scenes, log } = setup();
    const slow = new Probe("slow", log); // 5
    scenes.replace(slow);
    await runFor(engine, host, 1000); // 60 ticks
    // Premier update dès le premier tick, puis un tous les 5 ticks.
    expect(slow.updates).toBeGreaterThanOrEqual(11);
    expect(slow.updates).toBeLessThanOrEqual(13);
    const fast = new Probe("fast", log, 3);
    scenes.replace(fast);
    await runFor(engine, host, 1000);
    expect(fast.updates).toBeGreaterThanOrEqual(19);
    expect(fast.updates).toBeLessThanOrEqual(21);
  });

  it("charge sans bloquer la boucle : l'état de chargement est visible, la scène courante ne change qu'à la fin", async () => {
    const { host, engine, scenes, log } = setup();
    const first = new Probe("a", log);
    scenes.replace(first);
    await runFor(engine, host, 200);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    scenes.replace(new Probe("b", log, undefined, gate));
    const before = first.updates;
    for (let i = 0; i < 30; i++) {
      host.time += 1000 / 60;
      engine.frame(host.time);
    }
    expect(engine.loading).toBe(true);
    expect(scenes.top).toBe(first);
    expect(first.updates).toBe(before); // la scène courante est figée pendant la transition
    expect(log).not.toContain("b.enter");
    release();
    await runFor(engine, host, 50);
    expect(engine.loading).toBe(false);
    expect(log).toContain("b.enter");
  });

  it("une erreur de chargement remonte par frame()", async () => {
    const { host, engine, scenes } = setup();
    scenes.replace({
      load: () => Promise.reject(new Error("fichier absent")),
      enter() {},
      update() {},
      render() {},
    });
    await expect(runFor(engine, host, 200)).rejects.toThrow("fichier absent");
  });

  it("pile : push garde la scène du dessous figée, pop la reprend (resume)", async () => {
    const { host, engine, scenes, log } = setup();
    const base = new Probe("base", log);
    const pause = new Probe("pause", log);
    scenes.replace(base);
    await runFor(engine, host, 200);
    scenes.push(pause);
    await runFor(engine, host, 300);
    expect(scenes.depth).toBe(2);
    expect(scenes.top).toBe(pause);
    const frozen = base.updates;
    await runFor(engine, host, 300);
    expect(base.updates).toBe(frozen);
    expect(pause.updates).toBeGreaterThan(0);
    expect(log).not.toContain("base.exit");
    scenes.pop();
    await runFor(engine, host, 100);
    expect(scenes.top).toBe(base);
    expect(scenes.depth).toBe(1);
    expect(log.slice(-2)).toEqual(["pause.exit", "base.resume"]);
    await runFor(engine, host, 300);
    expect(base.updates).toBeGreaterThan(frozen);
    expect(() => scenes.pop()).toThrow();
  });

  it("une seule transition à la fois", async () => {
    const { host, engine, scenes, log } = setup();
    scenes.replace(new Probe("a", log));
    expect(() => scenes.replace(new Probe("b", log))).toThrow();
    await runFor(engine, host, 100);
  });

  it("fondu : au noir avant l'entrée de la nouvelle scène, puis révélée", async () => {
    const { host, engine, scenes, ctx, log } = setup();
    scenes.replace(new Probe("a", log));
    await runFor(engine, host, 200);
    expect(ctx.palette.black).toBe(false);
    const next = new Probe("b", log);
    scenes.replace(next, { fade: true });
    let fadingOut = false;
    let sawFadeIn = false;
    await runFor(engine, host, 1000, () => {
      if (!log.includes("b.enter") && ctx.fade.active) fadingOut = true;
      if (log.includes("b.enter") && ctx.fade.active) sawFadeIn = true;
    });
    expect(fadingOut).toBe(true);
    expect(next.blackAtEnter).toBe(true);
    expect(sawFadeIn).toBe(true);
    expect(ctx.fade.active).toBe(false);
    expect(ctx.palette.fadeStep).toBe(0);
    const shown = host.lastPresentation.palette;
    expect([...shown.subarray(3, 6)]).toEqual([...ctx.palette.display().subarray(3, 6)]);
  });

  it("les appuis faits avant l'entrée d'une scène ne lui sont pas transmis", async () => {
    const { host, engine, scenes, ctx, log } = setup();
    scenes.replace(new Probe("a", log));
    await runFor(engine, host, 100);
    ctx.input.keyDown("Escape");
    let seen = false;
    scenes.replace({
      enter() {},
      update(c) {
        if (c.input.justPressed("skip")) seen = true;
      },
      render() {},
    });
    await runFor(engine, host, 200);
    expect(seen).toBe(false);
  });
});

describe("Engine", () => {
  it("présente la surface et la palette d'affichage, seulement quand quelque chose change", async () => {
    const { host, engine, scenes, ctx, log } = setup();
    scenes.replace(new Probe("a", log, 60)); // un update par seconde
    await runFor(engine, host, 500);
    const count = host.presentations.length;
    expect(count).toBeGreaterThan(0);
    await runFor(engine, host, 300);
    expect(host.presentations.length).toBe(count); // rien n'a changé entre deux updates
    expect(host.lastPresentation.surface[0]).toBe(ctx.surface.work[0]);
    expect(host.lastPresentation.surface).not.toBe(ctx.surface.work);
    expect([...host.lastPresentation.palette.subarray(0, 3)]).toEqual([0, 0, 0]);
  });

  it("F1 / F2 règlent le volume avec une répétition de 20 ticks", async () => {
    const { host, engine, scenes, ctx, log } = setup();
    scenes.replace(new Probe("a", log));
    await runFor(engine, host, 100);
    expect(ctx.voice.volume).toBe(15);
    host.input.keyDown("F1");
    await runFor(engine, host, 100);
    expect(ctx.voice.volume).toBe(14);
    await runFor(engine, host, 1000);
    // Environ 3 pas par seconde tant que la touche est tenue.
    expect(ctx.voice.volume).toBeLessThanOrEqual(11);
    expect(ctx.voice.volume).toBeGreaterThanOrEqual(9);
    host.input.keyUp("F1");
    host.input.keyDown("F2");
    await runFor(engine, host, 100);
    expect(ctx.voice.volume).toBeGreaterThan(9);
  });
});
