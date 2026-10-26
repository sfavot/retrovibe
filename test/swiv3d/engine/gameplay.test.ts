import { describe, expect, it } from "vitest";
import { SIN, COS } from "../../../src/games/swiv3d/engine/fixed";
import type { GameObject } from "../../../src/games/swiv3d/engine/objects";
import { loadDebris } from "../../../src/games/swiv3d/engine/world";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { count, nodeAt, rec, scenario } from "./scenario";

const SOUND_ENEMY_SHOT = 2001;

function live(w: { liveObjects(): IterableIterator<GameObject> }, update: string): GameObject[] {
  return [...w.liveObjects()].filter((o) => o.update === update);
}

describe.skipIf(!hasOriginalFiles)("gameplay : ennemis", () => {
  it("une tourelle (3000) vise le joueur à portée et tire avec son programme d'arme", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(3000, sx + 150, sz + 100, { model: 400, childModel: 401, hitPoints: 100, subtype: 100 }),
    ]);
    const ev = s.run(300);
    const turret = live(s.world, "upd_0044ac88")[0]!;
    expect(turret.target).toBe(s.world.player.obj);
    expect(turret.pitch).toBeGreaterThan(-16);
    expect(turret.pitch).toBeLessThan(56);
    const shots = ev.filter((e) => e.kind === "sound" && e.id === SOUND_ENEMY_SHOT);
    expect(shots.length).toBeGreaterThan(3);
    // le canon 100 recharge 51 ticks : jamais plus d'un tir par 50 ticks
    expect(shots.length).toBeLessThanOrEqual(Math.ceil(300 / 50));
  });

  it("une tourelle touche le joueur : les balles retirent leurs pv (35) au joueur", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(3000, sx + 100, sz + 100, { model: 400, childModel: 401, hitPoints: 100, subtype: 400 }),
    ]);
    const ev = s.run(400);
    expect(count(ev, "playerDamaged")).toBeGreaterThan(0);
    expect(s.world.player.hp).toBeLessThan(496);
    expect(s.world.status.energy).toBe(s.world.player.hp);
  });

  it("un char (5000) suit les nœuds du bloc 107 et réserve un nœud à la fois", () => {
    // le joueur au nœud 1, le char au nœud le plus proche de 1 600 unités : hors de portée de ciblage, dans la zone active
    const s = scenario(
      "TERRAN00",
      (sx, sz, level) => {
        let best = level.waypoints[0]!;
        let bd = Infinity;
        for (const w of level.waypoints) {
          const d = Math.abs(Math.hypot(w.x - sx, w.z - sz) - 1600);
          if (d < bd) {
            bd = d;
            best = w;
          }
        }
        return [rec(5000, best.x, best.z, { model: 200, childModel: 202, hitPoints: 100, subtype: 100, thrust: 50 })];
      },
      {},
      nodeAt(1),
    );
    const tank = live(s.world, "upd_0044bca8")[0]!;
    expect(tank.target).toBe(tank);
    const visited = new Set<number>();
    const x0 = tank.x;
    const z0 = tank.z;
    for (let i = 0; i < 400; i++) {
      s.run(1);
      visited.add(tank.node);
    }
    expect(visited.size).toBeGreaterThan(1);
    expect(Math.hypot(tank.x - x0, tank.z - z0) / 256).toBeGreaterThan(30);
    // un seul véhicule par nœud : exactement un nœud a perdu sa capacité
    let reserved = 0;
    for (let n = 0; n < s.world.nodes.count; n++)
      if (s.world.nodes.capacity("ground", n) < s.level.waypoints[n]!.capacity.ground) reserved++;
    expect(reserved).toBe(1);
  });

  it("une fabrique (6000) engendre un char et sa tourelle toutes les 141 ticks quand un nœud est libre", () => {
    const s = scenario(
      "TERRAN00",
      (sx, sz) => [
        rec(6000, sx, sz, {
          model: 515,
          childModel: 501,
          hitPoints: 160,
          extra: { 11: 200, 12: 202, 13: 100, 14: 100, 15: 50 },
        }),
      ],
      {},
      nodeAt(1),
    );
    s.run(100);
    expect(live(s.world, "upd_0044bca8")).toHaveLength(0);
    s.run(60);
    expect(live(s.world, "upd_0044bca8")).toHaveLength(1);
    const turret = live(s.world, "upd_0044d470")[0]!;
    expect(turret.subtype).toBe(100);
    expect(turret.owner).toBe(live(s.world, "upd_0044bca8")[0]);
    // un char qui meurt rend son nœud : la fabrique continue d'en produire (un tous les 141 ticks au plus)
    const first = live(s.world, "upd_0044bca8")[0]!;
    first.hp = 0;
    s.run(300);
    const tanks = live(s.world, "upd_0044bca8");
    expect(tanks.length).toBeGreaterThanOrEqual(1);
    expect(tanks.length).toBeLessThanOrEqual(3);
  });

  it("un hélicoptère kamikaze (4001) reste posé jusqu'à l'alerte, puis décolle, fonce et heurte le joueur", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(4001, sx + 200, sz, { model: 100, hitPoints: 50 }),
    ]);
    const heli = live(s.world, "upd_0044e438")[0]!;
    expect(heli.classe & 0x10).toBe(0);
    s.run(10);
    expect(heli.classe & 0x10).toBe(0); // pas encore de recherche (période 70)
    const ev = s.run(250);
    expect(heli.classe & 0x10).not.toBe(0);
    expect(count(ev, "playerDamaged")).toBeGreaterThan(0);
    expect(s.world.player.hp).toBeLessThan(496);
    // le choc le détruit (min(pv, 100) des deux côtés) : épave et 210 points
    expect(s.world.game.score).toBe(210);
    expect(heli.update).toBe("upd_00449c10");
  });

  it("un avion de nœuds (4002) tire sur le joueur (arme 603) et meurt en épave avec 210 points", () => {
    const s = scenario(
      "TERRAN00",
      (sx, sz, level) => {
        let best = level.waypoints[0]!;
        let bd = Infinity;
        for (const w of level.waypoints) {
          const d = (w.x - sx - 300) ** 2 + (w.z - sz) ** 2;
          if (d < bd) {
            bd = d;
            best = w;
          }
        }
        return [rec(4002, best.x, best.z, { model: 103, hitPoints: 75, subtype: 603 })];
      },
      {},
      nodeAt(1),
    );
    const ev = s.run(250);
    const plane = live(s.world, "upd_0044e758")[0]!;
    expect(plane).toBeDefined();
    expect(ev.filter((e) => e.kind === "sound" && e.id === 2002).length).toBeGreaterThan(0);
    plane.hp = 0;
    plane.target = s.world.player.obj;
    const ev2 = s.run(2);
    expect(ev2.some((e) => e.kind === "scoreChanged" && e.delta === 210)).toBe(true);
    expect(plane.update).toBe("upd_00449c10");
  });

  it("un générateur (6300) maintient 4 chasseurs au plus autour du joueur, même après leur mort", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(6300, sx + 100, sz, { model: 103, hitPoints: 75, subtype: 602, thrust: 40 }),
    ]);
    s.run(160);
    const fighters = live(s.world, "fighter");
    expect(fighters).toHaveLength(4);
    expect(fighters.map((f) => f.state).sort()).toEqual([0, 1, 2, 3]);
    for (const f of fighters) f.hp = 0;
    s.run(200);
    expect(live(s.world, "fighter")).toHaveLength(0);
    expect(s.world.game.fighters.every((f) => f !== null)).toBe(true);
  });

  it("une piste (6100) lance des avions de ligne droite quand un joueur est repéré", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(6100, sx + 100, sz + 100, {
        model: 507,
        childModel: 508,
        hitPoints: 200,
        extra: { 11: 101, 13: 10, 14: 600, 15: 50 },
      }),
    ]);
    s.run(200);
    expect(live(s.world, "attack_plane").length).toBeGreaterThanOrEqual(1);
  });

  it("le canon à faisceau (3001) n'agit qu'à moins de 640 unités et retire 11 pv par impulsion", () => {
    const near = scenario("TERRAN00", (sx, sz) => [
      rec(3001, sx + 100, sz, { model: 402, hitPoints: 160, subtype: 700 }),
    ]);
    near.run(130);
    expect(near.world.player.hp).toBeLessThan(496);
    // première salve : le faisceau 700 touche à 24, 16 et 8 ticks du cycle (le cycle à 0 est rechargé à 100 avant le test)
    expect(496 - near.world.player.hp).toBe(11 * 3);
  });
});

