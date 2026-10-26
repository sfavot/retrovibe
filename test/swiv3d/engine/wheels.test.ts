import { describe, expect, it } from "vitest";
import { MAP_SIZE } from "../../../src/games/swiv3d/data/level";
import { attachTo } from "../../../src/games/swiv3d/engine/attach";
import { wheel as enemyWheel } from "../../../src/games/swiv3d/engine/enemies";
import { GameObject } from "../../../src/games/swiv3d/engine/objects";
import type { PlayerContext } from "../../../src/games/swiv3d/engine/player";
import { Terrain } from "../../../src/games/swiv3d/engine/terrain";
import { sampleGround } from "../../../src/games/swiv3d/engine/vehicle";
import {
  SKI_MODEL,
  WHEEL_MODEL,
  WHEEL_MOUNTS,
  WHEEL_WATER_MODEL,
  planetOf,
  wheelUpdate,
} from "../../../src/games/swiv3d/engine/wheels";
import type { World } from "../../../src/games/swiv3d/engine/world";
import { hasOriginalFiles } from "./helpers";
import { rec, scenario } from "./scenario";

/** Sol plat à `level · 0x400` (Q8) ; `water` : toute la carte 102 est de l'eau (type 0, vagues). */
function flatContext(level = 10, water = false): PlayerContext {
  return {
    terrain: new Terrain(new Uint8Array(MAP_SIZE * MAP_SIZE).fill(level)),
    models: new Map(),
    groundMap: water ? new Uint8Array(MAP_SIZE * MAP_SIZE) : null,
    time: () => 0,
    nodes: null as never,
    emit: () => {},
  };
}

function body(x = 1 << 22, y = 100000, z = 1 << 22): GameObject {
  const b = new GameObject(0);
  b.classe = 0x207;
  b.x = x;
  b.y = y;
  b.z = z;
  return b;
}

function wheelOf(b: GameObject, mount: number): GameObject {
  const w = new GameObject(1);
  w.classe = 0x40;
  w.owner = b;
  w.state = mount;
  w.model = WHEEL_MODEL;
  return w;
}

describe("roues du joueur : gm_wheel_update (004446a0)", () => {
  it("roue avant (mode 3) : posée à l'emplacement de la table 00484324, moyeu 1 500 plus bas, cap + braquage, rotation selon la vitesse", () => {
    const ctx = flatContext();
    const b = body();
    b.vz = 8192;
    const w = wheelOf(b, 1);
    wheelUpdate(ctx, w, 3, 24);
    const [lat, vert, fwd] = WHEEL_MOUNTS[1]!;
    expect(w.x).toBe(b.x + lat);
    expect(w.z).toBe(b.z + fwd);
    expect(w.y).toBe(b.y + vert - 1500);
    expect(w.yaw).toBe(24);
    // -(SIN[0]·vx + COS[0]·vz) >> 13 = -(256 · 8192) >> 13
    expect(w.pitch).toBe(-256);
    expect(w.vz).toBe(8192);
    expect(w.model).toBe(WHEEL_MODEL);
  });

  it("roue arrière (mode 4) : braque de la moitié dans l'autre sens ; suit tangage et roulis du véhicule", () => {
    const ctx = flatContext();
    const b = body();
    b.yaw = 0x40;
    b.pitch = 20;
    b.roll = -12;
    const w = wheelOf(b, 2);
    wheelUpdate(ctx, w, 4, 40);
    expect(w.yaw).toBe(0x40 - 20);
    expect(w.roll).toBe(-12);
    const ref = new GameObject(2);
    attachTo(b, ref, ...WHEEL_MOUNTS[2]!);
    expect(w.x).toBe(ref.x);
    expect(w.z).toBe(ref.z);
    expect(w.y).toBe(ref.y - 1500);
  });

  it("roue près du sol : relevée à sol + 2 000 avant la descente de 1 500", () => {
    const ctx = flatContext();
    const ground = 10 * 0x400;
    const b = body(1 << 22, ground + 3000);
    const w = wheelOf(b, 0);
    wheelUpdate(ctx, w, 3, 0);
    expect(w.y).toBe(ground + 2000 - 1500);
  });

  it("dans l'eau : roue posée à la surface, modèle 0x3d6, sans rotation ; l'arrière braque alors comme l'avant", () => {
    const ctx = flatContext(10, true);
    const b = body(1 << 22, 10 * 0x400 + 3000);
    b.vz = 8192;
    const w = wheelOf(b, 3);
    w.pitch = 77;
    wheelUpdate(ctx, w, 4, 40);
    const g = { height: 0, type: 0 };
    sampleGround(ctx, w.x, w.z, g);
    expect(w.y).toBe(g.height);
    expect(w.model).toBe(WHEEL_WATER_MODEL);
    expect(w.pitch).toBe(0);
    expect(w.yaw).toBe(40);
    // hors de l'eau, elle redevient une roue
    const dry = flatContext(10, false);
    b.y = 100000;
    wheelUpdate(dry, w, 4, 40);
    expect(w.model).toBe(WHEEL_MODEL);
  });

  it("motoneige : roues (mode 1) au tangage du véhicule, ski (mode 2) braqué au modèle 0x3d7 sans descente de moyeu", () => {
    const ctx = flatContext();
    const b = body();
    b.pitch = 9;
    b.vz = 8192;
    const w = wheelOf(b, 4);
    wheelUpdate(ctx, w, 1, 30);
    expect(w.pitch).toBe(9);
    expect(w.yaw).toBe(0);
    const ski = wheelOf(b, 6);
    wheelUpdate(ctx, ski, 2, 30);
    expect(ski.model).toBe(SKI_MODEL);
    expect(ski.pitch).toBe(9);
    expect(ski.yaw).toBe(30);
    const ref = new GameObject(2);
    attachTo(b, ref, ...WHEEL_MOUNTS[6]!);
    expect(ski.y).toBe(ref.y);
  });

  it("monde de la mission déduit du nom du niveau", () => {
    expect(planetOf("TERRAN02")).toBe(0);
    expect(planetOf("ARCTIC01")).toBe(1);
    expect(planetOf("LUNAR01")).toBe(2);
    expect(planetOf("MARS")).toBe(3);
  });
});

