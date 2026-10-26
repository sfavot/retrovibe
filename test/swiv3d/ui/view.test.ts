import { describe, expect, it } from "vitest";
import { Camera } from "../../../src/games/swiv3d/engine/camera";
import { World } from "../../../src/games/swiv3d/engine/world";
import { input } from "../../../src/games/swiv3d/engine/input";
import { createRenderAssets } from "../../../src/games/swiv3d/render/assets";
import { createRenderer } from "../../../src/games/swiv3d/render/renderer";
import { SCREEN_HEIGHT, SCREEN_WIDTH, WORLD_SIZE } from "../../../src/games/swiv3d/render/view";
import { parseBd } from "../../../src/games/swiv3d/data/bd";
import { parseGlobal } from "../../../src/games/swiv3d/data/global";
import { engineLoop, listenerOf, musicContextOf, SoundBridge, type SoundPort } from "../../../src/games/swiv3d/ui/sound-bridge";
import { bulletToSprite, cameraToRender, effectToSprite, isBullet, lookAngles, torusDelta, ViewBuilder, wrapCoordinate } from "../../../src/games/swiv3d/ui/view";
import type { GameObject } from "../../../src/games/swiv3d/engine/objects";
import type { RenderSprite } from "../../../src/games/swiv3d/render/view";
import { rec, scenario } from "../engine/scenario";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { loadLevel } from "../engine/helpers";

const camera = (over: Partial<Camera>) => Object.assign(new Camera(), over);

describe("vue : conversions d'angle et de position", () => {
  it("cap : 0 regarde vers +z, 128 vers +x, 256 vers -z, 384 vers -x", () => {
    expect(lookAngles(0, 0, 1).yaw).toBeCloseTo(0);
    expect(lookAngles(1, 0, 0).yaw).toBeCloseTo(128);
    expect(lookAngles(0, 0, -1).yaw).toBeCloseTo(256);
    expect(lookAngles(-1, 0, 0).yaw).toBeCloseTo(384);
  });

  it("élévation positive vers le bas (comme `view[4]`)", () => {
    expect(lookAngles(0, -1, 1).pitch).toBeCloseTo(64); // 45° vers le bas = 64 pas
    expect(lookAngles(0, 1, 1).pitch).toBeCloseTo(-64);
    expect(lookAngles(0, 0, 1).pitch).toBeCloseTo(0);
  });

  it("la caméra de poursuite par défaut regarde vers le bas depuis l'arrière du joueur", () => {
    // œil 508 unités derrière et 198 au-dessus du point visé, cap 128 (vers +x)
    const c = cameraToRender(camera({ eyeX: 1000, eyeY: 298, eyeZ: 2000, aimX: 1508, aimY: 100, aimZ: 2000, roll: 0.25 }));
    expect(c.yaw).toBeCloseTo(128);
    expect(c.pitch).toBeCloseTo((Math.atan2(198, 508) * 512) / (2 * Math.PI), 6);
    expect(c.pitch).toBeGreaterThan(15);
    expect(c.pitch).toBeLessThan(35);
    expect(c).toMatchObject({ x: 1000, y: 298, z: 2000, roll: 0.25 });
  });

  it("suit la couture du tore : cap correct quand le point visé est de l'autre côté", () => {
    const c = cameraToRender(camera({ eyeX: WORLD_SIZE - 100, eyeY: 200, eyeZ: 500, aimX: 400, aimY: 200, aimZ: 500 }));
    expect(c.yaw).toBeCloseTo(128); // +500 vers +x à travers la couture, pas -32268
    expect(c.pitch).toBeCloseTo(0);
  });

  it("replie l'œil dans le monde", () => {
    expect(wrapCoordinate(-10)).toBe(WORLD_SIZE - 10);
    expect(wrapCoordinate(WORLD_SIZE + 5)).toBe(5);
    expect(torusDelta(WORLD_SIZE - 30)).toBe(-30);
    expect(torusDelta(30)).toBe(30);
  });
});

