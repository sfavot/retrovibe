import { describe, expect, it } from "vitest";
import { isDockLocked } from "../../../src/games/swiv3d/engine/pads";
import { hasOriginalFiles } from "./helpers";
import { rec, scenario, type Scenario } from "./scenario";

function padOf(s: Scenario, type: number) {
  return s.world.levelObjects.find((o) => o.type === type)!;
}

/** Pose le joueur à `dx` unités (Q8) de la plate-forme. */
function moveNear(s: Scenario, pad: { x: number; z: number }, dx: number): void {
  const p = s.world.player.obj;
  p.x = pad.x + dx * 256;
  p.z = pad.z;
}

describe.skipIf(!hasOriginalFiles)("plates-formes de transformation", () => {
  it("7010 : l'hélicoptère est capté, glisse vers la plate-forme, descend, devient un véhicule puis est poussé dehors", () => {
    const s = scenario("TERRAN02", (sx, sz) => [rec(7010, sx + 30, sz, { model: 504, hitPoints: 1000 })]);
    const pad = padOf(s, 7010);
    let captured = -1;
    let docked = -1;
    let formChanged = -1;
    for (let t = 0; t < 400; t++) {
      s.run(1);
      if (captured < 0 && pad.state === 1) captured = t;
      if (docked < 0 && pad.state === 2) docked = t;
      if (formChanged < 0 && s.world.player.form === 1) formChanged = t;
    }
    expect(captured).toBeGreaterThanOrEqual(0);
    expect(captured).toBeLessThan(33); // le joueur est cherché tous les 32 ticks
    // 35 ticks de glissement (le compteur de 70 baisse de 2 par tick), puis la descente de 550/256 unité par tick
    expect(docked - captured).toBeGreaterThan(40);
    expect(docked - captured).toBeLessThan(120);
    expect(formChanged).toBeGreaterThan(docked - 1);
    expect(s.world.player.form).toBe(1);
    // poussé le long du cap de la plate-forme pendant 40 ticks puis libre ; la plate-forme attend 200 ticks
    expect(isDockLocked(s.world)).toBe(false);
    expect(s.world.player.autopilot).toBe(false);
    expect(s.world.player.obj.classe & 0x21c).toBe(0x204);
    expect(pad.state).toBe(5);
  });

  it("l'hélicoptère amarré garde le cap vers la plate-forme et arrive à 37 unités au-dessus d'elle", () => {
    const s = scenario("TERRAN02", (sx, sz) => [rec(7010, sx + 30, sz, { model: 504, hitPoints: 1000 })]);
    const pad = padOf(s, 7010);
    for (let t = 0; t < 400 && pad.state < 2; t++) s.run(1);
    const p = s.world.player.obj;
    expect(Math.abs(p.y - pad.y - 0x251c)).toBeLessThan(0x226 + 1);
    expect(Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz)).toBe(0);
  });

  it("7011 naît à l'état 5 : elle rend l'hélicoptère à un véhicule qui la rejoint, au repère de l'appareil posé", () => {
    const s = scenario("TERRAN02", (sx, sz) => [rec(7011, sx + 300, sz, { model: 504, childModel: 990, hitPoints: 1000 })], {
      startForm: 1,
    });
    const pad = padOf(s, 7011);
    s.run(1);
    expect(pad.state).toBe(5);
    moveNear(s, pad, -40);
    const seen: number[] = [];
    let helper = null as null | { x: number; y: number; z: number; yaw: number };
    for (const o of s.world.liveObjects()) if (o.update === "upd_0044822c") helper = { x: o.x, y: o.y, z: o.z, yaw: o.yaw };
    // l'hélicoptère posé est à 39 unités au-dessus, 32 unités derrière le nouveau cap (cap + 64) : décalage appliqué au 1er tick
    expect(helper).not.toBeNull();
    expect(Math.round((helper!.y - pad.y) / 256)).toBe(39);
    expect(Math.round(Math.hypot(helper!.x - pad.x, helper!.z - pad.z) / 256)).toBe(32);
    expect((helper!.yaw - pad.yaw) & 0x1ff).toBe(0x40);
    for (let t = 0; t < 1200 && s.world.player.form !== 0; t++) {
      s.run(1);
      if (seen[seen.length - 1] !== pad.state) seen.push(pad.state);
    }
    expect(s.world.player.form).toBe(0);
    // 5 (attend) → 6 (amarrage au sol) → 7 (arrivé, repris dans le même tick par l'hélicoptère posé) → 8 → 9 pendant 200 ticks
    expect(seen.slice(0, 3)).toEqual([6, 8, 9]);
    expect(isDockLocked(s.world)).toBe(false);
    expect(s.world.player.autopilot).toBe(false);
    expect(s.world.player.obj.classe & 0x21c).toBe(0x214);
    // le joueur est à la position de l'hélicoptère posé
    expect(Math.round(Math.hypot(s.world.player.obj.x - helper!.x, s.world.player.obj.z - helper!.z) / 256)).toBeLessThan(40);
  });

  it("amarré, le joueur n'a plus de pilote : il ne tire plus et son arme chargée est retirée (+0x180)", () => {
    const ammo = new Array<number>(20).fill(0);
    ammo[0] = 3;
    const s = scenario("TERRAN02", (sx, sz) => [rec(7010, sx + 300, sz, { model: 504, hitPoints: 1000 })], { ammo });
    s.run(1, { weaponDirect: 1 });
    for (let t = 0; t < 60 && s.world.game.weaponState !== 10; t++) s.run(1);
    expect(s.world.game.weaponState).toBe(10);
    const pad = padOf(s, 7010);
    moveNear(s, pad, -30);
    for (let t = 0; t < 40 && pad.state !== 1; t++) s.run(1);
    expect(isDockLocked(s.world)).toBe(true);
    s.run(1, { fireSpecial: true, firePrimary: true });
    expect(s.world.game.ammo[0]).toBe(3);
    expect(s.world.game.weaponState).not.toBe(0x0b);
    expect([0x14, 0x16, 0x1e]).toContain(s.world.game.weaponState);
  });
});
