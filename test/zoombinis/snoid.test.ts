import { describe, expect, it, vi } from "vitest";
import type { Script } from "../../src/games/zoombinis/data/script";
import {
  composeSnoidImage,
  snoidVoiceIdForEvent,
  snoidWalkScriptId,
  traitsFromIndex,
  walkLeg,
  WALK_TICKS_PER_STEP,
  type Point,
  type SnoidAnchors,
} from "../../src/games/zoombinis/data/zoombini";
import { createZoombinisEngine, type ZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag } from "../../src/games/zoombinis/engine/features";
import { node, path } from "../../src/games/zoombinis/engine/resources";
import type { Scene, SceneContext } from "../../src/games/zoombinis/engine/scene";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { installServices, SCREEN_HEIGHT, SCREEN_WIDTH, GRAPHICS } from "../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../src/games/zoombinis/engine/sound";
import { closeScreen, openScreen } from "../../src/games/zoombinis/scenes/screen-kit";
import { createSnoid, snoidAssets, type Snoid } from "../../src/games/zoombinis/scenes/snoid";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

/** Un tick de 17 ms (le simulateur tourne à 60 Hz : on avance image par image et on lit l'horloge du moteur). */
const TICK = 17;

describe.skipIf(!original.has)("Zoombinis à l'écran (snoid)", () => {
  /** Écran de test : le décor de BASECAMP, sans autre feature ; `setup` crée les Zoombinis dans `enter`. */
  async function start(setup: (ctx: SceneContext) => void) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 1 });
    await installServices(engine);
    let background: ReturnType<typeof openScreen>;
    const scene: Scene = {
      async load(ctx) {
        await ctx.resources.open("BASECAMP.MHK");
      },
      enter(ctx) {
        background = openScreen(ctx, ctx.resources.require("BASECAMP.MHK"));
        setup(ctx);
        ctx.services.get(FEATURES).invalidate();
      },
      leave: closeScreen,
      tick() {},
    };
    engine.register(ScreenId.logo, () => scene);
    engine.start();
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    return { host, engine, background: () => background };
  }

  const traits = traitsFromIndex(3 * 125 + 25 + 2 * 5 + 4);

  it("compose le Zoombini à l'écran : parties de la pose d'attente, pixels du Zoombini et seulement dans son rectangle", async () => {
    let snoid!: Snoid;
    const { host, engine, background } = await start((ctx) => {
      snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 } });
    });
    await runFor(engine, host, 100);
    const assets = snoidAssets(engine.ctx);
    const script = assets.script(100);
    const anchors: SnoidAnchors = { 3000: assets.sheets[3000].anchors!, 3100: assets.sheets[3100].anchors! };
    const expected = composeSnoidImage(traits, script.images[0]!, { pose: script.pose, origin: { x: 300, y: 400 }, anchors });
    expect(expected.length).toBeGreaterThan(0);
    expect(snoid.feature.parts.map(({ w, x, y }) => ({ w, x, y }))).toEqual(expected.map((p) => ({ w: p.index, x: p.x, y: p.y })));
    expect(snoid.scriptId).toBe(100);
    expect(snoid.feature.active).toBe(false);

    // L'écran diffère du décor dans le rectangle de la feature, et nulle part ailleurs.
    const { screen } = engine.services.get(GRAPHICS);
    const rect = snoid.feature.rect!;
    let inside = 0;
    for (let y = 0; y < SCREEN_HEIGHT; y++)
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        const differs = screen.pixels[y * SCREEN_WIDTH + x] !== background().pixels[y * SCREEN_WIDTH + x];
        const within = x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
        if (differs) {
          expect(within).toBe(true);
          inside++;
        }
      }
    expect(inside).toBeGreaterThan(200);
    // Les pieds sont au point d'ancrage : le Zoombini tient autour de (300, 400).
    expect(rect.left).toBeLessThan(300);
    expect(rect.right).toBeGreaterThan(300);
    expect(rect.top).toBeLessThan(400);
  });

  it("change de côté et de mode petit : autre image de la planche", async () => {
    let snoid!: Snoid;
    const { host, engine } = await start((ctx) => {
      snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 } });
    });
    await runFor(engine, host, 50);
    const right = snoid.feature.parts.map((p) => p.w);
    snoid.face(1);
    await runFor(engine, host, 50);
    const left = snoid.feature.parts.map((p) => p.w);
    expect(left).toEqual(right.map((w) => w + 1));
    snoid.setSmall(true);
    await runFor(engine, host, 50);
    expect(snoid.feature.parts.every((p) => p.sheet === snoidAssets(engine.ctx).sheets[3200])).toBe(true);
  });

  it("setFacing change le sens sans relire le script ; setPose impose la pose des emplacements", async () => {
    let snoid!: Snoid;
    const { host, engine } = await start((ctx) => {
      snoid = createSnoid(ctx, traits, { position: { x: 100, y: 400 } });
      snoid.play(130);
    });
    await runFor(engine, host, 17 * 20);
    const feature = snoid.feature;
    const image = feature.image;
    const script = snoid.scriptId;
    const right = feature.parts.map((p) => p.w);
    snoid.setFacing(1);
    expect(snoid.scriptId).toBe(script);
    expect(feature.image).toBe(image);
    await runFor(engine, host, 17 * 7);
    expect(snoid.facing).toBe(1);
    expect(feature.parts.map((p) => p.w).some((w, i) => w !== right[i])).toBe(true);
    const before = feature.parts.map((p) => p.w).join();
    snoid.setPose(2);
    await runFor(engine, host, 17 * 7);
    expect(feature.parts.map((p) => p.w).join()).not.toBe(before);
    snoid.setPose(null);
  });

  /** Joue `ticks` ticks et relève (tick, position) à chaque changement de position, vue par un crochet de tick placé après celui des features. */
  async function trace(engine: ZoombinisEngine, host: TestHost, snoid: Snoid, ticks: number): Promise<{ tick: number; x: number; y: number }[]> {
    const seen = [{ tick: engine.ctx.clock.ticks, x: snoid.position.x, y: snoid.position.y }];
    let active = true;
    engine.addTickHook((ctx) => {
      const last = seen[seen.length - 1]!;
      if (active && (last.x !== snoid.position.x || last.y !== snoid.position.y))
        seen.push({ tick: ctx.clock.ticks, x: snoid.position.x, y: snoid.position.y });
    });
    await runFor(engine, host, ticks * TICK);
    active = false;
    return seen;
  }

  it("marche en ligne droite : un pas de §4.2 toutes les 6 ticks, script de marche du secteur, arrivée en attente", async () => {
    let snoid!: Snoid;
    const arrivals: Point[] = [];
    const { host, engine } = await start((ctx) => {
      snoid = createSnoid(ctx, traits, { position: { x: 100, y: 400 }, onArrive: (s) => arrivals.push({ ...s.position }) });
    });
    const from = { x: 100, y: 400 };
    const to = { x: 300, y: 400 };
    const leg = walkLeg(from, to)!;
    expect(leg).toMatchObject({ sector: 2, stepX: 16 });
    snoid.walkTo(to);
    expect(snoid.walking).toBe(true);
    expect(snoid.scriptId).toBe(snoidWalkScriptId(traits.feet, 2));
    const seen = await trace(engine, host, snoid, 140);

    const xs = seen.map((s) => s.x);
    // 12 pas de 16 pixels puis le reste (200 = 12 × 16 + 8), y inchangé.
    expect(xs.slice(0, 14)).toEqual([100, 116, 132, 148, 164, 180, 196, 212, 228, 244, 260, 276, 292, 300]);
    expect(seen.every((s) => s.y === 400)).toBe(true);
    const steps = seen.slice(1);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.tick - steps[i - 1]!.tick).toBe(WALK_TICKS_PER_STEP);
    expect(snoid.scriptId).toBe(100);

    expect(arrivals).toEqual([to]);
    expect(snoid.walking).toBe(false);
    expect(snoid.facing).toBe(0);
    expect(snoid.feature.active).toBe(false);
    expect(snoid.feature.parts.length).toBeGreaterThan(0);
    // Il ne bouge plus.
    expect(seen[seen.length - 1]).toMatchObject({ x: 300, y: 400 });
  });

  it("marche vers la gauche : orientation et script de marche du secteur courant", async () => {
    let snoid!: Snoid;
    const { host, engine } = await start((ctx) => {
      snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 } });
    });
    snoid.walkTo({ x: 200, y: 400 });
    await runFor(engine, host, 6 * TICK);
    expect(snoid.facing).toBe(1);
    expect(snoid.scriptId).toBe(snoidWalkScriptId(traits.feet, 2));
    const scripts = new Set<number>();
    for (let i = 0; i < 100; i++) {
      await runFor(engine, host, TICK);
      scripts.add(snoid.scriptId);
    }
    expect(snoid.position).toEqual({ x: 200, y: 400 });
    expect(snoid.facing).toBe(1);
    expect(scripts.has(100)).toBe(true);
  });

  it("suit un chemin de NODE / PATH : passe par ses nœuds dans l'ordre", async () => {
    let snoid!: Snoid;
    let nodes: ReturnType<typeof node> = [];
    let paths: ReturnType<typeof path> = [];
    let arrived = 0;
    const { host, engine } = await start((ctx) => {
      const archive = ctx.resources.require("BASECAMP.MHK");
      nodes = node(archive, 1000);
      paths = path(archive, 1000);
      snoid = createSnoid(ctx, traits, { position: { ...nodes[0]! }, onArrive: () => arrived++ });
    });
    // Chemin 1 : nœuds 1, 2 et 7.
    expect(paths[1]).toEqual([1, 2, 7]);
    snoid.followPath(nodes, paths[1]!);
    const seen = await trace(engine, host, snoid, 400);
    const visited = seen.map((s) => `${s.x},${s.y}`);
    const index = (n: number) => visited.indexOf(`${nodes[n - 1]!.x},${nodes[n - 1]!.y}`);
    expect(index(2)).toBeGreaterThan(0);
    expect(index(7)).toBeGreaterThan(index(2));
    expect(seen[seen.length - 1]).toMatchObject(nodes[6]!);
    expect(arrived).toBe(1);
    // Le nœud 2 est plus bas que le 1 (355 > 325) : le Zoombini descend d'abord (secteurs 0 ou 1, jamais l'attente).
    expect(seen[1]!.y).toBeGreaterThan(seen[0]!.y);
  });

  it("met en file la voix d'un terminateur dépendant du Zoombini et joue un SCRS d'écran", async () => {
    // Script d'écran synthétique : l'image 0 de l'attente 100, terminée par l'évènement 0xce (code de voix 12).
    const common = (ctx: SceneContext) => snoidAssets(ctx).script(100);
    let snoid!: Snoid;
    let sound!: ReturnType<typeof engineSound>;
    const ended: number[] = [];
    const { host, engine } = await start((ctx) => {
      const base = common(ctx).images[0]!;
      const image = { cells: base.cells.map((c) => ({ ...c })), terminated: true, terminator: -0x100 | 0xce, event: 0xce };
      const script: Script = { imageCount: 2, pose: 0, images: [image, { ...image, event: 0 }], trailingWords: 0 };
      sound = engineSound(ctx);
      snoid = createSnoid(ctx, traits, {
        position: { x: 200, y: 400 },
        scripts: (id) => (id === 9001 ? script : undefined),
        onEnd: (s) => ended.push(s.scriptId),
      });
    });
    const queue = vi.spyOn(sound, "queue");
    const seen: number[] = [];
    queue.mockImplementation((id) => void seen.push(id));
    snoid.play(9001, FeatureFlag.stopAtEnd, { kind: "normal", at: { x: 260, y: 410 } });
    await runFor(engine, host, 20 * TICK);
    // Code de voix 12 (base 400) + décalage du type de voix (cheveux 4 : 15) + nez 3 − 1.
    expect(snoidVoiceIdForEvent(0xce, traits, () => 0)).toBe(417);
    expect(seen).toEqual([417]);
    // Le script d'écran finit sur le point demandé : première partie de la dernière image posée sur (260, 410).
    expect(ended).toEqual([9001]);
    expect(snoid.position).toEqual({ x: 260, y: 410 });
    const first = snoid.feature.parts[0]!;
    expect(first.x + snoidAssets(engine.ctx).sheets[3000].anchors!.x[first.w]!).toBe(260);
    expect(first.y + snoidAssets(engine.ctx).sheets[3000].anchors!.y[first.w]!).toBe(410);
  });

  it("detruit son feature", async () => {
    let snoid!: Snoid;
    const { host, engine } = await start((ctx) => {
      snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 } });
    });
    const features = engine.services.get(FEATURES);
    expect(features.features).toContain(snoid.feature);
    snoid.destroy();
    await runFor(engine, host, 50);
    expect(features.features).not.toContain(snoid.feature);
  });

  describe("animations d'attente (états 0 et 6, tâche H0)", () => {
    it("sont désactivées par défaut : tickWait ne joue rien et ne tire rien", async () => {
      let snoid!: Snoid;
      const { host, engine } = await start((ctx) => {
        snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 } });
      });
      const random = vi.spyOn(engine.ctx.rng, "range");
      for (let i = 0; i < 400; i++) {
        snoid.tickWait();
        await runFor(engine, host, TICK);
      }
      expect(snoid.waitAnimations).toBe(false);
      expect(snoid.playingWait).toBe(false);
      expect(snoid.scriptId).toBe(100);
      expect(random).not.toHaveBeenCalled();
    });

    it("en mode petit (`DS:239a`, ville / hôtel / XFER) : le compteur tourne mais aucune animation d'attente n'est tirée ni jouée", async () => {
      let snoid!: Snoid;
      const { host, engine } = await start((ctx) => {
        snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 }, waitAnimations: true, small: true });
      });
      const random = vi.spyOn(engine.ctx.rng, "range");
      for (let i = 0; i < 3000; i++) {
        expect(snoid.tickWait()).toBe(false);
        await runFor(engine, host, TICK);
      }
      expect(snoid.playingWait).toBe(false);
      expect(snoid.scriptId).toBe(100);
      expect(random).not.toHaveBeenCalled();
    });

    it("playWait joue le SCRS 130 + n une fois, met une voix de code 4 ou 5 en file, puis revient à l'attente sans rappel de l'écran", async () => {
      let snoid!: Snoid;
      const ended: number[] = [];
      const { host, engine } = await start((ctx) => {
        snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 }, waitAnimations: true, onEnd: (s) => void ended.push(s.scriptId) });
      });
      const queue = vi.spyOn(engineSound(engine.ctx), "queue");
      expect(snoid.resting).toBe(true);
      snoid.playWait(3);
      expect(snoid.scriptId).toBe(133);
      expect(snoid.playingWait).toBe(true);
      expect(snoid.resting).toBe(false);
      // Voix : code 4 (base 200) ou 5 (225) + type de voix (cheveux 4 : 15) + nez 3 − 1.
      expect(queue).toHaveBeenCalledTimes(1);
      expect([217, 242]).toContain(queue.mock.calls[0]![0]);
      // Sans effet pendant l'animation.
      snoid.playWait(5);
      expect(snoid.scriptId).toBe(133);
      await runFor(engine, host, 300 * TICK);
      expect(snoid.playingWait).toBe(false);
      expect(snoid.resting).toBe(true);
      expect(snoid.scriptId).toBe(100);
      expect(ended).toEqual([]);
    });

    it("la variante d'attente 2 joue 138 + n ; sans voix quand les effets sont coupés", async () => {
      let snoid!: Snoid;
      const { host, engine } = await start((ctx) => {
        snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 }, waitAnimations: true, idleVariant: 2 });
      });
      engine.ctx.prefs.effects = false;
      const queue = vi.spyOn(engineSound(engine.ctx), "queue");
      snoid.playWait(0);
      expect(snoid.scriptId).toBe(138);
      expect(queue).not.toHaveBeenCalled();
      await runFor(engine, host, 300 * TICK);
      expect(snoid.scriptId).toBe(102);
    });

    it("tickWait déclenche des animations d'attente de temps en temps (une fois sur dix environ toutes les ~66 échéances) et pas pendant une marche", async () => {
      let snoid!: Snoid;
      const { host, engine } = await start((ctx) => {
        snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 }, waitAnimations: true });
      });
      const played: number[] = [];
      let waiting = false;
      for (let i = 0; i < 20000 && played.length < 4; i++) {
        snoid.tickWait();
        await runFor(engine, host, TICK);
        if (snoid.playingWait && !waiting) played.push(snoid.scriptId);
        waiting = snoid.playingWait;
      }
      expect(played.length).toBeGreaterThanOrEqual(1);
      for (const id of played) expect(id).toBeGreaterThanOrEqual(130);
      for (const id of played) expect(id).toBeLessThanOrEqual(137);
      // Marche : rien ne part.
      snoid.walkTo({ x: 600, y: 400 });
      for (let i = 0; i < 100; i++) {
        expect(snoid.tickWait()).toBe(false);
        await runFor(engine, host, TICK);
        if (!snoid.walking) break;
      }
    });

    it("setPosition déplace sans relancer le script", async () => {
      let snoid!: Snoid;
      const { host, engine } = await start((ctx) => {
        snoid = createSnoid(ctx, traits, { position: { x: 300, y: 400 } });
        snoid.play(147);
      });
      await runFor(engine, host, 4 * TICK);
      const image = snoid.feature.image;
      snoid.setPosition({ x: 120, y: 200 });
      expect(snoid.position).toEqual({ x: 120, y: 200 });
      expect(snoid.scriptId).toBe(147);
      expect(snoid.feature.image).toBe(image);
    });
  });
});

function engineSound(ctx: SceneContext) {
  return ctx.services.get(ZOOMBINIS_SOUND);
}