describe("son : auditeur et moteur", () => {
  it("auditeur : base de la caméra, tangage compris", () => {
    const l = listenerOf({ x: 1, y: 2, z: 3, yaw: 128, pitch: 64 });
    expect(l.yaw).toBeCloseTo(Math.PI / 2);
    expect(l.forward![0]).toBeCloseTo(Math.SQRT1_2); // vers +x, incliné de 45° vers le bas
    expect(l.forward![1]).toBeCloseTo(-Math.SQRT1_2);
    expect(l.forward![2]).toBeCloseTo(0);
    expect(l.right![0]).toBeCloseTo(0);
    expect(l.right![2]).toBeCloseTo(-1);
    expect([l.x, l.y, l.z]).toEqual([1, 2, 3]);
  });

  it("boucles de moteur par forme, contexte musical par niveau", () => {
    expect(engineLoop(0)).toEqual({ sound: 5000 });
    expect(engineLoop(1)).toEqual({ sound: 5001, frequency: 11000 });
    expect(engineLoop(3)).toEqual({ sound: 5002 });
    expect(engineLoop(0x2a)).toBeNull();
    expect(musicContextOf("terran01")).toBe("level:TERRAN01");
    expect(musicContextOf("DEMO")).toBe("silent");
  });
});

describe.skipIf(!hasOriginalFiles)("vue : TERRAN00 (fichiers du jeu)", () => {
  const { level, models } = loadLevel("TERRAN00");

  it("le joueur est dans la vue, au bon endroit, avec son modèle (990)", () => {
    const world = World.load(level, models, { cameraFps: 0 });
    const view = new ViewBuilder().build(world);
    const p = world.player.obj;
    const player = view.objects.find((o) => o.modelId === 990);
    expect(player).toBeDefined();
    expect(player).toMatchObject({ x: p.x / 256, y: p.y / 256, z: p.z / 256, yaw: p.yaw });
    // tous les objets à modèle 3D sont là, aucun sprite (>= 10000) ni objet sans modèle
    const drawable = [...world.liveObjects()].filter((o) => o.model > 0 && o.model < 10000).length;
    expect(view.objects).toHaveLength(drawable);
    expect(view.objects.length).toBeGreaterThan(100);
    expect(view.time).toBe(0);
  });

  it("réutilise ses tableaux d'une image à l'autre", () => {
    const world = World.load(level, models, { cameraFps: 0 });
    const builder = new ViewBuilder();
    const first = builder.build(world);
    const objects = first.objects;
    const second = builder.build(world);
    expect(second.objects).toBe(objects);
  });

  it("la vue suit le joueur après quelques ticks et le rendu ne lève pas d'erreur", () => {
    const global = parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD"));
    const renderer = createRenderer(createRenderAssets({ level, models: [...models.values()], global }));
    const world = World.load(level, models, { cameraFps: 0 });
    const builder = new ViewBuilder();
    const fb = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
    const before = { ...builder.build(world).camera };
    for (let t = 0; t < 80; t++) {
      world.tick(input({ forward: true }));
      world.updateCamera(60);
    }
    const view = builder.build(world);
    renderer.render(view, fb);
    expect(view.time).toBe(80);
    expect(view.camera.x !== before.x || view.camera.z !== before.z).toBe(true);
    // ciel noir en haut (indice 0), pixels de terrain et d'objets en bas
    expect(fb.some((px) => px !== 0)).toBe(true);
    let drawnRows = 0;
    for (let row = 0; row < SCREEN_HEIGHT; row++) {
      for (let col = 0; col < SCREEN_WIDTH; col++) {
        if (fb[row * SCREEN_WIDTH + col] !== 0) {
          drawnRows++;
          break;
        }
      }
    }
    expect(drawnRows).toBeGreaterThan(SCREEN_HEIGHT / 3);
  });
});

