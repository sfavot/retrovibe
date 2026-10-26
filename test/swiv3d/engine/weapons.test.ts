import { describe, expect, it } from "vitest";
import { COS, SIN } from "../../../src/games/swiv3d/engine/fixed";
import { launcherOf } from "../../../src/games/swiv3d/engine/launchers";
import type { GameObject } from "../../../src/games/swiv3d/engine/objects";
import { hasOriginalFiles } from "./helpers";
import { rec, scenario, type Scenario } from "./scenario";

/** Munitions : `n` à `count`, le reste à 0. */
function ammo(n: number, count: number): number[] {
  const a = new Array<number>(20).fill(0);
  a[n] = count;
  return a;
}

function live(s: Scenario, update: string): GameObject[] {
  return [...s.world.liveObjects()].filter((o) => o.update === update);
}

/** Sélectionne l'arme `n` (la touche `n % 10 + 1` ; l'arme `n >= 10` n'est choisie que parce que la banque basse est vide). */
function select(s: Scenario, n: number): void {
  s.run(1, { weaponDirect: (n % 10) + 1 });
  expect(s.world.game.selected).toBe(n);
}

/** Avance jusqu'à l'état « armée » (10), retourne le nombre de ticks. */
function armUp(s: Scenario, max = 200): number {
  for (let t = 0; t < max; t++) {
    if (s.world.game.weaponState === 10) return t;
    s.run(1);
  }
  throw new Error(`l'arme ${s.world.game.loaded} n'est jamais armée (état ${s.world.game.weaponState})`);
}

/**
 * Joue `ticks` ticks (le premier avec le tir spécial) et retourne, pour chaque objet distinct qui prend le comportement `update`, le
 * tick (0 = celui de l'appui) où il est vu pour la première fois.
 */
function launches(s: Scenario, update: string, ticks: number): number[] {
  const seen = new Set<GameObject>();
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    s.run(1, t === 0 ? { fireSpecial: true } : {});
    for (const o of s.world.liveObjects())
      if (o.update === update && !seen.has(o)) {
        seen.add(o);
        out.push(t);
      }
  }
  return out;
}

/** Composantes (latéral, avant) du décalage de `o` par rapport au joueur, dans le repère du cap, en 1/256 d'unité. */
function frame(s: Scenario, o: GameObject): { lat: number; fwd: number; vert: number } {
  const p = s.world.player.obj;
  const dx = o.x - p.x;
  const dz = o.z - p.z;
  const sy = SIN[p.yaw & 0x1ff]! / 256;
  const cy = COS[p.yaw & 0x1ff]! / 256;
  return { lat: dx * cy - dz * sy, fwd: dx * sy + dz * cy, vert: o.y - p.y };
}

