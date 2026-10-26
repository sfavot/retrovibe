/** Véhicules au sol du joueur (formes 1, 2, 4, 5) : pilotes et physique portés de `0043a174`…`00445f44` (`vehicle.ts`). */
import { describe, expect, it } from "vitest";
import { emptyInput, input } from "../../../src/games/swiv3d/engine/input";
import { SIN } from "../../../src/games/swiv3d/engine/fixed";
import { World } from "../../../src/games/swiv3d/engine/world";
import { sampleGround } from "../../../src/games/swiv3d/engine/vehicle";
import { Terrain } from "../../../src/games/swiv3d/engine/terrain";
import type { PlayerContext } from "../../../src/games/swiv3d/engine/player";
import { hasOriginalFiles, loadLevel } from "./helpers";

/** Niveau plat (relief 100, sol normal 200), départ du joueur seul, éventuellement avec une rampe vers +x ou une carte 102 donnée. */
function arena(opts: { ground?: number; ramp?: boolean; start?: [number, number, number] } = {}): World {
  const { level, models } = loadLevel("TERRAN03");
  const heightmap = new Uint8Array(level.heightmap.length).fill(100);
  if (opts.ramp)
    for (let z = 0; z < 512; z++) for (let x = 0; x < 512; x++) heightmap[z * 512 + x] = Math.min(255, Math.max(0, 60 + (x - 100) * 2));
  const [sx, sz, angle] = opts.start ?? [256 * 64, 256 * 64, 0];
  const objects = level.objects
    .filter((o) => o.type >= 1000 && o.type <= 1002)
    .map((o) => ({ ...o, x: sx, z: sz, angle }));
  return World.load(
    { ...level, heightmap, groundMap: new Uint8Array(level.groundMap.length).fill(opts.ground ?? 200), objects },
    models,
  );
}

function run(w: World, ticks: number, inp = emptyInput()): void {
  for (let t = 0; t < ticks; t++) w.tick(inp);
}

