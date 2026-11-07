import { describe, expect, it, vi } from "vitest";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag } from "../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { installServices } from "../../src/games/zoombinis/engine/services";
import {
  createHiddenAsteroidsScene,
  DIRECTIONS,
  rockPoints,
  scoreboardDigits as asteroidDigits,
  splitKind,
  wrap,
} from "../../src/games/zoombinis/scenes/hidden-asteroids";
import {
  createHiddenShootingScene,
  scoreboardDigits as shootingDigits,
  streakBonus,
  walkerRoute,
  walkerSlots,
} from "../../src/games/zoombinis/scenes/hidden-shooting";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

describe("écran caché 19 : règles du tir aux Zoombinis", () => {
  it("coups rendus par une série (1110:2616) et places de passants selon le score (1110:23ac)", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 30].map(streakBonus)).toEqual([0, 5, 5, 10, 10, 15, 15, 20, 20]);
    expect([0, 9, 10, 14, 15, 19, 20, 39, 40, 59, 60, 79, 80, 81, 99].map(walkerSlots)).toEqual([1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 2, 2, 3, 1, 1]);
  });

  it("trajet d'un passant (1110:28ed) : loin du pointeur, sens tiré à pile ou face", () => {
    const draws = (values: number[]) => {
      const calls: [number, number][] = [];
      const range = (lo: number, hi: number) => {
        calls.push([lo, hi]);
        return values.shift() ?? lo;
      };
      return { range, calls };
    };
    // Pointeur en haut (y ≤ 240) : trajets 1 à 3 ; le trajet 2 longe le bas, de −20 à 660.
    let d = draws([2, 400, 80]);
    expect(walkerRoute(240, d.range)).toEqual({ from: { x: -20, y: 400 }, to: { x: 0x294, y: 400 } });
    expect(d.calls).toEqual([
      [1, 3],
      [0x17c, 0x1c2],
      [1, 100],
    ]);
    // Pointeur en bas : trajets 4 à 6 ; pile (≤ 50) : le sens s'inverse.
    d = draws([6, 170, 50]);
    expect(walkerRoute(241, d.range)).toEqual({ from: { x: 0xfa, y: 170 }, to: { x: -20, y: 170 } });
    expect(d.calls[0]).toEqual([4, 6]);
  });

  it("tableau (1110:2b23) : deux chiffres pour le meilleur score, le score et les coups", () => {
    expect(shootingDigits(42, 7, 15)).toEqual([4, 2, 0, 7, 1, 5]);
  });
});

describe("écran caché 20 : règles des astéroïdes", () => {
  it("points (1110:3936) et morceaux (1110:317c) selon le script du rocher", () => {
    expect([1000, 1004, 1005, 1009, 1016, 1020, 1021, 1030].map(rockPoints)).toEqual([5, 5, 10, 10, 1, 1, 15, 15]);
    expect([1016, 1020, 1000, 1004, 1005, 1009, 1021, 1026].map(splitKind)).toEqual(["medium", "medium", "small", "small", null, null, null, null]);
  });

  it("le monde boucle de −10 à 650 et de −10 à 490 ; huit directions dans le sens des aiguilles d'une montre", () => {
    expect([wrap(651, 650), wrap(650, 650), wrap(-10, 650), wrap(-11, 650)]).toEqual([-10, 650, -10, 650]);
    expect(DIRECTIONS[0]).toEqual([0, -1]);
    expect(DIRECTIONS[2]).toEqual([1, 0]);
    expect(DIRECTIONS[6]).toEqual([-1, 0]);
  });

  it("tableau (1110:3e95) : trois chiffres pour le meilleur score et le score, un pour les vies", () => {
    expect(asteroidDigits(905, 37, 3)).toEqual([9, 0, 5, 0, 3, 7, 3]);
  });
});