describe.skipIf(!hasOriginalFiles)("armes spéciales : lanceurs accrochés (hélicoptère)", () => {
  it("la table des lanceurs distingue l'hélicoptère (dessous) et les véhicules (dessus)", () => {
    expect(launcherOf(0, 1)!.pods[0]!.hold).toEqual([4000, -700, 0]);
    expect(launcherOf(1, 1)!.pods[0]!.hold).toEqual([5000, 2000, 0]);
    expect(launcherOf(0, 9)).toBeNull();
    expect(launcherOf(1, 9)!.pods[0]!.hold).toEqual([0, 4000, -4000]);
    expect(launcherOf(4, 19)).not.toBeNull();
  });

  it("missile : le missile glisse sous le fuselage pendant 20 ticks, puis part en 'missile_straight'", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(0, 3) });
    select(s, 0);
    s.run(2);
    const pods = live(s, "missile_attached");
    expect(pods).toHaveLength(1);
    expect(pods[0]!.classe).toBe(0x40);
    expect(armUp(s)).toBeLessThan(40);
    const hold = frame(s, pods[0]!);
    expect(Math.abs(hold.lat)).toBeLessThan(300);
    expect(hold.vert).toBeCloseTo(-3000, -2);
    s.run(1, { fireSpecial: true });
    expect(s.world.game.ammo[0]).toBe(3 - 1);
    expect(pods[0]!.update).toBe("missile_straight");
    expect(pods[0]!.classe).toBe(0x3f);
    // un nouveau missile est accroché, le canon n'y touche pas
    s.run(30);
    expect(live(s, "missile_attached")).toHaveLength(1);
    expect(s.world.game.weaponState).toBe(10);
  });

  it("autolock : deux missiles à ±4 000 sous le fuselage, le second part 7 ticks après le premier", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(1, 3) });
    select(s, 1);
    armUp(s);
    const [a, b] = live(s, "missile_attached");
    expect(Math.round(frame(s, a!).lat / 100) * 100).toBe(4000);
    expect(Math.round(frame(s, b!).lat / 100) * 100).toBe(-4000);
    expect(launches(s, "missile_b", 20)).toEqual([0, 8]);
    expect(a!.classe === 0 || a!.update === "missile_b").toBe(true);
    expect(s.world.game.ammo[1]).toBe(2);
  });

  it("missiles tri-ogives : celui du dessous part seul, les deux latéraux 10 ticks plus tard en 'missile_straight'", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(10, 3) });
    select(s, 10);
    armUp(s);
    const pods = live(s, "missile_attached");
    expect(pods).toHaveLength(3);
    expect(launches(s, "missile_b", 5)).toEqual([0]);
    expect(launches(s, "missile_straight", 15)).toEqual([6, 6].map((v) => v)); // tick 11 après l'appui (5 ticks déjà joués)
    expect(s.world.game.ammo[10]).toBe(2);
  });

  it("missiles Faucon : quatre missiles, aux ticks 0, 8, 16 et 24", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(11, 2) });
    select(s, 11);
    armUp(s);
    const pods = live(s, "missile_attached");
    expect(pods).toHaveLength(4);
    expect(launches(s, "missile_b", 40)).toEqual([0, 8, 16, 24]);
    expect(s.world.game.ammo[11]).toBe(1);
  });

  it("multi-tir : 8 missiles, un tous les 8 ticks, nacelles larguées aux ticks 70 et 85, rechargement à 90", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(2, 2) });
    select(s, 2);
    armUp(s);
    const pods = live(s, "missile_attached");
    expect(pods).toHaveLength(2);
    const fired: number[] = [];
    const dropped: number[] = [];
    const seen = new Set<GameObject>();
    for (let t = 0; t < 95; t++) {
      s.run(1, t === 0 ? { fireSpecial: true } : {});
      for (const o of s.world.liveObjects()) if (o.update === "missile_b" && !seen.has(o)) (seen.add(o), fired.push(t));
      const d = pods.filter((p) => p.update === "pod_dropped").length;
      while (dropped.length < d) dropped.push(t);
    }
    expect(fired.slice(0, 8)).toEqual([8, 16, 24, 32, 40, 48, 56, 64]);
    expect(dropped).toEqual([70, 85]);
    expect(s.world.game.weaponState).not.toBe(0x0c);
    expect(s.world.game.ammo[2]).toBe(1);
  });

  it("tomawhak : deux missiles de croisière lents (300), le second 7 ticks après, dans des états de spirale opposés", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(3, 2) });
    select(s, 3);
    armUp(s);
    const [a, b] = live(s, "missile_attached");
    s.run(1, { fireSpecial: true });
    expect(a!.update).toBe("cruise_missile");
    expect(a!.state).toBe(10);
    expect(b!.update).toBe("missile_attached");
    s.run(8);
    expect(b!.update).toBe("cruise_missile");
    expect(b!.state).toBe(11);
    s.run(1);
    expect(Math.hypot(a!.vx, a!.vz)).toBeLessThan(600);
    // sans cible, la vitesse (`timer`) gagne 10 par tick après la spirale
    s.run(60);
    expect(a!.timer).toBeGreaterThan(300);
  });

  it("rocketpak : 5 missiles en couronne, la nacelle est larguée", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(4, 2) });
    select(s, 4);
    armUp(s);
    const [pod] = live(s, "missile_attached");
    s.run(1, { fireSpecial: true });
    expect(live(s, "missile_b")).toHaveLength(5);
    expect(pod!.update).toBe("pod_dropped");
    expect(s.world.game.ammo[4]).toBe(1);
  });

  it("apocalypse : 8 missiles, un par cap de 64", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(14, 2) });
    select(s, 14);
    armUp(s);
    s.run(1, { fireSpecial: true });
    const m = live(s, "missile_b");
    expect(m).toHaveLength(8);
    const yaws = new Set(m.map((o) => o.yaw & 0x1ff));
    expect(yaws.size).toBe(8);
  });

  it("l'arme est retirée (états 0x14 puis 0x16) si on en change quand elle est armée, puis l'autre est chargée", () => {
    const s = scenario("TERRAN00", () => [], { ammo: [3, 0, 0, 0, 0, 2, ...new Array<number>(14).fill(0)] });
    select(s, 0);
    armUp(s);
    const first = live(s, "missile_attached")[0]!;
    s.run(1, { weaponDirect: 6 });
    expect(s.world.game.selected).toBe(5);
    expect(s.world.game.weaponState).toBe(0x16);
    s.run(40);
    expect(first.classe).toBe(0);
    expect(s.world.game.loaded).toBe(5);
  });
});