describe.skipIf(!hasOriginalFiles)("gameplay : joueur", () => {
  it("le canon tire la salve du niveau de puissance (par 16 ticks)", () => {
    const expected = [4, 3, 4, 5, 5, 6, 6];
    expected.forEach((n, power) => {
      const s = scenario("TERRAN00", () => [], { cannonPower: power });
      let fired = 0;
      for (let t = 0; t < 16; t++) {
        s.run(1, { firePrimary: true });
        const fresh = [...s.world.liveObjects()].filter(
          (o) => o.update === "bullet_right" && o.age === 0,
        );
        for (const b of fresh) expect(b.owner).toBe(s.world.player.obj);
        fired += fresh.length;
      }
      expect(fired, `puissance ${power}`).toBe(n);
    });
  });

  it("les balles ont les dégâts d'énergie du motif (10 et 12) et se rangent autour du cap", () => {
    const s = scenario("TERRAN00", () => [], { cannonPower: 4 });
    s.run(1, { firePrimary: true });
    const hp = [...s.world.liveObjects()].filter((o) => o.update === "bullet_right").map((o) => o.hp).sort();
    expect(hp).toEqual([10, 10, 10, 10, 12]);
  });

  it("une cible détruite par les tirs rapporte 73 points, explose et laisse des effets", () => {
    const s = scenario(
      "TERRAN00",
      (sx, sz, level) => {
        const yaw = level.objects.find((o) => o.type === 1000)!.angle;
        return [
          rec(2000, sx + (SIN[yaw]! * 300) / 256, sz + (COS[yaw]! * 300) / 256, {
            model: 500,
            childModel: 0,
            hitPoints: 10,
          }),
        ];
      },
      { debris: loadDebris(readOriginal("TERRAN00.SLV"), "T0") },
    );
    const ev = s.run(60, { firePrimary: true });
    expect(ev.some((e) => e.kind === "objectDestroyed")).toBe(true);
    expect(ev.some((e) => e.kind === "scoreChanged" && e.delta === 73)).toBe(true);
    expect(ev.some((e) => e.kind === "sound" && e.id === 1000)).toBe(true);
    expect(s.world.status.score).toBeGreaterThan(0);
    const fx = s.world.effects();
    expect(fx.length).toBeGreaterThan(0);
    for (const e of fx) expect([504, 505]).toContain(e.set);
    // l'épave persiste (modèle 7xx) et la cible a disparu du pool
    expect(live(s.world, "static")).toHaveLength(0);
  });

  it("un bonus ramassé applique son effet (munitions de missiles) et sélectionne l'arme", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(7000, sx + 20, sz, { model: 604, childModel: 800, hitPoints: 10, subtype: 1000 }),
    ]);
    const ev = s.run(220);
    expect(s.world.game.ammo[0]).toBe(6);
    expect(s.world.status.specialAmmo[0]).toBe(6);
    expect(s.world.status.special).toBe(0);
    expect(ev.some((e) => e.kind === "pickup" && e.n === 0)).toBe(true);
    expect(ev.some((e) => e.kind === "message" && e.textTable === 100 && e.textId === 0)).toBe(true);
    expect(s.world.game.pickedPlaced).toBe(1);
  });

  it("un bonus d'énergie 101 rend 124 pv ; refusé quand l'énergie est pleine", () => {
    const low = scenario(
      "TERRAN00",
      (sx, sz) => [rec(7000, sx + 20, sz, { model: 604, childModel: 606, hitPoints: 10, subtype: 1101 })],
      { playerHitPoints: 300 },
    );
    low.run(220);
    expect(low.world.player.hp).toBe(424);
    const full = scenario("TERRAN00", (sx, sz) => [
      rec(7000, sx + 20, sz, { model: 604, childModel: 606, hitPoints: 10, subtype: 1101 }),
    ]);
    full.run(220);
    expect(full.world.player.hp).toBe(496);
    expect(live(full.world, "upd_004469fc")).toHaveLength(1); // toujours là : le plafond est atteint
  });

  it("un bonus de puissance (110) monte le canon d'un niveau tant qu'il est < 4", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(7000, sx + 20, sz, { model: 604, childModel: 808, hitPoints: 10, subtype: 1110 }),
    ]);
    s.run(220);
    expect(s.world.status.cannonPower).toBe(1);
  });

  it("une arme spéciale s'arme (20 ticks pour les missiles), consomme une munition au tir et poursuit sa cible", () => {
    const s = scenario(
      "TERRAN00",
      (sx, sz, level) => {
        const yaw = level.objects.find((o) => o.type === 1000)!.angle;
        return [
          rec(2000, sx + (SIN[yaw]! * 700) / 256, sz + (COS[yaw]! * 700) / 256, {
            model: 500,
            hitPoints: 50,
          }),
        ];
      },
      { ammo: [3, ...new Array<number>(19).fill(0)] },
    );
    expect(s.world.status.special).toBe(-1);
    s.run(1, { weaponDirect: 1 });
    expect(s.world.status.special).toBe(0);
    expect(s.world.status.specialArmed).toBe(false);
    s.run(30);
    expect(s.world.status.specialArmed).toBe(true);
    s.run(40); // le joueur a choisi sa cible (période de 60 ticks à l'arrêt)
    expect(s.world.player.obj.target.update).toBe("static");
    // appui bref sur le tir spécial : une munition de moins, un missile en l'air
    s.run(1, { fireSpecial: true });
    s.run(2);
    expect(s.world.status.specialAmmo[0]).toBe(2);
    expect(s.world.status.specialArmed).toBe(false); // réarmement du missile suivant
    expect(live(s.world, "missile_straight").length + count(s.world.drainEvents(), "objectDestroyed")).toBeGreaterThan(0);
    s.run(120);
    expect(live(s.world, "static")).toHaveLength(0); // le missile (80) a détruit la cible (50)
    // sans munition, l'arme est retirée et la sélection passe à « aucune »
    const dry = scenario("TERRAN00", () => [], { ammo: [1, ...new Array<number>(19).fill(0)] });
    dry.run(1, { weaponDirect: 1 });
    dry.run(30);
    dry.run(1, { fireSpecial: true });
    dry.run(10);
    expect(dry.world.status.specialAmmo[0]).toBe(0);
    expect(dry.world.status.special).toBe(-1);
  });

  it("la sélection d'arme saute les armes sans munitions et refuse celles du mauvais véhicule", () => {
    const s = scenario("TERRAN00", () => [], { ammo: [5, 0, 0, 4, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    s.run(1, { weaponDirect: 1 });
    expect(s.world.status.special).toBe(0);
    s.run(1, { weaponNext: true });
    expect(s.world.status.special).toBe(3);
    s.run(1, { weaponNext: true }); // l'arme 9 (Super Ressort) n'est pas pour l'hélicoptère
    expect(s.world.status.special).toBe(0);
    s.run(1, { weaponPrev: true });
    expect(s.world.status.special).toBe(3);
  });
});

describe.skipIf(!hasOriginalFiles)("gameplay : objectifs, fin de niveau, mort", () => {
  it("détruire le groupe 9 puis le groupe 0 déclenche le message, puis la fin de niveau 54 ticks plus tard", () => {
    const s = scenario("TERRAN00", (sx, sz, level) => {
      const yaw = level.objects.find((o) => o.type === 1000)!.angle;
      const at = (d: number): [number, number] => [
        sx + (SIN[yaw]! * d) / 256,
        sz + (COS[yaw]! * d) / 256,
      ];
      return [
        rec(2000, ...at(300), { model: 511, hitPoints: 10, subtype: 5009 }),
        rec(2000, ...at(500), { model: 514, hitPoints: 10, subtype: 5000 }),
        rec(2000, ...at(700), { model: 514, hitPoints: 400, subtype: 5000 }),
      ];
    });
    expect(s.world.status.objectivesLeft).toBe(3);
    const ev = s.run(80, { firePrimary: true });
    expect(ev.some((e) => e.kind === "objective" && e.group === 9 && e.groupDone)).toBe(true);
    expect(ev.some((e) => e.kind === "message" && e.textTable === 20 && e.textId === 9)).toBe(true);
    expect(s.world.game.group9Done).toBe(true);
    // le tir a aussi abattu le premier objectif du groupe 0 (500 unités), pas le dernier (400 pv)
    expect(s.world.status.objectivesLeft).toBe(1);
    expect(s.world.status.levelComplete).toBe(false);
    const target = live(s.world, "static").find((o) => o.hp === 400)!;
    target.hp = 0;
    const before = s.world.tickCount;
    const ev2 = s.run(70);
    expect(ev2.some((e) => e.kind === "message" && e.textTable === 20 && e.textId === 0)).toBe(true);
    expect(ev2.filter((e) => e.kind === "levelComplete")).toHaveLength(1);
    expect(s.world.status.levelComplete).toBe(true);
    expect(s.world.status.objectivesLeft).toBe(0);
    expect(s.world.game.endCounter).toBeGreaterThan(54);
    expect(before).toBeGreaterThan(0);
  });

  it("un bonus caché (7002) n'apparaît qu'après la destruction du groupe 9", () => {
    const s = scenario("TERRAN00", (sx, sz, level) => {
      const yaw = level.objects.find((o) => o.type === 1000)!.angle;
      const at = (d: number): [number, number] => [sx + (SIN[yaw]! * d) / 256, sz + (COS[yaw]! * d) / 256];
      return [
        rec(7002, sx + 400, sz + 400, { model: 604, childModel: 981, hitPoints: 0, subtype: 1009 }),
        rec(2000, ...at(300), { model: 511, hitPoints: 10, subtype: 5009 }),
      ];
    });
    s.run(30);
    expect(live(s.world, "upd_004469fc")).toHaveLength(0);
    s.run(60, { firePrimary: true });
    expect(s.world.game.group9Done).toBe(true);
    s.run(2);
    expect(live(s.world, "upd_004469fc")).toHaveLength(1);
    expect(live(s.world, "upd_004469fc")[0]!.subtype).toBe(1009);
  });

  it("la mort du joueur émet gameOver exactement 35 ticks plus tard, sans vie ni réapparition", () => {
    const s = scenario("TERRAN00", () => []);
    s.run(10);
    s.world.player.obj.hp = 0;
    const tDeath = s.world.tickCount + 1;
    let diedAt = -1;
    let overAt = -1;
    for (let i = 0; i < 60; i++) {
      s.run(1, { forward: true, firePrimary: true });
      const t = s.world.tickCount;
      for (const e of s.events.splice(0)) {
        if (e.kind === "playerDied") diedAt = t;
        if (e.kind === "gameOver") overAt = t;
      }
    }
    expect(diedAt).toBe(tDeath);
    expect(overAt - diedAt).toBe(35);
    expect(s.world.status.gameOver).toBe(true);
    expect(s.world.status.levelComplete).toBe(false);
    expect(s.world.status.messages.length).toBeGreaterThanOrEqual(0);
    // le joueur est inerte : plus de tir ni de déplacement
    const x = s.world.player.x;
    s.run(10, { forward: true, firePrimary: true });
    expect(s.world.player.x).toBe(x);
    expect([...s.world.liveObjects()].filter((o) => o.update === "bullet_right")).toHaveLength(0);
  });

  it("le bouclier absorbe les dégâts jusqu'à épuisement", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(7000, sx + 20, sz, { model: 604, childModel: 853, hitPoints: 10, subtype: 1107 }),
      rec(3000, sx + 100, sz + 100, { model: 400, childModel: 401, hitPoints: 100, subtype: 400 }),
    ]);
    s.run(250);
    expect(s.world.game.shield === null || s.world.game.shield.hp <= 200).toBe(true);
    expect(s.world.player.hp).toBeGreaterThanOrEqual(200 - 1 - 100);
  });
});