describe.skipIf(!original.has)("écrans cachés 19 et 20 (PICKER.MHK)", () => {
  async function start(screen: number) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 5 });
    const services = await installServices(engine);
    const entered: number[] = [];
    engine.register(ScreenId.hiddenShooting, createHiddenShootingScene);
    engine.register(ScreenId.hiddenAsteroids, createHiddenAsteroidsScene);
    engine.register(ScreenId.map, () => ({ enter: () => void entered.push(ScreenId.map), leave() {}, tick() {} }));
    const queue = vi.spyOn(services.sound, "queue");
    services.game.session.training = 1;
    services.game.session.screen = ScreenId.map;
    engine.start(screen as ScreenId);
    await runFor(engine, host, 800);
    expect(engine.error).toBeNull();
    const features = engine.services.get(FEATURES);
    const byScript = (id: number) => features.features.filter((f) => f.scriptId === id);
    return { host, engine, services, entered, queue, features, byScript, game: services.game };
  }

  it("19 : fond 1001, viseur à la souris, pointeur masqué, musique 30025, tableau à 00 00 09", async () => {
    const { host, engine, queue, byScript } = await start(ScreenId.hiddenShooting);
    expect(host.cursor).toBe("hidden");
    expect(queue).toHaveBeenCalledWith(30025);
    expect(byScript(1203)[0]!.parts.map((p) => p.w)).toEqual([11, 11, 11, 11, 11, 20]);
    host.input.moveMouse(200, 150);
    await runFor(engine, host, 50);
    const crosshair = byScript(1105)[0]!;
    expect(crosshair.parts[0]).toMatchObject({ w: 6, x: 186, y: 137 });
  });

  it("19 : un tir manqué coûte un coup ; plus de coups : fin de partie, pointeur rendu ; un clic sur le viseur arrêté relance", async () => {
    const { host, engine, byScript, game } = await start(ScreenId.hiddenShooting);
    // Un point des zones de premier plan : jamais touché.
    const at = [600, 150] as const;
    host.input.moveMouse(...at);
    for (let shot = 0; shot < 9; shot++) {
      host.click(...at);
      await runFor(engine, host, 300);
    }
    expect(byScript(1203)[0]!.parts.map((p) => p.w)).toEqual([11, 11, 11, 11, 11, 11]);
    expect(byScript(1204)).toHaveLength(1);
    expect(host.cursor).toBe("system");
    expect(game.game.shootingHighScore).toBe(0);
    host.click(...at);
    await runFor(engine, host, 100);
    expect(byScript(1204)).toHaveLength(0);
    expect(byScript(1203)[0]!.parts.map((p) => p.w)).toEqual([11, 11, 11, 11, 11, 20]);
    expect(host.cursor).toBe("hidden");
  });

  it("19 : un Zoombini visé au centre est touché, disparaît, et le score et le meilleur score (S+0x22) montent", async () => {
    const { host, engine, features, byScript, game } = await start(ScreenId.hiddenShooting);
    const shields = [
      [529, 125, 639, 197],
      [227, 155, 356, 205],
      [415, 425, 639, 479],
    ];
    let hit = false;
    for (let tries = 0; tries < 200 && !hit; tries++) {
      await runFor(engine, host, 50);
      const walker = features.features.find((f) => f.hasFlag(FeatureFlag.snoid) && f.rect && f.rect.left > 0 && f.rect.right < 640);
      if (!walker) continue;
      const r = walker.rect!;
      const x = Math.trunc((r.left + r.right) / 2);
      const y = Math.trunc((r.top + r.bottom) / 2);
      if (shields.some(([l, t, rr, b]) => x >= l! && x < rr! && y >= t! && y < b!)) continue;
      host.input.moveMouse(x, y);
      host.click(x, y);
      await runFor(engine, host, 300);
      hit = !features.features.includes(walker);
    }
    expect(hit).toBe(true);
    expect(game.game.shootingHighScore).toBe(1);
    expect(byScript(1203)[0]!.parts.map((p) => p.w)).toEqual([11, 12, 11, 12, 11, 19]);
  });

  it("19 : un clic dans le carré en haut à gauche ramène à la carte après le fondu", async () => {
    const { host, engine, entered } = await start(ScreenId.hiddenShooting);
    host.click(20, 20);
    await runFor(engine, host, 1000);
    expect(entered).toEqual([ScreenId.map]);
  });

  it("20 : vaisseau au centre, rotation (4, 6), tir (5, son 3002, trois au plus), musique 30035", async () => {
    const { host, engine, queue, byScript } = await start(ScreenId.hiddenAsteroids);
    expect(queue).toHaveBeenCalledWith(30035);
    const ship = byScript(1010)[0]!;
    expect(ship.parts[0]!.w).toBe(17);
    host.press("Digit6", { key: "6" });
    host.press("Digit6", { key: "6" });
    await runFor(engine, host, 100);
    expect(ship.parts[0]!.w).toBe(19);
    host.press("Digit4", { key: "4" });
    await runFor(engine, host, 100);
    expect(ship.parts[0]!.w).toBe(18);
    queue.mockClear();
    for (let i = 0; i < 5; i++) host.press("Digit5", { key: "5" });
    await runFor(engine, host, 50);
    expect(byScript(1011)).toHaveLength(3);
    expect(queue.mock.calls.filter(([id]) => id === 3002)).toHaveLength(3);
    // Un tir vit 12 pas de 3 ticks puis s'éteint en deux images.
    await runFor(engine, host, 17 * 3 * 17);
    expect(byScript(1011)).toHaveLength(0);
  });

  it("20 : des rochers (gros Zoombinis, SCRB 1016 à 1020) arrivent par les bords ; le tableau montre 000 000 3", async () => {
    const { byScript, features } = await start(ScreenId.hiddenAsteroids);
    const rocks = features.features.filter((f) => f.scriptId >= 1016 && f.scriptId <= 1020);
    expect(rocks.length === 1 || rocks.length === 2).toBe(true);
    expect(byScript(1014)[0]!.parts.map((p) => p.w)).toEqual([29, 29, 29, 29, 29, 29, 32]);
  });

  it("20 : un clic gauche n'importe où ramène à la carte", async () => {
    const { host, engine, entered } = await start(ScreenId.hiddenAsteroids);
    host.click(300, 300);
    await runFor(engine, host, 1000);
    expect(entered).toEqual([ScreenId.map]);
  });
});