describe.skipIf(!hasOriginalFiles)("armes spéciales : vols portés de l'exe", () => {
  it("super nova : 35 ticks de vol, puis 10 éclats et des balles sur les ennemis proches", () => {
    const s = scenario(
      "TERRAN00",
      (sx, sz, level) => {
        const yaw = level.objects.find((o) => o.type === 1000)!.angle;
        return [rec(2000, sx + (SIN[yaw]! * 400) / 256, sz + (COS[yaw]! * 400) / 256, { model: 500, hitPoints: 500 })];
      },
      { ammo: ammo(5, 2) },
    );
    select(s, 5);
    armUp(s);
    s.run(1, { fireSpecial: true });
    const nova = live(s, "special_nova")[0]!;
    expect(nova.pitch).toBeLessThanOrEqual(0x46);
    s.run(34);
    expect(nova.classe).not.toBe(0);
    s.run(2);
    expect(nova.classe).toBe(0);
    expect(live(s, "bullet_heavy").length).toBe(10);
    // une balle de 25 pv par objet « ennemi » des 5 × 5 cellules
    expect(live(s, "bullet").filter((o) => o.hp === 25).length).toBeGreaterThanOrEqual(1);
  });

  it("nucléateur : trois sous-munitions de durées de vie 30, 50 et 70", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(15, 2) });
    select(s, 15);
    armUp(s);
    s.run(1, { fireSpecial: true });
    s.run(36);
    const b = live(s, "bomblet");
    expect(b).toHaveLength(3);
    // 30, 50 et 70 ticks au départ, un tick de vol déjà joué
    expect(b.map((o) => o.timer).sort((x, y) => x - y)).toEqual([29, 49, 69]);
  });

  it("mortier : devient un fantôme lancé à 32 u/tick, rase le relief et éclate au 40ᵉ tick en 35 éclats", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(6, 2) });
    select(s, 6);
    armUp(s);
    s.run(1, { fireSpecial: true });
    const m = live(s, "special_mortar")[0]!;
    s.run(2);
    expect(m.classe).toBe(0x40);
    s.run(40);
    expect(m.classe).toBe(0);
    expect(live(s, "bullet_heavy").length).toBe(35);
  });

  it("super mortier : 20 éclats lourds de plus", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(16, 2) });
    select(s, 16);
    armUp(s);
    s.run(1, { fireSpecial: true });
    s.run(45);
    expect(live(s, "bullet_heavy").length).toBe(55);
  });

  it("bombe : l'onde de choc blesse un objet proche (et le joueur), mais pas un objet lointain", () => {
    const s = scenario(
      "TERRAN00",
      (sx, sz, level) => {
        const yaw = level.objects.find((o) => o.type === 1000)!.angle;
        const at = (d: number) => [sx + (SIN[yaw]! * d) / 256, sz + (COS[yaw]! * d) / 256] as const;
        return [
          rec(2000, ...at(300), { model: 500, hitPoints: 5000 }),
          rec(2000, ...at(1500), { model: 500, hitPoints: 5000 }),
        ];
      },
      { ammo: ammo(7, 2) },
    );
    select(s, 7);
    armUp(s);
    const [near, far] = s.world.levelObjects.filter((o) => o.type === 2000);
    const hpNear = near!.hp;
    s.run(1, { fireSpecial: true });
    s.run(120);
    expect(near!.hp).toBeLessThan(hpNear);
    expect(far!.hp).toBe(5000);
  });

  it("napalm : sème des gouttes de 50 pv qui tombent et creusent", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(8, 2) });
    select(s, 8);
    armUp(s);
    const drops = launches(s, "napalm_drop", 70);
    // première goutte au 18ᵉ tick de vol puis une tous les 4 ticks : le napalm touche le sol avant le 120ᵉ tick
    expect(drops.length).toBeGreaterThanOrEqual(3);
    expect(drops[0]).toBeGreaterThanOrEqual(18);
    expect(drops[1]! - drops[0]!).toBe(4);
    // les gouttes qui touchent le sol creusent un cratère (événement) et posent un décalque
    s.run(60);
    expect(s.events.filter((e) => e.kind === "crater").length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasOriginalFiles)("armes spéciales : véhicules roulants", () => {
  const ground = (n: number, count: number) => scenario("TERRAN00", () => [], { ammo: ammo(n, count), startForm: 1 });

  it("l'arme 9 n'est pas pour l'hélicoptère et l'arme 19 pas non plus", () => {
    const s = scenario("TERRAN00", () => [], { ammo: ammo(9, 2) });
    s.run(1, { weaponDirect: 10 });
    expect(s.world.game.selected).toBe(-1);
  });

  it("super ressort : cabrage, poussée de 50 ticks à 9 000, retour du pilote à l'atterrissage", () => {
    const s = ground(9, 2);
    select(s, 9);
    armUp(s);
    const pod = live(s, "missile_attached")[0]!;
    const hold = frame(s, pod);
    expect(hold.vert).toBeGreaterThan(3000);
    expect(hold.fwd).toBeLessThan(-3000);
    const p = s.world.player.obj;
    s.run(1, { fireSpecial: true });
    expect(s.world.game.ammo[9]).toBe(1);
    s.run(1);
    expect(s.world.player.autopilot).toBe(true);
    expect(p.classe & 4).toBe(0);
    let maxY = p.y;
    for (let t = 0; t < 400 && s.world.player.autopilot; t++) {
      s.run(1);
      maxY = Math.max(maxY, p.y);
    }
    expect(s.world.player.autopilot).toBe(false);
    expect(p.classe & 4).toBe(4);
    expect(maxY - s.world.terrain.height(p.x, p.z)).toBeGreaterThan(300 * 256);
    expect(pod.update).toBe("pod_dropped");
  });

  it("accélérateur : 1 munition par tick tant que le tir est tenu, poussée vers le cap", () => {
    const s = ground(19, 500);
    select(s, 19);
    armUp(s);
    const p = s.world.player.obj;
    s.run(30);
    const before = s.world.game.ammo[19]!;
    const v0 = Math.hypot(p.vx, p.vz);
    s.run(10, { fireSpecial: true });
    expect(s.world.game.ammo[19]).toBe(before - 10);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(v0 + 500);
    s.run(30);
    expect(s.world.game.ammo[19]).toBe(before - 10);
  });
});