describe("pont du son", () => {
  function fakePort() {
    const calls: string[] = [];
    const port: SoundPort = {
      play: (r) => (calls.push(`play ${r.sound}${r.spatial === false ? " ui" : ""}`), true),
      startLoop: (r, f) => (calls.push(`loop ${r.sound}${f ? ` @${f}` : ""}`), true),
      stopLoop: (s) => void calls.push(`stop ${s}`),
      stopAll: () => void calls.push("stopAll"),
      update: () => void calls.push("update"),
      setListener: () => void calls.push("listener"),
      setEmitterResolver: () => void calls.push("resolver"),
    };
    return { calls, port };
  }

  it.skipIf(!hasOriginalFiles)("lance le moteur et la musique au départ, relance au changement de forme, coupe à la mort", () => {
    const { level, models } = loadLevel("TERRAN00");
    const world = World.load(level, models, { cameraFps: 0 });
    const { calls, port } = fakePort();
    const contexts: string[] = [];
    const bridge = new SoundBridge(port, { setContext: (c) => void contexts.push(c) });
    bridge.attach(world, "TERRAN00");
    expect(calls).toEqual(["resolver", "loop 5000"]);
    expect(contexts).toEqual(["level:TERRAN00"]);
    calls.length = 0;
    bridge.handle([{ kind: "sound", id: 1001, x: 256, y: 512, z: 768 }, { kind: "formChanged", form: 1 }]);
    expect(calls).toEqual(["play 1001", "stop 5000", "loop 5001 @11000"]);
    calls.length = 0;
    bridge.handle([{ kind: "playerDied" }]);
    expect(calls).toEqual(["stop 5001"]);
    // Les sons des bonus (4000 / 4002), de la jauge (4001) et des explosions arrivent déjà en événements `sound` : `pickup`, `message`,
    // `objective`, `scoreChanged`, `crater` n'ont pas de son propre (catalogue) et ne doivent rien rejouer.
    calls.length = 0;
    bridge.handle([
      { kind: "pickup", n: 3 },
      { kind: "message", textTable: 100, textId: 3 },
      { kind: "objective", group: 9, groupDone: true, left: 2 },
      { kind: "scoreChanged", score: 10, delta: 10 },
      { kind: "crater", x: 0, z: 0, size: 1 },
    ]);
    expect(calls).toEqual([]);
  });
});

describe.skipIf(!hasOriginalFiles)("vue : balles et explosions en sprites", () => {
  it("chaque balle est un sprite 505 et chaque explosion un sprite 504, jamais dessinés comme modèles ni deux fois", () => {
    const s = scenario("TERRAN00", (sx, sz) => [rec(2000, sx + 40, sz + 40, { model: 511, hitPoints: 10, subtype: 5009 })]);
    const views = new ViewBuilder();
    let sawBullet = false;
    let sawEffect = false;
    for (let t = 0; t < 120; t++) {
      s.run(1, { firePrimary: true });
      const view = views.build(s.world);
      const bullets = [...s.world.liveObjects()].filter(isBullet).length;
      const effects = s.world.effects().length;
      const pooled = [...s.world.liveObjects()].filter((o) => o.model >= 11000 && o.model <= 11004).length;
      expect(effects).toBe(pooled);
      expect(view.sprites.filter((sp) => sp.setId === 505)).toHaveLength(bullets);
      expect(view.sprites.filter((sp) => sp.setId === 504)).toHaveLength(effects);
      // aucun modèle de sprite ne passe par le rendu des modèles 3D
      expect(view.objects.every((o) => o.modelId > 0 && o.modelId < 10000)).toBe(true);
      sawBullet ||= bullets > 0;
      sawEffect ||= effects > 0;
    }
    expect(sawBullet).toBe(true);
    expect(sawEffect).toBe(true);
  });

  it("série du sprite de balle = modèle - 10000 ; demi-taille de l'explosion = table W", () => {
    const sp = { setId: 504 as const, frame: 0, x: 0, y: 0, z: 0 } as RenderSprite;
    bulletToSprite({ model: 10003, x: 256, y: 512, z: 768 } as GameObject, sp);
    expect(sp).toMatchObject({ setId: 505, frame: 3, x: 1, y: 2, z: 3 });
    effectToSprite({ kind: "explosion", set: 504, frame: 20, x: 512, y: 0, z: 0, size: 3 }, sp);
    expect(sp).toMatchObject({ setId: 504, frame: 20, x: 2, size: 40 });
    effectToSprite({ kind: "impact", set: 504, frame: 40, x: 0, y: 0, z: 0, size: 0 }, sp);
    expect(sp.size).toBe(15);
    expect(isBullet({ classe: 1, model: 10006 })).toBe(false);
    expect(isBullet({ classe: 1, model: 11002 })).toBe(false);
  });
});
