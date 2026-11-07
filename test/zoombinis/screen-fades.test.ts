import { describe, expect, it, vi } from "vitest";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { ScreenId, type Scene, type SceneContext } from "../../src/games/zoombinis/engine/scene";
import { SCREEN_FADE_TICKS } from "../../src/games/zoombinis/engine/screen-fades";
import { installServices } from "../../src/games/zoombinis/engine/services";
import { originalFiles } from "../support/original";
import { FRAME_MS, runFor, TestHost } from "./engine-test-host";

const original = originalFiles("zoombinis", "files.json");
const FADE = SCREEN_FADE_TICKS;

/** Écran factice : palette grise, compte ses ticks, ses clics, ses touches et ses demandes de sortie. */
interface Probe {
  entered: number;
  ticks: number;
  clicks: number;
  keys: number;
  exits: number;
}

describe.skipIf(!original.has)("fondus d'écran communs (11a8:302b à l'entrée, 11a8:3065 à la sortie)", () => {
  async function start(options: { enabled?: boolean; first?: ScreenId; onEnter?: (id: ScreenId, ctx: SceneContext) => void } = {}) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 1 });
    const services = await installServices(engine);
    services.fades.enabled = options.enabled ?? true;
    services.game.game.options.transitionsOff = true;
    const { palette } = services.graphics;
    const probes = new Map<ScreenId, Probe>();
    const screen =
      (id: ScreenId) =>
      (): Scene => {
        const probe: Probe = { entered: 0, ticks: 0, clicks: 0, keys: 0, exits: 0 };
        probes.set(id, probe);
        return {
          enter(ctx) {
            probe.entered++;
            palette.clearFade();
            palette.colors.fill(120);
            options.onEnter?.(id, ctx);
          },
          leave() {},
          tick(ctx) {
            probe.ticks++;
            probe.clicks += ctx.input.buttonEvents.filter((e) => e.down).length;
          },
          key() {
            probe.keys++;
            return true;
          },
          exit() {
            probe.exits++;
          },
        };
      };
    for (const id of [ScreenId.logo, ScreenId.map, ScreenId.picker, ScreenId.baseCamp, ScreenId.town]) engine.register(id, screen(id));
    engine.start(options.first ?? ScreenId.map);
    /** Avance de `n` ticks de jeu exactement (images de 60 Hz, ticks de 17 ms). */
    const ticks = async (n: number) => {
      const end = engine.ctx.clock.ticks + n;
      while (engine.ctx.clock.ticks < end) await runFor(engine, host, FRAME_MS);
    };
    const lum = () => palette.output().slice(3, 255 * 3).reduce((sum, v) => sum + v, 0);
    const full = 120 * 254 * 3;
    const probe = (id: ScreenId) => probes.get(id)!;
    return { host, engine, services, palette, ticks, lum, full, probe };
  }

  it("à l'entrée : du noir vers la palette en 30 ticks ; le tick de l'écran, ses objets, ses clics, ses touches et sa sortie attendent la fin", async () => {
    const { engine, services, host, ticks, lum, full, probe } = await start();
    const frozen = vi.spyOn(services.features, "tick");
    await ticks(1);
    expect(engine.scenes.currentId).toBe(ScreenId.map);
    expect(lum()).toBeLessThan(full / 10);
    host.click(320, 240);
    engine.requestExit();
    await ticks(FADE / 2);
    expect(lum()).toBeGreaterThan(full / 3);
    expect(lum()).toBeLessThan(full);
    expect(probe(ScreenId.map)).toMatchObject({ ticks: 0, clicks: 0, exits: 0 });
    expect(frozen.mock.calls.every(([isFrozen]) => isFrozen === true)).toBe(true);
    await ticks(FADE / 2 + 1);
    expect(lum()).toBe(full);
    expect(services.graphics.palette.fade).toBeNull();
    expect(probe(ScreenId.map).ticks).toBeGreaterThan(0);
    // Le clic fait pendant le fondu est perdu (l'original ne le traite pas).
    expect(probe(ScreenId.map).clicks).toBe(0);
    expect(frozen.mock.calls.at(-1)![0]).toBe(false);
    host.click(320, 240);
    engine.requestExit();
    await ticks(2);
    expect(probe(ScreenId.map)).toMatchObject({ clicks: 1, exits: 1 });
  });

  it("à la sortie (goTo) : fondu vers le noir, écran gelé, bascule à la fin, puis fondu d'entrée de l'écran suivant", async () => {
    const { engine, services, ticks, lum, full, probe } = await start();
    await ticks(FADE + 2);
    const before = probe(ScreenId.map).ticks;
    services.game.goTo(engine.ctx, ScreenId.picker);
    expect(services.game.lastChange?.screen).toBe(ScreenId.picker);
    expect(services.fades.leaving).toBe(true);
    await ticks(FADE / 2);
    expect(engine.scenes.currentId).toBe(ScreenId.map);
    expect(lum()).toBeLessThan(full);
    expect(lum()).toBeGreaterThan(0);
    expect(probe(ScreenId.map).ticks).toBe(before);
    await ticks(FADE / 2);
    expect(lum()).toBe(0);
    await ticks(2);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
    expect(lum()).toBeLessThan(full / 10);
    await ticks(FADE);
    expect(lum()).toBe(full);
    expect(probe(ScreenId.picker).ticks).toBeGreaterThan(0);
  });

  it("une seconde demande pendant le fondu de sortie remplace la première, sans second fondu", async () => {
    const { engine, services, ticks, probe } = await start();
    await ticks(FADE + 2);
    services.fades.request(engine.ctx, ScreenId.picker);
    await ticks(10);
    const fade = services.graphics.palette.fade;
    services.fades.request(engine.ctx, ScreenId.town);
    expect(services.graphics.palette.fade).toBe(fade);
    await ticks(FADE);
    expect(engine.scenes.currentId).toBe(ScreenId.town);
    expect(probe(ScreenId.town).entered).toBe(1);
    expect(probe(ScreenId.picker)).toBeUndefined();
  });

  it("le logo n'a pas de fondu d'entrée, donc pas de fondu de sortie (DS:a404 à 0) : l'écran suivant vient tout de suite", async () => {
    const { engine, services, ticks, lum, full, probe } = await start({ first: ScreenId.logo });
    await ticks(2);
    expect(engine.scenes.currentId).toBe(ScreenId.logo);
    expect(lum()).toBe(full);
    expect(probe(ScreenId.logo).ticks).toBeGreaterThan(0);
    services.fades.request(engine.ctx, ScreenId.map);
    expect(services.fades.leaving).toBe(false);
    await ticks(2);
    expect(engine.scenes.currentId).toBe(ScreenId.map);
  });

  it("un écran qui demande à partir pendant son enter ne fait pas de fondu", async () => {
    const { engine, services, ticks } = await start({
      onEnter: (id, ctx) => {
        if (id === ScreenId.map) services.game.goTo(ctx, ScreenId.picker);
      },
    });
    await ticks(1);
    expect(services.graphics.palette.fade).toBeNull();
    expect(services.fades.blocking).toBe(false);
    await ticks(2);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
  });

  it("coupés (tests, défaut) : pas de fondu, l'écran tourne dès son entrée et goTo bascule au tick suivant", async () => {
    const { engine, services, ticks, lum, full, probe } = await start({ enabled: false });
    await ticks(2);
    expect(lum()).toBe(full);
    expect(probe(ScreenId.map).ticks).toBeGreaterThan(0);
    services.game.goTo(engine.ctx, ScreenId.picker);
    await ticks(2);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
    expect(lum()).toBe(full);
  });
});
