import { describe, expect, it } from "vitest";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { FEATURES, FeatureFlag } from "../../src/games/zoombinis/engine/features";
import {
  GRAPHICS,
  installServices,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from "../../src/games/zoombinis/engine/services";
import { createDemoScene } from "../../src/games/zoombinis/scenes/demo";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

const original = originalFiles("zoombinis", "files.json");

describe.skipIf(!original.has)("écran de démonstration (BASECAMP)", () => {
  async function start() {
    const host = new TestHost();
    // Le son ne joue qu'une fois la sortie débloquée (premier geste dans le navigateur).
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 1 });
    const services = await installServices(engine);
    engine.register(ScreenId.logo, createDemoScene);
    engine.start();
    await runFor(engine, host, 100);
    return { host, engine, services };
  }

  it("dessine le fond 640×480 avec sa palette", async () => {
    const { host, engine } = await start();
    expect(engine.error).toBeNull();
    expect(engine.scenes.currentId).toBe(ScreenId.logo);
    const frame = host.frames[host.frames.length - 1]!;
    expect(frame.pixels.length).toBe(SCREEN_WIDTH * SCREEN_HEIGHT);
    expect(frame.pixels.some((p) => p !== 0)).toBe(true);
    // La palette 10… vient du SHPL 1000 : au moins une entrée non noire dans la plage animable.
    expect(frame.palette.slice(10 * 3, 246 * 3).some((v) => v !== 0)).toBe(
      true,
    );
    const { palette } = engine.services.get(GRAPHICS);
    expect([...palette.colors.slice(30, 33)].some((v) => v !== 0)).toBe(true);
  });

  it("anime le décor : 32 features du camp, image recomposée au fil des ticks, détruites à la sortie", async () => {
    const { host, engine } = await start();
    const features = engine.services.get(FEATURES);
    const decor = () => features.features.filter((f) => !f.hasFlag(FeatureFlag.snoid));
    expect(decor()).toHaveLength(32);
    expect(features.group(0)).toBeDefined();
    expect(features.group(1)).toBeDefined();
    const before = host.frames[host.frames.length - 1]!.pixels.slice();
    await runFor(engine, host, 600);
    const after = host.frames[host.frames.length - 1]!.pixels;
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
    engine.scenes.request(ScreenId.map);
    engine.register(ScreenId.map, () => ({
      enter() {},
      leave() {},
      tick() {},
    }));
    await runFor(engine, host, 5);
    expect(features.features).toHaveLength(0);
  });

  it("fait entrer cinq Zoombinis un à un, marcher sur le chemin 1 de NODE / PATH 1000 puis attendre", async () => {
    const { host, engine } = await start();
    const features = engine.services.get(FEATURES);
    const snoids = () => features.features.filter((f) => f.hasFlag(FeatureFlag.snoid));
    // Le premier est entré au premier tick ; les autres suivent à intervalles réguliers.
    expect(snoids()).toHaveLength(1);
    expect(snoids()[0]!.active).toBe(true);
    await runFor(engine, host, 1200);
    expect(snoids()).toHaveLength(5);
    // Mi-parcours : ils marchent (scripts de marche 105 à 129, jamais l'attente 100), le long de la bande des nœuds 1, 2 et 7.
    const walking = snoids().filter((f) => f.active);
    expect(walking.length).toBeGreaterThan(0);
    for (const f of walking) {
      expect(f.scriptId).toBeGreaterThanOrEqual(105);
      expect(f.scriptId).toBeLessThanOrEqual(129);
    }
    await runFor(engine, host, 6000);
    // Arrivés : tous en pose d'attente (script 100, une image arrêtée), à la file de gauche à droite sans sortir de l'écran.
    const stopped = snoids();
    expect(stopped.every((f) => !f.active && f.scriptId === 100)).toBe(true);
    const rects = stopped.map((f) => f.rect!);
    expect(rects.every((r) => r.left >= 0 && r.right <= SCREEN_WIDTH && r.bottom <= SCREEN_HEIGHT)).toBe(true);
    const lefts = rects.map((r) => r.left);
    expect([...lefts].sort((a, b) => b - a)).toEqual(lefts);
    expect(new Set(lefts).size).toBe(5);
  });

  it("envoie la musique 30000 au MIDI", async () => {
    const { host, services } = await start();
    expect(services.sound.lastMusicId).toBe(30000);
    expect(host.audio.midi.messages.length).toBeGreaterThan(0);
    // Messages SYSX d'initialisation (Bn 79 00 : remise à zéro des contrôleurs) avant les notes.
    expect(
      host.audio.midi.messages.some(
        ({ message }) => message[0] === 0xb0 && message[1] === 0x79,
      ),
    ).toBe(true);
  });

  it("fait défiler les curseurs et joue un son au clic", async () => {
    const { host, engine } = await start();
    const waves = host.audio.waves.length;
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      host.click(100, 100);
      await runFor(engine, host, 50);
      seen.push(host.cursor!);
    }
    expect(seen).toEqual([
      "curs1",
      "curs2",
      "curs3",
      "curs4",
      "curs5",
      "system",
    ]);
    expect(host.audio.waves.length).toBeGreaterThan(waves);
  });
});