describe.skipIf(!hasOriginalFiles)("véhicule au sol : physique", () => {
  it("atteint ≈ 3 650 Q8/tick (14,3 u/tick) sur sol plat et s'arrête par frottement 15/16", () => {
    const w = arena();
    w.setPlayerForm(1);
    run(w, 200, input({ forward: true }));
    expect(w.player.speed).toBeGreaterThan(3600);
    expect(w.player.speed).toBeLessThan(3700);
    expect(w.player.pitch).toBe(0);
    expect(w.player.roll).toBe(0);
    run(w, 100);
    expect(w.player.speed).toBeLessThan(100);
  });

  it("une touche tenue vaut deux pas de poussée (clavier : 2 × 0x82) ; avec frein, un seul", () => {
    const w = arena();
    w.setPlayerForm(1);
    w.tick(input({ forward: true }));
    expect(w.player.thrust).toBe(0x104);
    const b = arena();
    b.setPlayerForm(1);
    b.tick(input({ forward: true, brake: true }));
    expect(b.player.thrust).toBe(0x82);
    expect(b.player.obj.state).toBe(1);
    // la forme 4 pousse de 0xd2 par pas
    const f = arena();
    f.setPlayerForm(4);
    f.tick(input({ forward: true }));
    expect(f.player.thrust).toBe(0x1a4);
  });

  it("le frein ne dure qu'un tick, annule la poussée et freine à 14/16 au lieu de 15/16", () => {
    const speedAfter = (brake: boolean) => {
      const w = arena();
      w.setPlayerForm(1);
      run(w, 100, input({ forward: true }));
      w.tick(input({ brake }));
      expect(w.player.obj.state).toBe(brake ? 1 : 0);
      w.tick(emptyInput());
      expect(w.player.obj.state).toBe(0); // consommé par la physique, effacé par le pilote suivant
      return w.player;
    };
    const braked = speedAfter(true);
    const free = speedAfter(false);
    expect(braked.thrust).toBe(0);
    expect(free.thrust).toBeGreaterThan(0);
    expect(braked.speed).toBeLessThan(free.speed);
  });

  it("plafonne la poussée à 500 avant le frottement 15/16 (468 utilisés)", () => {
    const w = arena();
    w.setPlayerForm(1);
    run(w, 50, input({ forward: true }));
    run(w, 1);
    expect(w.player.thrust).toBeLessThanOrEqual(500 * (15 / 16) + 1);
    w.player.thrust = 9000;
    w.tick(emptyInput());
    expect(w.player.thrust).toBe((500 * 15) >> 4);
  });

  it("vire de 4 pas par tick, braque les roues de 4 en 4 vers ±40 et les redresse", () => {
    const w = arena();
    w.setPlayerForm(1);
    run(w, 100); // se pose
    const yaw0 = w.player.obj.yaw;
    run(w, 5, input({ turnRight: true }));
    expect(w.player.obj.yaw - yaw0).toBe(20);
    expect(w.player.steerTarget).toBe(40);
    expect(w.player.steer).toBe(20);
    run(w, 10, input({ turnRight: true }));
    expect(w.player.steer).toBe(40);
    run(w, 4, input({ turnLeft: true }));
    expect(w.player.steerTarget).toBe(-40);
    expect(w.player.steer).toBe(24);
  });

  it("inverse le braquage visuel en marche arrière (vitesse avant < -7000)", () => {
    const w = arena({ start: [256 * 64, 256 * 64, 0] });
    w.setPlayerForm(1);
    w.player.obj.vz = -9000; // cap 0 : l'avant est +z
    w.tick(input({ turnRight: true }));
    expect(w.player.steerTarget).toBe(-40);
  });

  it("se redresse sur un sol plat (tangage et roulis rappelés par les contacts)", () => {
    const w = arena();
    w.setPlayerForm(1);
    run(w, 60);
    w.player.obj.roll = 30;
    w.player.obj.pitch = -20;
    w.player.obj.y += 3000;
    run(w, 40);
    expect(w.player.obj.roll).toBe(0);
    expect(w.player.obj.pitch).toBe(0);
    expect(w.player.obj.vy).toBe(0);
  });

  it("monte une rampe en cabrant de ≈ 10 pas et va moins vite qu'à plat", () => {
    const w = arena({ ramp: true, start: [110 * 64, 100 * 64, 128] }); // cap 128 : vers +x
    w.setPlayerForm(1);
    run(w, 150, input({ forward: true }));
    expect(w.player.pitch).toBeGreaterThan(5);
    expect(w.player.pitch).toBeLessThan(15);
    expect(w.player.speed).toBeGreaterThan(2500);
    expect(w.player.speed).toBeLessThan(3300);
  });

  it("en l'air : gravité 150 (120 pour les formes 4 et 5), cabrage jusqu'à 90 (formes 1, 2), retour à plat (4, 5)", () => {
    const air = (form: number) => {
      const w = arena();
      w.setPlayerForm(form);
      w.player.obj.y += 400 * 256;
      w.player.obj.pitch = 30;
      w.player.obj.roll = -6;
      w.tick(emptyInput());
      return w.player.obj;
    };
    expect(air(1).vy).toBe(-150);
    expect(air(1).pitch).toBe(32);
    expect(air(4).vy).toBe(-120);
    expect(air(4).pitch).toBe(28);
    expect(air(4).roll).toBe(-5);
    expect(air(5).vy).toBe(-120);
  });

  it("forme 4 : frottement 61/64 au sol, donc plus rapide que la forme 1 à poussée égale", () => {
    const top = (form: number) => {
      const w = arena();
      w.setPlayerForm(form);
      run(w, 250, input({ forward: true }));
      return w.player.speed;
    };
    expect(top(4)).toBeGreaterThan(top(1) * 1.3);
    expect(top(5)).toBeLessThan(top(1)); // poussée >> 12 : deux fois moins forte
  });

  it("est déterministe", () => {
    const hash = () => {
      const w = arena({ ramp: true, start: [110 * 64, 100 * 64, 128] });
      w.setPlayerForm(2);
      for (let t = 0; t < 300; t++) w.tick(input({ forward: true, turnRight: t % 90 > 60 }));
      return w.stateHash();
    };
    expect(hash()).toBe(hash());
  });
});