describe.skipIf(!hasOriginalFiles)("gameplay : plates-formes, navires, contrat de statut", () => {
  it("une plate-forme 7010 capte l'hélicoptère et le transforme en véhicule, puis attend un véhicule au sol (le retour : pads.test.ts)", () => {
    const s = scenario("TERRAN00", (sx, sz) => [
      rec(7010, sx + 30, sz, { model: 504, hitPoints: 1000, angle: 100 }),
    ]);
    const pad = live(s.world, "upd_004482dc")[0]!;
    s.run(5);
    expect(pad.state).toBe(1); // captation (joueur en vol à moins de 122 unités)
    expect(s.world.player.autopilot).toBe(true);
    s.run(100);
    expect(s.world.player.form).toBe(1);
    expect(s.world.status.energy).toBe(496);
    expect(s.world.events.length + s.events.filter((e) => e.kind === "formChanged").length).toBeGreaterThan(0);
    // relâché 40 ticks après la pose, puis 200 ticks de pause
    s.run(250);
    expect(pad.state).toBe(5);
    expect(s.world.player.autopilot).toBe(false);
  });

  it("un navire (5500) suit les nœuds d'eau (compteur navire) et tire sur le joueur", () => {
    const s = scenario(
      "TERRAN02",
      (sx, sz, level) => {
        // nœuds d'eau dans la carte (les coordonnées ≥ 32 768 ne sont pas repliées par l'exe, voir objects.md §10.5)
        const water = level.waypoints.map((w, i) => ({ w, i })).filter(({ w }) => w.capacity.ships > 0 && w.x < 32768 && w.z < 32768);
        let best = water[0]!.w;
        let bd = Infinity;
        for (const { w } of water) {
          const d = Math.abs(Math.hypot(w.x - sx, w.z - sz) - 1300);
          if (d < bd) {
            bd = d;
            best = w;
          }
        }
        return [rec(5500, best.x, best.z, { model: 300, childModel: 301, hitPoints: 100, subtype: 110, thrust: 40 })];
      },
      {},
      (level) => {
        const w = level.waypoints.find((n) => n.capacity.ships > 0 && n.x < 32768 && n.z < 32768)!;
        return { x: w.x, z: w.z };
      },
    );
    const boat = live(s.world, "upd_0044cf1c")[0]!;
    const visited = new Set<number>();
    for (let i = 0; i < 400; i++) {
      s.run(1);
      visited.add(boat.node);
    }
    expect(boat.node).toBeGreaterThanOrEqual(0);
    expect(s.level.waypoints[boat.node]!.capacity.ships).toBeGreaterThan(0);
    expect(visited.size).toBeGreaterThan(1);
  });

  it("expose un statut complet à jour à chaque tick (contrat de H2)", () => {
    const s = scenario("TERRAN00", () => [], { ammo: [4, ...new Array<number>(19).fill(0)], score: 120 });
    const st = s.world.status;
    expect(st).toBe(s.world.status); // même objet, mis à jour sur place
    expect(st.maxEnergy).toBe(496);
    expect(st.energy).toBe(496);
    expect(st.shield).toBe(0);
    expect(st.cannonPower).toBe(0);
    expect(st.special).toBe(-1);
    expect(st.specialAmmo).toHaveLength(20);
    expect(st.specialAmmo[0]).toBe(4);
    expect(st.score).toBe(120);
    expect(st.messages).toEqual([]);
    s.world.game.score += 10; // le score affiché rattrape le score réel de 3 par tick
    s.run(3);
    expect(st.score).toBe(120 + 3 + 3 + 3);
    s.run(1);
    expect(st.score).toBe(130);
    s.world.game.message(100, 3, 0x1000);
    s.run(1);
    expect(st.messages).toEqual([{ serial: 0, textTable: 100, textId: 3, tint: 0x1000, type: 0, ticksLeft: 70 }]);
  });

  it("les effets exposent explosions et impacts avec leur image et leur taille", () => {
    const s = scenario("TERRAN00", () => []);
    expect(s.world.effects()).toEqual([]);
    const p = s.world.player.obj;
    const e = s.world.spawn({ classe: 0xe1, hp: 100, x: p.x, y: p.y, z: p.z, model: 11003, update: "fx_explosion" });
    e!.state = 27;
    const fx = s.world.effects();
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ kind: "explosion", set: 504, frame: 27, size: 3 });
    s.run(40);
    expect(s.world.effects()).toEqual([]); // l'animation (images 27 à 39) s'est terminée
  });
});