describe.skipIf(!hasOriginalFiles)("compagnons", () => {
  function withBuddy(n: number): Scenario {
    const s = scenario("TERRAN00", () => [], {});
    s.world.game.ammo[0] = 0;
    return Object.assign(s, { buddy: n });
  }

  it("module de verrouillage : 4 balles de 8 pv par rafale de 32 ticks tant que le tir principal est tenu", () => {
    const s = withBuddy(105);
    // le bonus est appliqué directement
    return import("../../../src/games/swiv3d/engine/pickups").then(({ applyPickup }) => {
      applyPickup(s.world, 105);
      const b = s.world.game.buddies.find((x) => x)!;
      expect(b.classe).toBe(0x14);
      s.run(5);
      const before = live(s, "bullet_right").length;
      expect(before).toBe(0);
      let shots = 0;
      for (let t = 0; t < 96; t++) {
        s.run(1, { firePrimary: true });
        for (const o of live(s, "bullet_right")) if (o.hp === 8 && o.model === 10002 && o.age === 0) shots++;
      }
      expect(shots).toBe(12);
    });
  });

  it("super module : un missile de classe 10 tous les 32 ticks, seulement tir principal tenu", () => {
    const s = withBuddy(108);
    return import("../../../src/games/swiv3d/engine/pickups").then(({ applyPickup }) => {
      applyPickup(s.world, 108);
      s.run(70);
      expect(live(s, "missile_class10")).toHaveLength(0);
      let shots = 0;
      for (let t = 0; t < 65; t++) {
        s.run(1, { firePrimary: true });
        for (const o of live(s, "missile_class10")) if (o.age === 0) shots++;
      }
      expect(shots).toBe(2);
    });
  });
});