describe.skipIf(!hasOriginalFiles)("véhicule au sol : eau (carte 102 < 4)", () => {
  const dive = (form: number) => {
    const w = arena({ ground: 0 });
    w.setPlayerForm(form);
    run(w, 100);
    const hp = w.player.hp;
    run(w, 10);
    return { w, lost: hp - w.player.hp };
  };

  it("coûte 1 pv par tick aux formes 1 et 2, 2 à la forme 4, rien à la forme 5", () => {
    expect(dive(1).lost).toBe(10);
    expect(dive(2).lost).toBe(10);
    expect(dive(4).lost).toBe(20);
    expect(dive(5).lost).toBe(0);
  });

  it("la forme 5 prend le modèle 982 sur l'eau et 980 sur terre", () => {
    expect(dive(5).w.player.obj.model).toBe(982);
    const w = arena();
    w.setPlayerForm(5);
    run(w, 100);
    expect(w.player.obj.model).toBe(980);
  });

  it("enfonce la forme 1 de ≈ 8 unités (2 000 Q8) par rapport au sol sec", () => {
    const sec = arena();
    sec.setPlayerForm(1);
    run(sec, 100);
    const eau = dive(1).w;
    const gap = (w: World) => (w.player.y - w.terrain.height(w.player.x, w.player.z)) / 256;
    // l'eau ajoute en plus une vague de 0 à 16 unités : on compare à la moyenne sur la période
    expect(gap(sec)).toBeCloseTo(12, 0);
    expect(gap(eau)).toBeLessThan(gap(sec) + 16);
  });

  it("n'applique aucun dégât avec `water: false`", () => {
    const { level, models } = loadLevel("TERRAN03");
    const w = World.load(
      { ...level, groundMap: new Uint8Array(level.groundMap.length), objects: level.objects.filter((o) => o.type >= 1000 && o.type <= 1002) },
      models,
      { water: false },
    );
    w.setPlayerForm(1);
    run(w, 100);
    expect(w.player.hp).toBe(496);
    expect(w.player.groundTypeUnder).toBe(0xff);
  });
});

describe("sampleGround (gm_terrain_height_water)", () => {
  const heightmap = new Uint8Array(512 * 512).fill(100);
  const groundMap = new Uint8Array(512 * 512).fill(200);
  groundMap[5 * 512 + 7] = 0; // case d'eau (cx 7, cz 5)
  const ctx = (time: number, map: Uint8Array | null): PlayerContext =>
    ({ terrain: new Terrain(heightmap), groundMap: map, time: () => time }) as unknown as PlayerContext;
  const out = { height: 0, type: 0 };

  it("sans carte 102 : hauteur ordinaire et sol 0xff", () => {
    sampleGround(ctx(3, null), 7 * 16384, 5 * 16384, out);
    expect(out).toEqual({ height: 100 * 0x400, type: 0xff });
  });

  it("avec la carte : type de la case, coin d'eau relevé de la vague WAVE[(cz·4 + temps + SIN[(cx & 31)·16]) & 31] · 256", () => {
    const wave = (i: number) => Math.round(16 * Math.sin((Math.PI * i) / 32));
    for (const time of [0, 5, 31]) {
      sampleGround(ctx(time, groundMap), 7 * 16384, 5 * 16384, out);
      expect(out.type).toBe(0);
      expect(out.height).toBe(100 * 0x400 + wave((5 * 4 + time + SIN[(7 & 31) * 16]!) & 31) * 256);
    }
    // case voisine non aquatique : pas de vague, mais l'interpolation touche le coin d'eau à 255/256
    sampleGround(ctx(0, groundMap), 6 * 16384 + 16383, 5 * 16384, out);
    expect(out.type).toBe(200);
    expect(out.height).toBeGreaterThan(100 * 0x400);
  });
});