describe("roues de l'ennemi 5002 : gm_upd_wheel (004450c4)", () => {
  it("placée par gm_attach_offset dans le repère complet du corps, au cap du corps, et s'efface avec lui", () => {
    const b = body();
    b.yaw = 100;
    b.pitch = 15;
    b.roll = -7;
    b.vz = 8192;
    const w = wheelOf(b, 2);
    w.model = 984;
    enemyWheel(null as unknown as World, w);
    const ref = new GameObject(2);
    attachTo(b, ref, -6000, -4000, -4000);
    expect([w.x, w.y, w.z]).toEqual([ref.x, ref.y, ref.z]);
    expect(w.yaw).toBe(100);
    // rotation calculée avec le cap précédent de la roue (0) : -(COS[0] · vz) >> 13
    expect(w.pitch).toBe(-256);
    b.classe = 0;
    enemyWheel(null as unknown as World, w);
    expect(w.classe).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("roues du joueur dans le monde", () => {
  it("forme 1 : 4 roues 0x3d4 aux emplacements 0-3 ; forme 2 : 2 roues et un ski ; effacées au changement de forme", () => {
    const s = scenario("TERRAN02", () => [], { startForm: 1 });
    const p = s.world.player;
    expect(p.wheels.map((w) => w.state)).toEqual([0, 1, 2, 3]);
    expect(p.wheels.every((w) => w.model === WHEEL_MODEL && w.classe === 0x40)).toBe(true);
    const old = [...p.wheels];
    s.world.setPlayerForm(2);
    expect(old.every((w) => w.classe === 0)).toBe(true);
    expect(p.wheels.map((w) => w.state)).toEqual([4, 5, 6]);
    expect(p.wheels[2]!.model).toBe(SKI_MODEL);
    s.world.setPlayerForm(0);
    expect(p.wheels).toHaveLength(0);
  });

  it("buggy en marche : les roues suivent le véhicule, braquent avec lui et les roues arrière tournent plus vite (coup de poussée)", () => {
    const s = scenario("TERRAN02", () => [], { startForm: 1 });
    const p = s.world.player;
    s.run(40, { forward: true });
    s.run(20, { forward: true, turnLeft: true });
    const o = p.obj;
    for (const w of p.wheels) {
      expect(Math.hypot(w.x - o.x, w.z - o.z) / 256).toBeLessThan(40);
      expect(w.y).toBeLessThan(o.y);
    }
    expect(p.steer).toBe(-40);
    expect(p.wheels[0]!.yaw - o.yaw).toBe(-40);
    expect(p.wheels[2]!.yaw - o.yaw).toBe(20);
    // vitesse vers l'avant : les roues tournent en arrière (tangage décroissant), l'arrière reçoit en plus 2 × 13 par tick
    expect(p.wheels[0]!.pitch).toBeLessThan(0);
    expect(p.wheels[2]!.pitch - p.wheels[0]!.pitch).toBeLessThanOrEqual(-60 * 26 + 60);
  });

  it("amarrage au sol (00438694) : roues mises à jour, braquage par pas de 8 ; à la mort elles deviennent des éclats", () => {
    const s = scenario("TERRAN02", (sx, sz) => [rec(7011, sx + 300, sz, { model: 504, childModel: 990, hitPoints: 1000 })], {
      startForm: 1,
    });
    s.run(1);
    const pad = s.world.levelObjects.find((o) => o.type === 7011)!;
    const p = s.world.player;
    p.obj.x = pad.x - 40 * 256;
    p.obj.z = pad.z;
    for (let t = 0; t < 40 && !p.autopilot; t++) s.run(1);
    expect(p.autopilot).toBe(true);
    p.steerTarget = 40;
    p.steer = 0;
    s.run(1);
    expect(p.steer).toBe(8);
    for (let t = 0; t < 30; t++) s.run(1);
    const o = p.obj;
    for (const w of p.wheels) expect(Math.hypot(w.x - o.x, w.z - o.z) / 256).toBeLessThan(40);
    expect(p.wheels[0]!.yaw - o.yaw).toBe(p.steer);

    const wheels = [...p.wheels];
    o.hp = 0;
    s.run(1);
    expect(p.wheels).toHaveLength(0);
    expect(wheels.every((w) => w.update === "fx_debris" && w.model === WHEEL_MODEL)).toBe(true);
    expect(wheels.some((w) => w.vy > 0)).toBe(true);
  });
});
