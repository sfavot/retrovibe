import { describe, expect, it } from "vitest";
import { COS, SIN } from "../../../src/games/swiv3d/engine/fixed";
import { FLAG, type GameObject } from "../../../src/games/swiv3d/engine/objects";
import { PICKUP_BUDDY_LOCK, applyPickup } from "../../../src/games/swiv3d/engine/pickups";
import { hasOriginalFiles } from "./helpers";
import { rec, scenario, type Scenario } from "./scenario";

function live(s: Scenario, update: string): GameObject[] {
  return [...s.world.liveObjects()].filter((o) => o.update === update);
}

function ammo(n: number, count: number): number[] {
  const a = new Array<number>(20).fill(0);
  a[n] = count;
  return a;
}

/** Abat une cible statique (gelée tant qu'intacte : le dégel imite le choc d'un tir). */
function kill(o: GameObject): void {
  o.flags &= ~FLAG.FROZEN;
  o.hp = 0;
}

/**
 * TERRAN00 réduit à une cible d'objectif du groupe 0 (seule inscrite : la détruire est la victoire), placée derrière le départ.
 * `settle` ticks sans entrée, puis la cible est abattue et le monde avance jusqu'au tick `0x19` de la séquence de victoire inclus.
 */
function victory(startForm: number, settle = 40, opts: { ammo?: number[] } = {}): Scenario {
  const s = scenario(
    "TERRAN00",
    (sx, sz) => [rec(2000, sx - 600, sz - 600, { model: 514, hitPoints: 10, subtype: 5000 })],
    { startForm, ...opts },
  );
  s.run(settle);
  kill(live(s, "static").find((o) => o.subtype === 5000)!);
  for (let t = 0; t < 40 && s.world.game.endCounter !== 0x19; t++) s.run(1);
  expect(s.world.game.endState).toBe("victory");
  expect(s.world.game.endCounter).toBe(0x19);
  return s;
}

describe.skipIf(!hasOriginalFiles)("fin de niveau : pilotes gm_pilot_victory_*", () => {
  it("tick 25 : formes 0 à 3, pilote de fin, âge 0, classe 0x40 ; +0x184 = 0", () => {
    const s = victory(0);
    const p = s.world.player;
    expect(p.victory).toBe(true);
    expect(p.obj.classe).toBe(0x40);
    expect(p.obj.age).toBe(0);
    expect(s.world.game.alive).toBe(false);
  });

  it("hélicoptère (00438d08) : file droit devant au même cap, sans commandes ni tir", () => {
    const s = victory(0);
    const p = s.world.player;
    const yaw = p.obj.yaw;
    const x0 = p.x;
    const z0 = p.z;
    const counter = s.world.game.fireCounter;
    s.run(29, { turnLeft: true, strafeRight: true, firePrimary: true });
    expect(p.obj.yaw).toBe(yaw);
    // intention « avancer » 0x4b0 par tick, amortie de 14/16 : le tangage tend vers -38 (après le pilote)
    expect(p.obj.pitch).toBeGreaterThanOrEqual(-38);
    expect(p.obj.pitch).toBeLessThan(-35);
    // déplacement vers l'avant en unités (SIN/COS sur 256) : ~160 en 29 ticks, là où l'appareil sans commande ferait du sur-place
    const fwd = ((p.x - x0) * SIN[yaw & 0x1ff]! + (p.z - z0) * COS[yaw & 0x1ff]!) / 0x10000;
    expect(fwd).toBeGreaterThan(100);
    expect(s.world.game.fireCounter).toBe(counter);
    // la sortie du niveau arrive toujours au tick 55
    expect(s.world.game.endCounter).toBe(0x19 + 29);
    s.run(1);
    expect(s.world.status.levelComplete).toBe(true);
  });

  it("la mise à jour des armes continue : un missile armé reste accroché à l'hélicoptère qui file", () => {
    const s = scenario(
      "TERRAN00",
      (sx, sz) => [rec(2000, sx - 600, sz - 600, { model: 514, hitPoints: 10, subtype: 5000 })],
      { ammo: ammo(0, 3) },
    );
    s.run(1, { weaponDirect: 1 });
    s.run(40);
    expect(s.world.game.weaponState).toBe(10);
    kill(live(s, "static").find((o) => o.subtype === 5000)!);
    s.run(60);
    const p = s.world.player.obj;
    const pod = live(s, "missile_attached")[0]!;
    expect(Math.hypot(pod.x - p.x, pod.z - p.z) / 256).toBeLessThan(40);
  });

  it("buggy (00438ec8) : cap −4 par tick, poussée, roues arrière lancées de −13 par tick de plus que l'avant", () => {
    const s = victory(1, 80);
    const p = s.world.player;
    expect(p.victory).toBe(true);
    const yaw = p.obj.yaw;
    const front = p.wheels[0]!.pitch;
    const rear = p.wheels[2]!.pitch;
    const x0 = p.x;
    const z0 = p.z;
    s.run(5, { turnRight: true, forward: true });
    expect(p.obj.yaw).toBe(yaw - 20);
    expect(p.wheels[2]!.pitch - rear - (p.wheels[0]!.pitch - front)).toBe(-65);
    s.run(20);
    expect(Math.hypot(p.x - x0, p.z - z0)).toBeGreaterThan(256 * 20);
  });

  it("motoneige (00438fb8) : cap −4 par tick, roues en modes 1, 1, 2", () => {
    const s = victory(2, 80);
    const p = s.world.player;
    const yaw = p.obj.yaw;
    s.run(3, { turnRight: true });
    expect(p.obj.yaw).toBe(yaw - 12);
    // mode 1 : la roue prend le tangage du corps ; mode 2 : le ski aussi (le coup de −13 est écrasé)
    const ski = p.wheels[2]!;
    expect(ski.pitch).toBe(p.obj.pitch);
  });

  it("formes 4 et 5 : pas de pilote de fin, les commandes restent actives (seul +0x184 tombe)", () => {
    const s = victory(4, 60);
    const p = s.world.player;
    expect(p.victory).toBe(false);
    expect(p.obj.classe).not.toBe(0x40);
    expect(s.world.game.alive).toBe(false);
    const yaw = p.obj.yaw;
    s.run(3, { turnLeft: true });
    expect(p.obj.yaw).toBe(yaw - 12);
  });
});

describe.skipIf(!hasOriginalFiles)("mort du joueur (gm_player_die)", () => {
  it("les compagnons sont détachés mais vivent, les lanceurs partent en éclats, le joueur reste immobile", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(0, 3) });
    s.run(1, { weaponDirect: 1 });
    s.run(40);
    applyPickup(s.world, PICKUP_BUDDY_LOCK);
    const buddy = s.world.game.buddies.find((b) => b !== null)!;
    expect(buddy).toBeTruthy();
    const pod = live(s, "missile_attached")[0]!;
    s.world.player.obj.hp = 0;
    s.run(1);
    expect(s.world.player.dead).toBe(true);
    expect(s.world.game.buddies.every((b) => b === null)).toBe(true);
    expect(pod.update).toBe("fx_debris");
    expect(Math.abs(pod.vx) + Math.abs(pod.vy) + Math.abs(pod.vz)).toBeGreaterThan(0);
    expect(pod.vy).toBeGreaterThanOrEqual(0);
    s.world.player.obj.vx = 5000;
    s.run(10);
    expect(buddy.classe).not.toBe(0);
    expect(buddy.hp).toBeGreaterThan(0);
    expect(s.world.player.obj.vx).toBe(0);
    expect(s.world.player.obj.classe).toBe(0x40);
    expect(s.world.player.obj.model).toBe(0);
  });
});