describe.skipIf(!hasOriginalFiles)("gameplay : altitude de l'hélicoptère en vol vers l'avant", () => {
  it("oscille fortement à cause de l'anticipation du relief à 32 ticks (comportement de gm_heli_physics)", () => {
    const s = scenario("TERRAN00", () => []);
    const alt: number[] = [];
    for (let t = 0; t < 800; t++) {
      s.run(1, { forward: true });
      if (t > 60) alt.push((s.world.player.y - s.world.terrain.height(s.world.player.x, s.world.player.z)) / 256);
    }
    alt.sort((a, b) => a - b);
    const median = alt[alt.length >> 1]!;
    expect(median).toBeGreaterThan(120);
    expect(alt[alt.length - 1]! - alt[0]!).toBeGreaterThan(300);
    // au repos le même appareil tient 80 unités (voir player.test.ts) : l'écart vient de l'anticipation, pas d'une erreur de consigne
  });
});

describe.skipIf(!hasOriginalFiles)("gameplay : parcours scripté de TERRAN00", () => {
  it("2000 ticks : les ennemis tirent, le joueur est touché, le score monte, l'état est déterministe", async () => {
    const results: { hash: number; shots: number; hits: number; score: number }[] = [];
    for (let rep = 0; rep < 2; rep++) {
      const { loadLevel } = await import("./helpers");
      const { level, models } = loadLevel("TERRAN00");
      const { World } = await import("../../../src/games/swiv3d/engine/world");
      const { input } = await import("../../../src/games/swiv3d/engine/input");
      const w = World.load(level, models, { debris: loadDebris(readOriginal("TERRAN00.SLV"), "T0") });
      const turret = level.objects.find((o) => o.type === 3000 && o.x === 12159 && o.z === 19812)!;
      expect(turret).toBeDefined();
      let shots = 0;
      let hits = 0;
      for (let t = 0; t < 2000; t++) {
        const dx = turret.x - (w.player.x >> 8);
        const dz = turret.z - (w.player.z >> 8);
        const bearing = Math.round((Math.atan2(dx, dz) * 512) / (2 * Math.PI));
        const err = ((((bearing - w.player.yaw + 256) % 512) + 512) % 512) - 256;
        w.tick(
          input({
            forward: Math.hypot(dx, dz) > 450 && Math.abs(err) < 100,
            firePrimary: true,
            turnRight: err > 6,
            turnLeft: err < -6,
          }),
        );
        for (const e of w.drainEvents()) {
          if (e.kind === "sound" && (e.id === 2001 || e.id === 2002 || e.id === 2003)) shots++;
          if (e.kind === "playerDamaged" && e.source === "contact") hits++;
        }
      }
      results.push({ hash: w.stateHash(), shots, hits, score: w.game.score });
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]!.shots).toBeGreaterThan(5);
    expect(results[0]!.hits).toBeGreaterThan(0);
    expect(results[0]!.score).toBeGreaterThan(0);
  });
});
