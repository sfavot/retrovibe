import { describe, expect, it } from "vitest";
import { crosshairFrame, HudStateBuilder, isRadarBlip } from "../../../src/games/swiv3d/ui/hud-state";
import { cameraToRender } from "../../../src/games/swiv3d/ui/view";
import { hasOriginalFiles } from "../helpers";
import { SIN, COS } from "../../../src/games/swiv3d/engine/fixed";
import { rec, scenario } from "../engine/scenario";

const OPTIONS = { missionName: "Fastoche", language: "fr", paused: false } as const;

describe("viseur et radar : formules", () => {
  it("image du viseur : clamp((D >> 6) - 11, 0, 15)", () => {
    expect([0, 700, 704, 1000, 1700, 5000].map(crosshairFrame)).toEqual([0, 0, 0, 4, 15, 15]);
    expect(crosshairFrame(768)).toBe(1);
  });

  it("un point de radar : objet vivant dans les 9 × 9 cellules de la grille autour du joueur (tore compris)", () => {
    const player = { x: 63 << 17, z: 0 };
    expect(isRadarBlip({ classe: 0x1001, x: 1 << 17, z: 4 << 17 }, player)).toBe(true); // 63 -> 1 : 2 cellules à travers la couture
    expect(isRadarBlip({ classe: 0x1001, x: 3 << 17, z: 0 }, player)).toBe(true); // 4 cellules : au bord
    expect(isRadarBlip({ classe: 0x1001, x: 4 << 17, z: 0 }, player)).toBe(false); // 5 cellules
    expect(isRadarBlip({ classe: 0x1001, x: 10 << 17, z: 0 }, player)).toBe(false);
    expect(isRadarBlip({ classe: 0, x: player.x, z: 0 }, player)).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("HudState d'après le monde", () => {
  it("jauge, score, armes et messages viennent de `world.status`", () => {
    const s = scenario("TERRAN00", () => [], { ammo: [0, 0, 5], score: 40 });
    s.world.game.message(100, 2, 0x400);
    s.run(1);
    const view = { camera: cameraToRender(s.world.camera) };
    const state = new HudStateBuilder().build(s.world, view.camera, OPTIONS);
    expect(state).toMatchObject({ energy: 496, maxEnergy: 496, score: 40, missionName: "Fastoche", language: "fr", paused: false, tick: 1 });
    expect(state.specialAmmo[2]).toBe(5);
    expect(state.messages).toEqual([{ serial: 0, textTable: 100, textId: 2, tint: 0x400, type: 0, ticksLeft: 70 }]);
    expect(state.radar.playerYaw).toBe(s.world.player.obj.yaw);
  });

  it("radar : le champ de classe `+0x04` de chaque objet proche, jamais le joueur ; objectifs avec leur groupe courant", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(2000, sx + 300, sz + 100, { model: 511, hitPoints: 10, subtype: 5009 }),
      rec(2000, sx - 200, sz + 400, { model: 514, hitPoints: 10, subtype: 5000 }),
      rec(2000, sx + 12000, sz, { model: 514, hitPoints: 10, subtype: 5000 }), // hors portée du radar
    ]);
    s.run(1);
    const state = new HudStateBuilder().build(s.world, cameraToRender(s.world.camera), OPTIONS);
    const live = [...s.world.liveObjects()];
    const near = live.filter((o) => o !== s.world.player.obj && Math.abs(o.x - s.world.player.obj.x) < 3 << 17);
    expect(state.radar.blips.length).toBeGreaterThanOrEqual(2);
    expect(state.radar.blips.length).toBeLessThan(live.length);
    for (const blip of state.radar.blips) expect(live.some((o) => o.classe === blip.kind && o.x / 256 === blip.x)).toBe(true);
    expect(near.length).toBeGreaterThan(0);
    expect(state.radar.objectives).toHaveLength(3);
    // groupe de tête = le plus grand (9) : seule sa cible est « courante »
    expect(state.radar.objectives!.filter((o) => o.current)).toHaveLength(1);
  });

  it("viseurs : le jaune suit la cible du joueur, le rouge l'objectif en tête (seulement avec une cible) ; lissage de moitié ; aucun sans cible", () => {
    const s = scenario("TERRAN00", (sx, sz, level) => {
      const yaw = level.objects.find((o) => o.type === 1000)!.angle;
      const at = (d: number, side: number) => [sx + (SIN[yaw]! * d + COS[yaw]! * side) / 256, sz + (COS[yaw]! * d - SIN[yaw]! * side) / 256] as const;
      const [tx, tz] = at(600, 0);
      const [ox, oz] = at(900, 150);
      return [
        rec(3000, tx, tz, { model: 400, childModel: 401, hitPoints: 100, subtype: 100 }),
        rec(3000, ox, oz, { model: 400, childModel: 401, hitPoints: 100, subtype: 100 }),
      ];
    });
    const builder = new HudStateBuilder();
    s.run(80);
    const player = s.world.player.obj;
    const [target, objective] = [...s.world.liveObjects()].filter((o) => o.classe & 0x1000);
    expect(target && objective).toBeTruthy();
    s.world.updateCamera(60);
    const camera = cameraToRender(s.world.camera);

    // Sans cible : pas de viseur, même avec un objectif.
    s.world.game.objectives.push({ obj: objective!, group: 0 });
    player.target = player;
    expect(builder.build(s.world, camera, OPTIONS).crosshair).toBeUndefined();

    // Cible qui n'est pas l'objectif : jaune sur la cible, rouge sur l'objectif, deux positions distinctes.
    player.target = target!;
    const first = builder.build(s.world, camera, OPTIONS).crosshair!;
    expect(first.yellow).not.toBeNull();
    expect(first.red).not.toBeNull();
    expect(first.yellow!.frame).toBeGreaterThanOrEqual(0);
    expect(first.yellow!.frame).toBeLessThanOrEqual(15);
    expect(first.red!.x).not.toBe(first.yellow!.x);

    // Cible = objectif en tête : les deux viseurs sont alignés (cible verrouillée).
    player.target = objective!;
    const locked = new HudStateBuilder().build(s.world, camera, OPTIONS).crosshair!;
    expect(locked.red).toEqual(locked.yellow);

    // Sans objectif en liste, seul le jaune reste.
    player.target = target!;
    s.world.game.objectives.length = 0;
    const alone = new HudStateBuilder().build(s.world, camera, OPTIONS).crosshair!;
    expect(alone.yellow).not.toBeNull();
    expect(alone.red).toBeNull();

    // La caméra se déplace : le viseur ne saute pas, il rejoint la nouvelle position par moitiés.
    const moved = { ...camera, yaw: camera.yaw + 10 };
    const a = builder.build(s.world, moved, OPTIONS).crosshair!.yellow!;
    const b = builder.build(s.world, moved, OPTIONS).crosshair!.yellow!;
    const c = builder.build(s.world, moved, OPTIONS).crosshair!.yellow!;
    const steps = [Math.abs(a.x - first.yellow!.x), Math.abs(b.x - a.x), Math.abs(c.x - b.x)];
    expect(steps[0]).toBeGreaterThan(steps[2]!);

    // Derrière la caméra : l'objet n'a pas de viseur, son état de lissage est perdu.
    const behind = { ...camera, yaw: camera.yaw + 256 };
    expect(builder.build(s.world, behind, OPTIONS).crosshair).toBeUndefined();
  });
});
